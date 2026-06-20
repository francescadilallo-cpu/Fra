import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import {
  Plug, Upload, Check, X, FileText, Search, Star,
  Zap, AlertCircle, CheckCircle2, Loader2, Download, Trash2, RefreshCw,
  Database, AlertTriangle, Clock,
} from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { useExtendedOntology } from '../data/ontologyExtensions'
import { CONNECTORS, CATEGORY_LABELS, type ConnectorDef, type ConnectorCategory } from '../data/connectors'
import { parseCSV, suggestMappings, SAMPLE_CSV_BY_SECTOR, type MappingSuggestion } from '../data/csvImport'
import { AW_SAMPLE_DATA, type AWEntityName } from '../data/awSampleData'
import {
  listSources, addSource, removeSource, syncSource,
  getConnectorBackendDef, CONNECTOR_BACKEND_MAP,
  type BackendSource, type ParamField,
} from '../api/sources'
import { Mail } from 'lucide-react'
import { buildSemanticLayer, semanticSources, backendErrorMessage } from '../api/semantic'
import { IS_DEMO_MODE, workspaceLabel } from '../lib/demoMode'
import type { NavTab } from '../types'
import { toast as globalToast } from './Toast'

// ── AW Sources Panel (manufacturing only) ────────────────────────────────────

function downloadEntityCSV(entityName: AWEntityName, filename: string) {
  const rows = AW_SAMPLE_DATA[entityName]
  if (!rows || rows.length === 0) return
  const columns = Object.keys(rows[0])
  const header = columns.join(',')
  const csvRows = rows.map(row =>
    columns.map(col => {
      const v = row[col]
      if (v === null || v === undefined) return ''
      const s = String(v)
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')
  )
  const blob = new Blob([[header, ...csvRows].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

interface AWSourceDef {
  label: string; type: string
  tables: { name: string; rows: number }[]
  totalRows: number; lastSync: string
  warning?: string; note?: string
  downloadEntity: AWEntityName; downloadFilename: string
}

const AW_SOURCES: AWSourceDef[] = [
  {
    label: 'ERP — OrionSales', type: 'PostgreSQL / DuckDB',
    tables: [
      { name: 'sales_order_header', rows: IS_DEMO_MODE ? 31465  : 0 },
      { name: 'sales_order_line',   rows: IS_DEMO_MODE ? 121317 : 0 },
      { name: 'salesperson',        rows: IS_DEMO_MODE ? 17     : 0 },
      { name: 'territory',          rows: IS_DEMO_MODE ? 10     : 0 },
      { name: 'offer',              rows: IS_DEMO_MODE ? 16     : 0 },
    ],
    totalRows: IS_DEMO_MODE ? 152825 : 0, lastSync: IS_DEMO_MODE ? '2014-12-31' : '—',
    downloadEntity: 'SalesOrder', downloadFilename: 'aw_sales_order_sample.csv',
  },
  {
    label: 'CRM — ClientHub', type: 'SQLite',
    tables: [
      { name: 'account',        rows: IS_DEMO_MODE ? 20201 : 0 },
      { name: 'contact',        rows: IS_DEMO_MODE ? 19302 : 0 },
      { name: 'address',        rows: IS_DEMO_MODE ? 19614 : 0 },
      { name: 'state_province', rows: IS_DEMO_MODE ? 70    : 0 },
    ],
    totalRows: IS_DEMO_MODE ? 59193 : 0, lastSync: IS_DEMO_MODE ? '2014-12-31' : '—',
    warning: IS_DEMO_MODE ? '372 duplicate accounts removed (accountId<0)' : undefined,
    downloadEntity: 'Customer', downloadFilename: 'aw_customer_sample.csv',
  },
  {
    label: 'HR + PIM — Files', type: 'CSV + JSON',
    tables: [{ name: 'dipendenti_hr', rows: IS_DEMO_MODE ? 290 : 0 }, { name: 'product_catalog_pim', rows: IS_DEMO_MODE ? 504 : 0 }],
    totalRows: IS_DEMO_MODE ? 794 : 0, lastSync: IS_DEMO_MODE ? '2014-12-31' : '—',
    note: 'Italian schema · HR CSV + PIM JSON',
    downloadEntity: 'Employee', downloadFilename: 'aw_employee_sample.csv',
  },
]

function AWSourcesPanel() {
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({})
  const [liveSync, setLiveSync] = useState<string | null>(null)

  useEffect(() => {
    semanticSources().then(srcs => {
      const counts: Record<string, number> = {}
      let sync: string | null = null
      srcs.forEach(s => {
        Object.entries(s.record_counts ?? {}).forEach(([t, n]) => { counts[t] = n })
        if (s.loaded_at && !sync) sync = s.loaded_at.slice(0, 10)
      })
      setLiveCounts(counts)
      if (sync) setLiveSync(sync)
    }).catch(() => {})
  }, [])

  const sources = AW_SOURCES.map(src => {
    const tables = src.tables.map(t => ({ ...t, rows: liveCounts[t.name] ?? t.rows }))
    const totalRows = tables.reduce((s, t) => s + t.rows, 0)
    return { ...src, tables, totalRows, lastSync: liveSync ?? src.lastSync }
  })

  return (
    <div className="bg-teal-50/60 border border-teal-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2.5">
        <Database className="w-4 h-4 text-teal-600" />
        <h2 className="text-sm font-bold text-slate-800">Active Sources</h2>
        <span className="flex items-center gap-1 text-[10px] font-semibold bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-2 py-0.5">
          <span className="w-1.5 h-1.5 bg-teal-500 rounded-full" />{sources.length} connected
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {sources.map(src => (
          <div key={src.label} className="bg-white border border-teal-100 rounded-xl p-3 space-y-2.5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900 leading-tight">{src.label}</p>
                <p className="text-[10px] text-slate-400 font-mono mt-0.5">{src.type}</p>
              </div>
              <span className="flex items-center gap-1 text-[9px] font-semibold bg-teal-50 text-teal-700 border border-teal-100 rounded-full px-1.5 py-0.5 flex-shrink-0 mt-0.5">
                <span className="w-1 h-1 bg-teal-500 rounded-full" />connected
              </span>
            </div>
            <div className="space-y-0.5">
              {src.tables.map(t => (
                <div key={t.name} className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-500">{t.name}</span>
                  <span className="text-[10px] text-slate-400">{t.rows.toLocaleString('en-US')}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-slate-100 mt-1 pt-1">
                <span className="text-[10px] font-semibold text-slate-600">Total</span>
                <span className="text-[10px] font-semibold text-teal-700">{src.totalRows.toLocaleString('en-US')}</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-400">Last sync: <span className="font-medium text-slate-500">{src.lastSync}</span></p>
            {src.warning && <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-2 py-1 leading-tight">⚠ {src.warning}</p>}
            {src.note && <p className="text-[10px] text-teal-600 bg-teal-50 border border-teal-100 rounded px-2 py-1 leading-tight">{src.note}</p>}
            <button onClick={() => downloadEntityCSV(src.downloadEntity, src.downloadFilename)}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] text-slate-500 hover:text-teal-600 border border-slate-200 hover:border-teal-300 rounded-lg px-2 py-1.5 transition-colors bg-slate-50 hover:bg-teal-50">
              <Download className="w-3 h-3" />Download sample
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Credential modal ──────────────────────────────────────────────────────────

function CredentialModal({
  connector, onSubmit, onCancel, loading,
}: {
  connector: ConnectorDef
  onSubmit: (params: Record<string, string>) => void
  onCancel: () => void
  loading: boolean
}) {
  const def = getConnectorBackendDef(connector.id)
  const [values, setValues] = useState<Record<string, string>>({})
  const [notified, setNotified] = useState(false)

  const set = (key: string, val: string) => setValues(prev => ({ ...prev, [key]: val }))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const valid = def.params_schema
    .filter(f => f.required)
    .every(f => (values[f.key] ?? '').trim() !== '')

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className={`w-9 h-9 ${connector.bg} ${connector.fg} rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0`}>
            {connector.logo}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900">{connector.name}</p>
            <p className="text-[11px] text-slate-500">
              {def.waitlist_only ? 'Native connector coming soon' : 'Configure connection'}
            </p>
          </div>
          <button onClick={onCancel} aria-label="Close" className="text-slate-400 hover:text-slate-600 p-1.5 rounded hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        {def.waitlist_only ? (
          /* Waitlist panel — no credential form, no registration to the backend */
          <div className="px-5 py-6 space-y-4">
            <div className="rounded-xl bg-amber-50 border border-amber-100 p-4 text-center space-y-2">
              <p className="text-sm font-semibold text-amber-800">Native API connector in progress</p>
              <p className="text-xs text-amber-700 leading-relaxed">
                We're building the native {connector.name} connector. In the meantime, export your data as a CSV and use the <span className="font-semibold">CSV upload</span> section below — your data will be fully queryable.
              </p>
            </div>
            {notified ? (
              <div className="flex items-center justify-center gap-2 text-xs text-teal-700 bg-teal-50 border border-teal-100 rounded-xl px-4 py-3">
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                <span>You're on the list — we'll email you when {connector.name} is ready.</span>
              </div>
            ) : (
              <button
                onClick={() => setNotified(true)}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-xl hover:bg-slate-800 transition-colors"
              >
                <Mail className="w-3.5 h-3.5" />
                Notify me when {connector.name} is ready
              </button>
            )}
          </div>
        ) : (
          /* Normal credential form */
          <div className="px-5 py-4 space-y-3.5">
            {def.params_schema.map((field: ParamField, idx: number) => (
              <div key={field.key}>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {field.label}
                  {field.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                <input
                  autoFocus={idx === 0}
                  type={field.type === 'password' ? 'password' : 'text'}
                  value={values[field.key] ?? ''}
                  onChange={e => set(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-100 font-mono placeholder:font-sans placeholder:text-slate-400"
                />
                {field.hint && <p className="text-[10px] text-slate-400 mt-1">{field.hint}</p>}
              </div>
            ))}
            {def.params_schema.length === 0 && (
              <p className="text-xs text-slate-500 py-2">No configuration required.</p>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
          <button onClick={onCancel} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            {def.waitlist_only ? 'Close' : 'Cancel'}
          </button>
          {!def.waitlist_only && (
            <button
              onClick={() => onSubmit(values)}
              disabled={!valid || loading}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${valid && !loading ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plug className="w-3 h-3" />}
              {loading ? 'Connecting…' : 'Connect & Ingest'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: BackendSource['status'] }) {
  if (status === 'active') return (
    <span className="flex items-center gap-1 text-[10px] font-medium bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded">
      <span className="w-1 h-1 bg-teal-500 rounded-full" />Active
    </span>
  )
  if (status === 'error') return (
    <span className="flex items-center gap-1 text-[10px] font-medium bg-red-50 text-red-600 px-1.5 py-0.5 rounded">
      <AlertTriangle className="w-2.5 h-2.5" />Error
    </span>
  )
  if (status === 'syncing') return (
    <span className="flex items-center gap-1 text-[10px] font-medium bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
      <Loader2 className="w-2.5 h-2.5 animate-spin" />Syncing
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-[10px] font-medium bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded">
      <Clock className="w-2.5 h-2.5" />Pending
    </span>
  )
}

// ── Connector logo ────────────────────────────────────────────────────────────

function ConnectorLogo({ c, size = 'md' }: { c: ConnectorDef; size?: 'sm' | 'md' }) {
  const sizes = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-10 h-10 text-sm'
  return (
    <div className={`${sizes} ${c.bg} ${c.fg} rounded-lg flex items-center justify-center font-bold flex-shrink-0 ring-1 ring-black/5`}>
      {c.logo}
    </div>
  )
}

// ── Connected sources panel ───────────────────────────────────────────────────

function connectorById(id: string): ConnectorDef | undefined {
  // Direct id match
  const direct = CONNECTORS.find(c => c.id === id)
  if (direct) return direct
  // Reverse lookup: find which UI connector maps to this backend connector_type
  const uiId = Object.entries(CONNECTOR_BACKEND_MAP).find(([, def]) => def.connector_type === id)?.[0]
  return uiId ? CONNECTORS.find(c => c.id === uiId) : undefined
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function ConnectedSourcesPanel({
  sources, onDisconnect, onSync,
}: {
  sources: BackendSource[]
  onDisconnect: (id: string) => void
  onSync: (id: string) => void
}) {
  const userSources = sources.filter(s => !s.is_default)
  if (userSources.length === 0) {
    return (
      <div className="bg-white border border-slate-200 border-dashed rounded-xl p-8 text-center">
        <Database className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-500 font-medium">{IS_DEMO_MODE ? 'No additional sources connected' : 'No sources connected yet'}</p>
        <p className="text-xs text-slate-400 mt-1">Connect a system or upload a file below to get started.</p>
      </div>
    )
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {userSources.map((s, i) => {
        const c = connectorById(s.id.split('-')[0]) ?? connectorById(s.connector_type)
        return (
          <div key={s.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
            {c ? <ConnectorLogo c={c} size="sm" /> : (
              <div className="w-7 h-7 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 text-xs font-bold flex-shrink-0">
                <Database className="w-3.5 h-3.5" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-slate-900 truncate">{s.label}</p>
                <StatusBadge status={s.status} />
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {s.row_count > 0
                  ? `${s.row_count.toLocaleString('en-US')} records · synced ${relativeTime(s.last_sync_at)}`
                  : s.last_sync_at
                    ? `synced ${relativeTime(s.last_sync_at)} · 0 records`
                    : s.status === 'pending' ? 'Run setup to load data' : 'Not yet synced'}
              </p>
              {s.error_msg && (
                <p className="text-[10px] text-red-500 mt-0.5 line-clamp-3" title={s.error_msg}>{s.error_msg}</p>
              )}
            </div>
            <button onClick={() => onSync(s.id)}
              className="text-slate-400 hover:text-teal-600 transition-colors p-1.5 rounded hover:bg-slate-50" title="Sync now">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            {!s.is_default && (
              <button onClick={() => onDisconnect(s.id)}
                className="text-slate-400 hover:text-red-600 transition-colors p-1.5 rounded hover:bg-red-50" title="Disconnect">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Connector card ────────────────────────────────────────────────────────────

function ConnectorCard({
  c, connected, connecting, onConnect, onDisconnect,
}: {
  c: ConnectorDef
  connected: boolean
  connecting: boolean
  onConnect: () => void
  onDisconnect: () => void
}) {
  const disabled = c.status === 'coming-soon'
  return (
    <div className={`bg-white border rounded-xl p-3 transition-all ${connected ? 'border-teal-300 shadow-sm shadow-teal-50' : connecting ? 'border-blue-300' : 'border-slate-200 hover:border-slate-300'}`}>
      <div className="flex items-start gap-2.5">
        <ConnectorLogo c={c} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold text-slate-900 truncate">{c.name}</p>
            {c.popular && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
            {c.italian && <span className="text-[8px] font-bold bg-green-100 text-green-700 rounded px-1 py-0.5 leading-none">IT</span>}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug line-clamp-2">{c.description}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${c.status === 'available' ? 'bg-slate-100 text-slate-500' : c.status === 'beta' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'}`}>
          {c.status === 'coming-soon' ? 'Soon' : c.status === 'beta' ? 'Beta' : CATEGORY_LABELS[c.category]}
        </span>
        {connected ? (
          <button onClick={onDisconnect}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-600 transition-colors px-2 py-1 rounded hover:bg-red-50">
            <CheckCircle2 className="w-3 h-3 text-teal-500" />Connected
          </button>
        ) : (
          <button onClick={onConnect} disabled={disabled || connecting}
            className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors ${disabled ? 'bg-slate-50 text-slate-300 cursor-not-allowed' : connecting ? 'bg-blue-50 text-blue-600 cursor-wait' : 'bg-slate-900 text-white hover:bg-slate-800'}`}>
            {connecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plug className="w-3 h-3" />}
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Upload panel ──────────────────────────────────────────────────────────────

const CONFIDENCE_COLORS: Record<MappingSuggestion['confidence'], string> = {
  high: 'bg-teal-100 text-teal-700', medium: 'bg-amber-100 text-amber-700',
  low: 'bg-orange-100 text-orange-700', none: 'bg-slate-100 text-slate-500',
}
const TYPE_COLORS: Record<string, string> = {
  uuid: 'bg-orange-50 text-orange-600', string: 'bg-slate-100 text-slate-600',
  integer: 'bg-blue-50 text-blue-600', decimal: 'bg-purple-50 text-purple-600',
  boolean: 'bg-amber-50 text-amber-600', date: 'bg-green-50 text-green-700',
  datetime: 'bg-teal-50 text-teal-700', text: 'bg-slate-100 text-slate-500',
}

interface UploadState {
  filename: string; headers: string[]; rows: string[][]
  suggestions: MappingSuggestion[]; accepted: Record<string, boolean>
}

function UploadPanel({ upload, onUpload, onToggle, onClear, onIngest, onLoadSample }: {
  upload: UploadState | null
  onUpload: (file: File) => void
  onToggle: (col: string) => void
  onClear: () => void
  onIngest: () => void
  onLoadSample?: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (file) onUpload(file)
  }

  if (!upload) {
    return (
      <div>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${dragOver ? 'border-teal-400 bg-teal-50/50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
        >
          <Upload className={`w-8 h-8 mx-auto mb-3 ${dragOver ? 'text-teal-500' : 'text-slate-400'}`} />
          <p className="text-sm font-medium text-slate-700">Drop a CSV here or <span className="text-teal-600">browse</span></p>
          <p className="text-xs text-slate-400 mt-1">Supports .csv (commas or semicolons), up to 10 MB</p>
          <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={e => handleFiles(e.target.files)} className="hidden" />
        </div>
        {onLoadSample && (
          <button onClick={onLoadSample} className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 hover:text-teal-600 transition-colors mx-auto">
            <Download className="w-3 h-3" />Or load a sample dataset for this sector
          </button>
        )}
      </div>
    )
  }

  const acceptedCount = Object.values(upload.accepted).filter(Boolean).length
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/50">
        <FileText className="w-4 h-4 text-teal-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{upload.filename}</p>
          <p className="text-[11px] text-slate-500">
            {upload.rows.length.toLocaleString('en-US')} rows · {upload.headers.length} columns
            · <span className="text-teal-600 font-medium">{acceptedCount}/{upload.headers.length} mapped</span>
          </p>
        </div>
        <button onClick={onClear} aria-label="Remove file" className="text-slate-400 hover:text-slate-700 p-1.5 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
      </div>
      <div className="max-h-[380px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white border-b border-slate-200 z-10">
            <tr>
              {['CSV Column', 'Detected', 'Sample', '→ Maps to', 'Confidence', ''].map(h => (
                <th key={h} className="text-left px-4 py-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {upload.suggestions.map(s => {
              const accepted = upload.accepted[s.column]
              return (
                <tr key={s.column} className={`border-t border-slate-100 ${accepted ? 'bg-teal-50/30' : ''}`}>
                  <td className="px-4 py-2 font-mono text-slate-700">{s.column}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${TYPE_COLORS[s.detectedType] ?? 'bg-slate-100 text-slate-500'}`}>{s.detectedType}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-400 font-mono truncate max-w-[140px]">{s.sampleValues.slice(0, 2).join(', ') || '—'}</td>
                  <td className="px-3 py-2">
                    {s.suggestedEntity ? (
                      <span className="text-slate-700"><span className="font-medium">{s.suggestedEntity}</span><span className="text-slate-400">.{s.suggestedProperty}</span></span>
                    ) : <span className="text-slate-400 italic">— no match —</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${CONFIDENCE_COLORS[s.confidence]}`}>{s.confidence}</span>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onToggle(s.column)}
                      title={s.confidence === 'none' ? 'No entity match found — click to include anyway' : undefined}
                      className={`w-6 h-6 rounded flex items-center justify-center transition-all ${accepted ? 'bg-teal-600 text-white' : s.confidence === 'none' ? 'border border-dashed border-slate-300 text-slate-300 hover:border-slate-400 hover:text-slate-400' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                      {accepted && <Check className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <AlertCircle className="w-3.5 h-3.5 text-slate-400" />Toggle to include/exclude columns — unmatched columns (dashed) can still be included
        </div>
        <button onClick={onIngest} disabled={acceptedCount === 0}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${acceptedCount > 0 ? 'bg-teal-600 hover:bg-teal-700 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
          <Zap className="w-3.5 h-3.5" />Ingest {upload.rows.length.toLocaleString('en-US')} rows
        </button>
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function DataSourcesView({ onNavigate }: { onNavigate?: (tab: NavTab) => void } = {}) {
  const { sectorId, sector } = useSector()
  const ontology = useExtendedOntology(sectorId)

  // ── Backend sources state
  const [sources, setSources] = useState<BackendSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourcesError, setSourcesError] = useState<string | null>(null)

  // ── UI state
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<ConnectorCategory | 'all' | 'italian'>('all')
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [credentialModal, setCredentialModal] = useState<ConnectorDef | null>(null)
  const [credentialLoading, setCredentialLoading] = useState(false)
  const [upload, setUpload] = useState<UploadState | null>(null)
  const [ingesting, setIngesting] = useState(false)
  const [building, setBuilding] = useState(false)
  const [buildStep, setBuildStep] = useState(0) // 1–3 = in-progress steps, 4 = done
  const navTimerRef = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => { if (navTimerRef.current) clearTimeout(navTimerRef.current) }, [])

  const showToast = useCallback((msg: string, type: 'ok' | 'error' = 'ok') => {
    globalToast(msg, type === 'error' ? 'error' : 'success')
  }, [])

  // ── Load sources from backend on mount
  useEffect(() => {
    let cancelled = false
    setSourcesLoading(true)
    listSources()
      .then(data => { if (!cancelled) setSources(data) })
      .catch(err => {
        if (!cancelled) setSourcesError(backendErrorMessage(err) || 'Could not load sources')
      })
      .finally(() => { if (!cancelled) setSourcesLoading(false) })
    return () => { cancelled = true }
  }, [])

  // ── Set of connected connector IDs (by matching connector id prefix or type)
  const connectedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const s of sources) {
      // Match by exact id or by connector_type prefix
      CONNECTORS.forEach(c => {
        if (s.id === c.id || s.connector_type === c.id.replace(/-/g, '_') || s.id.startsWith(c.id + '-')) {
          ids.add(c.id)
        }
      })
    }
    return ids
  }, [sources])

  // ── Connect flow: open credential modal
  const openConnect = (c: ConnectorDef) => {
    if (c.status === 'coming-soon' || connectingId) return
    setCredentialModal(c)
  }

  // ── Submit credential form → POST /api/sources
  const submitCredentials = async (params: Record<string, string>) => {
    if (!credentialModal) return
    const def = getConnectorBackendDef(credentialModal.id)

    // Coerce comma-separated 'tables' to array
    const finalParams: Record<string, unknown> = { ...params }
    if (typeof finalParams.tables === 'string') {
      finalParams.tables = (finalParams.tables as string).split(',').map(t => t.trim()).filter(Boolean)
    }

    setCredentialLoading(true)
    try {
      const newSource = await addSource({
        connector_type: def.connector_type,
        label: credentialModal.name,
        params: finalParams,
      })
      setSources(prev => [...prev.filter(s => s.id !== newSource.id), newSource])
      setCredentialModal(null)
      showToast(
        newSource.status === 'active'
          ? `${credentialModal.name} connected · ${newSource.row_count.toLocaleString('en-US')} records`
          : newSource.status === 'error'
            ? `${credentialModal.name} registered but sync failed: ${newSource.error_msg ?? 'unknown error'}`
            : `${credentialModal.name} registered — sync coming soon`,
        newSource.status === 'error' ? 'error' : 'ok',
      )
      window.dispatchEvent(new CustomEvent('pipeline-run-updated'))
    } catch (err: unknown) {
      showToast(backendErrorMessage(err) || 'Connection failed', 'error')
    } finally {
      setCredentialLoading(false)
      setConnectingId(null)
    }
  }

  // ── Disconnect → DELETE /api/sources/{id}
  const disconnectSource = async (sourceId: string) => {
    const src = sources.find(s => s.id === sourceId)
    try {
      await removeSource(sourceId)
      setSources(prev => prev.filter(s => s.id !== sourceId))
      showToast(`${src?.label ?? sourceId} disconnected`)
      window.dispatchEvent(new CustomEvent('pipeline-run-updated'))
    } catch (err: unknown) {
      showToast(backendErrorMessage(err) || 'Disconnect failed', 'error')
    }
  }

  // ── Disconnect by connector UI id (may have suffix)
  const disconnectByConnectorId = (connectorId: string) => {
    const src = sources.find(s => s.id === connectorId || s.id.startsWith(connectorId + '-'))
    if (src) disconnectSource(src.id)
  }

  // ── Sync → POST /api/sources/{id}/sync
  const syncById = async (sourceId: string) => {
    setSources(prev => prev.map(s => s.id === sourceId ? { ...s, status: 'syncing' } : s))
    try {
      const updated = await syncSource(sourceId)
      setSources(prev => prev.map(s => s.id === sourceId ? updated : s))
      showToast(`${updated.label} synced · ${updated.row_count.toLocaleString('en-US')} records`)
      window.dispatchEvent(new CustomEvent('pipeline-run-updated'))
    } catch (err: unknown) {
      const msg = backendErrorMessage(err) || 'Sync failed'
      setSources(prev => prev.map(s => s.id === sourceId ? { ...s, status: 'error', error_msg: msg } : s))
      showToast(msg, 'error')
    }
  }

  // ── CSV upload handlers
  const handleFile = async (file: File) => {
    const text = await file.text()
    const { headers, rows } = parseCSV(text)
    if (headers.length === 0) { showToast('Could not parse CSV — check file format', 'error'); return }
    const suggestions = suggestMappings(headers, rows, ontology.nodes)
    const accepted: Record<string, boolean> = {}
    suggestions.forEach(s => { accepted[s.column] = s.confidence === 'high' || s.confidence === 'medium' })
    setUpload({ filename: file.name, headers, rows, suggestions, accepted })
  }

  const loadSample = () => {
    const sample = SAMPLE_CSV_BY_SECTOR[sectorId]
    if (!sample) return
    const { headers, rows } = parseCSV(sample.content)
    const suggestions = suggestMappings(headers, rows, ontology.nodes)
    const accepted: Record<string, boolean> = {}
    suggestions.forEach(s => { accepted[s.column] = s.confidence !== 'none' })
    setUpload({ filename: sample.filename, headers, rows, suggestions, accepted })
  }

  const ingestCsv = async () => {
    if (!upload) return
    setIngesting(true)
    const tableName = upload.filename.replace(/\.csv$/i, '').replace(/[^a-z0-9]/gi, '_').toLowerCase()
    // Build a temporary CSV string from accepted columns
    const acceptedCols = upload.suggestions.filter(s => upload.accepted[s.column]).map(s => s.column)
    const csvLines = [acceptedCols.join(','), ...upload.rows.map(r => {
      const indices = acceptedCols.map(col => upload.headers.indexOf(col))
      return indices.map(i => (r[i] ?? '')).join(',')
    })]
    // Upload as a blob URL is not practical for server — send rows as JSON instead
    // We POST a new source with connector_type='csv' and the data encoded in params
    try {
      const newSource = await addSource({
        connector_type: 'csv',
        label: upload.filename,
        params: {
          // Backend will look for 'path' first; fall back to inline data
          table_name: tableName,
          inline_csv: csvLines.join('\n'),
        },
      })
      setSources(prev => [...prev.filter(s => s.id !== newSource.id), newSource])
      showToast(`Ingested ${upload.rows.length.toLocaleString('en-US')} rows from ${upload.filename}`)
      window.dispatchEvent(new CustomEvent('pipeline-run-updated'))
      setUpload(null)
    } catch (err: unknown) {
      showToast(backendErrorMessage(err) || 'Ingest failed', 'error')
    } finally {
      setIngesting(false)
    }
  }

  // ── Filters
  const filteredConnectors = useMemo(() =>
    CONNECTORS.filter(c => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false
      if (categoryFilter === 'italian') return c.italian
      if (categoryFilter !== 'all') return c.category === categoryFilter
      return true
    }),
  [search, categoryFilter])

  const allCategories: ('all' | 'italian' | ConnectorCategory)[] = [
    'all', 'italian', 'erp', 'accounting', 'ecommerce', 'crm', 'payments', 'database', 'cloud', 'logistics',
  ]

  const BUILD_STEPS = ['Scanning data sources…', 'Building knowledge graph…', 'Extracting metrics & relations…']

  async function handleBuildSemanticLayer() {
    setBuilding(true)
    setBuildStep(1)
    const t2 = setTimeout(() => setBuildStep(2), 900)
    const t3 = setTimeout(() => setBuildStep(3), 1900)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)
    try {
      await buildSemanticLayer(controller.signal)
      clearTimeout(t2); clearTimeout(t3); clearTimeout(timeoutId)
      setBuildStep(4)
      globalToast(`Your data is ready — ${sources.length} source${sources.length !== 1 ? 's' : ''} connected`, 'success')
      window.dispatchEvent(new CustomEvent('pipeline-run-updated'))
      navTimerRef.current = setTimeout(() => {
        setBuilding(false); setBuildStep(0)
        onNavigate?.('sembuilder' as NavTab)
      }, 700)
    } catch (err) {
      clearTimeout(t2); clearTimeout(t3); clearTimeout(timeoutId)
      setBuilding(false); setBuildStep(0)
      const isCanceled = (err as { code?: string })?.code === 'ERR_CANCELED'
      globalToast(
        isCanceled
          ? 'Build timed out — the backend took too long to respond'
          : backendErrorMessage(err) || 'Build failed — check backend connection or source configuration',
        'error',
      )
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 flex-shrink-0">
        <h1 className="text-2xl font-bold text-slate-900">Data Sources</h1>
        <p className="text-slate-500 mt-1 text-sm">
          {workspaceLabel(sector.name)} · Connect business systems or upload files — data loads automatically and becomes queryable instantly
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-8 py-6 space-y-6">

        {/* AW active sources (manufacturing demo only) */}
        {IS_DEMO_MODE && sectorId === 'manufacturing' && <AWSourcesPanel />}

        {/* Sources error */}
        {sourcesError && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {sourcesError}
          </div>
        )}

        {/* Connected sources from backend */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Connected Sources</h2>
              {sourcesLoading
                ? <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />
                : <span className="text-xs text-slate-400">· {sources.filter(s => !s.is_default).length} active</span>
              }
            </div>
          </div>
          <ConnectedSourcesPanel
            sources={sources}
            onDisconnect={disconnectSource}
            onSync={syncById}
          />
        </section>

        {/* Build Semantic Layer CTA */}
        {sources.length > 0 && (
          <div className="rounded-xl border border-teal-200 bg-gradient-to-r from-teal-50 to-cyan-50 p-5">
            {building ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-teal-800 mb-3">Building your data model…</p>
                {BUILD_STEPS.map((step, i) => {
                  const stepNum = i + 1
                  const done = buildStep > stepNum || buildStep === 4
                  const active = buildStep === stepNum
                  return (
                    <div key={i} className={`flex items-center gap-2.5 text-xs transition-colors ${done ? 'text-teal-700' : active ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>
                      {done
                        ? <CheckCircle2 className="w-4 h-4 text-teal-500 flex-shrink-0" />
                        : active
                        ? <Loader2 className="w-4 h-4 animate-spin text-teal-500 flex-shrink-0" />
                        : <div className="w-4 h-4 rounded-full border-2 border-slate-200 flex-shrink-0" />
                      }
                      <span>{step}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-teal-900">Ready to build your data model?</p>
                  <p className="text-xs text-teal-700 mt-0.5">
                    {sources.length} source{sources.length !== 1 ? 's' : ''} connected · entities, relationships, and metrics auto-discovered from your data
                  </p>
                </div>
                <button
                  onClick={handleBuildSemanticLayer}
                  className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors flex-shrink-0 shadow-sm"
                >
                  <Zap className="w-4 h-4" /> Build Data Model
                </button>
              </div>
            )}
          </div>
        )}

        {/* Connector hub */}
        <section>
          <div className="flex items-center justify-between mb-3 gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Plug className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Connect a New Source</h2>
              <span className="text-xs text-slate-400">· {CONNECTORS.filter(c => c.status !== 'coming-soon').length} integrations</span>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search connectors…"
                className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg outline-none focus:border-teal-400 w-52" />
            </div>
          </div>

          <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1">
            {allCategories.map(cat => {
              const isActive = categoryFilter === cat
              const label = cat === 'all' ? 'All' : cat === 'italian' ? '🇮🇹 Italian' : CATEGORY_LABELS[cat]
              return (
                <button key={cat} onClick={() => setCategoryFilter(cat)}
                  className={`text-xs px-3 py-1 rounded-full transition-colors flex-shrink-0 ${isActive ? 'bg-slate-900 text-white font-medium' : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                  {label}
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredConnectors.map(c => (
              <ConnectorCard key={c.id} c={c}
                connected={connectedIds.has(c.id)}
                connecting={connectingId === c.id}
                onConnect={() => openConnect(c)}
                onDisconnect={() => disconnectByConnectorId(c.id)}
              />
            ))}
          </div>
          {filteredConnectors.length === 0 && (
            <p className="text-center text-sm text-slate-400 py-8">No connectors match your search.</p>
          )}
        </section>

        {/* Upload */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Upload className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Upload File</h2>
            <span className="text-xs text-slate-400">· fields auto-matched to your data model</span>
          </div>
          <UploadPanel
            upload={upload} onUpload={handleFile} onToggle={col => setUpload(prev => prev ? { ...prev, accepted: { ...prev.accepted, [col]: !prev.accepted[col] } } : null)}
            onClear={() => setUpload(null)} onIngest={ingestCsv} onLoadSample={IS_DEMO_MODE ? loadSample : undefined}
          />
        </section>
      </div>

      {/* Credential modal */}
      {credentialModal && (
        <CredentialModal
          connector={credentialModal}
          onSubmit={submitCredentials}
          onCancel={() => { setCredentialModal(null); setConnectingId(null) }}
          loading={credentialLoading}
        />
      )}

      {/* Ingest overlay */}
      {ingesting && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl px-6 py-5 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-teal-500 animate-spin" />
            <div>
              <p className="text-sm font-semibold text-slate-900">Processing your data…</p>
              <p className="text-xs text-slate-500 mt-0.5">Mapping fields · validating · indexing</p>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
