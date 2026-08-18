/**
 * Upload .docx/.pdf/.md/.txt files, convert to Markdown, and save into the
 * Obsidian vault folder the `vault` MCP server (mcp-server-filesystem) also
 * points at — so a saved file is immediately readable by the dsh agent and
 * viewable in Obsidian.
 */
import express from 'express'
import multer from 'multer'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import TurndownService from 'turndown'

const turndown = new TurndownService({ headingStyle: 'atx' })
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

/** Strip anything but a safe base filename (no path separators, no traversal). */
function safeBaseName(name) {
  const base = path.basename(name).replace(/[\\/]/g, '_')
  return base.replace(/[<>:"|?*\x00-\x1f]/g, '_').trim() || 'untitled'
}

/** Avoid overwriting an existing note by appending a numeric suffix. */
function uniqueTargetPath(vaultDir, stem, ext) {
  let candidate = path.join(vaultDir, `${stem}${ext}`)
  let n = 1
  while (existsSync(candidate)) {
    candidate = path.join(vaultDir, `${stem}-${n}${ext}`)
    n += 1
  }
  return candidate
}

async function toMarkdown(originalName, buffer) {
  const ext = path.extname(originalName).toLowerCase()
  if (ext === '.docx') {
    const { value: html } = await mammoth.convertToHtml({ buffer })
    return turndown.turndown(html)
  }
  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buffer })
    const { text } = await parser.getText()
    await parser.destroy()
    return text
  }
  if (ext === '.md' || ext === '.txt') {
    return buffer.toString('utf8')
  }
  throw new Error(`Unsupported file type "${ext || '(none)'}". Only .docx, .pdf, .md, .txt are accepted.`)
}

const PAGE = (vaultDir, message) => `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>Nạp kiến thức vào vault</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 48px auto; padding: 0 16px; }
  h1 { font-size: 1.3rem; }
  .drop { border: 2px dashed #999; border-radius: 8px; padding: 32px; text-align: center; color: #555; }
  .msg { margin: 16px 0; padding: 12px; border-radius: 6px; }
  .ok { background: #e6ffed; color: #036b26; }
  .err { background: #ffecec; color: #a30000; }
  input[type=file] { margin: 12px 0; }
  button { padding: 8px 20px; border-radius: 6px; border: none; background: #111; color: #fff; cursor: pointer; }
  code { background: #f3f3f3; padding: 2px 6px; border-radius: 4px; }
</style>
</head>
<body>
<h1>Nạp kiến thức vào vault</h1>
<p>Vault: <code>${vaultDir}</code> · <a href="/vault/graph">Xem danh sách &amp; graph &rarr;</a></p>
${message ?? ''}
<form class="drop" method="post" action="/vault/upload" enctype="multipart/form-data">
  <p>Chọn file <code>.docx</code>, <code>.pdf</code>, <code>.md</code> hoặc <code>.txt</code> — sẽ tự convert sang Markdown và lưu vào vault.</p>
  <input type="file" name="file" accept=".docx,.pdf,.md,.txt" required>
  <br>
  <button type="submit">Tải lên & Convert</button>
</form>
</body>
</html>`

export function createVaultRouter(vaultDir) {
  mkdirSync(vaultDir, { recursive: true })
  const router = express.Router()

  router.get('/', (_req, res) => {
    res.type('html').send(PAGE(vaultDir))
  })

  router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
      res.status(400).type('html').send(PAGE(vaultDir, '<div class="msg err">Chưa chọn file.</div>'))
      return
    }
    try {
      const markdown = await toMarkdown(req.file.originalname, req.file.buffer)
      const stem = safeBaseName(path.parse(req.file.originalname).name)
      const target = uniqueTargetPath(vaultDir, stem, '.md')
      const header = `<!-- Nguồn: ${req.file.originalname} · Nạp lúc: ${new Date().toISOString()} -->\n\n`
      writeFileSync(target, header + markdown, 'utf8')
      res.type('html').send(PAGE(
        vaultDir,
        `<div class="msg ok">Đã lưu <code>${path.basename(target)}</code> (${markdown.length} ký tự) vào vault.</div>`,
      ))
    } catch (err) {
      res.status(500).type('html').send(PAGE(
        vaultDir,
        `<div class="msg err">Lỗi: ${err instanceof Error ? err.message : String(err)}</div>`,
      ))
    }
  })

  return router
}
