/**
 * PiiPanel — data protection rules. Values in protected columns are masked
 * SERVER-SIDE before any API response, so neither the query interface nor
 * the data explorer ever shows them. Admins add rules by hand or from the
 * name-based scan (no row data is ever read to produce suggestions).
 */
import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, ScanSearch, Trash2, Plus, Loader2 } from 'lucide-react'
import { api, getAuthToken } from '../api/client'
import { backendErrorMessage } from '../api/semantic'
import { toast } from './Toast'

export interface PiiRule {
  id: string
  table: string
  column: string
  strategy: 'full' | 'partial' | 'email'
  created_by: string
  created_at: string
}

export interface PiiSuggestion {
  table: string
  column: string
  strategy: 'full' | 'partial' | 'email'
  reason: string
}

const listRules = (): Promise<PiiRule[]> =>
  api.get<PiiRule[]>('/api/semantic/pii/rules').then(r => r.data)
const createRule = (rule: { column: string; strategy: string; table?: string }): Promise<PiiRule> =>
  api.post<PiiRule>('/api/semantic/pii/rules', rule).then(r => r.data)
const deleteRule = (id: string): Promise<void> =>
  api.delete(`/api/semantic/pii/rules/${encodeURIComponent(id)}`).then(() => undefined)
const scanColumns = (): Promise<PiiSuggestion[]> =>
  api.post<PiiSuggestion[]>('/api/semantic/pii/scan').then(r => r.data)

const STRATEGY_LABEL: Record<PiiRule['strategy'], string> = {
  full: 'hide completely',
  partial: 'keep last 4',
  email: 'keep domain',
}

function isAdmin(): boolean {
  const token = getAuthToken()
  if (!token) return false
  try {
    const b64 = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/')
    if (!b64) return false
    return (JSON.parse(atob(b64)) as Record<string, unknown>).role === 'admin'
  } catch { return false }
}

export function PiiSection() {
  const admin = isAdmin()
  const [rules, setRules] = useState<PiiRule[]>([])
  const [suggestions, setSuggestions] = useState<PiiSuggestion[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [newColumn, setNewColumn] = useState('')
  const [newStrategy, setNewStrategy] = useState<PiiRule['strategy']>('full')

  const refresh = useCallback(() => {
    listRules().then(setRules).catch(() => {})
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const addRule = useCallback(async (rule: { column: string; strategy: string; table?: string }) => {
    try {
      await createRule(rule)
      toast(`"${rule.column}" is now masked in every result`, 'success')
      setSuggestions(prev => prev?.filter(s => !(s.column === rule.column && s.table === (rule.table ?? ''))) ?? null)
      refresh()
    } catch (err) {
      toast(backendErrorMessage(err) || 'Could not add the rule', 'error')
    }
  }, [refresh])

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      const found = await scanColumns()
      setSuggestions(found)
      if (found.length === 0) toast('No unprotected sensitive columns found', 'success')
    } catch (err) {
      toast(backendErrorMessage(err) || 'Scan failed', 'error')
    } finally { setScanning(false) }
  }, [])

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="w-4 h-4 text-teal-600" />
        <h3 className="text-sm font-semibold text-slate-900">Data protection</h3>
        {admin && (
          <button
            onClick={scan}
            disabled={scanning}
            className="ml-auto flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-40"
            title="Suggest columns to protect from their names — no data is read"
          >
            {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanSearch className="w-3.5 h-3.5" />}
            Scan for sensitive columns
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Values in protected columns are masked before they leave the server — query answers and the data explorer never show them.
      </p>

      {rules.length === 0 && !suggestions && (
        <p className="text-xs text-slate-400 italic">No protected columns yet.</p>
      )}

      {rules.length > 0 && (
        <div className="space-y-1 mb-3">
          {rules.map(rule => (
            <div key={rule.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-slate-50 group text-xs">
              <span className="font-mono text-slate-700">
                {rule.table ? `${rule.table}.` : ''}{rule.column}
              </span>
              {!rule.table && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">everywhere</span>}
              <span className="text-[10px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded-full">{STRATEGY_LABEL[rule.strategy]}</span>
              {admin && (
                <button
                  onClick={async () => {
                    try { await deleteRule(rule.id); refresh() }
                    catch { toast('Could not remove the rule', 'error') }
                  }}
                  className="ml-auto text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                  title="Remove protection"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <div className="border border-indigo-100 bg-indigo-50/50 rounded-lg p-3 mb-3">
          <p className="text-xs font-medium text-slate-700 mb-1.5">Suggested from column names:</p>
          <div className="space-y-1">
            {suggestions.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs flex-wrap">
                <span className="font-mono text-slate-700">{s.table}.{s.column}</span>
                <span className="text-slate-400">{s.reason} · {STRATEGY_LABEL[s.strategy]}</span>
                <button
                  onClick={() => addRule({ column: s.column, strategy: s.strategy, table: s.table })}
                  className="ml-auto text-teal-600 hover:text-teal-700 font-medium"
                >
                  Protect
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {admin && (
        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
          <input
            value={newColumn}
            onChange={e => setNewColumn(e.target.value)}
            placeholder="Column name (masked everywhere)"
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 flex-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-teal-400"
          />
          <select
            value={newStrategy}
            onChange={e => setNewStrategy(e.target.value as PiiRule['strategy'])}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600"
          >
            <option value="full">hide completely</option>
            <option value="partial">keep last 4</option>
            <option value="email">keep domain</option>
          </select>
          <button
            onClick={() => {
              const col = newColumn.trim()
              if (!col) return
              addRule({ column: col, strategy: newStrategy })
              setNewColumn('')
            }}
            disabled={!newColumn.trim()}
            className="flex items-center gap-1 text-xs text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-3 py-1.5 disabled:opacity-40"
          >
            <Plus className="w-3 h-3" /> Protect
          </button>
        </div>
      )}
    </section>
  )
}
