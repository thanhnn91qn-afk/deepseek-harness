/**
 * The verdict log: one scrubbed line per review, waiting to be consolidated.
 *
 * This is tier 1 of the memory pipeline. It is deliberately dumb — append a
 * de-identified, length-capped summary of what the agent concluded and move
 * on. All judgement happens later, in one batch, so a few hundred reviews a
 * day cost nothing extra at request time.
 *
 * Two placement rules matter:
 *   - **Outside the vault.** The vault is served over HTTP with permissive
 *     CORS; the verdict log is closer to the raw material and must not be
 *     reachable that way, so it lives under `$DSH_HOME`.
 *   - **Never the prompt.** Only the agent's own conclusion is retained. The
 *     record text that arrived in the request is not written anywhere.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { scrubForStorage } from './scrub.js'
import { DEFAULTS } from './config.js'

/** Roll the log over once it passes this size so it cannot grow without bound. */
const MAX_LOG_BYTES = 8 * 1024 * 1024

/** Location of the pending-verdict log. */
export function verdictLogPath(dshHome) {
  return path.join(dshHome, 'memory', 'verdicts.jsonl')
}

/**
 * Append one review outcome.
 *
 * Never throws: memory is a background concern and must not be able to fail a
 * request that already produced a good answer for the caller.
 * @param {string} dshHome - dsh home directory.
 * @param {{text: string, at?: string}} verdict - the agent's conclusion.
 * @param {object} [config] - effective settings.
 * @returns {boolean} true when a line was written.
 */
export function appendVerdict(dshHome, verdict, config = DEFAULTS) {
  try {
    const text = scrubForStorage(verdict?.text ?? '', config.maxVerdictChars)
    if (text === '') return false

    const file = verdictLogPath(dshHome)
    mkdirSync(path.dirname(file), { recursive: true })
    rollIfLarge(file)
    appendFileSync(file, `${JSON.stringify({ at: verdict.at ?? new Date().toISOString(), text })}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/** Move an oversized log aside so the active file stays bounded. */
function rollIfLarge(file) {
  try {
    if (statSync(file).size < MAX_LOG_BYTES) return
    renameSync(file, `${file}.1`)
  } catch {
    // Absent file, or a rename another process already did — nothing to roll.
  }
}

/**
 * Read pending verdicts.
 * @param {string} dshHome - dsh home directory.
 * @returns {{at: string, text: string}[]} parseable entries, oldest first.
 */
export function readVerdicts(dshHome) {
  let raw
  try {
    raw = readFileSync(verdictLogPath(dshHome), 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    try {
      const entry = JSON.parse(line)
      if (typeof entry?.text === 'string' && entry.text !== '') out.push(entry)
    } catch {
      // A torn final line from a crash mid-append; skip it.
    }
  }
  return out
}

/**
 * Drop consumed verdicts once they have been folded into rules.
 * @param {string} dshHome - dsh home directory.
 * @param {number} count - number of leading entries to remove.
 */
export function dropVerdicts(dshHome, count) {
  if (count <= 0) return
  const remaining = readVerdicts(dshHome).slice(count)
  const file = verdictLogPath(dshHome)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, remaining.map(e => `${JSON.stringify(e)}\n`).join(''), 'utf8')
}
