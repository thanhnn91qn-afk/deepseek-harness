/**
 * Read-only view of the vault: a note list plus a force-directed graph of
 * [[wikilink]] connections between notes, in the same spirit as Obsidian's
 * graph view. Pure vanilla JS/Canvas client, no CDN/external dependency, so
 * it works fully offline on an internal network.
 */
import express from 'express'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const WIKILINK_RE = /\[\[([^\]|#]+)(?:[^\]]*)\]\]/g

function listNotes(vaultDir) {
  let entries
  try {
    entries = readdirSync(vaultDir)
  } catch {
    return []
  }
  return entries
    .filter(name => name.toLowerCase().endsWith('.md'))
    .map((name) => {
      const full = path.join(vaultDir, name)
      const stat = statSync(full)
      const content = readFileSync(full, 'utf8')
      const title = path.basename(name, '.md')
      const links = [...content.matchAll(WIKILINK_RE)].map(m => m[1].trim())
      const snippet = content.replace(/^<!--.*?-->\s*/s, '').replace(/[#>*_`]/g, '').trim().slice(0, 160)
      return { id: title, file: name, title, snippet, links, mtimeMs: stat.mtimeMs, bytes: stat.size }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

function graphData(notes) {
  const ids = new Set(notes.map(n => n.id))
  const nodes = notes.map(n => ({ id: n.id, title: n.title, size: n.snippet.length }))
  const edgeKeys = new Set()
  const links = []
  for (const note of notes) {
    for (const target of note.links) {
      if (!ids.has(target) || target === note.id) continue
      const key = [note.id, target].sort().join(' ')
      if (edgeKeys.has(key)) continue
      edgeKeys.add(key)
      links.push({ source: note.id, target })
    }
  }
  return { nodes, links }
}

const PAGE = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>Vault - danh sách &amp; graph</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; display: flex; height: 100vh; }
  aside { width: 320px; overflow-y: auto; border-right: 1px solid #ddd; padding: 16px; box-sizing: border-box; }
  aside h1 { font-size: 1.1rem; margin: 0 0 12px; }
  .note { padding: 8px 10px; border-radius: 6px; margin-bottom: 6px; cursor: default; }
  .note:hover { background: #f3f3f3; }
  .note .title { font-weight: 600; font-size: 0.92rem; }
  .note .snippet { font-size: 0.8rem; color: #666; margin-top: 2px; }
  .note .meta { font-size: 0.72rem; color: #999; margin-top: 2px; }
  main { flex: 1; position: relative; }
  canvas { width: 100%; height: 100%; display: block; cursor: grab; }
  .empty { padding: 24px; color: #777; }
  a.up { display: inline-block; margin-bottom: 12px; font-size: 0.85rem; }
</style>
</head>
<body>
<aside>
  <a class="up" href="/vault">&larr; Nạp thêm kiến thức</a>
  <h1>Ghi chú trong vault (<span id="count">0</span>)</h1>
  <div id="list"></div>
</aside>
<main><canvas id="graph"></canvas></main>
<script>
async function main() {
  const res = await fetch('/vault/graph-data')
  const { notes, graph } = await res.json()

  document.getElementById('count').textContent = notes.length
  const list = document.getElementById('list')
  if (notes.length === 0) {
    list.innerHTML = '<div class="empty">Chưa có ghi chú nào. Quay lại trang nạp kiến thức để tải file.</div>'
  }
  for (const n of notes) {
    const div = document.createElement('div')
    div.className = 'note'
    div.innerHTML = '<div class="title">' + escapeHtml(n.title) + '</div>' +
      '<div class="snippet">' + escapeHtml(n.snippet) + '</div>' +
      '<div class="meta">' + n.links.length + ' liên kết &middot; ' + Math.round(n.bytes / 1024 * 10) / 10 + ' KB</div>'
    list.appendChild(div)
  }

  runGraph(graph)
}

function escapeHtml(s) {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

/** Minimal force-directed layout: spring edges + node repulsion + centering, no external library. */
function runGraph(graph) {
  const canvas = document.getElementById('graph')
  const ctx = canvas.getContext('2d')
  const nodes = graph.nodes.map((n, i) => ({
    ...n,
    x: Math.cos(i) * 100 + canvas.clientWidth / 2 + (Math.random() - 0.5) * 20,
    y: Math.sin(i) * 100 + canvas.clientHeight / 2 + (Math.random() - 0.5) * 20,
    vx: 0, vy: 0,
  }))
  const byId = new Map(nodes.map(n => [n.id, n]))
  const links = graph.links
    .map(l => ({ source: byId.get(l.source), target: byId.get(l.target) }))
    .filter(l => l.source && l.target)

  function resize() {
    canvas.width = canvas.clientWidth * devicePixelRatio
    canvas.height = canvas.clientHeight * devicePixelRatio
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  }
  resize()
  window.addEventListener('resize', resize)

  let dragging = null
  canvas.addEventListener('mousedown', (e) => {
    const { x, y } = toGraph(e)
    dragging = nodes.find(n => Math.hypot(n.x - x, n.y - y) < 14)
  })
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return
    const { x, y } = toGraph(e)
    dragging.x = x
    dragging.y = y
    dragging.vx = 0
    dragging.vy = 0
  })
  window.addEventListener('mouseup', () => { dragging = null })

  function toGraph(e) {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function tick() {
    const w = canvas.clientWidth, h = canvas.clientHeight
    for (const a of nodes) {
      if (a === dragging) continue
      let fx = (w / 2 - a.x) * 0.002
      let fy = (h / 2 - a.y) * 0.002
      for (const b of nodes) {
        if (a === b) continue
        const dx = a.x - b.x, dy = a.y - b.y
        const d2 = Math.max(dx * dx + dy * dy, 25)
        const f = 900 / d2
        fx += (dx / Math.sqrt(d2)) * f
        fy += (dy / Math.sqrt(d2)) * f
      }
      a.vx = (a.vx + fx) * 0.85
      a.vy = (a.vy + fy) * 0.85
    }
    for (const { source, target } of links) {
      const dx = target.x - source.x, dy = target.y - source.y
      const d = Math.max(Math.hypot(dx, dy), 1)
      const f = (d - 120) * 0.01
      const fx = (dx / d) * f, fy = (dy / d) * f
      if (source !== dragging) { source.vx += fx; source.vy += fy }
      if (target !== dragging) { target.vx -= fx; target.vy -= fy }
    }
    for (const n of nodes) {
      if (n === dragging) continue
      n.x += n.vx
      n.y += n.vy
    }

    ctx.clearRect(0, 0, w, h)
    ctx.strokeStyle = '#ccc'
    ctx.lineWidth = 1
    for (const { source, target } of links) {
      ctx.beginPath()
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
      ctx.stroke()
    }
    for (const n of nodes) {
      const r = 6 + Math.min(n.size / 40, 10)
      ctx.beginPath()
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
      ctx.fillStyle = '#4c6ef5'
      ctx.fill()
      ctx.fillStyle = '#222'
      ctx.font = '12px system-ui'
      ctx.fillText(n.title, n.x + r + 4, n.y + 4)
    }
    requestAnimationFrame(tick)
  }
  tick()
}

main()
</script>
</body>
</html>`

export function createVaultGraphRouter(vaultDir) {
  const router = express.Router()

  router.get('/graph', (_req, res) => {
    res.type('html').send(PAGE)
  })

  router.get('/graph-data', (_req, res) => {
    const notes = listNotes(vaultDir)
    res.json({ notes, graph: graphData(notes) })
  })

  return router
}
