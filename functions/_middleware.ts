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
 *  - for event JOIN links (`?evento=<código>`), the one pasted in the club's
 *    group chat: the race's own poster, its name, the day and how many are in;
 *  - for ACCOUNT invites (`?invite=<código>`), the only door in: says it is an
 *    invitation and whether it still works — never who sent it;
 *  - for live-tracking links (`?t=<token>`), reads the session from D1 and says
 *    whether it's LIVE, whose it is and which route, plus that route's own card
 *    as the image. Without this, sharing a live track previewed with the app
 *    logo and slogan, which say nothing about that particular outing.
 *
 * Non-HTML responses (assets, /api/*) pass through untouched. Any KV/parse error
 * degrades gracefully to the brand defaults baked into index.html.
 */

import {
  imagenDeEvento, claveTarjeta, tarjeta, type ImagenPrevia, type EventoParaImagen,
} from './lib/ogImagen'

interface Env {
  SHARE_KV: KVNamespace
  DB: D1Database
}

/**
 * El día de la carrera, en castellano y en hora española.
 *
 * En el borde no hay zona horaria del que mira —el crawler de WhatsApp puede
 * estar en cualquier parte— y una carrera tiene la hora del sitio donde se
 * corre, así que se fija Madrid en vez de dejar que salga en UTC y anuncie una
 * salida a las 06:30 que en realidad es a las 08:30.
 */
function fechaLarga(ms: number): string {
  try {
    return new Date(ms).toLocaleString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/Madrid',
    })
  } catch { return '' }
}

/**
 * ¿Está subida ya la tarjeta dibujada de este evento?
 *
 * Se comprueba de verdad, sin descargarla (`stream` + `cancel`): anunciar una
 * imagen que no está deja al previsualizador con un 404 y sin pastilla, que es
 * peor que enseñar el cartel a secas.
 */
async function hayTarjetaDeEvento(env: Env, id: string): Promise<boolean> {
  try {
    const stored = await env.SHARE_KV.get(`${claveTarjeta(id)}:img`, 'stream')
    if (!stored) return false
    await stored.cancel()
    return true
  } catch { return false }
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
  const eventToken = url.searchParams.get('ev')
  const isEventLink = !!eventToken && /^[A-Za-z0-9_-]{16,32}$/.test(eventToken)
  const memberEvent = url.searchParams.get('e')
  const isMemberEventLink = !!memberEvent && /^[A-Za-z0-9_-]{16,32}$/.test(memberEvent)
  const joinCode = url.searchParams.get('evento')
  const isJoinLink = !!joinCode && /^[A-Za-z0-9_-]{8,64}$/.test(joinCode)
  const invite = url.searchParams.get('invite')
  const isInviteLink = !!invite && /^[A-Za-z0-9_-]{8,64}$/.test(invite)

  // Share links get a per-link image (the rendered track card, served by
  // /og/<id>.png with a brand-card fallback). Everything else gets the brand
  // card. Ambas son 1200×630; el tamaño viaja junto a la url porque no todas lo
  // son —el cartel de una carrera es 3:1— y declararlo mal es lo que hace que
  // el previsualizador recorte a un cuadrado en vez de pintar la grande.
  let imagen: ImagenPrevia = tarjeta(
    isShareLink ? `${url.origin}/og/${id}.jpg` : `${url.origin}/og-card.png`,
  )

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
        // Imagen: mejor la tarjeta YA generada de la ruta enganchada, que enseña
        // el trazado real. Pero solo existe si esa ruta se compartió alguna vez
        // desde la web (se dibuja en el navegador y se sube), cosa que no pasa
        // con un plan creado desde la app: entonces /og/<id>.jpg devuelve la
        // tarjeta de marca, que habla de previsión meteorológica y no dice nada
        // de un seguimiento. Por eso se comprueba antes si existe de verdad y,
        // si no, se usa la tarjeta propia de "en directo".
        imagen = tarjeta(`${url.origin}/og-live.png`)
        if (row.planShareId) {
          try {
            const stored = await ctx.env.SHARE_KV.get(`${row.planShareId}:img`, 'stream')
            if (stored) {
              imagen = tarjeta(`${url.origin}/og/${row.planShareId}.jpg`)
              await stored.cancel()
            }
          } catch { /* sin tarjeta de ruta, la de en directo sirve */ }
        }
      }
    } catch { /* si algo falla, vista previa de marca y a seguir */ }
  }

  // Enlace público de un evento (`?ev=`). Es el que se pega en el grupo de la
  // familia, así que la vista previa importa más que en ningún otro: quien lo
  // recibe no conoce la aplicación y decide si tocar por lo que ve ahí. Lleva
  // el CARTEL de la carrera como imagen —ya está subido y encuadrado— y dice
  // cuántos van en directo, que es lo que hace tocar el enlace.
  if (isEventLink) {
    try {
      const row = await ctx.env.DB.prepare(
        `SELECT e.id, e.name, e.photo_key AS photoKey, e.photo_at AS photoAt,
                e.starts_at AS startsAt,
                (SELECT COUNT(*) FROM event_members m WHERE m.event_id = e.id) AS members,
                (SELECT COUNT(*) FROM tracking_sessions t
                  WHERE t.event_id = e.id AND t.status = 'active') AS live
           FROM events e WHERE e.public_token = ?`,
      ).bind(eventToken).first<EventoParaImagen & { name: string; live: number }>()
      if (row) {
        const raw = row.name.trim()
        const name = raw.length > 48 ? `${raw.slice(0, 47).trimEnd()}…` : raw
        title = row.live > 0 ? `🔴 En directo · ${name}` : `🏁 ${name}`
        desc = row.live > 0
          ? `Sigue en el mapa a ${row.live} ${row.live === 1 ? 'participante' : 'participantes'}: posición, ritmo y margen sobre los cortes.`
          : 'Sigue a los participantes en el mapa cuando empiecen a compartir su posición.'
        // La TARJETA del evento, la misma que la parrilla: 1200×630 con el
        // cartel de fondo, el nombre y cuántos van. Antes iba el cartel a
        // secas, que es 3:1, y el previsualizador lo recortaba a un cuadrado
        // diminuto —el enlace del grupo enseñaba media palabra del cartel—.
        // Sin tarjeta todavía, el cartel; sin cartel, la de "en directo".
        imagen = imagenDeEvento(url.origin, row, await hayTarjetaDeEvento(ctx.env, row.id))
      }
    } catch { /* sin datos del evento, vista previa de marca */ }
  }

  // Enlace de la PARRILLA (`?e=<id>`). Es el que se pasan entre los que corren,
  // y era el único de los cuatro que se quedaba con la vista previa de marca:
  // "previsión meteorológica hora a hora", que no dice ni qué carrera es. Lleva
  // una tarjeta dibujada para esto —cartel de fondo, nombre, cuándo se sale y
  // cuántos van—, que sube quien organiza al abrir la parrilla; si todavía no
  // existe, el cartel a secas, y si tampoco hay, la de "en directo".
  if (isMemberEventLink) {
    try {
      const row = await ctx.env.DB.prepare(
        `SELECT e.id, e.name, e.starts_at AS startsAt, e.ended_at AS endedAt,
                e.photo_key AS photoKey, e.photo_at AS photoAt,
                (SELECT COUNT(*) FROM event_members m WHERE m.event_id = e.id) AS members,
                (SELECT COUNT(*) FROM tracking_sessions t
                  WHERE t.event_id = e.id AND t.status = 'active') AS live
           FROM events e WHERE e.id = ?`,
      ).bind(memberEvent).first<EventoParaImagen & {
        name: string; endedAt: number | null; live: number
      }>()
      if (row) {
        const raw = row.name.trim()
        const name = raw.length > 48 ? `${raw.slice(0, 47).trimEnd()}…` : raw
        // Lo primero del título es lo único que se lee seguro, así que dice el
        // estado: en directo manda sobre todo lo demás.
        title = row.live > 0 ? `🔴 En directo · ${name}`
          : row.endedAt ? `🏁 ${name} · terminada`
          : `🏁 Parrilla · ${name}`
        const quienes = row.members === 1 ? '1 participante' : `${row.members} participantes`
        desc = row.live > 0
          ? `Sigue en el mapa a ${row.live} ${row.live === 1 ? 'participante' : 'participantes'}: posición, ritmo y margen sobre los cortes.`
          : row.endedAt
            ? `Resultados, meta y replay de la carrera. ${quienes}.`
            : [row.startsAt ? fechaLarga(row.startsAt) : null, quienes,
                'Prepara tu baliza y sigue a los tuyos en el mapa común.'].filter(Boolean).join(' · ')
        // La tarjeta dibujada si está subida, y si no el cartel. Se comprueba
        // que EXISTE antes de anunciarla: si no, el previsualizador se come un
        // 404 y no enseña imagen ninguna.
        imagen = imagenDeEvento(url.origin, row, await hayTarjetaDeEvento(ctx.env, row.id))
      }
    } catch { /* sin datos del evento, vista previa de marca */ }
  }

  // Enlace para UNIRSE a un evento (`?evento=<código>`). Es el que se pega en el
  // grupo del club, y hasta ahora se previsualizaba con el logo y el eslogan de
  // la aplicación: "previsión meteorológica hora a hora", que no invita a nada
  // ni dice a qué te están invitando. Quien lo recibe decide si tocar por lo que
  // ve en esa pastilla, así que lleva el cartel de la carrera, su nombre, el día
  // y cuántos van apuntados.
  if (isJoinLink) {
    try {
      const row = await ctx.env.DB.prepare(
        `SELECT e.id, e.name, e.starts_at AS startsAt, e.ended_at AS endedAt,
                e.photo_key AS photoKey, e.photo_at AS photoAt,
                (SELECT COUNT(*) FROM event_members m WHERE m.event_id = e.id) AS members
           FROM events e WHERE e.invite_code = ?`,
      ).bind(joinCode).first<EventoParaImagen & { name: string; endedAt: number | null }>()
      if (row) {
        const raw = row.name.trim()
        const name = raw.length > 44 ? `${raw.slice(0, 43).trimEnd()}…` : raw
        // Lo primero del título es lo único que se lee seguro: que te invitan y
        // a qué. Una carrera ya terminada lo dice, para que nadie se apunte a
        // algo que pasó.
        title = row.endedAt ? `🏁 ${name} · terminada` : `🎽 Te apuntas a ${name}`
        const cuando = row.startsAt ? fechaLarga(row.startsAt) : null
        const quienes = row.members === 1 ? '1 participante' : `${row.members} participantes`
        desc = row.endedAt
          ? `Esta carrera ya se corrió. ${quienes} en la parrilla.`
          : [
              cuando,
              `${quienes} en la parrilla`,
              'Toca para entrar y compartir tu posición en el mapa común.',
            ].filter(Boolean).join(' · ')
        // La misma tarjeta que los otros dos enlaces del evento: el cartel a
        // secas es 3:1 y salía recortado a un cuadrado.
        imagen = imagenDeEvento(url.origin, row, await hayTarjetaDeEvento(ctx.env, row.id))
      }
    } catch { /* sin datos del evento, vista previa de marca */ }
  }

  // Invitación para CREAR CUENTA (`?invite=<código>`). El alta es solo por
  // invitación, así que este enlace es la única puerta de entrada — y se
  // previsualizaba igual que la portada, sin decir que lo que hay al otro lado
  // es una invitación personal y de un solo uso.
  //
  // Aquí no se enseña ni quién invita ni nada de la cuenta: el código viaja por
  // donde viaja y una vista previa la ve cualquiera del grupo. Solo si el
  // enlace SIRVE todavía, que es lo único que necesita saber quien lo recibe
  // —y lo que evita que alguien pelee con un enlace ya gastado—.
  if (isInviteLink) {
    try {
      const row = await ctx.env.DB.prepare(
        'SELECT used_by AS usedBy, expires_at AS expiresAt FROM invitations WHERE code = ?',
      ).bind(invite).first<{ usedBy: string | null; expiresAt: number | null }>()
      if (row) {
        const gastada = row.usedBy !== null
        const caducada = row.expiresAt !== null && Date.now() > row.expiresAt
        if (gastada || caducada) {
          title = '🎟️ Invitación ya usada'
          desc = gastada
            ? 'Esta invitación se usó para crear una cuenta. Pide otra a quien te la mandó.'
            : 'Esta invitación ha caducado. Pide otra a quien te la mandó.'
        } else {
          title = '🎟️ Tienes una invitación'
          desc = 'Crea tu cuenta en SiLoSeNoSalgo: planifica la carrera hora a hora, comparte tu posición en directo y sigue a los tuyos en el mapa.'
        }
        imagen = tarjeta(`${url.origin}/og-card.png`)
      }
    } catch { /* sin datos de la invitación, vista previa de marca */ }
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
  // El TAMAÑO va con la imagen: el previsualizador lo usa para decidir el
  // hueco antes de bajarse nada, y si no cuadra con lo que luego recibe pinta
  // la miniatura de al lado en vez de la pastilla grande.
  let rw = new HTMLRewriter()
    .on('meta[property="og:image"]', setAttr('content', imagen.url))
    .on('meta[property="og:image:width"]', setAttr('content', String(imagen.width)))
    .on('meta[property="og:image:height"]', setAttr('content', String(imagen.height)))
    .on('meta[name="twitter:image"]', setAttr('content', imagen.url))
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
