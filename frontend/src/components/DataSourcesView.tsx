import { useState, useRef, useMemo, useCallback } from 'react'
import {
  Plug, Upload, Check, X, FileText, Search, ChevronRight, Star,
  Zap, AlertCircle, CheckCircle2, Loader2, Download, Trash2, RefreshCw, Database,
} from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { useExtendedOntology } from '../data/ontologyExtensions'
import {
  CONNECTORS, CATEGORY_LABELS,
  useConnectedSources,
  type ConnectorDef, type ConnectorCategory, type ConnectedSource,
} from '../data/connectors'
import {
  parseCSV, suggestMappings, SAMPLE_CSV_BY_SECTOR,
  type MappingSuggestion,
} from '../data/csvImport'
import { AW_SAMPLE_DATA, type AWEntityName } from '../data/awSampleData'

// ── AW Sources Panel (manufacturing only) ───────────────────────────────────
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
  const csv = [header, ...csvRows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface AWSource {
  label: string
  type: string
  tables: { name: string; rows: number }[]
  totalRows: number
  lastSync: string
  warning?: string
  note?: string
  downloadEntity: AWEntityName
  downloadFilename: string
}

const AW_SOURCES: AWSource[] = [
  {
    label: 'ERP — OrionSales',
    type: 'PostgreSQL / DuckDB',
    tables: [
      { name: 'sales_order_header', rows: 31465 },
      { name: 'sales_order_line',   rows: 121317 },
      { name: 'salesperson',        rows: 17 },
      { name: 'territory',          rows: 10 },
      { name: 'offer',              rows: 16 },
    ],
    totalRows: 152825,
    lastSync: '2014-12-31',
    downloadEntity: 'SalesOrder',
    downloadFilename: 'aw_sales_order_sample.csv',
  },
  {
    label: 'CRM — ClientHub',
    type: 'SQLite',
    tables: [
      { name: 'account',        rows: 20201 },
      { name: 'contact',        rows: 19302 },
      { name: 'address',        rows: 19614 },
      { name: 'state_province', rows: 70 },
      { name: 'country',        rows: 6 },
    ],
    totalRows: 59193,
    lastSync: '2014-12-31',
    warning: '372 duplicate accounts removed (accountId<0)',
    downloadEntity: 'Customer',
    downloadFilename: 'aw_customer_sample.csv',
  },
  {
    label: 'HR + PIM — Files',
    type: 'CSV + JSON',
    tables: [
      { name: 'dipendenti_hr',      rows: 290 },
      { name: 'product_catalog_pim', rows: 504 },
    ],
    totalRows: 794,
    lastSync: '2014-12-31',
    note: 'Italian schema · HR CSV + PIM JSON',
    downloadEntity: 'Employee',
    downloadFilename: 'aw_employee_sample.csv',
  },
]

function AWSourcesPanel() {
  return (
    <div className="bg-teal-50/60 border border-teal-200 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <Database className="w-4 h-4 text-teal-600" />
        <h2 className="text-sm font-bold text-slate-800">AdventureWorks — Fonti Attive</h2>
        <span className="flex items-center gap-1 text-[10px] font-semibold bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-2 py-0.5">
          <span className="w-1.5 h-1.5 bg-teal-500 rounded-full" />
          3 connected
        </span>
      </div>

      {/* Source cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {AW_SOURCES.map(src => (
          <div key={src.label} className="bg-white border border-teal-100 rounded-xl p-3 space-y-2.5 shadow-sm">
            {/* Card header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900 leading-tight">{src.label}</p>
                <p className="text-[10px] text-slate-400 font-mono mt-0.5">{src.type}</p>
              </div>
              <span className="flex items-center gap-1 text-[9px] font-semibold bg-teal-50 text-teal-700 border border-teal-100 rounded-full px-1.5 py-0.5 flex-shrink-0 mt-0.5">
                <span className="w-1 h-1 bg-teal-500 rounded-full" />
                connected
              </span>
            </div>

            {/* Tables list */}
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

            {/* Last sync */}
            <p className="text-[10px] text-slate-400">
              Last sync: <span className="font-medium text-slate-500">{src.lastSync}</span>
            </p>

            {/* Warning / note */}
            {src.warning && (
              <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-2 py-1 leading-tight">
                ⚠ {src.warning}
              </p>
            )}
            {src.note && (
              <p className="text-[10px] text-teal-600 bg-teal-50 border border-teal-100 rounded px-2 py-1 leading-tight">
                {src.note}
              </p>
            )}

            {/* Download sample */}
            <button
              onClick={() => downloadEntityCSV(src.downloadEntity, src.downloadFilename)}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] text-slate-500 hover:text-teal-600 border border-slate-200 hover:border-teal-300 rounded-lg px-2 py-1.5 transition-colors bg-slate-50 hover:bg-teal-50"
            >
              <Download className="w-3 h-3" />
              Download sample
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Workflow progress strip ──────────────────────────────────────────────────
type Step = 'connect' | 'map' | 'validate' | 'ingest'
const STEPS: { id: Step; label: string; description: string }[] = [
  { id: 'connect',  label: 'Connect',  description: 'Choose a source' },
  { id: 'map',      label: 'Map',      description: 'Align fields to ontology' },
  { id: 'validate', label: 'Validate', description: 'Check data quality' },
  { id: 'ingest',   label: 'Ingest',   description: 'Sync to semantic layer' },
]

function WorkflowProgress({ active, complete }: { active: Step; complete: Set<Step> }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-1">
        {STEPS.map((step, i) => {
          const isActive = step.id === active
          const isDone = complete.has(step.id)
          return (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all ${
                  isDone   ? 'bg-teal-500 text-white' :
                  isActive ? 'bg-teal-600 text-white ring-4 ring-teal-100' :
                  'bg-slate-100 text-slate-400'
                }`}>
                  {isDone ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </div>
                <div className="min-w-0">
                  <p className={`text-xs font-semibold ${isActive || isDone ? 'text-slate-900' : 'text-slate-400'}`}>
                    {step.label}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">{step.description}</p>
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <ChevronRight className={`w-4 h-4 mx-2 flex-shrink-0 ${isDone ? 'text-teal-400' : 'text-slate-300'}`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Connector logo (avatar) ──────────────────────────────────────────────────
function ConnectorLogo({ c, size = 'md' }: { c: ConnectorDef; size?: 'sm' | 'md' }) {
  const sizes = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-10 h-10 text-sm'
  return (
    <div className={`${sizes} ${c.bg} ${c.fg} rounded-lg flex items-center justify-center font-bold flex-shrink-0 ring-1 ring-black/5`}>
      {c.logo}
    </div>
  )
}

// ── Connector card ───────────────────────────────────────────────────────────
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
    <div className={`bg-white border rounded-xl p-3 transition-all ${
      connected   ? 'border-teal-300 shadow-sm shadow-teal-50' :
      connecting  ? 'border-blue-300' :
      'border-slate-200 hover:border-slate-300'
    }`}>
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
        <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
          c.status === 'available' ? 'bg-slate-100 text-slate-500' :
          c.status === 'beta'      ? 'bg-amber-100 text-amber-700' :
          'bg-slate-100 text-slate-400'
        }`}>
          {c.status === 'coming-soon' ? 'Soon' : c.status === 'beta' ? 'Beta' : CATEGORY_LABELS[c.category]}
        </span>
        {connected ? (
          <button
            onClick={onDisconnect}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-600 transition-colors px-2 py-1 rounded hover:bg-red-50"
          >
            <CheckCircle2 className="w-3 h-3 text-teal-500" />
            Connected
          </button>
        ) : (
          <button
            onClick={onConnect}
            disabled={disabled || connecting}
            className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors ${
              disabled    ? 'bg-slate-50 text-slate-300 cursor-not-allowed' :
              connecting  ? 'bg-blue-50 text-blue-600 cursor-wait' :
              'bg-slate-900 text-white hover:bg-slate-800'
            }`}
          >
            {connecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plug className="w-3 h-3" />}
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Connected sources panel ──────────────────────────────────────────────────
function connectorById(id: string): ConnectorDef | undefined {
  return CONNECTORS.find(c => c.id === id)
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function ConnectedSourcesPanel({
  sources, onDisconnect, onSync,
}: {
  sources: ConnectedSource[]
  onDisconnect: (id: string) => void
  onSync: (id: string) => void
}) {
  if (sources.length === 0) {
    return (
      <div className="bg-white border border-slate-200 border-dashed rounded-xl p-8 text-center">
        <Database className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-500 font-medium">No sources connected yet</p>
        <p className="text-xs text-slate-400 mt-1">Connect a system or upload a file to start ingesting data.</p>
      </div>
    )
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {sources.map((s, i) => {
        const c = connectorById(s.connectorId)
        if (!c) return null
        return (
          <div key={s.connectorId} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
            <ConnectorLogo c={c} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-slate-900 truncate">{c.name}</p>
                <span className="flex items-center gap-1 text-[10px] font-medium bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded">
                  <span className="w-1 h-1 bg-teal-500 rounded-full" />
                  Connected
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {s.rowCount.toLocaleString('en-US')} records · synced {relativeTime(s.lastSyncAt)}
              </p>
            </div>
            <button
              onClick={() => onSync(s.connectorId)}
              className="text-slate-400 hover:text-teal-600 transition-colors p-1.5 rounded hover:bg-slate-50"
              title="Sync now"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDisconnect(s.connectorId)}
              className="text-slate-400 hover:text-red-600 transition-colors p-1.5 rounded hover:bg-red-50"
              title="Disconnect"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ── Upload + auto-mapping preview ────────────────────────────────────────────
interface UploadState {
  filename: string
  headers: string[]
  rows: string[][]
  suggestions: MappingSuggestion[]
  accepted: Record<string, boolean>  // column -> accepted
}

const CONFIDENCE_COLORS: Record<MappingSuggestion['confidence'], string> = {
  high:   'bg-teal-100 text-teal-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-orange-100 text-orange-700',
  none:   'bg-slate-100 text-slate-500',
}

const TYPE_COLORS: Record<string, string> = {
  uuid: 'bg-orange-50 text-orange-600',
  string: 'bg-slate-100 text-slate-600',
  integer: 'bg-blue-50 text-blue-600',
  decimal: 'bg-purple-50 text-purple-600',
  boolean: 'bg-amber-50 text-amber-600',
  date: 'bg-green-50 text-green-700',
  datetime: 'bg-teal-50 text-teal-700',
  text: 'bg-slate-100 text-slate-500',
}

function UploadPanel({
  upload, onUpload, onToggle, onClear, onIngest, onLoadSample,
}: {
  upload: UploadState | null
  onUpload: (file: File) => void
  onToggle: (col: string) => void
  onClear: () => void
  onIngest: () => void
  onLoadSample: () => void
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
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
            dragOver ? 'border-teal-400 bg-teal-50/50' : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <Upload className={`w-8 h-8 mx-auto mb-3 ${dragOver ? 'text-teal-500' : 'text-slate-400'}`} />
          <p className="text-sm font-medium text-slate-700">
            Drop a CSV here or <span className="text-teal-600">browse</span>
          </p>
          <p className="text-xs text-slate-400 mt-1">Supports .csv (commas or semicolons), up to 10 MB</p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={e => handleFiles(e.target.files)}
            className="hidden"
          />
        </div>
        <button
          onClick={onLoadSample}
          className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 hover:text-teal-600 transition-colors mx-auto"
        >
          <Download className="w-3 h-3" />
          Or load a sample dataset for this sector
        </button>
      </div>
    )
  }

  const acceptedCount = Object.values(upload.accepted).filter(Boolean).length
  const ingestable = acceptedCount > 0

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* File header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/50">
        <FileText className="w-4 h-4 text-teal-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{upload.filename}</p>
          <p className="text-[11px] text-slate-500">
            {upload.rows.length.toLocaleString('en-US')} rows · {upload.headers.length} columns detected
            · <span className="text-teal-600 font-medium">{acceptedCount}/{upload.headers.length} mapped</span>
          </p>
        </div>
        <button
          onClick={onClear}
          className="text-slate-400 hover:text-slate-700 p-1.5 rounded hover:bg-slate-100"
          title="Clear"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mapping table */}
      <div className="max-h-[380px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white border-b border-slate-200 z-10">
            <tr>
              <th className="text-left px-4 py-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">CSV Column</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Detected</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Sample</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">→ Maps to</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Confidence</th>
              <th className="w-12 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {upload.suggestions.map(s => {
              const accepted = upload.accepted[s.column]
              return (
                <tr key={s.column} className={`border-t border-slate-100 ${accepted ? 'bg-teal-50/30' : ''}`}>
                  <td className="px-4 py-2 font-mono text-slate-700">{s.column}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${TYPE_COLORS[s.detectedType] ?? 'bg-slate-100 text-slate-500'}`}>
                      {s.detectedType}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-400 font-mono truncate max-w-[140px]">
                    {s.sampleValues.slice(0, 2).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2">
                    {s.suggestedEntity ? (
                      <span className="text-slate-700">
                        <span className="font-medium">{s.suggestedEntity}</span>
                        <span className="text-slate-400">.{s.suggestedProperty}</span>
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">— no match —</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${CONFIDENCE_COLORS[s.confidence]}`}>
                      {s.confidence}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onToggle(s.column)}
                      disabled={s.confidence === 'none'}
                      className={`w-6 h-6 rounded flex items-center justify-center transition-all ${
                        accepted
                          ? 'bg-teal-600 text-white'
                          : s.confidence === 'none'
                            ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                            : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                      }`}
                    >
                      {accepted ? <Check className="w-3.5 h-3.5" /> : null}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer with ingest CTA */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
          Toggle mappings to include/exclude columns
        </div>
        <button
          onClick={onIngest}
          disabled={!ingestable}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            ingestable
              ? 'bg-teal-600 hover:bg-teal-700 text-white'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          Ingest {upload.rows.length.toLocaleString('en-US')} rows
        </button>
      </div>
    </div>
  )
}

// ── Connector workflow ───────────────────────────────────────────────────────
interface ConnectorFieldMapping {
  source: string; target: string; include: boolean; confidence: 'high' | 'medium' | 'low'
}
interface ConnectorValidationCheck { label: string; status: 'ok' | 'warning'; detail: string }
interface ConnectorWorkflow {
  connector: ConnectorDef
  step: 'map' | 'validate' | 'ingest'
  mappings: ConnectorFieldMapping[]
  rowCount: number
  checks: ConnectorValidationCheck[]
}

const CONNECTOR_FIELD_TEMPLATES: Partial<Record<ConnectorCategory, ConnectorFieldMapping[]>> = {
  erp: [
    { source: 'order_id',       target: 'SalesOrder.orderId',          include: true,  confidence: 'high'   },
    { source: 'customer_ref',   target: 'Customer.customerId',         include: true,  confidence: 'high'   },
    { source: 'product_ref',    target: 'Product.productId',           include: true,  confidence: 'high'   },
    { source: 'subtotal',       target: 'SalesOrder.subtotal_amount',  include: true,  confidence: 'medium' },
    { source: 'order_date',     target: 'SalesOrder.orderDate',        include: true,  confidence: 'high'   },
    { source: 'salesperson_id', target: 'Salesperson.salespersonId',   include: true,  confidence: 'high'   },
    { source: 'total_due',      target: 'SalesOrder.total_due',        include: false, confidence: 'medium' },
  ],
  crm: [
    { source: 'account_id',   target: 'Customer.accountId', include: true,  confidence: 'high'   },
    { source: 'company_name', target: 'Customer.name',       include: true,  confidence: 'high'   },
    { source: 'email',        target: 'Customer.email',      include: true,  confidence: 'high'   },
    { source: 'region',       target: 'Territory.name',      include: true,  confidence: 'medium' },
    { source: 'status',       target: 'Customer.status',     include: true,  confidence: 'high'   },
    { source: 'created_at',   target: 'Customer.createdAt',  include: false, confidence: 'low'    },
  ],
  ecommerce: [
    { source: 'order_number',   target: 'SalesOrder.orderId',       include: true,  confidence: 'high'   },
    { source: 'sku',            target: 'Product.productId',         include: true,  confidence: 'high'   },
    { source: 'qty',            target: 'SalesOrderLine.quantity',   include: true,  confidence: 'high'   },
    { source: 'unit_price',     target: 'SalesOrderLine.unitPrice',  include: true,  confidence: 'high'   },
    { source: 'customer_email', target: 'Customer.email',            include: true,  confidence: 'medium' },
    { source: 'shipped_at',     target: 'SalesOrder.shipDate',       include: true,  confidence: 'high'   },
  ],
  accounting: [
    { source: 'invoice_no',   target: 'SalesOrder.orderId',         include: true,  confidence: 'high'   },
    { source: 'net_amount',   target: 'SalesOrder.subtotal_amount',  include: true,  confidence: 'high'   },
    { source: 'vat_amount',   target: 'SalesOrder.tax_amount',       include: true,  confidence: 'medium' },
    { source: 'posting_date', target: 'SalesOrder.orderDate',        include: true,  confidence: 'high'   },
    { source: 'vendor_code',  target: 'Salesperson.salespersonId',   include: false, confidence: 'low'    },
  ],
  database: [
    { source: 'id',       target: 'SalesOrder.orderId',         include: true,  confidence: 'high'   },
    { source: 'amount',   target: 'SalesOrder.subtotal_amount',  include: true,  confidence: 'medium' },
    { source: 'date',     target: 'SalesOrder.orderDate',        include: true,  confidence: 'high'   },
    { source: 'customer', target: 'Customer.customerId',         include: true,  confidence: 'medium' },
    { source: 'product',  target: 'Product.productId',           include: false, confidence: 'low'    },
  ],
  payments: [
    { source: 'txn_id',       target: 'SalesOrder.orderId',     include: true,  confidence: 'medium' },
    { source: 'amount_cents', target: 'SalesOrder.total_due',   include: true,  confidence: 'medium' },
    { source: 'customer_id',  target: 'Customer.customerId',    include: true,  confidence: 'high'   },
    { source: 'created_at',   target: 'SalesOrder.orderDate',   include: true,  confidence: 'high'   },
    { source: 'currency',     target: 'SalesOrder.currency',    include: false, confidence: 'low'    },
  ],
  cloud: [
    { source: 'record_id',    target: 'SalesOrder.orderId',         include: true,  confidence: 'medium' },
    { source: 'value',        target: 'SalesOrder.subtotal_amount',  include: true,  confidence: 'low'    },
    { source: 'owner',        target: 'Salesperson.salespersonId',   include: false, confidence: 'low'    },
    { source: 'created_date', target: 'SalesOrder.orderDate',        include: true,  confidence: 'medium' },
  ],
  logistics: [
    { source: 'shipment_id',   target: 'SalesOrder.orderId',  include: true,  confidence: 'medium' },
    { source: 'destination',   target: 'Territory.name',       include: true,  confidence: 'medium' },
    { source: 'delivery_date', target: 'SalesOrder.shipDate',  include: true,  confidence: 'high'   },
    { source: 'weight_kg',     target: 'Product.weight',       include: false, confidence: 'low'    },
    { source: 'carrier_code',  target: 'SalesOrder.carrier',   include: false, confidence: 'low'    },
  ],
}

function generateConnectorMappings(c: ConnectorDef): ConnectorFieldMapping[] {
  return (CONNECTOR_FIELD_TEMPLATES[c.category] ?? CONNECTOR_FIELD_TEMPLATES.database!).map(m => ({ ...m }))
}

function generateValidationChecks(rowCount: number): ConnectorValidationCheck[] {
  const dupes = Math.floor(rowCount * 0.015)
  const nulls = Math.floor(rowCount * 0.008)
  return [
    { label: 'Records found',               status: 'ok',                         detail: `${rowCount.toLocaleString('en-US')} rows available` },
    { label: 'Primary key uniqueness',       status: 'ok',                         detail: 'No duplicate IDs detected' },
    { label: 'Potential duplicates',         status: dupes > 0 ? 'warning' : 'ok', detail: `${dupes} suspected duplicate records` },
    { label: 'Null values in mapped fields', status: nulls > 0 ? 'warning' : 'ok', detail: `${nulls} rows with null values` },
    { label: 'Type compatibility',           status: 'ok',                         detail: 'All mapped fields are type-compatible' },
    { label: 'Cross-source key resolution',  status: 'ok',                         detail: `${Math.floor(rowCount * 0.87).toLocaleString('en-US')} records matched to existing entities` },
  ]
}

function ConnectorWorkflowPanel({
  workflow, onToggleMapping, onConfirmMappings, onProceedIngest, onCancel,
}: {
  workflow: ConnectorWorkflow
  onToggleMapping: (source: string) => void
  onConfirmMappings: () => void
  onProceedIngest: () => void
  onCancel: () => void
}) {
  const includedCount = workflow.mappings.filter(m => m.include).length
  const warnCount = workflow.checks.filter(c => c.status === 'warning').length

  return (
    <div className="bg-white border border-blue-200 rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-blue-50/70 border-b border-blue-100">
        <ConnectorLogo c={workflow.connector} size="sm" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">{workflow.connector.name}</p>
          <p className="text-[11px] text-slate-500">
            {workflow.step === 'map'      && 'Step 2 of 3 — Map fields to your ontology'}
            {workflow.step === 'validate' && 'Step 3 of 3 — Validate data quality before ingesting'}
            {workflow.step === 'ingest'   && 'Ingesting into semantic layer…'}
          </p>
        </div>
        {workflow.step !== 'ingest' && (
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 p-1.5 rounded hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Map step */}
      {workflow.step === 'map' && (
        <>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white border-b border-slate-200 z-10">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Source Field</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">→ Ontology Target</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Confidence</th>
                  <th className="w-12 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {workflow.mappings.map(m => (
                  <tr key={m.source} className={`border-t border-slate-100 ${m.include ? 'bg-blue-50/30' : ''}`}>
                    <td className="px-4 py-2 font-mono text-slate-700">{m.source}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {m.target.includes('.') ? (
                        <>
                          <span className="font-medium">{m.target.split('.')[0]}</span>
                          <span className="text-slate-400">.{m.target.split('.')[1]}</span>
                        </>
                      ) : m.target}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${CONFIDENCE_COLORS[m.confidence]}`}>
                        {m.confidence}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => onToggleMapping(m.source)}
                        className={`w-6 h-6 rounded flex items-center justify-center transition-all ${
                          m.include ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                        }`}
                      >
                        {m.include && <Check className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/50">
            <p className="text-xs text-slate-500">{includedCount} of {workflow.mappings.length} fields included</p>
            <button
              onClick={onConfirmMappings}
              disabled={includedCount === 0}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                includedCount > 0 ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              <ChevronRight className="w-3.5 h-3.5" />
              Confirm Mappings
            </button>
          </div>
        </>
      )}

      {/* Validate step */}
      {workflow.step === 'validate' && (
        <>
          <div className="px-4 py-4 space-y-2.5">
            {workflow.checks.map(check => (
              <div key={check.label} className="flex items-start gap-3">
                {check.status === 'ok'
                  ? <CheckCircle2 className="w-4 h-4 text-teal-500 flex-shrink-0 mt-0.5" />
                  : <AlertCircle  className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                }
                <div>
                  <p className="text-xs font-medium text-slate-700">{check.label}</p>
                  <p className="text-[11px] text-slate-500">{check.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/50">
            <p className="text-xs text-slate-500">
              {warnCount > 0 ? `${warnCount} warning${warnCount > 1 ? 's' : ''} — proceeding is safe` : 'All checks passed'}
            </p>
            <button
              onClick={onProceedIngest}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white transition-colors"
            >
              <Zap className="w-3.5 h-3.5" />
              Ingest {workflow.rowCount.toLocaleString('en-US')} records
            </button>
          </div>
        </>
      )}

      {/* Ingest step */}
      {workflow.step === 'ingest' && (
        <div className="px-4 py-8 flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 text-teal-500 animate-spin" />
          <p className="text-sm font-semibold text-slate-900">Ingesting to semantic layer…</p>
          <p className="text-xs text-slate-500">Mapping fields · validating types · indexing nodes & edges</p>
        </div>
      )}
    </div>
  )
}

// ── Main view ────────────────────────────────────────────────────────────────
export default function DataSourcesView() {
  const { sectorId, sector } = useSector()
  const ontology = useExtendedOntology(sectorId)
  const [connectedSources, setConnectedSources] = useConnectedSources(sectorId)

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<ConnectorCategory | 'all' | 'italian'>('all')
  const [connecting, setConnecting] = useState<string | null>(null)
  const [upload, setUpload] = useState<UploadState | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [ingesting, setIngesting] = useState(false)
  const [connectorWorkflow, setConnectorWorkflow] = useState<ConnectorWorkflow | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  // Determine active workflow step
  const activeStep: Step = useMemo(() => {
    if (connectorWorkflow) return connectorWorkflow.step
    if (ingesting) return 'ingest'
    if (upload && Object.values(upload.accepted).some(Boolean)) return 'validate'
    if (upload) return 'map'
    return 'connect'
  }, [connectorWorkflow, upload, ingesting])

  const completeSteps = useMemo(() => {
    const done = new Set<Step>()
    if (connectedSources.length > 0 || upload || connectorWorkflow) done.add('connect')
    if (connectorWorkflow && (connectorWorkflow.step === 'validate' || connectorWorkflow.step === 'ingest')) done.add('map')
    if (connectorWorkflow && connectorWorkflow.step === 'ingest') done.add('validate')
    if (upload && Object.values(upload.accepted).some(Boolean)) { done.add('connect'); done.add('map') }
    if (ingesting) { done.add('map'); done.add('validate') }
    return done
  }, [connectedSources, upload, ingesting, connectorWorkflow])

  // ── Filters
  const filteredConnectors = useMemo(() => {
    return CONNECTORS.filter(c => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false
      if (categoryFilter === 'italian') return c.italian
      if (categoryFilter !== 'all') return c.category === categoryFilter
      return true
    })
  }, [search, categoryFilter])

  const connectedIds = new Set(connectedSources.map(s => s.connectorId))

  // ── Connect / disconnect
  const connectConnector = (c: ConnectorDef) => {
    if (c.status === 'coming-soon' || connecting) return
    setConnecting(c.id)
    setTimeout(() => {
      const rowCount = Math.floor(800 + Math.random() * 4200)
      setConnectorWorkflow({
        connector: c,
        step: 'map',
        mappings: generateConnectorMappings(c),
        rowCount,
        checks: generateValidationChecks(rowCount),
      })
      setConnecting(null)
      showToast(`Connected to ${c.name} · configure field mappings below`)
    }, 1200)
  }

  const toggleConnectorMapping = (source: string) => {
    if (!connectorWorkflow) return
    setConnectorWorkflow({
      ...connectorWorkflow,
      mappings: connectorWorkflow.mappings.map(m => m.source === source ? { ...m, include: !m.include } : m),
    })
  }

  const confirmConnectorMappings = () => {
    if (!connectorWorkflow) return
    setConnectorWorkflow({ ...connectorWorkflow, step: 'validate' })
  }

  const proceedConnectorIngest = () => {
    if (!connectorWorkflow) return
    const wf = connectorWorkflow
    const currentSources = connectedSources
    setConnectorWorkflow({ ...wf, step: 'ingest' })
    setTimeout(() => {
      const now = new Date().toISOString()
      const filtered = currentSources.filter(s => s.connectorId !== wf.connector.id)
      setConnectedSources([...filtered, { connectorId: wf.connector.id, connectedAt: now, lastSyncAt: now, rowCount: wf.rowCount }])
      setConnectorWorkflow(null)
      showToast(`${wf.connector.name} ingested · ${wf.rowCount.toLocaleString('en-US')} records added`)
    }, 2000)
  }

  const cancelConnectorWorkflow = () => setConnectorWorkflow(null)

  const disconnectConnector = (id: string) => {
    setConnectedSources(connectedSources.filter(s => s.connectorId !== id))
    const c = connectorById(id)
    if (c) showToast(`${c.name} disconnected`)
  }

  const syncConnector = (id: string) => {
    const now = new Date().toISOString()
    setConnectedSources(connectedSources.map(s => s.connectorId === id ? { ...s, lastSyncAt: now } : s))
    const c = connectorById(id)
    if (c) showToast(`${c.name} synced just now`)
  }

  // ── Upload handlers
  const handleFile = async (file: File) => {
    const text = await file.text()
    const { headers, rows } = parseCSV(text)
    if (headers.length === 0) {
      showToast('Could not parse CSV — check the file format')
      return
    }
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

  const toggleMapping = (col: string) => {
    if (!upload) return
    setUpload({ ...upload, accepted: { ...upload.accepted, [col]: !upload.accepted[col] } })
  }

  const ingestData = () => {
    if (!upload) return
    setIngesting(true)
    setTimeout(() => {
      // Persist as a "file" connector entry
      const now = new Date().toISOString()
      const fakeId = `file-${Date.now()}`
      setConnectedSources([
        ...connectedSources,
        { connectorId: 'google-sheets', connectedAt: now, lastSyncAt: now, rowCount: upload.rows.length },
      ].filter((s, i, arr) => arr.findIndex(x => x.connectorId === s.connectorId) === i))
      showToast(`Ingested ${upload.rows.length.toLocaleString('en-US')} rows from ${upload.filename}`)
      setUpload(null)
      setIngesting(false)
      void fakeId
    }, 1500)
  }

  // ── Categories list for filter chips
  const allCategories: ('all' | 'italian' | ConnectorCategory)[] = [
    'all', 'italian',
    'erp', 'accounting', 'ecommerce', 'crm', 'payments', 'database', 'cloud', 'logistics',
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 flex-shrink-0">
        <h1 className="text-2xl font-bold text-slate-900">Data Sources</h1>
        <p className="text-slate-500 mt-1 text-sm">
          {sector.name} · Connect business systems or upload files to ingest into the semantic layer
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-8 py-6 space-y-6">
        {/* AW active sources (manufacturing only) */}
        {sectorId === 'manufacturing' && <AWSourcesPanel />}

        {/* Workflow */}
        <WorkflowProgress active={activeStep} complete={completeSteps} />

        {/* Connector workflow (Map → Validate → Ingest after connecting a new source) */}
        {connectorWorkflow && (
          <ConnectorWorkflowPanel
            workflow={connectorWorkflow}
            onToggleMapping={toggleConnectorMapping}
            onConfirmMappings={confirmConnectorMappings}
            onProceedIngest={proceedConnectorIngest}
            onCancel={cancelConnectorWorkflow}
          />
        )}

        {/* Connected sources */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Connected Sources</h2>
              <span className="text-xs text-slate-400">· {connectedSources.length} active</span>
            </div>
          </div>
          <ConnectedSourcesPanel
            sources={connectedSources}
            onDisconnect={disconnectConnector}
            onSync={syncConnector}
          />
        </section>

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
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search connectors…"
                className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg outline-none focus:border-teal-400 w-52"
              />
            </div>
          </div>

          {/* Category chips */}
          <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1">
            {allCategories.map(cat => {
              const isActive = categoryFilter === cat
              const label = cat === 'all' ? 'All' : cat === 'italian' ? '🇮🇹 Italian' : CATEGORY_LABELS[cat]
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`text-xs px-3 py-1 rounded-full transition-colors flex-shrink-0 ${
                    isActive
                      ? 'bg-slate-900 text-white font-medium'
                      : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredConnectors.map(c => (
              <ConnectorCard
                key={c.id}
                c={c}
                connected={connectedIds.has(c.id)}
                connecting={connecting === c.id}
                onConnect={() => connectConnector(c)}
                onDisconnect={() => disconnectConnector(c.id)}
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
            <span className="text-xs text-slate-400">· auto-mapping to your ontology</span>
          </div>
          <UploadPanel
            upload={upload}
            onUpload={handleFile}
            onToggle={toggleMapping}
            onClear={() => setUpload(null)}
            onIngest={ingestData}
            onLoadSample={loadSample}
          />
        </section>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-sm rounded-xl px-4 py-3 shadow-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-teal-400" />
          {toast}
        </div>
      )}

      {/* Ingest overlay */}
      {ingesting && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl px-6 py-5 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-teal-500 animate-spin" />
            <div>
              <p className="text-sm font-semibold text-slate-900">Ingesting to semantic layer…</p>
              <p className="text-xs text-slate-500 mt-0.5">Mapping fields · validating · indexing</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
