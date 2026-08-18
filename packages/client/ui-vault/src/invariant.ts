/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-vault`.
 * @module @deepseek-ai/dsh-client-ui-vault/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-vault'

/** Cordis companion plugin name. */
export const name = 'client-ui-vault-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the panel's own state (open/closed, fetched notes)
 * is local React state with no cross-plugin mutable relation, and data comes
 * from a plain fetch() to an external HTTP server, not a Cordis capability.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
