/** Tests for the bounded rule store: merge, promote, expire, cap, and the identifier guard. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { enforceLimits, readRules, slugify, upsertRule } from './rules.js'
import { DEFAULTS } from './config.js'

const { draftTtlDays: DRAFT_TTL_DAYS, maxRules: MAX_RULES, promoteAt: PROMOTE_AT } = DEFAULTS

const DAY_MS = 24 * 60 * 60 * 1000

/** Fresh vault per test so cases cannot leak into each other. */
function vault() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-rules-'))
  return { dir, cleanup: () => { rmSync(dir, { recursive: true, force: true }) } }
}

test('slugify strips Vietnamese diacritics into a stable key', () => {
  assert.equal(slugify('Khoa Sản thiếu đánh giá'), 'khoa-san-thieu-danh-gia')
  assert.equal(slugify('  ĐÃ--- Ổn  '), 'da-on')
  assert.equal(slugify('!!!'), 'rule')
})

test('a new sighting creates a draft rule', () => {
  const v = vault()
  try {
    const res = upsertRule(v.dir, { code: 'san-thieu-bang-huyet', text: 'Khoa Sản thiếu đánh giá nguy cơ băng huyết' })
    assert.equal(res.status, 'created')
    assert.equal(res.rule.draft, true)
    assert.equal(res.rule.count, 1)
    assert.equal(readRules(v.dir).length, 1)
  } finally { v.cleanup() }
})

test('repeat sightings merge into one note instead of adding notes', () => {
  const v = vault()
  try {
    for (let i = 0; i < 5; i += 1) {
      upsertRule(v.dir, { code: 'san-thieu-bang-huyet', text: 'Khoa Sản thiếu đánh giá nguy cơ băng huyết' })
    }
    const rules = readRules(v.dir)
    assert.equal(rules.length, 1, 'five sightings must stay one note')
    assert.equal(rules[0].count, 5)
  } finally { v.cleanup() }
})

test('a rule is promoted out of draft at the sighting threshold', () => {
  const v = vault()
  try {
    for (let i = 1; i < PROMOTE_AT; i += 1) {
      const res = upsertRule(v.dir, { code: 'icd-nham', text: 'Mã ICD J18 hay bị ghi nhầm thành J15' })
      assert.equal(res.rule.draft, true, `still draft at sighting ${i}`)
    }
    const promoted = upsertRule(v.dir, { code: 'icd-nham', text: 'Mã ICD J18 hay bị ghi nhầm thành J15' })
    assert.equal(promoted.rule.count, PROMOTE_AT)
    assert.equal(promoted.rule.draft, false)
  } finally { v.cleanup() }
})

test('times lets one call record a whole batch of sightings', () => {
  const v = vault()
  try {
    const res = upsertRule(v.dir, { code: 'icd-nham', text: 'ICD hay ghi nhầm', times: 12 })
    assert.equal(res.rule.count, 12)
    assert.equal(res.rule.draft, false)
  } finally { v.cleanup() }
})

test('established wording survives later paraphrases, drafts still refine', () => {
  const v = vault()
  try {
    upsertRule(v.dir, { code: 'r', text: 'bản nháp đầu' })
    upsertRule(v.dir, { code: 'r', text: 'bản nháp sửa' })
    assert.equal(readRules(v.dir)[0].text, 'bản nháp sửa', 'draft text refines')

    upsertRule(v.dir, { code: 'r', text: 'bản đã chốt' })
    assert.equal(readRules(v.dir)[0].draft, false)
    upsertRule(v.dir, { code: 'r', text: 'diễn đạt lung tung khác' })
    assert.equal(readRules(v.dir)[0].text, 'bản đã chốt', 'established text is not churned')
  } finally { v.cleanup() }
})

test('an identifier in the incoming text is scrubbed, never stored raw', () => {
  const v = vault()
  try {
    const res = upsertRule(v.dir, { code: 'leak', text: 'Hồ sơ HS-2026-0417 thiếu mục đánh giá' })
    assert.equal(res.status, 'created')
    assert.doesNotMatch(res.rule.text, /0417/, 'record id must not reach the note')
    assert.match(res.rule.text, /\[MÃ_HS\]/)
    assert.match(res.rule.text, /thiếu mục đánh giá/, 'the learnable content survives')
    // What lands on disk is the scrubbed text, not the caller's original.
    assert.doesNotMatch(readRules(v.dir)[0].text, /0417/)
  } finally { v.cleanup() }
})

test('a name slips through as a scrubbed marker, not a name', () => {
  const v = vault()
  try {
    const res = upsertRule(v.dir, { code: 'ten', text: 'Bệnh nhân: Nguyễn Văn An thiếu mục đánh giá' })
    assert.equal(res.status, 'created')
    assert.doesNotMatch(res.rule.text, /Nguyễn/)
    assert.match(res.rule.text, /\[TÊN\]/)
  } finally { v.cleanup() }
})

test('empty content is refused', () => {
  const v = vault()
  try {
    assert.equal(upsertRule(v.dir, { code: 'x', text: '   ' }).status, 'rejected')
    assert.equal(upsertRule(v.dir, { code: 'x', text: undefined }).status, 'rejected')
  } finally { v.cleanup() }
})

test('stale drafts expire but established rules do not', () => {
  const v = vault()
  try {
    upsertRule(v.dir, { code: 'cu-nhap', text: 'quan sát một lần' })
    upsertRule(v.dir, { code: 'cu-chac', text: 'luật đã chốt', times: PROMOTE_AT })

    const later = Date.now() + (DRAFT_TTL_DAYS + 1) * DAY_MS
    const { expired } = enforceLimits(v.dir, { now: later })

    assert.deepEqual(expired, ['cu-nhap'])
    assert.deepEqual(readRules(v.dir).map(r => r.code), ['cu-chac'])
  } finally { v.cleanup() }
})

test('the store stays capped, evicting the weakest rule first', () => {
  const v = vault()
  try {
    upsertRule(v.dir, { code: 'yeu-nhat', text: 'chỉ gặp một lần' })
    for (let i = 0; i < MAX_RULES; i += 1) {
      upsertRule(v.dir, { code: `manh-${i}`, text: `luật số ${i}`, times: PROMOTE_AT + 1 })
    }
    const rules = readRules(v.dir)
    assert.equal(rules.length, MAX_RULES, 'store must not grow past the cap')
    assert.equal(rules.some(r => r.code === 'yeu-nhat'), false, 'weakest rule evicted first')
  } finally { v.cleanup() }
})

test('reading an absent vault yields no rules rather than throwing', () => {
  assert.deepEqual(readRules(path.join(tmpdir(), 'dsh-rules-does-not-exist')), [])
})
