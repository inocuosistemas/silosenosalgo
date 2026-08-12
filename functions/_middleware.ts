/// <reference types="@cloudflare/workers-types" />

/**
 * Edge middleware for link previews (Open Graph).
 *
 * Crawlers (WhatsApp, Telegram, Twitter…) don't run JavaScript: they read only
 * the raw HTML's `<title>` and `<meta property="og:*">`. The SPA ships a single
 * static `index.html`, so without this every shared link `/?s=<id>` would preview
 * with the same generic app name.
 *
 * This runs on every request but only touches HTML documents:
 *  - always rewrites og:image / twitter:image / og:url to ABSOLUTE URLs (crawlers
 *    require absolute image URLs), derived from the request origin;
 *  - for share links (`?s=<id>`), looks up the tiny `${id}:og` sidecar in KV and
 *    overrides `<title>`, og:title/description and twitter:title/description with
 *    the outing's own name + summary;
 *  - for live-tracking links (`?t=<token>`), reads the session from D1 and says
 *    whether it's LIVE, whose it is and which route, plus that route's own card
 *    as the image. Without this, sharing a live track previewed with the app
 *    logo and slogan, which say nothing about that particular outing.
 *
 * Non-HTML responses (assets, /api/*) pass through untouched. Any KV/parse error
 * degrades gracefully to the brand defaults baked into index.html.
 */

interface Env {
  SHARE_KV: KVNamespace
  DB: D1Database
}

/** HTMLRewriter handler that sets one attribute to a fixed value. */
function setAttr(name: string, value: string): HTMLRewriterElementContentHandlers {
  return { element: (el) => { el.setAttribute(name, value) } }
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const res = await ctx.next()
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('text/html')) return res

  const url = new URL(ctx.request.url)
  const id = url.searchParams.get('s')
  const isShareLink = !!id && /^[A-Za-z0-9_-]{8,32}$/.test(id)
  const track = url.searchParams.get('t')
  const isTrackLink = !!track && /^[A-Za-z0-9_-]{16,32}$/.test(track)

  // Share links get a per-link image (the rendered track card, served by
  // /og/<id>.png with a brand-card fallback). Everything else gets the brand
  // card. Both are 1200×630, so the static og:image:width/height stay valid.
  let imageUrl = isShareLink ? `${url.origin}/og/${id}.jpg` : `${url.origin}/og-card.png`

  // Per-link title/description, if this is a share link with a stored sidecar.
  let title: string | null = null
  let desc: string | null = null

  // Enlaces de seguimiento en directo (`?t=`). Antes caian en el caso generico y
  // se compartian con el logo y el eslogan de la aplicacion, que no dicen nada
  // de ESTA salida: quien recibe el enlace no sabia ni de quien era ni si estaba
  // en marcha. Una consulta por clave primaria basta para contarlo.
  if (isTrackLink) {
    try {
      const row = await ctx.env.DB.prepare(
        `SELECT ts.title AS title, ts.plan_name AS planName, ts.status AS status,
                ts.expires_at AS expiresAt, ts.plan_share_id AS planShareId,
                u.username AS username
           FROM tracking_sessions ts LEFT JOIN users u ON u.id = ts.owner_user_id
          WHERE ts.id = ?`,
      ).bind(track).first<{
        title: string | null; planName: string | null; status: string
        expiresAt: number; planShareId: string | null; username: string | null
      }>()
      if (row) {
        const live = row.status === 'active' && Date.now() <= row.expiresAt
        // WhatsApp corta el titulo cerca de los 65 caracteres, y lo primero que
        // no puede perderse es el "en directo". Se recorta el nombre de la ruta,
        // que ademas suele traer la coletilla de la organizacion.
        const raw = (row.planName || row.title || '').trim()
        const route = raw.length > 48 ? `${raw.slice(0, 47).trimEnd()}…` : raw
        title = live
          ? `🔴 En directo${route ? ` · ${route}` : ''}`
          : `🏁 Finalizado${route ? ` · ${route}` : ''}`
        const who = row.username ? `@${row.username}` : 'un corredor'
        desc = live
          ? `Sigue a ${who} en tiempo real: posición, ritmo y hora estimada de llegada.`
          : `Recorrido de ${who}. Mira por dónde pasó y a qué hora.`
        // Si la baliza lleva una ruta enganchada, se aprovecha la tarjeta ya
        // generada de esa ruta: se ve el trazado en vez del logo. Si no existe,
        // /og/<id>.jpg ya devuelve la tarjeta de marca por su cuenta.
        if (row.planShareId) imageUrl = `${url.origin}/og/${row.planShareId}.jpg`
      }
    } catch { /* si algo falla, vista previa de marca y a seguir */ }
  }

  if (isShareLink) {
    try {
      const raw = await ctx.env.SHARE_KV.get(`${id}:og`)
      if (raw) {
        const meta = JSON.parse(raw) as { title?: unknown; desc?: unknown }
        if (typeof meta.title === 'string' && meta.title) title = meta.title
        if (typeof meta.desc === 'string' && meta.desc) desc = meta.desc
      }
    } catch { /* fall back to brand defaults */ }
  }

  // Always: make image + url absolute (works for the home page too).
  let rw = new HTMLRewriter()
    .on('meta[property="og:image"]', setAttr('content', imageUrl))
    .on('meta[name="twitter:image"]', setAttr('content', imageUrl))
    .on('meta[property="og:url"]', setAttr('content', url.href))

  // Share links: override title + description with the outing's own data.
  if (title) {
    const pageTitle = `${title} · SiLoSeNoSalgo`
    rw = rw
      .on('title', { element: (el) => { el.setInnerContent(pageTitle) } })
      .on('meta[property="og:title"]', setAttr('content', title))
      .on('meta[name="twitter:title"]', setAttr('content', title))
    if (desc) {
      rw = rw
        .on('meta[property="og:description"]', setAttr('content', desc))
        .on('meta[name="twitter:description"]', setAttr('content', desc))
    }
  }

  return rw.transform(res)
}
