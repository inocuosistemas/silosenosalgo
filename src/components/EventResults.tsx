import type { EventStats } from '../../shared/wireTypes'
import { MarkBadge } from './MarkPicker'
import { Dorsal } from './Dorsal'

/**
 * Los resultados congelados de una carrera, tal como se enseñan.
 *
 * Vive aquí y no dentro de una pantalla porque se pintan en DOS sitios —la
 * parrilla del evento y la pestaña de meta del mapa— y tenerlo escrito dos
 * veces ya salió caro: al repartir puestos compartidos se cambió una copia y
 * la otra siguió numerando 1, 2, 3 sobre unos datos que decían 1, 1, 1. Dos
 * listas que dicen lo mismo tienen que ser la misma lista.
 */

/** Un ritmo en minutos por kilómetro: "5:42". */
export function fmtRitmo(min: number): string {
  const m = Math.floor(min)
  const s = Math.round((min - m) * 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Un tiempo de carrera: "5h 12m". */
export function fmtDuracion(min: number | null): string {
  if (min == null) return '—'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`
}

/** ¿Hay algún puesto repartido? Los resultados de antes no traen `puesto`. */
function hayEmpate(stats: EventStats): boolean {
  const p = stats.corredores.filter((c) => c.puesto != null).map((c) => c.puesto)
  return new Set(p).size < p.length
}

/**
 * El kilómetro más rápido de la carrera: el dato que se discute luego.
 * Separado de la lista porque cada pantalla lo coloca donde le cabe.
 */
export function RecordDeKm({ stats }: { stats: EventStats }) {
  if (!stats.fastestKm) return null
  return (
    <p className="mb-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-2.5 py-1.5 text-[11px] text-amber-100">
      ⚡ Kilómetro más rápido de la carrera: <b>{fmtRitmo(stats.fastestKm.minutos)}</b> —{' '}
      {stats.fastestKm.username}, desde el km {stats.fastestKm.desdeKm.toFixed(1)}
    </p>
  )
}

/** La clasificación, con sus puestos compartidos y sus márgenes. */
export function ListaResultados({ stats }: { stats: EventStats }) {
  return (
    <>
      {/* Si hay empates hay que decir por qué: sin esto alguien discute un
          puesto que el cronómetro no ha decidido. */}
      {hayEmpate(stats) && (
        <p className="mb-2 rounded-lg border border-slate-700 bg-slate-900/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-400">
          🤝 Hay puestos compartidos: el paso por meta se calcula entre dos lecturas
          del GPS y cada tiempo lleva su margen. Cuando dos márgenes se tocan,
          cualquiera de los dos pudo llegar antes.
        </p>
      )}
      <ul className="space-y-1.5">
        {stats.corredores.map((c, i) => (
          <li key={c.username} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2">
            <div className="flex items-center gap-2">
              {/* El puesto que dice el resultado, no la fila en la que cayó:
                  los que llegan dentro del margen del otro comparten número, y
                  el siguiente se salta los empatados. */}
              <span className="w-5 shrink-0 text-center text-xs tabular-nums text-slate-500">
                {c.finished ? (c.puesto ?? i + 1) : '·'}
              </span>
              <MarkBadge emoji={c.emoji} color={c.color} size={20} />
              {c.bib && <Dorsal bib={c.bib} />}
              <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{c.username}</span>
              {c.finished
                ? (
                  <span className="shrink-0 text-right">
                    <span className="text-sm font-bold tabular-nums text-emerald-300">{fmtDuracion(c.minutos)}</span>
                    {/* El margen, pegado al tiempo: un tiempo sin él invita a
                        comparar segundos que no existen. Por debajo de cinco
                        segundos no se enseña, que es ruido de maquetación. */}
                    {c.margenMs != null && c.margenMs >= 5000 && (
                      <span className="ml-1 text-[10px] tabular-nums text-slate-500">±{Math.round(c.margenMs / 1000)}s</span>
                    )}
                  </span>
                )
                : (
                  /* Tres finales distintos y hasta ahora dos se contaban igual:
                     quien se RETIRÓ —paró la baliza sin cruzar— y quien
                     simplemente dejó de dar señal. El primero terminó su
                     carrera; del segundo no se sabe nada, y ponerle "no llegó"
                     es dar por hecho lo que no consta. */
                  <span className="shrink-0 text-[10px] text-slate-500">
                    {!c.tracked ? 'no emitió' : c.abandono ? 'abandonó' : 'sin noticias'}
                  </span>
                )}
            </div>
            {c.tracked && (
              <p className="mt-0.5 flex flex-wrap gap-x-2 pl-7 text-[11px] tabular-nums text-slate-500">
                <span>{c.km?.toFixed(1)} km</span>
                {c.ritmoMinKm != null && <span>· {fmtRitmo(c.ritmoMinKm)} /km de media</span>}
                {c.mejorKmMin != null && (
                  <span>· mejor km {fmtRitmo(c.mejorKmMin)}{c.mejorKmDesde != null ? ` (km ${c.mejorKmDesde.toFixed(1)})` : ''}</span>
                )}
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
