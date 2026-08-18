/** Tests for the tunable settings and their effect on an existing rule store. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  DEFAULTS, configPath, describeConfig, ensureConfigFile,
  loadConfig, saveConfig, validateConfig,
} from './config.js'
import { enforceLimits, readRules, upsertRule } from './rules.js'
import { writeIndex } from './index-file.js'

function home() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-config-'))
  return { dir, cleanup: () => { rmSync(dir, { recursive: true, force: true }) } }
}

test('an absent config file yields the defaults', () => {
  const h = home()
  try {
    assert.deepEqual(loadConfig(h.dir, {}), DEFAULTS)
  } finally { h.cleanup() }
})

test('the config file is created with defaults on first use', () => {
  const h = home()
  try {
    ensureConfigFile(h.dir)
    const written = JSON.parse(readFileSync(configPath(h.dir), 'utf8'))
    assert.equal(written.maxRules, DEFAULTS.maxRules)
    assert.equal(written.promoteAt, DEFAULTS.promoteAt)
    assert.ok(written._ghiChu.promoteAt.length > 0, 'file explains itself')
  } finally { h.cleanup() }
})

test('saved settings are read back', () => {
  const h = home()
  try {
    saveConfig(h.dir, { maxRules: 25, promoteAt: 2 })
    const config = loadConfig(h.dir, {})
    assert.equal(config.maxRules, 25)
    assert.equal(config.promoteAt, 2)
    assert.equal(config.draftTtlDays, DEFAULTS.draftTtlDays, 'untouched keys keep their default')
  } finally { h.cleanup() }
})

test('the environment overrides the file', () => {
  const h = home()
  try {
    saveConfig(h.dir, { maxRules: 25 })
    assert.equal(loadConfig(h.dir, { MEMORY_MAX_RULES: '7' }).maxRules, 7)
    assert.equal(loadConfig(h.dir, { MEMORY_MAX_RULES: '' }).maxRules, 25, 'blank is not an override')
  } finally { h.cleanup() }
})

test('out-of-range values are clamped and reported', () => {
  const { config, rejected } = validateConfig({ maxRules: 0, promoteAt: 99999 })
  assert.equal(config.maxRules, 1)
  assert.equal(config.promoteAt, 100)
  assert.deepEqual(rejected.sort(), ['maxRules', 'promoteAt'])
})

test('unusable values fall back to the default instead of breaking the pipeline', () => {
  const { config, rejected } = validateConfig({ maxRules: 'nhiều', promoteAt: null })
  assert.equal(config.maxRules, DEFAULTS.maxRules)
  assert.equal(config.promoteAt, DEFAULTS.promoteAt)
  assert.ok(rejected.includes('maxRules'))
  assert.ok(rejected.includes('promoteAt'))
})

test('junk never collapses a threshold to its most permissive value', () => {
  // Number(null/''/false/[]) is 0, which would clamp promoteAt to 1 and turn
  // every single observation into an established rule.
  for (const junk of [null, undefined, '', '   ', false, true, [], {}, NaN]) {
    const { config } = validateConfig({ promoteAt: junk, maxRules: junk })
    assert.equal(config.promoteAt, DEFAULTS.promoteAt, `promoteAt survives ${JSON.stringify(junk)}`)
    assert.equal(config.maxRules, DEFAULTS.maxRules, `maxRules survives ${JSON.stringify(junk)}`)
  }
})

test('numeric strings from a hand-edited file are accepted', () => {
  const { config } = validateConfig({ maxRules: '40', promoteAt: ' 5 ' })
  assert.equal(config.maxRules, 40)
  assert.equal(config.promoteAt, 5)
})

test('unknown keys are ignored', () => {
  const { config } = validateConfig({ khongCoThat: 5 })
  assert.equal(config.khongCoThat, undefined)
  assert.deepEqual(config, DEFAULTS)
})

test('a corrupt config file degrades to defaults', () => {
  const h = home()
  try {
    ensureConfigFile(h.dir)
    writeFileSync(configPath(h.dir), '{ this is not json', 'utf8')
    assert.deepEqual(loadConfig(h.dir, {}), DEFAULTS)
  } finally { h.cleanup() }
})

test('describeConfig documents every setting with its bounds', () => {
  const fields = describeConfig()
  assert.equal(fields.length, Object.keys(DEFAULTS).length)
  for (const field of fields) {
    assert.ok(field.doc.length > 0, `${field.key} has a description`)
    assert.ok(field.min <= field.default && field.default <= field.max, `${field.key} default in range`)
  }
})

test('lowering promoteAt promotes qualifying rules retroactively', () => {
  const h = home()
  try {
    const strict = { ...DEFAULTS, promoteAt: 5 }
    upsertRule(h.dir, { code: 'r', text: 'quan sát lặp lại', times: 3 }, strict)
    assert.equal(readRules(h.dir, strict)[0].draft, true, 'draft under the strict threshold')

    const relaxed = { ...DEFAULTS, promoteAt: 2 }
    assert.equal(readRules(h.dir, relaxed)[0].draft, false, 'promoted immediately, no new sighting needed')
  } finally { h.cleanup() }
})

test('raising promoteAt demotes rules that no longer qualify', () => {
  const h = home()
  try {
    upsertRule(h.dir, { code: 'r', text: 'luật vừa đủ', times: 3 })
    const agents = path.join(h.dir, 'AGENTS.md')
    assert.equal(writeIndex(h.dir, agents, DEFAULTS).listed, 1)

    const strict = { ...DEFAULTS, promoteAt: 10 }
    assert.equal(writeIndex(h.dir, agents, strict).listed, 0, 'dropped out of the model-visible index')
    assert.doesNotMatch(readFileSync(agents, 'utf8'), /luật vừa đủ/)
  } finally { h.cleanup() }
})

test('lowering maxRules evicts down to the new cap', () => {
  const h = home()
  try {
    for (let i = 0; i < 10; i += 1) {
      upsertRule(h.dir, { code: `r-${i}`, text: `luật ${i}`, times: i + 1 })
    }
    assert.equal(readRules(h.dir).length, 10)

    const tight = { ...DEFAULTS, maxRules: 4 }
    enforceLimits(h.dir, { config: tight })
    const left = readRules(h.dir, tight)
    assert.equal(left.length, 4)
    assert.ok(left.every(r => r.count >= 7), 'the strongest rules are the survivors')
  } finally { h.cleanup() }
})
