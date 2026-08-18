/**
 * Tier 2 of the memory pipeline: turn a pile of verdicts into a few rules.
 *
 * The split of labour is the whole point. Deterministic code owns counting,
 * merging, promotion, expiry and the size cap (see `rules.js`); the model is
 * asked only to spot a recurring pattern and phrase it in one sentence. That
 * keeps the job inside what a 12B can do reliably, and keeps the cost at a
 * handful of small calls per run instead of one per reviewed record.
 *
 * Everything the model returns is treated as untrusted: JSON is extracted
 * defensively, entries are validated field by field, and the text still passes
 * through the scrubber inside `upsertRule` before it can reach the vault.
 */
import { upsertRule } from './rules.js'
import { dropVerdicts, readVerdicts } from './verdicts.js'
import { writeIndex } from './index-file.js'
import { DEFAULTS } from './config.js'


const SYSTEM_PROMPT = `Bạn là bộ phân tích chất lượng hồ sơ bệnh án.
Đầu vào là các nhận xét đã khử định danh từ những lần rà soát hồ sơ ra viện.
Nhiệm vụ: tìm những VẤN ĐỀ LẶP LẠI và diễn đạt mỗi vấn đề thành một quy luật ngắn.

Quy tắc bắt buộc:
- Chỉ nêu vấn đề xuất hiện từ 2 lần trở lên trong danh sách.
- Mỗi quy luật là MỘT câu tiếng Việt, dưới 20 từ, mô tả khuôn mẫu chung.
- Tuyệt đối không nhắc tên người, mã hồ sơ, ngày tháng, số thẻ, địa chỉ.
- Nếu không có vấn đề nào lặp lại, trả về mảng rỗng.

Chỉ trả về JSON, không giải thích, đúng dạng:
[{"code":"slug-khong-dau","text":"Câu mô tả quy luật","times":3}]`

/**
 * Pull the first JSON array out of a model reply.
 *
 * Small models wrap JSON in prose or fences often enough that a bare
 * `JSON.parse` is not usable here.
 * @param {string} reply - raw model output.
 * @returns {unknown[]} parsed array, or empty when nothing valid was found.
 */
export function extractJsonArray(reply) {
  if (typeof reply !== 'string') return []
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply)
  const candidates = [fenced?.[1], reply].filter(c => typeof c === 'string')
  for (const candidate of candidates) {
    const start = candidate.indexOf('[')
    const end = candidate.lastIndexOf(']')
    if (start === -1 || end <= start) continue
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1))
      if (Array.isArray(parsed)) return parsed
    } catch {
      // Try the next candidate.
    }
  }
  return []
}

/**
 * Keep only well-formed rule proposals.
 * @param {unknown[]} entries - raw parsed entries.
 * @returns {{code: string, text: string, times: number}[]} validated proposals.
 */
export function validateProposals(entries) {
  const out = []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const text = typeof entry.text === 'string' ? entry.text.trim() : ''
    const code = typeof entry.code === 'string' ? entry.code.trim() : ''
    if (text === '' || code === '') continue
    // A "rule" longer than a sentence is the model narrating, not generalizing.
    if (text.length > 200) continue
    const times = Number.isFinite(entry.times) ? Math.max(1, Math.trunc(entry.times)) : 1
    out.push({ code, text, times })
  }
  return out
}

/**
 * Ask the model for recurring patterns in one chunk of verdicts.
 * @param {object} llm - `{ baseUrl, apiKey, model }` for an OpenAI-compatible endpoint.
 * @param {string[]} lines - scrubbed verdict texts.
 * @param {AbortSignal} [signal] - cancellation.
 * @returns {Promise<{code: string, text: string, times: number}[]>} validated proposals.
 */
async function proposeFromChunk(llm, lines, signal) {
  const numbered = lines.map((line, i) => `${i + 1}. ${line}`).join('\n')
  const res = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
    body: JSON.stringify({
      model: llm.model,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Các nhận xét:\n${numbered}` },
      ],
    }),
  })
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`)
  const body = await res.json()
  return validateProposals(extractJsonArray(body?.choices?.[0]?.message?.content ?? ''))
}

/**
 * Fold pending verdicts into the rule store and refresh the index.
 *
 * Verdicts are consumed only for chunks that completed, so a mid-run failure
 * leaves the rest pending for the next run rather than losing them.
 * @param {object} options - `{ dshHome, vaultDir, agentsPath, llm, signal }`.
 * @returns {Promise<{read: number, consumed: number, proposed: number, created: number, merged: number, rejected: number, listed: number, skipped?: string}>} run report.
 */
export async function consolidate(options) {
  const { dshHome, vaultDir, agentsPath, llm, signal } = options
  const config = options.config ?? DEFAULTS
  const verdicts = readVerdicts(dshHome)
  const empty = { read: verdicts.length, consumed: 0, proposed: 0, created: 0, merged: 0, rejected: 0, listed: 0 }

  if (verdicts.length < config.minVerdicts) {
    return { ...empty, skipped: `cần ít nhất ${config.minVerdicts} nhận xét, hiện có ${verdicts.length}` }
  }

  let consumed = 0
  let proposed = 0
  let created = 0
  let merged = 0
  let rejected = 0

  for (let i = 0; i < verdicts.length; i += config.chunkSize) {
    const chunk = verdicts.slice(i, i + config.chunkSize)
    let proposals
    try {
      proposals = await proposeFromChunk(llm, chunk.map(v => v.text), signal)
    } catch {
      // Leave this chunk and everything after it pending for the next run.
      break
    }
    proposed += proposals.length
    for (const proposal of proposals) {
      const res = upsertRule(vaultDir, proposal, config)
      if (res.status === 'created') created += 1
      else if (res.status === 'merged') merged += 1
      else rejected += 1
    }
    consumed += chunk.length
  }

  dropVerdicts(dshHome, consumed)
  const { listed } = writeIndex(vaultDir, agentsPath, config)
  return { read: verdicts.length, consumed, proposed, created, merged, rejected, listed }
}
