/**
 * Regenerates the memory index in `$DSH_HOME/AGENTS.md` — the read side of the
 * learning loop.
 *
 * `@deepseek-ai/dsh-agent-instructions` loads that file into every session,
 * including each headless run the proxy spawns, so whatever lands here is what
 * the agent starts out knowing. Two properties matter:
 *
 *   - **Only established rules are listed.** A draft (seen fewer than
 *     `promoteAt` times) stays in the vault for review but is kept out of the
 *     model's context, so an unconfirmed guess never steers a review.
 *   - **One line per rule, body on demand.** The index is a table of contents,
 *     not the content; the agent reads a full note through the vault MCP server
 *     when it needs detail. A 12B model degrades quickly when its context is
 *     padded, so paying only for titles is what keeps this affordable.
 *
 * Text outside the generated markers is preserved, so a person can keep their
 * own standing instructions in the same file.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { readRules } from './rules.js'
import { DEFAULTS } from './config.js'

const BEGIN = '<!-- DSH-MEMORY:BEGIN — tự sinh, đừng sửa trong khối này -->'
const END = '<!-- DSH-MEMORY:END -->'

/** Default location of the instruction file dsh loads for every session. */
export function defaultAgentsPath(dshHome) {
  return path.join(dshHome, 'AGENTS.md')
}

/**
 * Render the generated block for a set of rules.
 * @param {object[]} rules - established rules, strongest first.
 * @returns {string} the block, markers included.
 */
function renderBlock(rules) {
  if (rules.length === 0) {
    return `${BEGIN}\n\n_Chưa tích luỹ luật nào._\n\n${END}`
  }
  const lines = rules.map(r => `- \`memory/${r.code}.md\` — ${r.text.split('\n')[0]} _(gặp ${r.count} lần)_`)
  return `${BEGIN}

## Trí nhớ đã tích luỹ

Đây là những quy luật rút ra từ các lần rà soát trước. Dùng làm gợi ý kiểm tra,
không phải kết luận — hồ sơ trước mắt luôn là căn cứ cuối cùng. Cần chi tiết thì
đọc file tương ứng trong vault qua công cụ \`vault\`.

${lines.join('\n')}

${END}`
}

/**
 * Rewrite the memory block in the instruction file.
 * @param {string} vaultDir - vault root holding `memory/`.
 * @param {string} agentsPath - path to the instruction file to update.
 * @param {object} [config] - effective settings.
 * @returns {{listed: number, skippedDrafts: number}} what the index now advertises.
 */
export function writeIndex(vaultDir, agentsPath, config = DEFAULTS) {
  const all = readRules(vaultDir, config)
  const established = all
    .filter(r => !r.draft && r.count >= config.promoteAt)
    .sort((a, b) => b.count - a.count)
  const block = renderBlock(established)

  let previous = ''
  try {
    previous = readFileSync(agentsPath, 'utf8')
  } catch {
    previous = ''
  }

  let next
  const start = previous.indexOf(BEGIN)
  const end = previous.indexOf(END)
  if (start !== -1 && end !== -1 && end > start) {
    // Preserve whatever a person wrote around the generated block.
    next = previous.slice(0, start) + block + previous.slice(end + END.length)
  } else if (previous.trim() === '') {
    next = `${block}\n`
  } else {
    next = `${previous.trimEnd()}\n\n${block}\n`
  }

  mkdirSync(path.dirname(agentsPath), { recursive: true })
  writeFileSync(agentsPath, next, 'utf8')
  return { listed: established.length, skippedDrafts: all.length - established.length }
}
