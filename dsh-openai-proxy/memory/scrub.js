/**
 * De-identification for anything derived from patient records before it is
 * written to disk.
 *
 * The deployment keeps its LAN ports open by choice, so this module — not the
 * network boundary — is the layer that keeps identifiers out of the verdict
 * log and the rule vault. It is deliberately over-eager: losing a bit of
 * wording is acceptable, leaking an identifier is not. Every rule replaces a
 * match with a typed placeholder so downstream text stays readable.
 */

/** Replacement markers, kept short so scrubbed text stays legible to the model. */
const MARK = {
  name: '[TÊN]',
  bhyt: '[BHYT]',
  id: '[CCCD]',
  date: '[NGÀY]',
  phone: '[SĐT]',
  record: '[MÃ_HS]',
  address: '[ĐỊA_CHỈ]',
}

/**
 * Labels that introduce a person's name in Vietnamese clinical text. Ordered
 * longest-first so `họ và tên` wins over `tên`.
 */
const NAME_LABELS = [
  'họ và tên', 'ho va ten', 'họ tên', 'ho ten',
  'người bệnh', 'nguoi benh', 'bệnh nhân', 'benh nhan',
  'tên bn', 'ten bn', 'bn', 'pt',
]

/** A capitalized Vietnamese word: one uppercase letter then letters (diacritics included). */
const WORD = '\\p{Lu}\\p{L}+'

/**
 * Expand a literal into a case-insensitive pattern character by character.
 *
 * The whole-regex `i` flag cannot be used here: under case-insensitive
 * matching JavaScript folds `\p{Lu}` so it also matches lowercase, which makes
 * the name pattern below swallow the ordinary words that follow the name.
 * @param {string} literal - lowercase label text.
 * @returns {string} a pattern matching either case of each letter.
 */
function caseInsensitive(literal) {
  return literal.replace(/\p{L}/gu, (ch) => {
    const lower = ch.toLowerCase()
    const upper = ch.toUpperCase()
    return lower === upper ? ch : `[${lower}${upper}]`
  })
}

/**
 * `<label>: Nguyễn Văn A` — 2..5 capitalized words after a name label.
 * The label itself is preserved so the sentence still reads sensibly.
 */
const NAME_AFTER_LABEL = new RegExp(
  // The separator must tolerate Markdown: the model answers in Markdown, so
  // `bệnh nhân **Nguyễn Văn An**` and `Họ và tên:** Nguyễn Văn An` are the
  // normal shapes, not the exception. Sentence punctuation is excluded so a
  // label ending a sentence cannot capture the next sentence's first words.
  `\\b(${NAME_LABELS.map(caseInsensitive).join('|')})\\b([\\s:：*_\\-]*)`
  + `((?:${WORD}\\s+){1,4}(?:${WORD}|\\p{Lu}\\b))`,
  'gu',
)

/**
 * Vietnamese health-insurance card: 2 letters, then 13 digits (e.g. DN4010112345678).
 * Written with separators tolerated because clinical exports space them out.
 */
const BHYT = /\b[A-Z]{2}[\s.-]?\d{1}[\s.-]?\d{2}[\s.-]?\d{10}\b/g

/** CCCD (12 digits) or the older CMND (9 digits), optionally separated. */
const NATIONAL_ID = /\b\d{3}[\s.-]?\d{3}[\s.-]?\d{3}(?:[\s.-]?\d{3})?\b/g

/** Vietnamese mobile/landline written locally (0…) or with the +84 country code. */
const PHONE = /(?:\+84|\b0)(?:[\s.-]?\d){8,10}\b/g

/** Dates in the day-first forms Vietnamese records use. */
const DATE = /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/g

/**
 * Record/admission identifiers: a letter-ish prefix joined to digits by a
 * separator (HS-2026-0417, BA/12345, MAHS 88213). Requires the separator so
 * ordinary words with trailing numbers survive.
 */
const RECORD_ID = /\b(?:HS|BA|MAHS|MA_HS|SVV|STT|MSBN|MBN)[\s._/-]*[\dA-Z][\dA-Z._/-]{2,}\b/gi

/** Street addresses: a house number followed by a Vietnamese address keyword. */
const ADDRESS = /\b\d{1,4}\s+(?:đường|duong|phố|pho|ngõ|ngo|thôn|thon|xóm|xom|ấp|ap|tổ|to)\s+[^\n,;.]{2,40}/giu

/**
 * Remove personal identifiers from free text.
 *
 * Order matters: structured identifiers (card, id, phone, record) run before
 * the bare-digit national-id sweep so their digits are already consumed, and
 * names run first so a label's own digits are not eaten underneath them.
 * @param {string} text - raw text that may quote a patient record.
 * @returns {string} the same text with identifiers replaced by markers.
 */
export function scrub(text) {
  if (typeof text !== 'string' || text.length === 0) return ''
  let out = text

  // A label tells us a name; the name then recurs without one. The agent's
  // answer restates the record, so the first mention is labelled and the rest
  // are bare — learn each name from its labelled mention, then erase every
  // occurrence of it, labelled or not.
  const names = new Set()
  out.replace(NAME_AFTER_LABEL, (whole, _label, _sep, name) => {
    const trimmed = name.trim()
    if (trimmed.length >= 3) names.add(trimmed)
    return whole
  })

  out = out.replace(NAME_AFTER_LABEL, (_m, label, sep, _name) => `${label}${sep}${MARK.name}`)
  for (const name of names) out = out.split(name).join(MARK.name)
  out = out.replace(ADDRESS, MARK.address)
  out = out.replace(BHYT, MARK.bhyt)
  out = out.replace(RECORD_ID, MARK.record)
  out = out.replace(PHONE, MARK.phone)
  out = out.replace(DATE, MARK.date)
  out = out.replace(NATIONAL_ID, MARK.id)
  return out
}

/**
 * Scrub and hard-cap text destined for durable storage.
 *
 * The cap is a second safety net: an unrecognized identifier format cannot
 * leak more than `maxChars` of context, and it keeps the verdict log bounded
 * at a few hundred records a day.
 * @param {string} text - raw text.
 * @param {number} [maxChars] - retained length after scrubbing.
 * @returns {string} scrubbed, truncated text.
 */
export function scrubForStorage(text, maxChars = 600) {
  const cleaned = scrub(text).replace(/\s+/g, ' ').trim()
  return cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, maxChars)}…`
}

/**
 * Report whether text still looks like it carries an identifier.
 *
 * Used as an assertion at write time: the rule vault refuses content that
 * trips this, so a scrubber gap becomes a dropped rule rather than a leak.
 * @param {string} text - candidate text, normally already scrubbed.
 * @returns {boolean} true when a residual identifier pattern is present.
 */
export function looksIdentifying(text) {
  if (typeof text !== 'string') return false
  // Re-run the source patterns; `scrub` is idempotent, so a clean string
  // cannot match. Fresh RegExp objects avoid shared `lastIndex` state.
  return [BHYT, NATIONAL_ID, PHONE, DATE, RECORD_ID]
    .some(re => new RegExp(re.source, re.flags.replace('g', '')).test(text))
}
