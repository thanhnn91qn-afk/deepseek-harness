/** Tests for verdict logging and the consolidation step's parsing/validation. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appendVerdict, dropVerdicts, readVerdicts } from './verdicts.js'
import { extractJsonArray, validateProposals } from './consolidate.js'

function home() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-verdict-'))
  return { dir, cleanup: () => { rmSync(dir, { recursive: true, force: true }) } }
}

test('a verdict is stored scrubbed', () => {
  const h = home()
  try {
    appendVerdict(h.dir, { text: 'Hồ sơ HS-2026-0417 của BN Nguyễn Văn An thiếu mục đánh giá' })
    const [entry] = readVerdicts(h.dir)

    assert.doesNotMatch(entry.text, /0417/)
    assert.doesNotMatch(entry.text, /Nguyễn/)
    assert.match(entry.text, /thiếu mục đánh giá/)
  } finally { h.cleanup() }
})

test('empty or unusable verdicts are not written', () => {
  const h = home()
  try {
    assert.equal(appendVerdict(h.dir, { text: '   ' }), false)
    assert.equal(appendVerdict(h.dir, {}), false)
    assert.equal(appendVerdict(h.dir, null), false)
    assert.deepEqual(readVerdicts(h.dir), [])
  } finally { h.cleanup() }
})

test('verdicts accumulate in order and can be consumed from the front', () => {
  const h = home()
  try {
    for (let i = 0; i < 5; i += 1) appendVerdict(h.dir, { text: `nhận xét số ${i}` })
    assert.equal(readVerdicts(h.dir).length, 5)

    dropVerdicts(h.dir, 3)
    const rest = readVerdicts(h.dir)
    assert.equal(rest.length, 2)
    assert.match(rest[0].text, /số 3/)
  } finally { h.cleanup() }
})

test('reading an absent log yields nothing rather than throwing', () => {
  assert.deepEqual(readVerdicts(path.join(tmpdir(), 'dsh-verdict-missing')), [])
})

test('extractJsonArray reads a bare array', () => {
  assert.deepEqual(extractJsonArray('[{"code":"a","text":"b"}]'), [{ code: 'a', text: 'b' }])
})

test('extractJsonArray reads a fenced array and ignores surrounding prose', () => {
  const reply = 'Đây là kết quả:\n```json\n[{"code":"a","text":"b","times":3}]\n```\nHy vọng giúp ích.'
  assert.deepEqual(extractJsonArray(reply), [{ code: 'a', text: 'b', times: 3 }])
})

test('extractJsonArray returns empty for unusable replies', () => {
  assert.deepEqual(extractJsonArray('không tìm thấy vấn đề nào'), [])
  assert.deepEqual(extractJsonArray('[bị cắt giữa chừng'), [])
  assert.deepEqual(extractJsonArray(undefined), [])
  assert.deepEqual(extractJsonArray('{"code":"a"}'), [], 'an object is not an array')
})

test('validateProposals drops entries missing code or text', () => {
  const out = validateProposals([
    { code: 'ok', text: 'một luật hợp lệ', times: 4 },
    { code: '', text: 'thiếu code' },
    { code: 'thieu-text', text: '   ' },
    { text: 'không có code' },
    null,
    'chuỗi lạc',
  ])
  assert.deepEqual(out, [{ code: 'ok', text: 'một luật hợp lệ', times: 4 }])
})

test('validateProposals rejects narration dressed up as a rule', () => {
  assert.deepEqual(validateProposals([{ code: 'dai', text: 'x'.repeat(201) }]), [])
})

test('validateProposals normalizes the sighting count', () => {
  assert.deepEqual(validateProposals([{ code: 'a', text: 't' }]), [{ code: 'a', text: 't', times: 1 }])
  assert.equal(validateProposals([{ code: 'a', text: 't', times: 0 }])[0].times, 1)
  assert.equal(validateProposals([{ code: 'a', text: 't', times: -5 }])[0].times, 1)
  assert.equal(validateProposals([{ code: 'a', text: 't', times: 7.9 }])[0].times, 7)
  assert.equal(validateProposals([{ code: 'a', text: 't', times: 'nhiều' }])[0].times, 1)
})
