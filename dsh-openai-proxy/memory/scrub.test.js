/** Tests for the de-identification layer that guards the verdict log and rule vault. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksIdentifying, scrub, scrubForStorage } from './scrub.js'

test('strips patient names after Vietnamese labels', () => {
  assert.match(scrub('Bệnh nhân: Nguyễn Văn An thiếu mục đánh giá'), /Bệnh nhân: \[TÊN\]/)
  assert.match(scrub('Họ và tên Trần Thị Bích Hạnh'), /Họ và tên \[TÊN\]/)
  assert.match(scrub('BN Lê Minh Quân đã ra viện'), /BN \[TÊN\]/)
})

test('keeps the surrounding clinical wording intact', () => {
  const out = scrub('Bệnh nhân: Nguyễn Văn An thiếu mục đánh giá nguy cơ băng huyết')
  assert.match(out, /thiếu mục đánh giá nguy cơ băng huyết/)
})

test('strips BHYT card numbers', () => {
  assert.match(scrub('Thẻ BHYT DN4010112345678 hợp lệ'), /\[BHYT\]/)
  assert.doesNotMatch(scrub('Thẻ BHYT DN4010112345678 hợp lệ'), /4010112345678/)
})

test('strips CCCD and CMND numbers', () => {
  assert.doesNotMatch(scrub('CCCD 001234567890'), /001234567890/)
  assert.doesNotMatch(scrub('CMND 123456789'), /123456789/)
})

test('strips phone numbers in local and +84 forms', () => {
  assert.doesNotMatch(scrub('SĐT 0912345678'), /0912345678/)
  assert.doesNotMatch(scrub('Liên hệ +84912345678'), /912345678/)
})

test('strips dates of birth in day-first forms', () => {
  assert.doesNotMatch(scrub('Sinh ngày 12/04/1978'), /1978/)
  assert.doesNotMatch(scrub('Ngày vào viện 03-11-2026'), /2026/)
})

test('strips record and admission identifiers', () => {
  assert.doesNotMatch(scrub('Hồ sơ HS-2026-08-18-0417'), /0417/)
  assert.doesNotMatch(scrub('Số vào viện SVV/88213'), /88213/)
})

test('strips street addresses', () => {
  assert.doesNotMatch(scrub('Địa chỉ 27 đường Trần Phú, Uông Bí'), /Trần Phú/)
})

test('strips names the model wrapped in Markdown emphasis', () => {
  const out = scrub('hồ sơ của bệnh nhân **Nguyễn Thị Hoa** đã hoàn tất')
  assert.doesNotMatch(out, /Nguyễn/)
  assert.match(out, /\[TÊN\]/)
})

test('strips names after a Markdown bold label', () => {
  const out = scrub('* **Họ và tên:** Nguyễn Thị Hoa\n* **Khoa:** Sản')
  assert.doesNotMatch(out, /Nguyễn/)
  assert.match(out, /Khoa:\*\* Sản/, 'other fields survive')
})

test('erases later unlabelled repeats of a name learned from a label', () => {
  const out = scrub('Bệnh nhân: Nguyễn Thị Hoa. Nguyễn Thị Hoa ổn định sau mổ.')
  assert.doesNotMatch(out, /Nguyễn/, 'the bare repeat must go too')
  assert.equal(out.match(/\[TÊN\]/g).length, 2)
})

test('reproduces the live leak that markdown output caused', () => {
  // Verbatim shape from a real gemma-4-12b review reply.
  const reply = 'Tôi đã nhận được thông tin hồ sơ bệnh án của bệnh nhân **Nguyễn Thị Hoa**.\n\n'
    + '* **Họ và tên:** Nguyễn Thị Hoa\n* **Ngày sinh:** 03/05/1990\n'
    + '* **Số CCCD:** 001290001111\n* **Số hồ sơ:** HS-2026-9001\n* **Khoa:** Sản'
  const out = scrub(reply)
  assert.doesNotMatch(out, /Nguyễn|Hoa/, 'no fragment of the name may survive')
  assert.doesNotMatch(out, /1990|001290001111|9001/)
  assert.match(out, /Sản/, 'the department still reaches the consolidator')
})

test('leaves de-identified clinical rules untouched', () => {
  const rule = 'Khoa Sản thường thiếu mục đánh giá nguy cơ băng huyết sau sinh'
  assert.equal(scrub(rule), rule)
})

test('leaves ICD codes and clinical measurements untouched', () => {
  const text = 'Mã ICD J18 hay bị ghi nhầm thành J15; huyết áp 120/80 mmHg'
  const out = scrub(text)
  assert.match(out, /J18/)
  assert.match(out, /J15/)
})

test('scrub is idempotent', () => {
  const once = scrub('Bệnh nhân: Nguyễn Văn An, CCCD 001234567890')
  assert.equal(scrub(once), once)
})

test('scrubForStorage caps length and collapses whitespace', () => {
  const long = `${'a'.repeat(900)}`
  const out = scrubForStorage(long, 100)
  assert.equal(out.length, 101)
  assert.match(out, /…$/)
  assert.equal(scrubForStorage('nhiều    khoảng   trắng'), 'nhiều khoảng trắng')
})

test('scrubForStorage handles empty and non-string input', () => {
  assert.equal(scrubForStorage(''), '')
  assert.equal(scrubForStorage(undefined), '')
  assert.equal(scrubForStorage(null), '')
})

test('looksIdentifying flags residual identifiers and passes clean rules', () => {
  assert.equal(looksIdentifying('Hồ sơ HS-2026-0417'), true)
  assert.equal(looksIdentifying('Sinh ngày 12/04/1978'), true)
  assert.equal(looksIdentifying('Khoa Sản thiếu mục đánh giá nguy cơ'), false)
})

test('looksIdentifying is satisfied by scrubbed output', () => {
  const raw = 'BN Nguyễn Văn An, sinh 12/04/1978, CCCD 001234567890, HS-2026-0417'
  assert.equal(looksIdentifying(scrub(raw)), false)
})
