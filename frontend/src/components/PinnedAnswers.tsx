/**
 * PinnedAnswers — Dashboard section rendering the questions pinned from
 * Query AI. Every tile re-runs its question against live data on mount
 * (and on demand), so the Dashboard shows current numbers, not snapshots.
 * Live mode only; pins are server-persisted and shared by the team.
 */
import { useCallback, useEffect, useState } from 'react'
import { Pin, RefreshCw, X, Loader2, MessageSquare } from 'lucide-react'
import { listPins, deletePin, type DashboardPin } from '../api/pins'
import { ask, adaptAskResult } from '../api/semantic'
import { modeScopedSector } from '../lib/demoMode'
import { useSector } from '../contexts/SectorContext'
import { toast } from './Toast'

interface TileState {
  status: 'loading' | 'done' | 'error'
  summary?: string
  rows?: Record<string, unknown>[]
}

function fmtCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  const s = String(value)
  return s.length > 28 ? s.slice(0, 27) + '…' : s
}

function TileResult({ state }: { state: TileState }) {
  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <p className="text-xs text-slate-400 py-3">
        Could not run this question right now — refresh to retry.
      </p>
    )
  }
  const rows = state.rows ?? []
  // Single value → big number; small result → mini table; else summary text.
  if (rows.length === 1 && Object.keys(rows[0]).length === 1) {
    const value = Object.values(rows[0])[0]
    return (
      <p className="text-2xl font-bold text-slate-800 tabular-nums py-1">
        {fmtCell(value)}
      </p>
    )
  }
  if (rows.length > 0) {
    const cols = Object.keys(rows[0]).slice(0, 3)
    return (
      <div className="overflow-x-auto">
        <table className="text-[11px] w-full">
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c} className="text-left text-slate-400 font-medium pr-3 pb-1">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 4).map((row, i) => (
              <tr key={i} className="border-t border-slate-100">
                {cols.map(c => (
                  <td key={c} className="pr-3 py-1 text-slate-600 whitespace-nowrap">{fmtCell(row[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 4 && (
          <p className="text-[10px] text-slate-300 mt-1">+{rows.length - 4} more rows</p>
        )}
      </div>
    )
  }
  return <p className="text-xs text-slate-500 py-2">{state.summary || 'No data'}</p>
}

export default function PinnedAnswers({ onNavigateToQuery }: {
  onNavigateToQuery?: (question: string) => void
}) {
  const { sectorId } = useSector()
  const [pins, setPins] = useState<DashboardPin[]>([])
  const [tiles, setTiles] = useState<Record<string, TileState>>({})

  const runPin = useCallback((pin: DashboardPin) => {
    setTiles(prev => ({ ...prev, [pin.id]: { status: 'loading' } }))
    ask(pin.question, sectorId)
      .then(raw => {
        const r = adaptAskResult(raw)
        setTiles(prev => ({
          ...prev,
          [pin.id]: { status: 'done', summary: r.summary, rows: r.rows },
        }))
      })
      .catch(() => {
        setTiles(prev => ({ ...prev, [pin.id]: { status: 'error' } }))
      })
  }, [sectorId])

  useEffect(() => {
    let cancelled = false
    listPins(modeScopedSector(sectorId))
      .then(loaded => {
        if (cancelled) return
        setPins(loaded)
        loaded.forEach(runPin)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [sectorId, runPin])

  const unpin = useCallback(async (pin: DashboardPin) => {
    try {
      await deletePin(pin.id)
      setPins(prev => prev.filter(p => p.id !== pin.id))
      toast('Unpinned from dashboard', 'success')
    } catch {
      toast('Could not unpin — try again', 'error')
    }
  }, [])

  if (pins.length === 0) return null

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Pin className="w-4 h-4 text-teal-600" />
        <h3 className="text-sm font-semibold text-slate-900">Pinned answers</h3>
        <span className="text-xs text-slate-400">refreshed on every visit</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {pins.map(pin => (
          <div key={pin.id} className="bg-white rounded-xl border border-slate-200 p-3 group">
            <div className="flex items-start gap-2">
              <button
                onClick={() => onNavigateToQuery?.(pin.question)}
                className="text-left text-xs font-medium text-slate-700 hover:text-teal-700 transition-colors flex items-start gap-1.5 min-w-0"
                title="Open in Query AI"
              >
                <MessageSquare className="w-3 h-3 mt-0.5 flex-shrink-0 text-slate-300" />
                <span className="truncate">{pin.title || pin.question}</span>
              </button>
              <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button
                  onClick={() => runPin(pin)}
                  className="p-1 text-slate-300 hover:text-teal-600"
                  title="Refresh"
                >
                  <RefreshCw className={`w-3 h-3 ${tiles[pin.id]?.status === 'loading' ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => unpin(pin)}
                  className="p-1 text-slate-300 hover:text-red-500"
                  title="Unpin"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="mt-1.5">
              <TileResult state={tiles[pin.id] ?? { status: 'loading' }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
