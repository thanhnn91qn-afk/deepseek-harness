/**
 * HTTP surface for the memory pipeline: inspect what has been learned, tune
 * how much is kept, and trigger consolidation.
 *
 * Read endpoints expose only the rule set — de-identified, already-distilled
 * text. The verdict log is deliberately NOT served: it sits closer to the raw
 * record and stays on disk under `$DSH_HOME`.
 *
 * Settings are read fresh on each use rather than captured at startup, so an
 * edit to `config.json` (or a POST here) takes effect without a restart.
 */
import express from 'express'
import path from 'node:path'
import { enforceLimits, readRules } from './rules.js'
import { readVerdicts } from './verdicts.js'
import { defaultAgentsPath, writeIndex } from './index-file.js'
import { consolidate } from './consolidate.js'
import { configPath, describeConfig, ensureConfigFile, loadConfig, saveConfig } from './config.js'

/**
 * Build the `/memory` router.
 *
 * When the effective `intervalMs` is non-zero the router also drives
 * consolidation on a timer, so the learning loop closes without anyone
 * triggering it. The timer and the HTTP route share one in-flight guard, which
 * is why the schedule lives here rather than in the server module.
 * @param {{dshHome: string, vaultDir: string, llm: object, enabled?: boolean, onRun?: Function}} options - pipeline wiring.
 * @returns {import('express').Router} the router, carrying `stop()` for teardown.
 */
export function createMemoryRouter(options) {
  const { dshHome, vaultDir, llm } = options
  const enabled = options.enabled !== false
  const agentsPath = defaultAgentsPath(dshHome)
  const router = express.Router()

  ensureConfigFile(dshHome)

  // One consolidation at a time: the runs mutate the same notes, and a second
  // concurrent pass would double-count the verdicts the first already claimed.
  let running = null

  /** Run consolidation unless one is already in flight. */
  function runOnce() {
    if (running !== null) return running
    running = consolidate({ dshHome, vaultDir, agentsPath, llm, config: loadConfig(dshHome) })
      .finally(() => { running = null })
    return running
  }

  /** Rules plus how much raw material is still waiting to be folded in. */
  router.get('/rules', (_req, res) => {
    const config = loadConfig(dshHome)
    const rules = readRules(vaultDir, config)
    res.json({
      enabled,
      vault: path.join(vaultDir, 'memory'),
      pendingVerdicts: readVerdicts(dshHome).length,
      established: rules.filter(r => !r.draft).length,
      drafts: rules.filter(r => r.draft).length,
      capacity: `${rules.length}/${config.maxRules}`,
      rules,
    })
  })

  /** Current settings, with the bounds and descriptions for each one. */
  router.get('/config', (_req, res) => {
    res.json({
      config: loadConfig(dshHome),
      file: configPath(dshHome),
      fields: describeConfig(),
    })
  })

  /**
   * Change settings. Values out of range are clamped and reported in
   * `rejected` rather than refused outright, and the index is rebuilt so a new
   * `promoteAt` is reflected immediately.
   */
  router.post('/config', (req, res) => {
    const { config, rejected } = saveConfig(dshHome, req.body ?? {})
    const { listed, skippedDrafts } = writeIndex(vaultDir, agentsPath, config)
    res.json({ config, rejected, listed, skippedDrafts })
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

  /** Age out stale drafts, apply the cap, and rebuild the index — no model call. */
  router.post('/tidy', (_req, res) => {
    const config = loadConfig(dshHome)
    const limits = enforceLimits(vaultDir, { config })
    const { listed, skippedDrafts } = writeIndex(vaultDir, agentsPath, config)
    res.json({ ...limits, listed, skippedDrafts })
  })

  const intervalMs = loadConfig(dshHome).intervalMs
  if (enabled && intervalMs > 0) {
    const timer = setInterval(() => {
      runOnce().then(
        report => options.onRun?.(null, report),
        error => options.onRun?.(error),
      )
    }, intervalMs)
    // Consolidation is background work; it must never hold the process open.
    timer.unref?.()
    router.stop = () => { clearInterval(timer) }
  } else {
    router.stop = () => {}
  }

  return router
}
