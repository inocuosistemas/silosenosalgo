import { useEffect, useRef, useState } from 'react'
import type { GpxNamedWaypoint, GpxTrack } from '../lib/gpx'
import {
  parsePoiPaste,
  validateRows,
  materialisePois,
  formatPoisAsText,
  type MaterialisedPoi,
  type ValidatedRow,
} from '../lib/customPois'
import { formatTime } from '../lib/timing'
import type { CutoffWallClock } from '../lib/cutoffInference'

export interface PoiUpdateDraft {
  distanceKm: number
  name: string
  desc: string
  cutoff: CutoffWallClock | null
}

interface Props {
  track:        GpxTrack
  startTime:    Date
  cutoffTimes:  Map<string, Date>
  /**
   * Called when the user confirms one or more POI additions. The handler is
   * responsible for merging into `track.namedWaypoints`, updating cut-offs
   * and triggering re-render.
   */
  onAddPois:    (pois: MaterialisedPoi[]) => void
  /** Update an existing POI. Changing km moves it onto the track at that km. */
  onUpdatePoi:  (lat: number, lon: number, draft: PoiUpdateDraft) => void
  /**
   * Remove a single POI by its lat/lon (matched by stable rounded key).
   * Original GPX POIs are confirmed in the panel before calling this hook.
   */
  onRemovePoi:  (lat: number, lon: number) => void
  /** Remove ALL user-added POIs at once. Confirmed at the call site. */
  onClearCustom: () => void
  /** Trigger the GPX download (App.tsx handles the actual blob/serialise call) */
  onDownload:   () => void
  /**
   * Download a FIT course for Garmin. Its course_points carry an explicit
   * `distance` field, the only way to make Garmin show the per-POI km (GPX
   * import lists every POI at "0,00 km").
   */
  onDownloadFit: () => void
  /** Whether there's any difference vs the originally-loaded GPX */
  modified:     boolean
}

const wptKey = (lat: number, lon: number) => `${lat.toFixed(6)},${lon.toFixed(6)}`

function parseCutoffInput(value: string): CutoffWallClock | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(trimmed)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

function cutoffInputValue(cutoff: Date | undefined): string {
  if (!cutoff) return ''
  return `${cutoff.getHours().toString().padStart(2, '0')}:${cutoff.getMinutes().toString().padStart(2, '0')}`
}

// ── Tiny inline SVG icons (same style as BuddyTracker) ────────────────────────
function PasteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M9 14l2 2 4-4" />
    </svg>
  )
}
function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}
function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}
function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

// ── Help / format modal ──────────────────────────────────────────────────────

function HelpModal({ onClose }: { onClose: () => void }) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl max-w-xl w-full max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-800 sticky top-0 bg-slate-900">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">Cómo añadir POIs</h3>
            <p className="text-xs text-slate-400 mt-0.5">Formato del texto y comportamiento</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200 text-xl leading-none px-2"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 text-sm text-slate-300">

          <section>
            <h4 className="text-slate-100 font-semibold mb-1.5">Formato por línea</h4>
            <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 overflow-x-auto">
{`km | nombre | descripción | corte | parada`}
            </pre>
            <ul className="mt-2 space-y-1 text-xs text-slate-400 list-disc pl-5">
              <li><code className="text-slate-200">km</code> — punto kilométrico, decimal con punto o coma (<code className="text-slate-200">15.5</code> o <code className="text-slate-200">15,5</code>)</li>
              <li><code className="text-slate-200">nombre</code> — obligatorio, cualquier texto</li>
              <li><code className="text-slate-200">descripción</code> — opcional, deja vacío entre los pipes si no aplica</li>
              <li><code className="text-slate-200">corte</code> — opcional, formato <code className="text-slate-200">HH:MM</code> únicamente. <strong className="text-slate-200">El día se calcula automáticamente</strong> (ver siguiente sección)</li>
              <li><code className="text-slate-200">parada</code> — opcional, minutos previstos parado en este punto. Se puede ajustar después en Plan de paso.</li>
            </ul>
          </section>

          <section>
            <h4 className="text-slate-100 font-semibold mb-1.5">Ejemplo</h4>
            <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
{`# Cabecera y comentarios opcionales
km | nombre        | descripción            | corte | parada
15.5 | Refugio       | Avituallamiento        | 14:30 | 30
22.0 | Cima del Pico | Vista panorámica       |       |
30.5 | Meta          |                        | 03:00 |`}
            </pre>
            <p className="text-xs text-slate-400 mt-2">
              Las líneas que empiezan con <code className="text-slate-200">#</code> y la cabecera <code className="text-slate-200">km | nombre…</code> se ignoran.
            </p>
          </section>

          <section className="bg-sky-950/30 border border-sky-800/50 rounded-lg p-3">
            <h4 className="text-sky-300 font-semibold mb-1.5">⏱ Cómo se calcula el día del corte</h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              Solo necesitas indicar la <strong className="text-slate-100">hora</strong> (HH:MM). El día se asigna automáticamente:
            </p>
            <ul className="mt-2 space-y-1 text-xs text-slate-300 list-disc pl-5">
              <li>El primer corte va al mismo día de salida si su hora es posterior a la hora de salida; si no, salta al día siguiente.</li>
              <li>Cada corte siguiente debe ser posterior al anterior en tiempo absoluto. Si la hora indicada es menor que la del corte anterior, salta automáticamente al día siguiente.</li>
              <li>Funciona para eventos multi-día sin que tengas que indicar nada manualmente.</li>
            </ul>
            <p className="text-xs text-slate-400 mt-2 italic">
              Ejemplo: salida sábado 09:00. Cortes 13:00 → sábado 13:00. Después 20:00 → sábado 20:00. Después 03:00 → domingo 03:00 (auto). Después 09:00 → domingo 09:00.
            </p>
          </section>

          <section className="bg-amber-950/20 border border-amber-800/40 rounded-lg p-3">
            <h4 className="text-amber-300 font-semibold mb-1.5">⚠ Hora de salida = referencia única</h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              Asegúrate de que la <strong className="text-slate-100">fecha y hora de salida</strong> son las reales del evento. Es la única referencia temporal: si la cambias, todos los cortes se recalculan al vuelo manteniendo sus horas absolutas y reasignando los días si hace falta.
            </p>
          </section>

          <section>
            <h4 className="text-slate-100 font-semibold mb-1.5">Separadores aceptados</h4>
            <p className="text-xs text-slate-400">
              Pipe <code className="text-slate-200">|</code>, tabulador (pegado desde Excel/Sheets) o punto y coma <code className="text-slate-200">;</code>. Mezclar dentro de la misma línea está permitido.
            </p>
          </section>

          <section>
            <h4 className="text-slate-100 font-semibold mb-1.5">Coordenadas</h4>
            <p className="text-xs text-slate-400">
              No hace falta indicar lat/lon. La aplicación calcula la posición exacta interpolando el punto km sobre el track cargado.
            </p>
          </section>

          <section>
            <h4 className="text-slate-100 font-semibold mb-1.5">Persistencia y descarga</h4>
            <ul className="space-y-1 text-xs text-slate-400 list-disc pl-5">
              <li>Los POIs añadidos pasan a formar parte del track en memoria, junto con los del GPX original.</li>
              <li>Se guardan en localStorage (por nombre de track) como copia de seguridad — no se pierden al recargar.</li>
              <li>Para llevártelos a otra aplicación o dispositivo, descarga el GPX modificado: los cortes viajan dentro de <code className="text-slate-200">&lt;extensions&gt;</code>, los POIs como <code className="text-slate-200">&lt;wpt&gt;</code> estándar.</li>
              <li>Si vuelves a cargar el GPX descargado en SiLoSeNoSalgo, se reconstruye todo (POIs + cortes).</li>
            </ul>
          </section>

          <section>
            <h4 className="text-slate-100 font-semibold mb-1.5">Compatibilidad</h4>
            <p className="text-xs text-slate-400">
              Otras apps (Wikiloc, Garmin Connect, GAIA…) verán los POIs como waypoints normales. La extensión de corte la ignorarán pero la mantendrán intacta al editar el archivo.
            </p>
          </section>

          <section>
            <h4 className="text-slate-100 font-semibold mb-1.5">Errores</h4>
            <p className="text-xs text-slate-400">
              Las líneas con problemas (km fuera de rango, formato de corte inválido, nombre vacío) se reportan al pegar y no se añaden. Las correctas sí se aplican.
            </p>
          </section>
        </div>

        <div className="px-5 py-3 border-t border-slate-800 flex justify-end sticky bottom-0 bg-slate-900">
          <button
            onClick={onClose}
            className="bg-sky-600 hover:bg-sky-500 text-white font-medium py-1.5 px-4 rounded-lg text-sm transition-colors"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────

export function PoisPanel({
  track,
  startTime,
  cutoffTimes,
  onAddPois,
  onUpdatePoi,
  onRemovePoi,
  onClearCustom,
  onDownload,
  onDownloadFit,
  modified,
}: Props) {
  const [open,        setOpen]        = useState(false)
  const [helpOpen,    setHelpOpen]    = useState(false)
  const [pasteText,   setPasteText]   = useState('')
  const [editingKey,  setEditingKey]  = useState<string | null>(null)
  const [editDraft,   setEditDraft]   = useState<{
    km: string
    name: string
    desc: string
    cutoff: string
  } | null>(null)
  const [preview,     setPreview]     = useState<{
    valid:      ValidatedRow[]
    invalid:    { lineNo: number; line: string; reason: string }[]
    outOfRange: { lineNo: number; line?: string; km: number; name: string }[]
    skipped:    number
  } | null>(null)
  const [statusMsg,  setStatusMsg] = useState<string | null>(null)
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setTransientStatus = (msg: string, ms = 4000) => {
    setStatusMsg(msg)
    if (statusTimer.current) clearTimeout(statusTimer.current)
    statusTimer.current = setTimeout(() => setStatusMsg(null), ms)
  }

  // Cleanup timer on unmount
  useEffect(() => () => {
    if (statusTimer.current) clearTimeout(statusTimer.current)
  }, [])

  const customPois = track.namedWaypoints.filter((w) => w.custom)

  const startEdit = (w: GpxNamedWaypoint) => {
    const cutoff = cutoffTimes.get(wptKey(w.lat, w.lon))
    setEditingKey(wptKey(w.lat, w.lon))
    setEditDraft({
      km: w.distanceKm.toFixed(2),
      name: w.name,
      desc: w.desc ?? '',
      cutoff: cutoffInputValue(cutoff),
    })
  }

  const cancelEdit = () => {
    setEditingKey(null)
    setEditDraft(null)
  }

  const saveEdit = (w: GpxNamedWaypoint) => {
    if (!editDraft) return
    const km = Number(editDraft.km.replace(',', '.'))
    if (!Number.isFinite(km) || km < 0 || km > track.totalDistanceKm) {
      setTransientStatus(`Km no válido: usa un valor entre 0 y ${track.totalDistanceKm.toFixed(1)}`)
      return
    }
    const name = editDraft.name.trim()
    if (!name) {
      setTransientStatus('El nombre del POI no puede estar vacío')
      return
    }
    const cutoff = parseCutoffInput(editDraft.cutoff)
    if (editDraft.cutoff.trim() && !cutoff) {
      setTransientStatus('Corte no válido: usa HH:MM')
      return
    }
    onUpdatePoi(w.lat, w.lon, {
      distanceKm: km,
      name,
      desc: editDraft.desc,
      cutoff,
    })
    setTransientStatus('✓ POI actualizado')
    cancelEdit()
  }

  const handleRemoveOne = (w: GpxNamedWaypoint) => {
    const msg = w.custom
      ? `¿Eliminar el POI "${w.name}"?`
      : `¿Eliminar el POI original "${w.name}" de esta planificación? Si quieres conservar el cambio, descarga el GPX modificado.`
    if (!confirm(msg)) return
    onRemovePoi(w.lat, w.lon)
    if (editingKey === wptKey(w.lat, w.lon)) cancelEdit()
    setTransientStatus('POI eliminado')
  }

  const handleAnalyse = () => {
    if (!pasteText.trim()) {
      setPreview(null)
      return
    }
    const { rows, errors, skipped } = parsePoiPaste(pasteText)
    const { validated, outOfRange } = validateRows(rows, {
      totalKm: track.totalDistanceKm,
      existingPois: track.namedWaypoints,
    })
    setPreview({
      valid:      validated,
      invalid:    errors,
      outOfRange: outOfRange.map((r) => ({ lineNo: r.lineNo, km: r.km, name: r.name })),
      skipped,
    })
  }

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        setTransientStatus('El portapapeles está vacío')
        return
      }
      setPasteText(text)
      const { rows, errors, skipped } = parsePoiPaste(text)
      const { validated, outOfRange } = validateRows(rows, {
        totalKm: track.totalDistanceKm,
        existingPois: track.namedWaypoints,
      })
      setPreview({
        valid:      validated,
        invalid:    errors,
        outOfRange: outOfRange.map((r) => ({ lineNo: r.lineNo, km: r.km, name: r.name })),
        skipped,
      })
    } catch {
      setTransientStatus('No se pudo leer el portapapeles')
    }
  }

  const handleConfirm = () => {
    if (!preview || preview.valid.length === 0) return
    const materialised = materialisePois(preview.valid, track, startTime)
    onAddPois(materialised)
    setTransientStatus(`✓ ${materialised.length} POI${materialised.length > 1 ? 's' : ''} añadido${materialised.length > 1 ? 's' : ''}`)
    setPasteText('')
    setPreview(null)
  }

  const handleCopyExisting = async () => {
    // The panel receives `cutoffTimes` as inferred Date objects (day already
    // assigned). For the paste-compatible output we only want HH:MM, so we
    // extract local hour/minute from each Date — the day is intentionally
    // discarded (it gets re-inferred on import).
    const cutoffByKm = new Map<number, { hour: number; minute: number }>()
    for (const w of track.namedWaypoints) {
      const c = cutoffTimes.get(wptKey(w.lat, w.lon))
      if (c) cutoffByKm.set(w.distanceKm, { hour: c.getHours(), minute: c.getMinutes() })
    }
    const text = formatPoisAsText(track.namedWaypoints, cutoffByKm)
    try {
      await navigator.clipboard.writeText(text)
      setTransientStatus('✓ POIs copiados al portapapeles')
    } catch {
      setTransientStatus('No se pudo copiar al portapapeles')
    }
  }

  const handleClearCustom = () => {
    if (customPois.length === 0) return
    if (!confirm(`¿Eliminar los ${customPois.length} POIs personalizados? Los del GPX original se conservan.`)) return
    onClearCustom()
    setTransientStatus(`${customPois.length} POI${customPois.length > 1 ? 's' : ''} eliminado${customPois.length > 1 ? 's' : ''}`)
  }

  const totalPois  = track.namedWaypoints.length
  const customCount = customPois.length

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">

      {/* ── Toggle header ── */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400 uppercase tracking-widest font-semibold">
            🚩 POIs del recorrido
          </span>
          <span className="text-xs text-slate-500">
            {totalPois > 0
              ? <>{totalPois} en total{customCount > 0 ? <> · <span className="text-purple-400 font-medium">{customCount} personalizado{customCount > 1 ? 's' : ''}</span></> : null}</>
              : 'añade puntos kilométricos, cortes y avituallamientos'}
          </span>
          {modified && (
            <span className="text-[10px] bg-amber-900/40 border border-amber-700/50 text-amber-300 px-2 py-0.5 rounded-full font-medium">
              cambios sin guardar
            </span>
          )}
        </div>
        <span className="text-slate-500 text-xs ml-2 shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-800 px-4 py-4 space-y-4">

          {/* ── Toolbar: paste / copy / info / download ── */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handlePasteFromClipboard}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white text-xs font-medium transition-colors"
              title="Pegar desde el portapapeles y previsualizar"
            >
              <PasteIcon /> Pegar del portapapeles
            </button>
            <button
              onClick={handleCopyExisting}
              disabled={totalPois === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-xs font-medium border border-slate-700 transition-colors"
              title="Copiar POIs actuales en formato texto"
            >
              <CopyIcon /> Copiar POIs
            </button>
            <button
              onClick={() => setHelpOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors"
              title="Ver formato esperado y funcionamiento"
            >
              <InfoIcon /> Ayuda y formato
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={onDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium transition-colors"
                title="Descargar GPX con el track y, si los hay, los POIs y cortes incrustados"
              >
                <DownloadIcon /> Descargar GPX
              </button>
              <button
                onClick={onDownloadFit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white text-xs font-medium transition-colors"
                title="Descargar curso FIT para Garmin Connect: los POI conservan su km (a diferencia del GPX)"
              >
                <DownloadIcon /> Curso FIT (Garmin)
              </button>
            </div>
          </div>

          {/* ── Status banner ── */}
          {statusMsg && (
            <div className="text-xs bg-slate-800 border border-slate-700 text-slate-300 px-3 py-2 rounded-lg">
              {statusMsg}
            </div>
          )}

          {/* ── Textarea ── */}
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 flex items-center justify-between">
              <span>Pegar texto (un POI por línea)</span>
              <button
                onClick={() => setHelpOpen(true)}
                className="text-sky-400 hover:text-sky-300 text-xs"
              >
                ¿formato?
              </button>
            </label>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              onBlur={handleAnalyse}
              placeholder={'15.5 | Refugio | Avituallamiento | 14:30\n22.0 | Cima | Vista panorámica\n30.5 | Meta |  | 03:00'}
              rows={5}
              spellCheck={false}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-600"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleAnalyse}
                disabled={!pasteText.trim()}
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 border border-slate-700 transition-colors"
              >
                Analizar
              </button>
              {pasteText.length > 0 && (
                <button
                  onClick={() => { setPasteText(''); setPreview(null) }}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  Limpiar
                </button>
              )}
            </div>
          </div>

          {/* ── Preview ── */}
          {preview && (
            <div className="space-y-3">
              {/* Summary */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {preview.valid.length > 0 && (
                  <span className="bg-emerald-900/30 border border-emerald-700/50 text-emerald-300 px-2 py-0.5 rounded-full">
                    ✓ {preview.valid.length} válid{preview.valid.length > 1 ? 'os' : 'o'}
                  </span>
                )}
                {preview.invalid.length > 0 && (
                  <span className="bg-red-900/30 border border-red-700/50 text-red-300 px-2 py-0.5 rounded-full">
                    ✗ {preview.invalid.length} con error
                  </span>
                )}
                {preview.outOfRange.length > 0 && (
                  <span className="bg-amber-900/30 border border-amber-700/50 text-amber-300 px-2 py-0.5 rounded-full">
                    ⚠ {preview.outOfRange.length} fuera de rango
                  </span>
                )}
                {preview.skipped > 0 && (
                  <span className="text-slate-500">{preview.skipped} ignorada{preview.skipped > 1 ? 's' : ''}</span>
                )}
              </div>

              {/* Valid rows table */}
              {preview.valid.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 text-[10px] uppercase tracking-wider">
                        <th className="text-left py-1.5 pr-3">km</th>
                        <th className="text-left py-1.5 pr-3">Nombre</th>
                        <th className="text-left py-1.5 pr-3">Descripción</th>
                        <th className="text-left py-1.5 pr-3">Corte</th>
                        <th className="text-left py-1.5 pr-3">Parada</th>
                        <th className="text-left py-1.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.valid.map((r) => (
                        <tr key={r.lineNo} className="border-t border-slate-800/50">
                          <td className="py-1.5 pr-3 font-mono text-slate-300">{r.km.toFixed(1)}</td>
                          <td className="py-1.5 pr-3 text-slate-200">{r.name}</td>
                          <td className="py-1.5 pr-3 text-slate-400 truncate max-w-[12rem]">{r.desc ?? '—'}</td>
                          <td className="py-1.5 pr-3 font-mono text-amber-300">
                            {r.cutoff
                              ? `${r.cutoff.hour.toString().padStart(2, '0')}:${r.cutoff.minute.toString().padStart(2, '0')}`
                              : '—'}
                          </td>
                          <td className="py-1.5 pr-3 font-mono text-rose-300">
                            {r.pauseMin ? `${r.pauseMin}m` : '—'}
                          </td>
                          <td className="py-1.5">
                            {r.isDuplicate && (
                              <span
                                className="text-amber-400 text-[10px]"
                                title={`Cerca de "${r.duplicateOf?.name}" (km ${r.duplicateOf?.distanceKm.toFixed(1)})`}
                              >
                                ⚠ duplicado cercano
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Invalid + out-of-range details */}
              {(preview.invalid.length > 0 || preview.outOfRange.length > 0) && (
                <div className="space-y-1.5">
                  {preview.invalid.map((e) => (
                    <p key={`err-${e.lineNo}`} className="text-xs text-red-400">
                      Línea {e.lineNo}: {e.reason} <span className="text-slate-500 font-mono">— {e.line}</span>
                    </p>
                  ))}
                  {preview.outOfRange.map((r) => (
                    <p key={`oor-${r.lineNo}`} className="text-xs text-amber-400">
                      Línea {r.lineNo}: km {r.km.toFixed(1)} fuera del recorrido (longitud {track.totalDistanceKm.toFixed(1)} km) — &quot;{r.name}&quot;
                    </p>
                  ))}
                </div>
              )}

              {/* Confirm */}
              {preview.valid.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={handleConfirm}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                  >
                    Añadir {preview.valid.length} POI{preview.valid.length > 1 ? 's' : ''} al recorrido
                  </button>
                  <button
                    onClick={() => setPreview(null)}
                    className="text-xs text-slate-500 hover:text-slate-300 px-3 py-2"
                  >
                    Descartar análisis
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Existing POIs list ── */}
          {totalPois > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-slate-800/60">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">POIs actuales del recorrido</p>
                {customCount > 0 && (
                  <button
                    onClick={handleClearCustom}
                    className="text-xs text-slate-500 hover:text-red-400 transition-colors"
                  >
                    Eliminar todos los personalizados
                  </button>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto scrollbar-slim pr-2">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-900 text-slate-500">
                    <tr className="border-b border-slate-800/80">
                      <th className="py-1.5 pr-2 text-right font-medium w-16">Km</th>
                      <th className="py-1.5 pr-2 text-left font-medium">Nombre</th>
                      <th className="py-1.5 pr-2 text-left font-medium">Descripción</th>
                      <th className="py-1.5 pr-2 text-left font-medium w-24">Corte oficial</th>
                      <th className="py-1.5 text-right font-medium w-24">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...track.namedWaypoints]
                      .sort((a, b) => a.distanceKm - b.distanceKm)
                      .map((w) => {
                        const cutoff = cutoffTimes.get(wptKey(w.lat, w.lon))
                        const key = wptKey(w.lat, w.lon)
                        const editing = editingKey === key && editDraft !== null
                        return (
                          <tr key={`${w.lat},${w.lon},${w.name}`} className="border-t border-slate-800/40">
                            <td className="py-1.5 pr-2 font-mono text-slate-400 text-right align-top">
                              {editing ? (
                                <input
                                  type="number"
                                  min={0}
                                  max={track.totalDistanceKm}
                                  step={0.1}
                                  value={editDraft.km}
                                  onChange={(e) => setEditDraft({ ...editDraft, km: e.target.value })}
                                  className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-right text-slate-200 focus:outline-none focus:border-sky-600"
                                />
                              ) : (
                                w.distanceKm.toFixed(1)
                              )}
                            </td>
                            <td className="py-1.5 pr-2 align-top">
                              {editing ? (
                                <input
                                  type="text"
                                  value={editDraft.name}
                                  onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                                  className="w-full min-w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-sky-600"
                                />
                              ) : (
                                <>
                                  <span className="text-slate-200">{w.name}</span>
                                  {w.custom && (
                                    <span className="ml-1.5 text-[10px] bg-purple-900/40 border border-purple-700/50 text-purple-300 px-1.5 py-0.5 rounded">
                                      personalizado
                                    </span>
                                  )}
                                </>
                              )}
                            </td>
                            <td className="py-1.5 pr-2 align-top">
                              {editing ? (
                                <input
                                  type="text"
                                  value={editDraft.desc}
                                  onChange={(e) => setEditDraft({ ...editDraft, desc: e.target.value })}
                                  className="w-full min-w-40 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-sky-600"
                                />
                              ) : (
                                <span className="block text-slate-500 truncate max-w-[18rem]" title={w.desc ?? ''}>{w.desc ?? ''}</span>
                              )}
                            </td>
                            <td className="py-1.5 pr-2 font-mono text-amber-300 align-top">
                              {editing ? (
                                <input
                                  type="time"
                                  value={editDraft.cutoff}
                                  onChange={(e) => setEditDraft({ ...editDraft, cutoff: e.target.value })}
                                  className="w-24 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-amber-200 focus:outline-none focus:border-amber-500 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-60"
                                />
                              ) : (
                                cutoff ? formatTime(cutoff) : ''
                              )}
                            </td>
                            <td className="py-1.5 text-right">
                              {editing ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => saveEdit(w)}
                                    className="text-emerald-300 hover:text-emerald-200 transition-colors text-xs px-1.5 py-0.5 rounded"
                                    title="Guardar cambios"
                                  >
                                    ✓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEdit}
                                    className="text-slate-500 hover:text-slate-300 transition-colors text-xs px-1.5 py-0.5 rounded"
                                    title="Cancelar"
                                  >
                                    ↩
                                  </button>
                                </div>
                              ) : (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => startEdit(w)}
                                    className="text-sky-400 hover:text-sky-300 transition-colors text-xs px-1.5 py-0.5 rounded"
                                    title="Editar POI"
                                  >
                                    ✎
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveOne(w)}
                                    className="text-slate-500 hover:text-red-400 transition-colors text-xs px-1.5 py-0.5 rounded"
                                    title="Eliminar POI"
                                  >
                                    ×
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Help modal — outside the collapsed body so it works regardless */}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  )
}

// Re-export so App.tsx can pass the right type
export type { MaterialisedPoi }
