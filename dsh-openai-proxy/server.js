import express from 'express'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { createVaultRouter } from './vault.js'
import { createVaultGraphRouter } from './vault-graph.js'
import { createMemoryRouter } from './memory/router.js'
import { appendVerdict } from './memory/verdicts.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Support both layouts: dsh-openai-proxy nested inside the deepseek-harness
 * repo itself (apps/ is a direct sibling — the current repo layout), or an
 * older layout where deepseek-harness/ sits next to dsh-openai-proxy/.
 */
function resolveDshBin() {
  const nested = path.resolve(__dirname, '../apps/cli/lib/bin.js')
  if (existsSync(nested)) return nested
  return path.resolve(__dirname, '../deepseek-harness/apps/cli/lib/bin.js')
}

const PORT = Number(process.env.PORT ?? 8787)
const BIND_HOST = process.env.BIND_HOST ?? '127.0.0.1'
const DSH_BIN = process.env.DSH_BIN_PATH ?? resolveDshBin()
const DSH_CWD = process.env.DSH_CWD ?? path.resolve(__dirname, 'workspace')
const DSH_TIMEOUT_MS = Number(process.env.DSH_TIMEOUT_MS ?? 120_000)
const MODEL_NAME = process.env.MODEL_NAME ?? 'dsh-agent'
const LMSTUDIO_API_KEY = process.env.LMSTUDIO_API_KEY ?? 'lm-studio'
const VAULT_DIR = process.env.VAULT_DIR ?? path.join(os.homedir(), 'Documents', 'dsh-vault')
const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')

/**
 * Selective memory: every review's conclusion is logged (de-identified), then
 * folded into a bounded rule set that `$DSH_HOME/AGENTS.md` advertises to each
 * later session. `MEMORY_ENABLED=0` turns the whole pipeline off.
 */
const MEMORY_ENABLED = process.env.MEMORY_ENABLED !== '0'
const MEMORY_LLM = {
  baseUrl: process.env.MEMORY_LLM_BASE_URL ?? 'http://192.168.1.71:1234/v1',
  apiKey: process.env.MEMORY_LLM_API_KEY ?? process.env.LMSTUDIO_API_KEY ?? 'lm-studio',
  model: process.env.MEMORY_LLM_MODEL ?? 'google/gemma-4-12b',
}

mkdirSync(DSH_CWD, { recursive: true })

/** Extract the last user-role message's text content, OpenAI message shape. */
function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'user') continue
    if (typeof msg.content === 'string') return msg.content
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n')
    }
  }
  return ''
}

/** Run one dsh headless task and resolve with its final stdout text. */
function runHeadless(task) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DSH_BIN, '--profile', 'headless', task], {
      cwd: DSH_CWD,
      env: { ...process.env, LMSTUDIO_API_KEY },
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`dsh headless timed out after ${DSH_TIMEOUT_MS}ms`))
    }, DSH_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(stderr.trim() || `dsh exited with code ${code}`))
        return
      }
      resolve(stdout.replace(/\n$/, ''))
    })
  })
}

const app = express()
app.use(express.json({ limit: '10mb' }))
// The dsh Web UI (a different origin/port) fetches /vault/* directly from its
// own sidebar panel; this stack already has no authentication anywhere, so a
// permissive CORS policy here adds no new exposure.
app.use('/vault', (_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  next()
})
app.use('/vault', createVaultRouter(VAULT_DIR))
app.use('/vault', createVaultGraphRouter(VAULT_DIR))

// Memory browsing and the manual consolidation trigger share the vault's CORS
// treatment because the dsh Web UI reads them from its own origin.
app.use('/memory', (_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  next()
})
app.use('/memory', createMemoryRouter({
  dshHome: DSH_HOME,
  vaultDir: VAULT_DIR,
  llm: MEMORY_LLM,
  enabled: MEMORY_ENABLED,
  onRun: (err, report) => {
    if (err) console.warn(`[memory] hợp nhất thất bại: ${err.message}`)
    else if (report.consumed > 0) {
      console.log(`[memory] đã gộp ${report.consumed} nhận xét → ${report.created} luật mới, `
        + `${report.merged} cập nhật; chỉ mục có ${report.listed} luật`)
    }
  },
}))

app.post('/v1/chat/completions', async (req, res) => {
  const { messages, stream } = req.body ?? {}
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: { message: '"messages" must be a non-empty array.', type: 'invalid_request_error' } })
    return
  }

  const task = lastUserText(messages)
  if (!task) {
    res.status(400).json({ error: { message: 'No user message with text content found.', type: 'invalid_request_error' } })
    return
  }

  const id = `chatcmpl-${randomUUID()}`
  const created = Math.floor(Date.now() / 1000)

  let text
  try {
    text = await runHeadless(task)
  } catch (err) {
    res.status(502).json({ error: { message: err instanceof Error ? err.message : String(err), type: 'upstream_error' } })
    return
  }

  // Record what the agent concluded, never what arrived in the prompt. This is
  // fire-and-forget on purpose: the caller already has a good answer, and a
  // memory failure must not turn a successful review into an error.
  if (MEMORY_ENABLED) {
    setImmediate(() => { appendVerdict(DSH_HOME, { text }) })
  }

  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`)

    send({
      id,
      object: 'chat.completion.chunk',
      created,
      model: MODEL_NAME,
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    })
    send({
      id,
      object: 'chat.completion.chunk',
      created,
      model: MODEL_NAME,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }

  res.json({
    id,
    object: 'chat.completion',
    created,
    model: MODEL_NAME,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: text },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  })
})

app.listen(PORT, BIND_HOST, () => {
  console.log(`dsh-openai-proxy listening on http://${BIND_HOST}:${PORT}`)
  if (BIND_HOST === '0.0.0.0') {
    console.log('WARNING: bound to all interfaces (LAN-reachable) with no authentication.')
    console.log('Anyone on the network can call this endpoint. Only use on a trusted LAN.')
  } else {
    console.log('No auth required (local only). Point your app at this base_url with any api_key value.')
  }
})
