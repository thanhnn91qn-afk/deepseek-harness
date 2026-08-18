/** Injected face for the sidebar-footer Vault panel. */

/** Live facts the panel needs: where the vault HTTP API lives. */
export interface VaultPanelFace {
  /** Origin the dsh-openai-proxy vault API is reachable at (e.g. http://host:8787). */
  baseUrl: string
}

/** One note as reported by GET {baseUrl}/vault/graph-data. */
export interface VaultNote {
  id: string
  file: string
  title: string
  snippet: string
  links: string[]
  mtimeMs: number
  bytes: number
}

/** One graph node/edge pair as reported by GET {baseUrl}/vault/graph-data. */
export interface VaultGraphData {
  notes: VaultNote[]
  graph: {
    nodes: { id: string; title: string; size: number }[]
    links: { source: string; target: string }[]
  }
}
