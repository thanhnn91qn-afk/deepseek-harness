/**
 * HTTP surface for the memory pipeline: inspect what has been learned, and
 * trigger consolidation.
 *
 * Read endpoints expose only the rule set — de-identified, already-distilled
 * text. The verdict log is deliberately NOT served: it sits closer to the raw
 * record and stays on disk under `$DSH_HOME`.
 */
import express from 'express'
import path from 'node:path'
import { enforceLimits, readRules } from './rules.js'
import { readVerdicts } from './verdicts.js'
import { defaultAgentsPath, writeIndex } from './index-file.js'
import { consolidate } from './consolidate.js'

/**
 * Build the `/memory` router.
 *
 * When `intervalMs` is set the router also drives consolidation on a timer, so
 * the learning loop closes without anyone triggering it. The timer and the
 * HTTP route share one in-flight guard, which is why the schedule lives here
 * rather than in the server module.
 * @param {{dshHome: string, vaultDir: string, llm: object, enabled?: boolean, intervalMs?: number, onRun?: Function}} options - pipeline wiring.
 * @returns {import('express').Router} the router, carrying `stop()` for teardown.
 */
export function createMemoryRouter(options) {
  const { dshHome, vaultDir, llm } = options
  const enabled = options.enabled !== false
  const agentsPath = defaultAgentsPath(dshHome)
  const router = express.Router()

  // One consolidation at a time: the runs mutate the same notes, and a second
  // concurrent pass would double-count the verdicts the first already claimed.
  let running = null

  /** Run consolidation unless one is already in flight. */
  function runOnce() {
    if (running !== null) return running
    running = consolidate({ dshHome, vaultDir, agentsPath, llm })
      .finally(() => { running = null })
    return running
  }

  if (enabled && Number.isFinite(options.intervalMs) && options.intervalMs > 0) {
    const timer = setInterval(() => {
      runOnce().then(
        report => options.onRun?.(null, report),
        error => options.onRun?.(error),
      )
    }, options.intervalMs)
    // Consolidation is background work; it must never hold the process open.
    timer.unref?.()
    router.stop = () => { clearInterval(timer) }
  } else {
    router.stop = () => {}
  }

  /** Rules plus how much raw material is still waiting to be folded in. */
  router.get('/rules', (_req, res) => {
    const rules = readRules(vaultDir)
    res.json({
      enabled,
      vault: path.join(vaultDir, 'memory'),
      pendingVerdicts: readVerdicts(dshHome).length,
      established: rules.filter(r => !r.draft).length,
      drafts: rules.filter(r => r.draft).length,
      rules,
    })
  })

  /** Fold pending verdicts into rules now. */
  router.post('/consolidate', async (_req, res) => {
    if (!enabled) {
      res.status(409).json({ error: 'memory pipeline is disabled (MEMORY_ENABLED=0)' })
      return
    }
    try {
      res.json(await runOnce())
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  /** Age out stale drafts and rebuild the index without calling the model. */
  router.post('/tidy', (_req, res) => {
    const limits = enforceLimits(vaultDir)
    const { listed, skippedDrafts } = writeIndex(vaultDir, agentsPath)
    res.json({ ...limits, listed, skippedDrafts })
  })

  return router
}
