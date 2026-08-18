/**
 * The bounded rule store: what the agent has actually learned, kept in
 * `<vault>/memory/*.md` as Obsidian-readable notes.
 *
 * Reviewing hundreds of records a day must NOT produce hundreds of notes. A
 * rule is keyed by a stable `code`, so a repeated observation increments one
 * note instead of adding another, and the store stays flat in size while
 * getting denser in signal:
 *
 *   - merge over append   — same `code` updates the existing note
 *   - promote at N        — a draft becomes a rule at `promoteAt` sightings
 *   - expire stale drafts — a draft idle for `draftTtlDays` is dropped
 *   - hard cap            — past `maxRules` the weakest rule makes way
 *
 * All four thresholds are settings (see `config.js`), and draft status is
 * recomputed from the current `promoteAt` on every read, so retuning takes
 * effect immediately rather than only for rules seen afterwards.
 *
 * Nothing identifying may land here: every write runs the scrubber's
 * `looksIdentifying` assertion and refuses rather than risk a leak.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { looksIdentifying, scrub } from './scrub.js'
import { DEFAULTS } from './config.js'

const DAY_MS = 24 * 60 * 60 * 1000

/** Directory holding the rule notes inside the vault. */
export function memoryDir(vaultDir) {
  return path.join(vaultDir, 'memory')
}

/**
 * Turn free text into a stable, filesystem-safe rule key.
 * @param {string} text - the code or title to slugify.
 * @returns {string} a lowercase hyphenated slug.
 */
export function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'rule'
}

/** Parse the small frontmatter subset these notes use (no YAML dependency). */
function parseNote(raw) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw)
  if (match === null) return { meta: {}, body: raw.trim() }
  const meta = {}
  for (const line of match[1].split('\n')) {
    const kv = /^([a-zA-Z][\w]*):\s*(.*)$/.exec(line.trim())
    if (kv === null) continue
    const value = kv[2].trim()
    if (value === 'true' || value === 'false') meta[kv[1]] = value === 'true'
    else if (/^-?\d+$/.test(value)) meta[kv[1]] = Number(value)
    else meta[kv[1]] = value.replace(/^["']|["']$/g, '')
  }
  return { meta, body: match[2].trim() }
}

/** Render a rule back to note text. */
function renderNote(rule) {
  return `---
code: ${rule.code}
draft: ${rule.draft}
count: ${rule.count}
firstSeen: ${rule.firstSeen}
lastSeen: ${rule.lastSeen}
---

${rule.text}
`
}

/**
 * Read every rule currently stored.
 *
 * Draft status is derived from `count` against the CURRENT `promoteAt` rather
 * than trusted from the file, so lowering the threshold promotes the rules
 * that already qualify instead of waiting for them to be seen again.
 * @param {string} vaultDir - vault root.
 * @param {object} [config] - effective settings.
 * @returns {object[]} rules, newest sighting first.
 */
export function readRules(vaultDir, config = DEFAULTS) {
  const dir = memoryDir(vaultDir)
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const rules = []
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.md')) continue
    const full = path.join(dir, name)
    let raw
    try {
      raw = readFileSync(full, 'utf8')
    } catch {
      continue
    }
    const { meta, body } = parseNote(raw)
    const mtime = statSync(full).mtimeMs
    const count = Number.isInteger(meta.count) ? meta.count : 1
    rules.push({
      file: name,
      code: typeof meta.code === 'string' && meta.code !== '' ? meta.code : path.basename(name, '.md'),
      draft: count < config.promoteAt,
      count,
      firstSeen: meta.firstSeen ?? new Date(mtime).toISOString(),
      lastSeen: meta.lastSeen ?? new Date(mtime).toISOString(),
      text: body,
    })
  }
  return rules.sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
}

/**
 * Rank rules weakest-first for eviction: drafts before established rules, then
 * fewer sightings, then least recently confirmed.
 */
function weakestFirst(a, b) {
  if (a.draft !== b.draft) return a.draft ? -1 : 1
  if (a.count !== b.count) return a.count - b.count
  return Date.parse(a.lastSeen) - Date.parse(b.lastSeen)
}

/**
 * Record one sighting of a rule, creating or merging as needed.
 *
 * Merging is what keeps the store flat: the same `code` seen again bumps its
 * counter and refreshes `lastSeen` rather than adding a note. `text` replaces
 * the stored wording only while the rule is still a draft, so an established
 * rule's reviewed phrasing is not churned by later paraphrases.
 * @param {string} vaultDir - vault root.
 * @param {{code: string, text: string, seenAt?: string, times?: number}} sighting - observation to record.
 * @param {object} [config] - effective settings.
 * @returns {{status: 'created'|'merged'|'rejected', rule?: object, reason?: string}} outcome.
 */
export function upsertRule(vaultDir, sighting, config = DEFAULTS) {
  const text = scrub(String(sighting.text ?? '')).trim()
  if (text === '') return { status: 'rejected', reason: 'empty' }
  if (looksIdentifying(text)) return { status: 'rejected', reason: 'identifying' }

  const code = slugify(sighting.code ?? text)
  const seenAt = sighting.seenAt ?? new Date().toISOString()
  const times = Number.isInteger(sighting.times) && sighting.times > 0 ? sighting.times : 1
  const dir = memoryDir(vaultDir)
  mkdirSync(dir, { recursive: true })

  const existing = readRules(vaultDir, config).find(r => r.code === code)
  const rule = existing === undefined
    ? { code, draft: true, count: times, firstSeen: seenAt, lastSeen: seenAt, text }
    : {
        ...existing,
        count: existing.count + times,
        lastSeen: seenAt,
        text: existing.draft ? text : existing.text,
      }
  rule.draft = rule.count < config.promoteAt

  writeFileSync(path.join(dir, `${code}.md`), renderNote(rule), 'utf8')
  enforceLimits(vaultDir, { keepCode: code, config })
  return { status: existing === undefined ? 'created' : 'merged', rule }
}

/**
 * Apply expiry and the size cap.
 *
 * Called after each write, and safe to call on its own (e.g. from a daily
 * job) so drafts still age out on a day with no new sightings.
 * @param {string} vaultDir - vault root.
 * @param {{now?: number, keepCode?: string, config?: object}} [options] - injected clock, an exempt rule, and settings.
 * @returns {{expired: string[], evicted: string[]}} codes removed by each policy.
 */
export function enforceLimits(vaultDir, options = {}) {
  const config = options.config ?? DEFAULTS
  const now = options.now ?? Date.now()
  const dir = memoryDir(vaultDir)
  const expired = []
  const evicted = []

  let rules = readRules(vaultDir, config)

  for (const rule of rules) {
    if (!rule.draft) continue
    if (rule.code === options.keepCode) continue
    if (now - Date.parse(rule.lastSeen) <= config.draftTtlDays * DAY_MS) continue
    rmSync(path.join(dir, rule.file), { force: true })
    expired.push(rule.code)
  }

  rules = readRules(vaultDir, config).sort(weakestFirst)
  while (rules.length > config.maxRules) {
    const victim = rules.shift()
    if (victim === undefined) break
    if (victim.code === options.keepCode) continue
    rmSync(path.join(dir, victim.file), { force: true })
    evicted.push(victim.code)
  }

  return { expired, evicted }
}
