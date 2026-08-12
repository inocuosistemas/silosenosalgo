/// <reference types="@cloudflare/workers-types" />
import type { Env } from './db'

/**
 * Avisos por Telegram.
 *
 * OJO con la comparación con `avisapelis`: aquel usa un **userbot de Telethon**,
 * es decir una sesión de usuario real con un proceso Python vivo y un fichero de
 * sesión. Eso no se puede reutilizar aquí ni queriendo: un Worker no mantiene
 * procesos ni ficheros. Y tampoco hace falta — el userbot existe allí porque
 * tiene que LEER de canales ajenos donde no se puede meter un bot, y aquí solo
 * hay que ESCRIBIR en un canal propio, que es una simple llamada HTTPS a la API
 * de bots.
 *
 * Todo esto es opcional por diseño: sin los dos secretos configurados, `notify`
 * no hace nada y devuelve false. Un aviso jamás debe tumbar la petición que lo
 * origina, así que además se traga cualquier error de red.
 */

/** Escapa lo que HTML de Telegram interpreta. Los mensajes los escribe
 *  cualquiera desde un enlace público: sin esto, un `<` roto tira el envío. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function notifyTelegram(env: Env, html: string): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN
  const chat = env.TELEGRAM_CHAT_ID
  if (!token || !chat) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text: html,
        parse_mode: 'HTML',
        // El enlace ya va en el texto; la tarjeta de vista previa solo estorba
        // en un aviso corto.
        disable_web_page_preview: true,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}
