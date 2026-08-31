import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../lib/AuthContext'
import type { SharePayloadV1, RevivedShare } from '../lib/sharePayload'
import type { PlanMeta } from '../../shared/wireTypes'
import {
  listPlans, createPlan, updatePlan, getPlan, getPlanPayload, renamePlan, deletePlan,
  suggestPlanName, plansErrorMessage, PlansError,
} from '../lib/plansTransport'
import { ConvertToEvent } from './ConvertToEvent'

type Current = { id: string; name: string } | null

/**
 * "Mis previsiones" modal. Opened from the user menu (AuthMenu → "📁 Mis
 * previsiones"); this component owns the modal and the "currently loaded/saved
 * plan" state so it can offer "Actualizar «X»" (overwrite in place) vs "Guardar
 * como nueva". The parent renders it unconditionally and it self-hides (returns
 * null) until `open`, so `current` survives opening/closing.
 */
export function MyPlansPanel({
  open, onClose, getPayload, hasTrack, eventId, onLoad,
}: {
  open: boolean
  onClose: () => void
  getPayload: () => SharePayloadV1
  hasTrack: boolean
  /** Evento del que viene el recorrido cargado (`?s=…&de=…`), para marcar la
   *  previsión como suya al guardarla. */
  eventId?: string | null
  onLoad: (revived: RevivedShare) => void
}) {
  const { user, status } = useAuth()
  const [current, setCurrent] = useState<Current>(null)
  if (status !== 'ready' || !user || !open) return null

  return (
    <Modal title="Mis previsiones" onClose={onClose}>
      <PlansBody
        getPayload={getPayload}
        hasTrack={hasTrack}
        current={current}
        eventId={eventId}
        canCreateEvents={user.isAdmin}
        onSaved={(id, name) => setCurrent({ id, name })}
        onLoaded={(id, name, revived) => { setCurrent({ id, name }); onLoad(revived); onClose() }}
        onDeleted={(id) => setCurrent((c) => (c && c.id === id ? null : c))}
      />
    </Modal>
  )
}

function PlansBody({
  getPayload, hasTrack, current, eventId, canCreateEvents, onSaved, onLoaded, onDeleted,
}: {
  getPayload: () => SharePayloadV1
  hasTrack: boolean
  current: Current
  eventId?: string | null
  /** Solo un administrador crea eventos: es quien organiza, no cada cuenta. */
  canCreateEvents: boolean
  onSaved: (id: string, name: string) => void
  onLoaded: (id: string, name: string, revived: RevivedShare) => void
  onDeleted: (id: string) => void
}) {
  const [plans, setPlans] = useState<PlanMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  /** La previsión que se está convirtiendo en evento (con su payload ya leído). */
  const [converting, setConverting] = useState<{ payload: SharePayloadV1; name: string } | null>(null)

  const refresh = useCallback(async () => {
    try { setPlans(await listPlans()); setError(null) }
    catch (e) { setError(plansErrorMessage(codeOf(e))) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Prefill the name: the loaded plan's name, else a suggestion from the route.
  useEffect(() => {
    if (current) { setName(current.name); return }
    if (hasTrack && !name) {
      try { setName(suggestPlanName(getPayload())) } catch { /* no track yet */ }
    }
  }, [current, hasTrack]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveNew() {
    if (!hasTrack || !name.trim()) return
    setBusy(true); setError(null)
    try {
      // La procedencia solo se marca al CREAR: actualizar una previsión
      // existente conserva la que ya tuviera (el servidor no la toca).
      const meta = await createPlan(getPayload(), name.trim(), eventId)
      onSaved(meta.id, meta.name)
      await refresh()
    } catch (e) { setError(plansErrorMessage(codeOf(e))) }
    finally { setBusy(false) }
  }

  async function update() {
    if (!hasTrack || !current || !name.trim()) return
    setBusy(true); setError(null)
    try {
      await updatePlan(current.id, getPayload(), name.trim())
      onSaved(current.id, name.trim())
      await refresh()
    } catch (e) { setError(plansErrorMessage(codeOf(e))) }
    finally { setBusy(false) }
  }

  async function load(p: PlanMeta) {
    setBusy(true); setError(null)
    try { onLoaded(p.id, p.name, await getPlan(p.id)) }
    catch (e) { setError(plansErrorMessage(codeOf(e))); setBusy(false) }
  }

  async function rename(p: PlanMeta) {
    const next = window.prompt('Nuevo nombre de la previsión', p.name)?.trim()
    if (!next || next === p.name) return
    setBusy(true); setError(null)
    try { await renamePlan(p.id, next); if (current?.id === p.id) onSaved(p.id, next); await refresh() }
    catch (e) { setError(plansErrorMessage(codeOf(e))) }
    finally { setBusy(false) }
  }

  /** Abre "convertir en evento" con el payload de esa previsión, tal cual está
   *  guardado (el recorte a base común lo hace el propio diálogo). */
  async function convert(p: PlanMeta) {
    setBusy(true); setError(null)
    try { setConverting({ payload: await getPlanPayload(p.id), name: p.name }) }
    catch (e) { setError(plansErrorMessage(codeOf(e))) }
    finally { setBusy(false) }
  }

  async function remove(p: PlanMeta) {
    if (!window.confirm(`¿Borrar "${p.name}"? No se puede deshacer.`)) return
    setBusy(true); setError(null)
    try { await deletePlan(p.id); onDeleted(p.id); await refresh() }
    catch (e) { setError(plansErrorMessage(codeOf(e))) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      {/* Save / update current */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <p className="text-xs text-slate-400 mb-2">
          {current ? <>Editando <span className="text-slate-200 font-medium">«{current.name}»</span></> : 'Guardar la ruta actual en tu cuenta'}
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={hasTrack ? 'Nombre de la previsión' : 'Carga una ruta primero'}
          disabled={!hasTrack || busy}
          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-sky-600 disabled:opacity-50 mb-2"
        />
        <div className="flex gap-2">
          {current && (
            <button
              onClick={() => void update()}
              disabled={!hasTrack || !name.trim() || busy}
              className="flex-1 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 transition-colors"
            >
              Actualizar
            </button>
          )}
          <button
            onClick={() => void saveNew()}
            disabled={!hasTrack || !name.trim() || busy}
            className={`flex-1 rounded-lg text-sm font-medium py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              current
                ? 'bg-slate-800 border border-slate-700 text-slate-200 hover:border-sky-700'
                : 'bg-sky-600 hover:bg-sky-500 text-white'
            }`}
          >
            {current ? 'Guardar como nueva' : 'Guardar'}
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="space-y-2 max-h-72 overflow-y-auto">
        {plans === null ? (
          <p className="text-xs text-slate-500">Cargando…</p>
        ) : plans.length === 0 ? (
          <p className="text-xs text-slate-500">Aún no tienes previsiones guardadas.</p>
        ) : (
          plans.map((p) => (
            <div key={p.id} className={`rounded-lg border bg-slate-950/60 p-2.5 text-xs ${current?.id === p.id ? 'border-sky-700' : 'border-slate-800'}`}>
              <p className="font-medium text-slate-200 truncate">
                {p.name}{current?.id === p.id && <span className="text-sky-400 font-normal"> · actual</span>}
              </p>
              <p className="text-slate-500 truncate">
                {[p.routeName, p.distanceKm != null ? `${p.distanceKm.toFixed(p.distanceKm < 100 ? 1 : 0)} km` : null, fmtDate(p.updatedAt)]
                  .filter(Boolean).join(' · ')}
              </p>
              <div className="mt-2 flex gap-2">
                <RowBtn onClick={() => void load(p)} disabled={busy} primary>Cargar</RowBtn>
                <RowBtn onClick={() => void rename(p)} disabled={busy}>Renombrar</RowBtn>
                {canCreateEvents && <RowBtn onClick={() => void convert(p)} disabled={busy}>Evento</RowBtn>}
                <RowBtn onClick={() => void remove(p)} disabled={busy} danger>Borrar</RowBtn>
              </div>
            </div>
          ))
        )}
      </div>

      {converting && (
        <ConvertToEvent
          payload={converting.payload}
          planName={converting.name}
          onClose={() => setConverting(null)}
        />
      )}
    </div>
  )
}

function RowBtn({ children, onClick, disabled, primary, danger }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; danger?: boolean
}) {
  const tone = primary ? 'text-sky-400 hover:bg-sky-950/50' : danger ? 'text-red-400 hover:bg-red-950/40' : 'text-slate-300 hover:bg-slate-800'
  return (
    <button onClick={onClick} disabled={disabled} className={`px-2 py-1 rounded border border-slate-700 disabled:opacity-50 transition-colors ${tone}`}>
      {children}
    </button>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-[2000] overflow-y-auto bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function codeOf(e: unknown): string {
  return e instanceof PlansError ? e.code : 'network'
}

function fmtDate(ms: number): string {
  try { return new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) } catch { return '' }
}
