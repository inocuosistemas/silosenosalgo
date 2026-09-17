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
  /** Avisos por Telegram. Secretos OPCIONALES: mientras no estén, no se avisa de
   *  nada y todo lo demás funciona igual (ver functions/lib/notify.ts). */
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  /** Avisos push a iOS. Secretos OPCIONALES, como los de Telegram: sin ellos no
   *  se manda ningún push y el resto funciona igual (ver functions/lib/apns.ts).
   *  `APNS_KEY_P8` es el contenido del .p8 tal cual, cabeceras PEM incluidas. */
  APNS_KEY_P8?: string
  APNS_KEY_ID?: string
  APNS_TEAM_ID?: string
  /** 'sandbox' para las compilaciones de Xcode; vacío = producción (TestFlight
   *  y App Store). Un token de un entorno no vale en el otro. */
  APNS_ENV?: string
  /** El bundle id de la app. Por defecto, el de producción. */
  APNS_TOPIC?: string
}
