/// <reference types="@cloudflare/workers-types" />

/**
 * Bindings available to every Pages Function. Configured in BOTH wrangler.toml
 * (local `wrangler pages dev`) and the Cloudflare dashboard (Pages → Settings →
 * Functions → bindings) for deployed Functions.
 */
export interface Env {
  SHARE_KV: KVNamespace
  DB: D1Database
  /** Per-user media budget in bytes (note photos+audios). Optional string var
   *  (Pages env vars are strings); defaults to 100 MB when unset/invalid. */
  MEDIA_QUOTA_BYTES?: string
}
