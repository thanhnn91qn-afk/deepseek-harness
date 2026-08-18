/**
 * Minimal force-directed layout for the Vault link graph: spring edges, node
 * repulsion, centering, draggable nodes. No external graph library — same
 * approach as dsh-openai-proxy's standalone /vault/graph page, ported to a
 * React-owned canvas with proper animation-frame/listener cleanup.
 */

interface GraphNode {
  id: string
  title: string
  size: number
  x: number
  y: number
  vx: number
  vy: number
}

interface GraphInput {
  nodes: { id: string; title: string; size: number }[]
  links: { source: string; target: string }[]
}

/**
 * Start the simulation on `canvas` and return a disposer that cancels the
 * animation frame and removes listeners (call from a React effect cleanup).
 * @param canvas - target canvas element, sized by its CSS box.
 * @param graph - nodes and wikilink edges to render.
 * @returns cleanup function.
 */
export function runVaultGraph(canvas: HTMLCanvasElement, graph: GraphInput): () => void {
  const context2d = canvas.getContext('2d')
  if (context2d === null) return () => {}
  // Re-typed binding: TS narrowing from the null check above does not
  // propagate into the requestAnimationFrame closure below.
  const ctx: CanvasRenderingContext2D = context2d

  const nodes: GraphNode[] = graph.nodes.map((n, i) => ({
    ...n,
    x: Math.cos(i) * 80 + canvas.clientWidth / 2 + (Math.random() - 0.5) * 20,
    y: Math.sin(i) * 80 + canvas.clientHeight / 2 + (Math.random() - 0.5) * 20,
    vx: 0,
    vy: 0,
  }))
  const byId = new Map(nodes.map(n => [n.id, n]))
  const links = graph.links
    .map(l => ({ source: byId.get(l.source), target: byId.get(l.target) }))
    .filter((l): l is { source: GraphNode; target: GraphNode } => l.source !== undefined && l.target !== undefined)

  function resize(): void {
    canvas.width = canvas.clientWidth * devicePixelRatio
    canvas.height = canvas.clientHeight * devicePixelRatio
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  }
  resize()
  window.addEventListener('resize', resize)

  let dragging: GraphNode | undefined
  function toGraph(e: MouseEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const onDown = (e: MouseEvent): void => {
    const { x, y } = toGraph(e)
    dragging = nodes.find(n => Math.hypot(n.x - x, n.y - y) < 12)
  }
  const onMove = (e: MouseEvent): void => {
    if (dragging === undefined) return
    const { x, y } = toGraph(e)
    dragging.x = x
    dragging.y = y
    dragging.vx = 0
    dragging.vy = 0
  }
  const onUp = (): void => { dragging = undefined }
  canvas.addEventListener('mousedown', onDown)
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)

  let frame = 0
  let disposed = false
  function tick(): void {
    if (disposed) return
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    for (const a of nodes) {
      if (a === dragging) continue
      let fx = (w / 2 - a.x) * 0.002
      let fy = (h / 2 - a.y) * 0.002
      for (const b of nodes) {
        if (a === b) continue
        const dx = a.x - b.x
        const dy = a.y - b.y
        const d2 = Math.max(dx * dx + dy * dy, 25)
        const f = 700 / d2
        fx += (dx / Math.sqrt(d2)) * f
        fy += (dy / Math.sqrt(d2)) * f
      }
      a.vx = (a.vx + fx) * 0.85
      a.vy = (a.vy + fy) * 0.85
    }
    for (const { source, target } of links) {
      const dx = target.x - source.x
      const dy = target.y - source.y
      const d = Math.max(Math.hypot(dx, dy), 1)
      const f = (d - 90) * 0.01
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      if (source !== dragging) { source.vx += fx; source.vy += fy }
      if (target !== dragging) { target.vx -= fx; target.vy -= fy }
    }
    for (const n of nodes) {
      if (n === dragging) continue
      n.x += n.vx
      n.y += n.vy
    }

    ctx.clearRect(0, 0, w, h)
    ctx.strokeStyle = 'currentColor'
    ctx.globalAlpha = 0.25
    ctx.lineWidth = 1
    for (const { source, target } of links) {
      ctx.beginPath()
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    for (const n of nodes) {
      const r = 5 + Math.min(n.size / 60, 8)
      ctx.beginPath()
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
      ctx.fillStyle = '#4c6ef5'
      ctx.fill()
      ctx.fillStyle = 'currentColor'
      ctx.font = '11px system-ui, sans-serif'
      ctx.fillText(n.title, n.x + r + 4, n.y + 4)
    }
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)

  return () => {
    disposed = true
    cancelAnimationFrame(frame)
    window.removeEventListener('resize', resize)
    canvas.removeEventListener('mousedown', onDown)
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
}
