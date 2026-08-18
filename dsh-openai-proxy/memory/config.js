/**
 * Tunable parameters for the memory pipeline.
 *
 * How much the vault is allowed to remember, and how many sightings earn a
 * place in it, are judgement calls that depend on the workload — so they are
 * settings, not constants. Resolution order is defaults → `config.json` →
 * environment, so a launcher can force a value while the file stays the
 * everyday place to tune things.
 *
 * Every value is validated and clamped on the way in: a typo in a hand-edited
 * file must degrade to a sane number, never break the pipeline or silently
 * disable the size cap.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Starting values, chosen for a few hundred record reviews a day. */
export const DEFAULTS = {
  maxRules: 80,
  promoteAt: 3,
  draftTtlDays: 30,
  chunkSize: 20,
  minVerdicts: 5,
  intervalMs: 3 * 60 * 60 * 1000,
  maxVerdictChars: 600,
}

/**
 * Allowed range per setting. The bounds are deliberately wide — they exist to
 * stop a value that would break the pipeline (a zero cap, a chunk too large
 * for the model's context), not to second-guess the operator.
 */
const BOUNDS = {
  maxRules: { min: 1, max: 5000 },
  promoteAt: { min: 1, max: 100 },
  draftTtlDays: { min: 1, max: 3650 },
  chunkSize: { min: 1, max: 100 },
  minVerdicts: { min: 1, max: 10000 },
  intervalMs: { min: 0, max: 7 * 24 * 60 * 60 * 1000 },
  maxVerdictChars: { min: 80, max: 5000 },
}

/** Vietnamese descriptions written into the config file so it explains itself. */
const DOC = {
  maxRules: 'Số luật tối đa giữ trong vault. Vượt quá thì luật yếu nhất bị loại.',
  promoteAt: 'Số lần lặp tối thiểu để một quan sát thành luật chính thức và được đưa vào AGENTS.md.',
  draftTtlDays: 'Nháp không tái xuất hiện sau bao nhiêu ngày thì tự xoá.',
  chunkSize: 'Số nhận xét gửi model mỗi lần chưng cất. Lớn quá thì model 12B kém chính xác.',
  minVerdicts: 'Dưới ngưỡng này thì bỏ qua, chưa đủ dữ liệu để thấy mẫu lặp.',
  intervalMs: 'Chu kỳ tự động hợp nhất, tính bằng mili-giây. Đặt 0 để chỉ chạy khi gọi tay.',
  maxVerdictChars: 'Số ký tự giữ lại của mỗi nhận xét sau khi khử định danh.',
}

/** Environment variable carrying each setting, when one is set. */
const ENV_KEYS = {
  maxRules: 'MEMORY_MAX_RULES',
  promoteAt: 'MEMORY_PROMOTE_AT',
  draftTtlDays: 'MEMORY_DRAFT_TTL_DAYS',
  chunkSize: 'MEMORY_CHUNK_SIZE',
  minVerdicts: 'MEMORY_MIN_VERDICTS',
  intervalMs: 'MEMORY_INTERVAL_MS',
  maxVerdictChars: 'MEMORY_MAX_VERDICT_CHARS',
}

/** Location of the editable settings file. */
export function configPath(dshHome) {
  return path.join(dshHome, 'memory', 'config.json')
}

/**
 * Coerce and clamp a candidate settings object.
 *
 * Unknown keys are dropped and unusable values fall back to the default, so
 * the result is always a complete, usable configuration.
 * @param {object} candidate - partial settings from any source.
 * @param {object} [base] - values to start from.
 * @returns {{config: object, rejected: string[]}} the usable config and which keys were unusable.
 */
/**
 * Coerce only genuine numbers and numeric strings.
 *
 * `Number()` alone is unusable here: it turns `null`, `''`, `false` and `[]`
 * into 0, which clamps to a bound's minimum. For `promoteAt` that minimum is
 * 1 — every lone observation would become an established rule — so a junk
 * value must fall back to the default rather than silently become the most
 * permissive setting available.
 * @param {unknown} value - candidate from a file or environment.
 * @returns {number|undefined} the number, or undefined when unusable.
 */
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

export function validateConfig(candidate, base = DEFAULTS) {
  const config = { ...DEFAULTS, ...base }
  const rejected = []
  if (candidate === null || typeof candidate !== 'object') return { config, rejected }

  for (const [key, bound] of Object.entries(BOUNDS)) {
    if (!(key in candidate)) continue
    const raw = toNumber(candidate[key])
    if (raw === undefined) {
      rejected.push(key)
      continue
    }
    const clamped = Math.min(bound.max, Math.max(bound.min, Math.trunc(raw)))
    if (clamped !== Math.trunc(raw)) rejected.push(key)
    config[key] = clamped
  }
  return { config, rejected }
}

/** Read the settings file, tolerating absence and malformed content. */
function readFile(dshHome) {
  try {
    const parsed = JSON.parse(readFileSync(configPath(dshHome), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Collect whichever settings the environment overrides. */
function readEnv(env) {
  const out = {}
  for (const [key, name] of Object.entries(ENV_KEYS)) {
    if (env[name] !== undefined && env[name] !== '') out[key] = env[name]
  }
  return out
}

/**
 * Resolve the effective configuration.
 * @param {string} dshHome - dsh home directory.
 * @param {object} [env] - environment to read overrides from.
 * @returns {object} a complete, validated configuration.
 */
export function loadConfig(dshHome, env = process.env) {
  const fromFile = validateConfig(readFile(dshHome)).config
  return validateConfig(readEnv(env), fromFile).config
}

/**
 * Write settings to disk, merged over what is already there.
 *
 * The file is rewritten with its `_ghiChu` documentation block so it stays
 * self-explanatory for whoever opens it next.
 * @param {string} dshHome - dsh home directory.
 * @param {object} partial - settings to change.
 * @returns {{config: object, rejected: string[]}} the stored config and unusable keys.
 */
export function saveConfig(dshHome, partial) {
  const current = validateConfig(readFile(dshHome)).config
  const { config, rejected } = validateConfig(partial, current)
  const file = configPath(dshHome)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ ...config, _ghiChu: DOC }, null, 2)}\n`, 'utf8')
  return { config, rejected }
}

/**
 * Create the settings file with defaults if it does not exist yet.
 * @param {string} dshHome - dsh home directory.
 * @returns {object} the effective configuration afterwards.
 */
export function ensureConfigFile(dshHome) {
  try {
    readFileSync(configPath(dshHome), 'utf8')
  } catch {
    saveConfig(dshHome, {})
  }
  return loadConfig(dshHome)
}

/** Settings metadata for a UI or an operator reading the API. */
export function describeConfig() {
  return Object.entries(BOUNDS).map(([key, bound]) => ({
    key, ...bound, default: DEFAULTS[key], doc: DOC[key],
  }))
}
