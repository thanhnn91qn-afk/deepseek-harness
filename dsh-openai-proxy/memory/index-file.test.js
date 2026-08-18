/** Tests for the generated memory index that every session loads. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { writeIndex } from './index-file.js'
import { upsertRule } from './rules.js'
import { DEFAULTS } from './config.js'

const { promoteAt: PROMOTE_AT } = DEFAULTS

function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-index-'))
  return {
    vault: dir,
    agents: path.join(dir, 'AGENTS.md'),
    cleanup: () => { rmSync(dir, { recursive: true, force: true }) },
  }
}

test('established rules are listed with their sighting count', () => {
  const w = workspace()
  try {
    upsertRule(w.vault, { code: 'san-bang-huyet', text: 'Khoa Sản thiếu đánh giá nguy cơ băng huyết', times: 34 })
    const res = writeIndex(w.vault, w.agents)

    assert.equal(res.listed, 1)
    const out = readFileSync(w.agents, 'utf8')
    assert.match(out, /memory\/san-bang-huyet\.md/)
    assert.match(out, /Khoa Sản thiếu đánh giá nguy cơ băng huyết/)
    assert.match(out, /gặp 34 lần/)
  } finally { w.cleanup() }
})

test('drafts are kept out of the index but remain in the vault', () => {
  const w = workspace()
  try {
    upsertRule(w.vault, { code: 'chua-chac', text: 'quan sát mới gặp một lần' })
    const res = writeIndex(w.vault, w.agents)

    assert.equal(res.listed, 0)
    assert.equal(res.skippedDrafts, 1)
    assert.doesNotMatch(readFileSync(w.agents, 'utf8'), /quan sát mới gặp/)
  } finally { w.cleanup() }
})

test('a rule appears in the index only once it is promoted', () => {
  const w = workspace()
  try {
    for (let i = 1; i < PROMOTE_AT; i += 1) {
      upsertRule(w.vault, { code: 'dan-dan', text: 'luật đang hình thành' })
    }
    assert.equal(writeIndex(w.vault, w.agents).listed, 0)

    upsertRule(w.vault, { code: 'dan-dan', text: 'luật đang hình thành' })
    assert.equal(writeIndex(w.vault, w.agents).listed, 1)
    assert.match(readFileSync(w.agents, 'utf8'), /luật đang hình thành/)
  } finally { w.cleanup() }
})

test('rules are ordered by how often they were seen', () => {
  const w = workspace()
  try {
    upsertRule(w.vault, { code: 'it', text: 'luật ít gặp', times: 3 })
    upsertRule(w.vault, { code: 'nhieu', text: 'luật hay gặp', times: 40 })
    writeIndex(w.vault, w.agents)

    const out = readFileSync(w.agents, 'utf8')
    assert.ok(out.indexOf('luật hay gặp') < out.indexOf('luật ít gặp'), 'most frequent rule first')
  } finally { w.cleanup() }
})

test('hand-written instructions around the block survive regeneration', () => {
  const w = workspace()
  try {
    writeFileSync(w.agents, '# Ghi chú của tôi\n\nLuôn trả lời bằng tiếng Việt.\n', 'utf8')
    upsertRule(w.vault, { code: 'r', text: 'một luật', times: PROMOTE_AT })

    writeIndex(w.vault, w.agents)
    upsertRule(w.vault, { code: 'r2', text: 'luật thứ hai', times: PROMOTE_AT })
    writeIndex(w.vault, w.agents)

    const out = readFileSync(w.agents, 'utf8')
    assert.match(out, /Luôn trả lời bằng tiếng Việt/, 'personal instructions preserved')
    assert.match(out, /luật thứ hai/)
    assert.equal(out.match(/DSH-MEMORY:BEGIN/g).length, 1, 'exactly one generated block')
  } finally { w.cleanup() }
})

test('regenerating repeatedly does not accumulate blocks', () => {
  const w = workspace()
  try {
    upsertRule(w.vault, { code: 'r', text: 'một luật', times: PROMOTE_AT })
    for (let i = 0; i < 4; i += 1) writeIndex(w.vault, w.agents)

    const out = readFileSync(w.agents, 'utf8')
    assert.equal(out.match(/DSH-MEMORY:BEGIN/g).length, 1)
    assert.equal(out.match(/DSH-MEMORY:END/g).length, 1)
  } finally { w.cleanup() }
})

test('an empty store still writes a well-formed placeholder block', () => {
  const w = workspace()
  try {
    assert.equal(writeIndex(w.vault, w.agents).listed, 0)
    const out = readFileSync(w.agents, 'utf8')
    assert.match(out, /Chưa tích luỹ luật nào/)
    assert.match(out, /DSH-MEMORY:END/)
  } finally { w.cleanup() }
})
