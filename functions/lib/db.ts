/// <reference types="@cloudflare/workers-types" />

/**
 * Bindings available to every Pages Function. Configured in BOTH wrangler.toml
 * (local `wrangler pages dev`) and the Cloudflare dashboard (Pages → Settings →
 * Functions → bindings) for deployed Functions.
 */
export interface Env {
  SHARE_KV: KVNamespace
  DB: D1Database
}
