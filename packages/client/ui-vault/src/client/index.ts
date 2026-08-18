/**
 * Vault knowledge-base panel: sidebar-footer trigger opening an
 * upload/notes/graph surface backed by the dsh-openai-proxy /vault HTTP API
 * (same VAULT_DIR the `vault` MCP server gives the agent read/write access
 * to). This package is UI-only — it talks to that already-running local HTTP
 * server via fetch(), it does not add a new Host RPC surface.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { VaultPanel } from './VaultPanel.tsx'
import type { VaultPanelFace } from './slots.ts'
import { en, NS, vi, zh } from './locales.ts'

export type { VaultGraphData, VaultNote, VaultPanelFace } from './slots.ts'
export type { VaultKey } from './locales.ts'
export type { VaultPanelProps } from './VaultPanel.tsx'

/** Port dsh-openai-proxy listens on; override with DSH_VAULT_PORT if the deployment changed PORT. */
const DEFAULT_VAULT_PORT = 8787

/** Required services: slot registry and locale. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the panel's dictionaries and mount it in the
 * sidebar footer, next to the Cordis plugin trigger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, vi }), 'ui-vault: dictionaries')

  // Same host as the Web UI, fixed proxy port — the proxy is bound to the
  // same interface (127.0.0.1 or 0.0.0.0) the Web UI itself is reachable on.
  const baseUrl = `${window.location.protocol}//${window.location.hostname}:${DEFAULT_VAULT_PORT}`

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'vault-panel',
    locale: NS,
    inject: (): VaultPanelFace => ({ baseUrl }),
  }, VaultPanel))
}
