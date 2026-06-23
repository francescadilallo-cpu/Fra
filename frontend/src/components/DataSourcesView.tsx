import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import {
  Plug, Upload, Check, X, FileText, Search, Star,
  Zap, AlertCircle, CheckCircle2, Loader2, Download, Trash2, RefreshCw,
  Database, AlertTriangle, Clock, ChevronDown, ChevronRight, ShieldCheck, Pencil,
  Sparkles, Brain, Link2, ClipboardCheck, Flag, MessageSquare, Rocket, TrendingUp, Plus,
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
import { buildSemanticLayer, semanticSources, backendErrorMessage, getSourceProfiles, analyzeSources, createMetric, addRelation } from '../api/semantic'
import type { TableProfile, AnalyzeResult } from '../api/semantic'
import { IS_DEMO_MODE, workspaceLabel } from '../lib/demoMode'
import {
  loadQualityRules, saveQualityRules, upsertRule, removeRule,
  getRuleForColumn, effectiveQualityScore, type QualityRule,
} from '../data/qualityRules'
import { loadExtension, saveExtension } from '../data/ontologyExtensions'
import { useJourneyProgress } from '../data/journeyProgress'
import {
  loadFeedback, addFeedback, resolveFeedback, KIND_LABELS,
  type FeedbackItem, type FeedbackKind,
} from '../data/evolutionFeedback'
import {
  loadReviewQueue, addReviewItems, updateReviewItem, certifyAll, type ReviewItem, type ReviewStatus,
} from '../data/changeReviewQueue'
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

// ── Quality badge ─────────────────────────────────────────────────────────────

function QualityBadge({ score }: { score: number }) {
  const cls = score >= 85 ? 'bg-teal-50 text-teal-700 border-teal-200'
            : score >= 60 ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-red-50 text-red-600 border-red-200'
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cls}`}>
      Q·{score}
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

// ── Ontology generation panel (Step 5) ───────────────────────────────────────

type OntologyGenState = 'idle' | 'analyzing' | 'review' | 'applying' | 'done' | 'error'

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = pct >= 80 ? 'bg-teal-400' : pct >= 60 ? 'bg-amber-400' : 'bg-slate-300'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-10 h-1 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] text-slate-400">{pct}%</span>
    </div>
  )
}

function OntologyGenerationPanel({
  sectorId,
  onNavigateToOntology,
}: {
  sectorId: string
  onNavigateToOntology: () => void
}) {
  const [genState, setGenState] = useState<OntologyGenState>('idle')
  const [proposal, setProposal] = useState<AnalyzeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(new Set())
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(new Set())
  const [selectedRelations, setSelectedRelations] = useState<Set<string>>(new Set())
  const [appliedCount, setAppliedCount] = useState(0)

  // Check if ontology already has entities from a previous generation
  const existingExt = useMemo(() => loadExtension(sectorId), [sectorId, genState])
  const existingCount = existingExt.nodes.length

  async function runAnalysis() {
    setGenState('analyzing')
    setError(null)
    try {
      const result = await analyzeSources()
      setProposal(result)
      // Pre-select all high-confidence proposals
      setSelectedEntities(new Set(result.proposal.entities.filter(e => e.confidence >= 0.6).map(e => e.table)))
      setSelectedMetrics(new Set(result.proposal.metrics.filter(m => m.confidence >= 0.6).map(m => m.name)))
      setSelectedRelations(new Set(result.proposal.relations.filter(r => r.confidence >= 0.6).map(r => `${r.from_table}__${r.to_table}`)))
      setGenState('review')
    } catch (e) {
      setError(backendErrorMessage(e) || 'Analysis failed — check that sources are connected.')
      setGenState('error')
    }
  }

  async function applyProposals() {
    if (!proposal) return
    setGenState('applying')
    let count = 0
    try {
      // Apply selected entities → ontology extension
      const entitiesToAdd = proposal.proposal.entities.filter(e => selectedEntities.has(e.table))
      if (entitiesToAdd.length > 0) {
        const ext = loadExtension(sectorId)
        const existingIds = new Set(ext.nodes.map(n => n.id))
        const newNodes = entitiesToAdd
          .filter(e => !existingIds.has(e.table))
          .map((e, i) => ({
            id: e.table,
            label: e.name,
            uri: `urn:entity:${e.table}`,
            properties: [],
            position: { x: 200 + (i % 3) * 220, y: 100 + Math.floor(i / 3) * 160 },
            db_table: e.table,
          }))
        saveExtension(sectorId, { ...ext, nodes: [...ext.nodes, ...newNodes] })
        count += newNodes.length
      }

      // Apply selected metrics
      const metricsToAdd = proposal.proposal.metrics.filter(m => selectedMetrics.has(m.name))
      await Promise.allSettled(metricsToAdd.map(m =>
        createMetric({
          name: m.name, description: m.description,
          expression: m.formula, sector_id: sectorId,
          type: 'derived', entity: '', field: '', numerator: '', denominator: '',
          filters: [], time_dimension: '', grains: [], format: 'number',
          status: 'draft', owner: '', tags: [],
        })
          .then(() => { count++ })
          .catch(() => {})
      ))

      // Apply selected relations
      const relationsToAdd = proposal.proposal.relations.filter(r => selectedRelations.has(`${r.from_table}__${r.to_table}`))
      await Promise.allSettled(relationsToAdd.map(r =>
        addRelation({ from_table: r.from_table, to_table: r.to_table, via_column: r.via_column, edge_type: 'fk' })
          .then(() => { count++ })
          .catch(() => {})
      ))

      // Submit applied items to the review queue for Step 6 certification
      const reviewItems: Parameters<typeof addReviewItems>[1] = [
        ...entitiesToAdd.map(e => ({ kind: 'entity' as const, name: e.name, description: e.description, tableKey: e.table, source: 'ai_proposal' as const })),
        ...metricsToAdd.map(m => ({ kind: 'metric' as const, name: m.name, description: m.description, source: 'ai_proposal' as const })),
        ...relationsToAdd.map(r => ({ kind: 'relation' as const, name: `${r.from_table} → ${r.to_table}`, description: r.description, tableKey: r.from_table, source: 'ai_proposal' as const })),
      ]
      if (reviewItems.length > 0) addReviewItems(sectorId, reviewItems)

      setAppliedCount(count)
      window.dispatchEvent(new CustomEvent('ontology-entity-added'))
      setGenState('done')
    } catch (e) {
      setError(backendErrorMessage(e) || 'Apply failed. Some items may have been saved.')
      setGenState('error')
    }
  }

  const totalSelected = selectedEntities.size + selectedMetrics.size + selectedRelations.size

  if (genState === 'idle' || genState === 'error') {
    return (
      <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-violet-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <Brain className="w-4.5 h-4.5 text-violet-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-800">AI-Assisted Data Model</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {existingCount > 0
                ? `${existingCount} entities already in your data model. Run again to discover new ones.`
                : 'Let AI analyze your connected sources and propose an initial data model — entities, metrics, and relations.'}
            </p>
            {genState === 'error' && error && (
              <p className="mt-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={runAnalysis}
                className="flex items-center gap-1.5 text-xs bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 transition-colors font-medium"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {genState === 'error' ? 'Retry Analysis' : 'Generate Data Model'}
              </button>
              {existingCount > 0 && (
                <button
                  onClick={onNavigateToOntology}
                  className="text-xs text-violet-600 hover:text-violet-800 transition-colors"
                >
                  Open Ontology Builder →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (genState === 'analyzing') {
    return (
      <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl p-5">
        <div className="flex items-center gap-3">
          <Loader2 className="w-4 h-4 text-violet-500 animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-slate-700">Analyzing sources…</p>
            <p className="text-xs text-slate-400 mt-0.5">Profiling tables and generating entity proposals</p>
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          {['Scanning table schemas', 'Inferring entity types', 'Proposing relations & metrics'].map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border-2 border-violet-300 animate-pulse" />
              <span className="text-[11px] text-slate-500">{step}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (genState === 'done') {
    return (
      <div className="bg-teal-50 border border-teal-200 rounded-xl p-5">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-teal-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-teal-800">Data model updated</p>
            <p className="text-xs text-teal-600 mt-0.5">{appliedCount} item{appliedCount !== 1 ? 's' : ''} added to your semantic layer.</p>
          </div>
          <button onClick={onNavigateToOntology}
            className="text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 transition-colors font-medium">
            Open Ontology Builder →
          </button>
        </div>
      </div>
    )
  }

  // review / applying
  const entities = proposal?.proposal.entities ?? []
  const metrics = proposal?.proposal.metrics ?? []
  const relations = proposal?.proposal.relations ?? []

  return (
    <div className="bg-white border border-violet-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-violet-50 to-indigo-50 border-b border-violet-100">
        <Sparkles className="w-4 h-4 text-violet-500" />
        <span className="text-sm font-semibold text-slate-800">AI Proposals</span>
        <span className="text-[10px] text-slate-500 ml-1">
          {proposal?.llm_used ? 'generated with LLM' : 'schema-inferred'}
        </span>
        <span className="ml-auto text-[10px] text-slate-400">{totalSelected} selected</span>
      </div>

      {/* Entities */}
      {entities.length > 0 && (
        <div className="border-b border-slate-100">
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-50">
            <Database className="w-3 h-3 text-slate-500" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Entities ({entities.length})</span>
          </div>
          {entities.map(e => (
            <label key={e.table} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer border-t border-slate-50 first:border-0">
              <input
                type="checkbox"
                checked={selectedEntities.has(e.table)}
                onChange={ev => setSelectedEntities(prev => { const s = new Set(prev); ev.target.checked ? s.add(e.table) : s.delete(e.table); return s })}
                className="w-3.5 h-3.5 rounded accent-violet-600"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-800">{e.name}</span>
                  <span className="font-mono text-[9px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{e.table}</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5 truncate">{e.description}</p>
              </div>
              <ConfidenceBar score={e.confidence} />
            </label>
          ))}
        </div>
      )}

      {/* Metrics */}
      {metrics.length > 0 && (
        <div className="border-b border-slate-100">
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-50">
            <Zap className="w-3 h-3 text-slate-500" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Metrics ({metrics.length})</span>
          </div>
          {metrics.map(m => (
            <label key={m.name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer border-t border-slate-50 first:border-0">
              <input
                type="checkbox"
                checked={selectedMetrics.has(m.name)}
                onChange={ev => setSelectedMetrics(prev => { const s = new Set(prev); ev.target.checked ? s.add(m.name) : s.delete(m.name); return s })}
                className="w-3.5 h-3.5 rounded accent-violet-600"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-800">{m.name}</span>
                  {m.unit && <span className="text-[9px] text-slate-400">{m.unit}</span>}
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5 font-mono truncate">{m.formula}</p>
              </div>
              <ConfidenceBar score={m.confidence} />
            </label>
          ))}
        </div>
      )}

      {/* Relations */}
      {relations.length > 0 && (
        <div>
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-50">
            <Link2 className="w-3 h-3 text-slate-500" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Relations ({relations.length})</span>
          </div>
          {relations.map(r => {
            const key = `${r.from_table}__${r.to_table}`
            return (
              <label key={key} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer border-t border-slate-50 first:border-0">
                <input
                  type="checkbox"
                  checked={selectedRelations.has(key)}
                  onChange={ev => setSelectedRelations(prev => { const s = new Set(prev); ev.target.checked ? s.add(key) : s.delete(key); return s })}
                  className="w-3.5 h-3.5 rounded accent-violet-600"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-mono text-slate-600">{r.from_table}</span>
                    <span className="text-slate-400">→</span>
                    <span className="font-mono text-slate-600">{r.to_table}</span>
                    <span className="text-[9px] text-slate-400 ml-1">via {r.via_column}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5 truncate">{r.description}</p>
                </div>
                <ConfidenceBar score={r.confidence} />
              </label>
            )
          })}
        </div>
      )}

      {/* Apply footer */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-t border-slate-100">
        <button onClick={() => setGenState('idle')} className="text-xs text-slate-400 hover:text-slate-600">← Back</button>
        <button
          onClick={applyProposals}
          disabled={totalSelected === 0 || genState === 'applying'}
          className="flex items-center gap-1.5 text-xs bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 transition-colors font-medium disabled:opacity-40"
        >
          {genState === 'applying' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          {genState === 'applying' ? 'Applying…' : `Apply ${totalSelected} item${totalSelected !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  )
}

// ── Review & Certification panel (Step 6) ────────────────────────────────────

function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  if (status === 'certified') return (
    <span className="flex items-center gap-1 text-[9px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-1.5 py-0.5">
      <CheckCircle2 className="w-2.5 h-2.5" />Certified
    </span>
  )
  if (status === 'flagged') return (
    <span className="flex items-center gap-1 text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5">
      <Flag className="w-2.5 h-2.5" />Flagged
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-[9px] font-semibold bg-slate-100 text-slate-500 border border-slate-200 rounded-full px-1.5 py-0.5">
      <Clock className="w-2.5 h-2.5" />Pending
    </span>
  )
}

function ReviewPanel({
  items, onUpdate, onCertifyAll,
}: {
  items: ReviewItem[]
  onUpdate: (id: string, status: ReviewStatus, notes: string) => void
  onCertifyAll: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')

  const pendingCount = items.filter(i => i.status === 'pending').length
  const certifiedCount = items.filter(i => i.status === 'certified').length
  const flaggedCount = items.filter(i => i.status === 'flagged').length

  if (items.length === 0) return null

  function openNote(item: ReviewItem) {
    setNoteText(item.notes)
    setEditingId(item.id)
  }

  const kindIcon = (kind: ReviewItem['kind']) => {
    if (kind === 'entity') return <Database className="w-3 h-3 text-slate-400" />
    if (kind === 'metric') return <Zap className="w-3 h-3 text-slate-400" />
    return <Link2 className="w-3 h-3 text-slate-400" />
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-100">
        <ClipboardCheck className="w-4 h-4 text-slate-500" />
        <span className="text-sm font-semibold text-slate-800">Review Queue</span>
        <div className="flex items-center gap-2 ml-1">
          {pendingCount > 0 && (
            <span className="text-[10px] bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5 font-medium">{pendingCount} pending</span>
          )}
          {certifiedCount > 0 && (
            <span className="text-[10px] bg-teal-50 text-teal-700 rounded-full px-1.5 py-0.5 font-medium">{certifiedCount} certified</span>
          )}
          {flaggedCount > 0 && (
            <span className="text-[10px] bg-amber-50 text-amber-700 rounded-full px-1.5 py-0.5 font-medium">{flaggedCount} flagged</span>
          )}
        </div>
        {pendingCount > 0 && (
          <button
            onClick={onCertifyAll}
            className="ml-auto flex items-center gap-1 text-[10px] bg-teal-600 text-white px-2.5 py-1 rounded-lg hover:bg-teal-700 transition-colors font-medium"
          >
            <CheckCircle2 className="w-3 h-3" />Certify all
          </button>
        )}
      </div>

      {/* Items */}
      <div className="divide-y divide-slate-50">
        {items.map(item => (
          <div key={item.id} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex-shrink-0">{kindIcon(item.kind)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-slate-800">{item.name}</span>
                  <span className="text-[9px] bg-slate-100 text-slate-400 rounded px-1 py-0.5 capitalize">{item.kind}</span>
                  <span className="text-[9px] text-slate-400">·</span>
                  <span className="text-[9px] text-slate-400">
                    {new Date(item.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </span>
                  <ReviewStatusBadge status={item.status} />
                </div>
                {item.description && (
                  <p className="text-[10px] text-slate-500 mt-0.5 truncate">{item.description}</p>
                )}
                {item.notes && (
                  <p className="text-[10px] text-slate-400 italic mt-0.5">"{item.notes}"</p>
                )}
              </div>
              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {item.status !== 'certified' && (
                  <button
                    onClick={() => onUpdate(item.id, 'certified', item.notes)}
                    className="p-1 rounded hover:bg-teal-50 text-slate-400 hover:text-teal-600 transition-colors"
                    title="Certify"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </button>
                )}
                {item.status !== 'flagged' && (
                  <button
                    onClick={() => onUpdate(item.id, 'flagged', item.notes)}
                    className="p-1 rounded hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition-colors"
                    title="Flag for review"
                  >
                    <Flag className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => editingId === item.id ? setEditingId(null) : openNote(item)}
                  className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                  title="Add note"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {/* Inline note editor */}
            {editingId === item.id && (
              <div className="mt-2 flex items-center gap-2 pl-6">
                <input
                  type="text"
                  placeholder="Add a note…"
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { onUpdate(item.id, item.status, noteText); setEditingId(null) }
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  autoFocus
                  className="flex-1 text-[10px] px-2 py-1 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-400"
                />
                <button
                  onClick={() => { onUpdate(item.id, item.status, noteText); setEditingId(null) }}
                  className="text-[10px] bg-teal-600 text-white px-2 py-0.5 rounded hover:bg-teal-700"
                >Save</button>
                <button onClick={() => setEditingId(null)} className="text-[10px] text-slate-400">Cancel</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      {certifiedCount === items.length && items.length > 0 && (
        <div className="px-4 py-2.5 bg-teal-50 border-t border-teal-100 flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />
          <span className="text-[10px] text-teal-700 font-medium">All items certified — ready for activation.</span>
        </div>
      )}
    </div>
  )
}

// ── Activation readiness checklist (Step 7) ──────────────────────────────────

interface ReadinessCheck {
  label: string
  done: boolean
  hint: string
  actionLabel?: string
  onAction?: () => void
}

function ActivationReadinessPanel({
  checks, allReady, onActivate, activating,
}: {
  checks: ReadinessCheck[]
  allReady: boolean
  onActivate: () => void
  activating: boolean
}) {
  const doneCount = checks.filter(c => c.done).length
  return (
    <div className={`rounded-xl border overflow-hidden ${allReady ? 'border-teal-300 bg-gradient-to-r from-teal-50 to-emerald-50' : 'border-slate-200 bg-white'}`}>
      {/* Header */}
      <div className={`flex items-center gap-3 px-4 py-3 ${allReady ? 'bg-teal-50/60' : 'bg-slate-50'} border-b ${allReady ? 'border-teal-200' : 'border-slate-100'}`}>
        <Rocket className={`w-4 h-4 ${allReady ? 'text-teal-600' : 'text-slate-400'}`} />
        <span className="text-sm font-semibold text-slate-800">Activation Readiness</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${doneCount === checks.length ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
          {doneCount}/{checks.length}
        </span>
      </div>

      {/* Checklist */}
      <div className="divide-y divide-slate-50">
        {checks.map(c => (
          <div key={c.label} className="flex items-center gap-3 px-4 py-2.5">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${c.done ? 'bg-teal-100' : 'bg-slate-100'}`}>
              {c.done
                ? <Check className="w-3 h-3 text-teal-600" />
                : <span className="w-2 h-2 rounded-full bg-slate-300" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium ${c.done ? 'text-teal-800' : 'text-slate-700'}`}>{c.label}</p>
              {!c.done && <p className="text-[10px] text-slate-400 mt-0.5">{c.hint}</p>}
            </div>
            {!c.done && c.actionLabel && c.onAction && (
              <button
                onClick={c.onAction}
                className="text-[10px] text-teal-600 hover:text-teal-800 font-medium flex-shrink-0 transition-colors"
              >
                {c.actionLabel} →
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Activate CTA */}
      {allReady && (
        <div className="px-4 py-3 bg-teal-50 border-t border-teal-200 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-teal-800">Ready to activate!</p>
            <p className="text-[10px] text-teal-600 mt-0.5">Build your semantic layer and start querying your data.</p>
          </div>
          <button
            onClick={onActivate}
            disabled={activating}
            className="flex items-center gap-1.5 text-xs bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors font-semibold disabled:opacity-60"
          >
            {activating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
            {activating ? 'Building…' : 'Build & Activate'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Continuous evolution panel (Step 8) ──────────────────────────────────────

function ContinuousEvolutionPanel({
  sources, feedbackItems, onAddFeedback, onResolve,
}: {
  sources: { id: string; label: string; last_sync_at: string | null; status: string }[]
  feedbackItems: FeedbackItem[]
  onAddFeedback: (kind: FeedbackKind, title: string, notes: string) => void
  onResolve: (id: string) => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [formKind, setFormKind] = useState<FeedbackKind>('data_quality')
  const [formTitle, setFormTitle] = useState('')
  const [formNotes, setFormNotes] = useState('')

  function submitForm() {
    if (!formTitle.trim()) return
    onAddFeedback(formKind, formTitle.trim(), formNotes.trim())
    setFormTitle(''); setFormNotes(''); setShowForm(false)
  }

  const openItems = feedbackItems.filter(f => f.status === 'open')
  const resolvedItems = feedbackItems.filter(f => f.status === 'resolved')

  // Freshness info derived from source sync dates
  const freshnessItems = sources
    .filter(s => s.last_sync_at)
    .map(s => {
      const ageMs = Date.now() - new Date(s.last_sync_at!).getTime()
      const ageH = ageMs / 3_600_000
      const status = ageH < 24 ? 'fresh' : ageH < 72 ? 'warning' : 'stale'
      return { ...s, ageH, status }
    })

  const statusColor = (s: string) =>
    s === 'fresh' ? 'text-teal-600 bg-teal-50 border-teal-200'
    : s === 'warning' ? 'text-amber-600 bg-amber-50 border-amber-200'
    : 'text-red-600 bg-red-50 border-red-200'

  const statusLabel = (s: string) =>
    s === 'fresh' ? 'Fresh' : s === 'warning' ? 'Aging' : 'Stale'

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-100">
        <TrendingUp className="w-4 h-4 text-slate-500" />
        <span className="text-sm font-semibold text-slate-800">Continuous Evolution</span>
        {openItems.length > 0 && (
          <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5 font-medium">
            {openItems.length} open
          </span>
        )}
        <button
          onClick={() => setShowForm(v => !v)}
          className="ml-auto flex items-center gap-1 text-[10px] text-teal-600 hover:text-teal-800 font-medium transition-colors"
        >
          <Plus className="w-3 h-3" />Report issue
        </button>
      </div>

      {/* Data freshness */}
      {freshnessItems.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-50">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Data Freshness</p>
          <div className="flex flex-wrap gap-2">
            {freshnessItems.map(s => (
              <div key={s.id} className={`flex items-center gap-1.5 text-[10px] border rounded-full px-2 py-0.5 ${statusColor(s.status)}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                <span className="font-medium truncate max-w-[120px]">{s.label}</span>
                <span className="opacity-70">{statusLabel(s.status)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feedback form */}
      {showForm && (
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">New Report</p>
          <div className="space-y-2">
            <select
              value={formKind}
              onChange={e => setFormKind(e.target.value as FeedbackKind)}
              className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-400 bg-white"
            >
              {(Object.entries(KIND_LABELS) as [FeedbackKind, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Brief title *"
              value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
            <textarea
              placeholder="Details (optional)"
              value={formNotes}
              onChange={e => setFormNotes(e.target.value)}
              rows={2}
              className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-400 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={submitForm}
                disabled={!formTitle.trim()}
                className="text-xs bg-teal-600 text-white px-3 py-1 rounded hover:bg-teal-700 transition-colors disabled:opacity-40 font-medium"
              >Submit</button>
              <button onClick={() => setShowForm(false)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback items */}
      {feedbackItems.length > 0 ? (
        <div className="divide-y divide-slate-50">
          {feedbackItems.slice(0, 5).map(item => (
            <div key={item.id} className={`flex items-start gap-3 px-4 py-2.5 ${item.status === 'resolved' ? 'opacity-50' : ''}`}>
              <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${item.status === 'resolved' ? 'bg-teal-400' : item.status === 'in_review' ? 'bg-amber-400' : 'bg-slate-300'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-700">{item.title}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {KIND_LABELS[item.kind]} · {new Date(item.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  {item.status === 'resolved' && item.resolvedAt && ` · Resolved ${new Date(item.resolvedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                </p>
                {item.notes && <p className="text-[10px] text-slate-400 italic mt-0.5 truncate">"{item.notes}"</p>}
              </div>
              {item.status === 'open' && (
                <button
                  onClick={() => onResolve(item.id)}
                  className="text-[9px] text-teal-600 hover:text-teal-800 font-medium flex-shrink-0 transition-colors"
                >
                  Resolve
                </button>
              )}
            </div>
          ))}
          {feedbackItems.length > 5 && (
            <div className="px-4 py-2 text-center">
              <span className="text-[10px] text-slate-400">{feedbackItems.length - 5} more items</span>
            </div>
          )}
        </div>
      ) : (
        <div className="px-4 py-4 text-center">
          <p className="text-xs text-slate-400">No reports yet. Use "Report issue" to flag data quality problems, missing metrics, or schema changes.</p>
        </div>
      )}

      {resolvedItems.length > 0 && (
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100">
          <span className="text-[10px] text-slate-400">{resolvedItems.length} resolved item{resolvedItems.length !== 1 ? 's' : ''}</span>
        </div>
      )}
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

// ── Profiling report panel ────────────────────────────────────────────────────

function NullBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100)
  const color = pct === 0 ? 'bg-teal-400' : pct < 10 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <div className="w-12 h-1.5 bg-slate-200 rounded-full overflow-hidden flex-shrink-0">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(pct, pct > 0 ? 4 : 0)}%` }} />
      </div>
      <span className={`text-[10px] font-medium flex-shrink-0 ${pct > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{pct}%</span>
    </div>
  )
}

function ProfilingPanel({
  tables, tableProfiles, loading, onRefresh, qualityRules, onUpdateRule, onRemoveRule,
}: {
  tables: string[]
  tableProfiles: Record<string, TableProfile>
  loading: boolean
  onRefresh: () => void
  qualityRules: QualityRule[]
  onUpdateRule: (rule: QualityRule) => void
  onRemoveRule: (tableKey: string, columnName: string) => void
}) {
  const [openTable, setOpenTable] = useState<string | null>(null)
  // editingRule: tracks which column's inline editor is open
  const [editingRule, setEditingRule] = useState<{ tableKey: string; columnName: string } | null>(null)
  const [ruleForm, setRuleForm] = useState({ ignore: false, maxNullRate: 30, note: '' })

  function openRuleEditor(tableKey: string, columnName: string) {
    const existing = getRuleForColumn(qualityRules, tableKey, columnName)
    setRuleForm({
      ignore: existing?.ignore ?? false,
      maxNullRate: existing ? Math.round(existing.maxNullRate * 100) : 30,
      note: existing?.note ?? '',
    })
    setEditingRule({ tableKey, columnName })
  }

  function saveRule() {
    if (!editingRule) return
    onUpdateRule({
      tableKey: editingRule.tableKey,
      columnName: editingRule.columnName,
      ignore: ruleForm.ignore,
      maxNullRate: ruleForm.maxNullRate / 100,
      note: ruleForm.note.trim(),
    })
    setEditingRule(null)
  }

  function clearRule() {
    if (!editingRule) return
    onRemoveRule(editingRule.tableKey, editingRule.columnName)
    setEditingRule(null)
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Data Quality</span>
          {qualityRules.filter(r => tables.some(t => r.tableKey === t)).length > 0 && (
            <span className="text-[9px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-1.5 py-0.5">
              {qualityRules.filter(r => tables.some(t => r.tableKey === t)).length} rule{qualityRules.filter(r => tables.some(t => r.tableKey === t)).length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-teal-600 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Profiling…' : 'Refresh'}
        </button>
      </div>

      {loading && tables.every(t => !tableProfiles[t]) ? (
        <div className="space-y-2">
          {tables.slice(0, 3).map(t => (
            <div key={t} className="h-8 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {tables.map(t => {
            const p = tableProfiles[t]
            if (!p) return null
            const isOpen = openTable === t
            const effScore = effectiveQualityScore(p, qualityRules, t)
            const qColor = effScore >= 85 ? 'bg-teal-400' : effScore >= 60 ? 'bg-amber-400' : 'bg-red-400'
            const qText = effScore >= 85 ? 'text-teal-700' : effScore >= 60 ? 'text-amber-700' : 'text-red-700'
            const rulesForTable = qualityRules.filter(r => r.tableKey === t)
            return (
              <div key={t} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                {/* Table header row */}
                <button
                  onClick={() => setOpenTable(isOpen ? null : t)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
                >
                  <span className="font-mono text-xs text-slate-700 flex-1 truncate">{t}</span>
                  <span className="text-[10px] text-slate-400 flex-shrink-0">{p.row_count.toLocaleString('en-US')} rows · {p.column_count} cols</span>
                  {/* Effective quality score */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${qColor}`} style={{ width: `${effScore}%` }} />
                    </div>
                    <span className={`text-[10px] font-bold ${qText}`}>{effScore}%</span>
                  </div>
                  {rulesForTable.length > 0 && (
                    <span className="text-[9px] bg-teal-50 text-teal-700 border border-teal-200 rounded px-1.5 py-0.5 flex-shrink-0 flex items-center gap-0.5">
                      <ShieldCheck className="w-2.5 h-2.5" />{rulesForTable.length}
                    </span>
                  )}
                  {p.high_null_columns.length > 0 && (
                    <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 flex-shrink-0">
                      ⚠ {p.high_null_columns.length} null
                    </span>
                  )}
                  {isOpen
                    ? <ChevronDown className="w-3 h-3 text-slate-400 flex-shrink-0" />
                    : <ChevronRight className="w-3 h-3 text-slate-400 flex-shrink-0" />}
                </button>

                {/* Column-level detail */}
                {isOpen && p.columns.length > 0 && (
                  <div className="border-t border-slate-100">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="bg-slate-50 text-slate-400 font-semibold uppercase tracking-wide">
                          <th className="text-left px-3 py-1.5">Column</th>
                          <th className="text-left px-2 py-1.5">Type</th>
                          <th className="text-left px-2 py-1.5 w-28">Null %</th>
                          <th className="text-right px-3 py-1.5">Distinct</th>
                          <th className="text-center px-2 py-1.5">Key?</th>
                          <th className="text-center px-2 py-1.5">Rule</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {p.columns.map(col => {
                          const rule = getRuleForColumn(qualityRules, t, col.name)
                          const isEditingThis = editingRule?.tableKey === t && editingRule?.columnName === col.name
                          const threshold = rule ? rule.maxNullRate : 0.30
                          const isHighNull = !rule?.ignore && col.null_rate > threshold
                          return (
                            <>
                              <tr key={col.name} className={isHighNull ? (col.null_rate > 0.3 ? 'bg-red-50/30' : 'bg-amber-50/20') : rule?.ignore ? 'bg-slate-50/60' : ''}>
                                <td className="px-3 py-1.5 font-mono text-slate-700 truncate max-w-[140px]" title={col.name}>
                                  {col.name}
                                  {rule?.ignore && <span className="ml-1 text-slate-400 italic">(ignored)</span>}
                                </td>
                                <td className="px-2 py-1.5">
                                  <span className="bg-slate-100 text-slate-500 rounded px-1.5 py-0.5 font-medium">{col.type || '—'}</span>
                                </td>
                                <td className="px-2 py-1.5">
                                  <NullBar rate={col.null_rate} />
                                </td>
                                <td className="px-3 py-1.5 text-right text-slate-500">{col.distinct_in_sample.toLocaleString('en-US')}</td>
                                <td className="px-2 py-1.5 text-center">
                                  {col.looks_unique && (
                                    <span title="Likely primary key" className="text-teal-600 font-bold">✦</span>
                                  )}
                                </td>
                                <td className="px-2 py-1.5 text-center">
                                  <button
                                    onClick={() => isEditingThis ? setEditingRule(null) : openRuleEditor(t, col.name)}
                                    className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-slate-100 transition-colors"
                                    title={rule ? 'Edit quality rule' : 'Set quality rule'}
                                  >
                                    {rule ? (
                                      <ShieldCheck className={`w-3 h-3 ${rule.ignore ? 'text-slate-400' : 'text-teal-500'}`} />
                                    ) : (
                                      <Pencil className="w-2.5 h-2.5 text-slate-300 hover:text-slate-500" />
                                    )}
                                  </button>
                                </td>
                              </tr>
                              {isEditingThis && (
                                <tr key={`${col.name}-editor`} className="bg-teal-50/40">
                                  <td colSpan={6} className="px-3 py-2">
                                    <div className="flex flex-wrap items-center gap-3">
                                      <label className="flex items-center gap-1.5 text-[10px] text-slate-600 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={ruleForm.ignore}
                                          onChange={e => setRuleForm(f => ({ ...f, ignore: e.target.checked }))}
                                          className="w-3 h-3 rounded accent-teal-600"
                                        />
                                        Ignore nulls (exclude from score)
                                      </label>
                                      <label className="flex items-center gap-1.5 text-[10px] text-slate-600">
                                        <span>Max null</span>
                                        <input
                                          type="number"
                                          min={0} max={100}
                                          value={ruleForm.maxNullRate}
                                          disabled={ruleForm.ignore}
                                          onChange={e => setRuleForm(f => ({ ...f, maxNullRate: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) }))}
                                          className="w-12 text-[10px] px-1.5 py-0.5 border border-slate-200 rounded text-center disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-teal-400"
                                        />
                                        <span>%</span>
                                      </label>
                                      <input
                                        type="text"
                                        placeholder="Note (optional)"
                                        value={ruleForm.note}
                                        onChange={e => setRuleForm(f => ({ ...f, note: e.target.value }))}
                                        className="flex-1 min-w-[100px] text-[10px] px-2 py-0.5 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-400"
                                      />
                                      <div className="flex items-center gap-1.5 ml-auto">
                                        {rule && (
                                          <button onClick={clearRule}
                                            className="text-[10px] text-red-500 hover:text-red-700 transition-colors px-1.5 py-0.5">
                                            Remove
                                          </button>
                                        )}
                                        <button onClick={() => setEditingRule(null)}
                                          className="text-[10px] text-slate-400 hover:text-slate-600 px-1.5 py-0.5">
                                          Cancel
                                        </button>
                                        <button onClick={saveRule}
                                          className="text-[10px] bg-teal-600 text-white px-2 py-0.5 rounded hover:bg-teal-700 transition-colors">
                                          Save
                                        </button>
                                      </div>
                                    </div>
                                    {ruleForm.note && (
                                      <p className="mt-1 text-[9px] text-slate-500 italic">{ruleForm.note}</p>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </>
                          )
                        })}
                      </tbody>
                    </table>
                    {p.high_null_columns.filter(col => !getRuleForColumn(qualityRules, t, col)?.ignore).length > 0 && (
                      <div className="px-3 py-2 bg-amber-50 border-t border-amber-100 flex items-center gap-2">
                        <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                        <span className="text-[10px] text-amber-700">
                          High null rate: <span className="font-mono">
                            {p.high_null_columns.filter(col => !getRuleForColumn(qualityRules, t, col)?.ignore).join(', ')}
                          </span>
                          {' — '}click ✎ to set a rule or ignore
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ConnectedSourcesPanel({
  sources, onDisconnect, onSync, tableProfiles, profilingLoading, onRefreshProfiles,
  qualityRules, onUpdateRule, onRemoveRule,
}: {
  sources: BackendSource[]
  onDisconnect: (id: string) => void
  onSync: (id: string) => void
  tableProfiles: Record<string, TableProfile>
  profilingLoading: boolean
  onRefreshProfiles: () => void
  qualityRules: QualityRule[]
  onUpdateRule: (rule: QualityRule) => void
  onRemoveRule: (tableKey: string, columnName: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) => setExpanded(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s
  })

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
        const tables = s.target_tables ?? []
        const profs = tables.map(t => tableProfiles[t]).filter((p): p is TableProfile => !!p)
        const avgQ = profs.length > 0
          ? Math.round(profs.reduce((a, p) => a + effectiveQualityScore(p, qualityRules, tables[profs.indexOf(p)]), 0) / profs.length)
          : undefined
        const totalHighNull = profs.reduce((a, p, pi) => {
          return a + p.columns.filter(col => {
            const rule = getRuleForColumn(qualityRules, tables[pi], col.name)
            return !rule?.ignore && col.null_rate > (rule ? rule.maxNullRate : 0.30)
          }).length
        }, 0)
        const isExpanded = expanded.has(s.id)

        return (
          <div key={s.id} className={i > 0 ? 'border-t border-slate-100' : ''}>
            <div className="flex items-center gap-3 px-4 py-3">
              {c ? <ConnectorLogo c={c} size="sm" /> : (
                <div className="w-7 h-7 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 text-xs font-bold flex-shrink-0">
                  <Database className="w-3.5 h-3.5" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-slate-900 truncate">{s.label}</p>
                  <StatusBadge status={s.status} />
                  {avgQ !== undefined && <QualityBadge score={avgQ} />}
                  {totalHighNull > 0 && (
                    <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded">
                      ⚠ {totalHighNull} high-null {totalHighNull === 1 ? 'col' : 'cols'}
                    </span>
                  )}
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
              {profs.length > 0 && (
                <button onClick={() => toggleExpand(s.id)}
                  className="text-slate-400 hover:text-slate-600 transition-colors p-1.5 rounded hover:bg-slate-50"
                  title={isExpanded ? 'Hide quality detail' : 'Show quality detail'}>
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              )}
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

            {/* Data Quality — full column-level profiling + rule editing */}
            {isExpanded && (profs.length > 0 || profilingLoading) && (
              <ProfilingPanel
                tables={tables}
                tableProfiles={tableProfiles}
                loading={profilingLoading}
                onRefresh={onRefreshProfiles}
                qualityRules={qualityRules}
                onUpdateRule={onUpdateRule}
                onRemoveRule={onRemoveRule}
              />
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

// ── Workbench pipeline rail (Step 1–8 orchestration) ────────────────────────

type StepStatus = 'done' | 'current' | 'upcoming'
type WorkbenchPhase = 'SETUP' | 'BUILD' | 'OPERATE'

interface WorkbenchStep {
  n: number
  phase: WorkbenchPhase
  label: string
  anchor: string
  status: StepStatus
}

const PHASE_META: { id: WorkbenchPhase; label: string; span: number }[] = [
  { id: 'SETUP', label: 'Setup', span: 2 },
  { id: 'BUILD', label: 'Build', span: 4 },
  { id: 'OPERATE', label: 'Operate', span: 2 },
]

// Per-step detail used by the rail spotlight + node icons.
const STEP_DETAIL: Record<number, { icon: typeof Database; desc: string; cta: string }> = {
  1: { icon: Sparkles,       desc: 'Your sector and context are set — the model is tuned to your domain.', cta: 'Review setup' },
  2: { icon: Plug,           desc: 'Connect your ERP, CRM, files and databases. Data loads automatically.', cta: 'Connect a source' },
  3: { icon: Database,       desc: 'Every table is profiled: row counts, types, null rates and key detection.', cta: 'View profiling' },
  4: { icon: ShieldCheck,    desc: 'Tune quality rules — mark expected nulls, set thresholds, certify columns.', cta: 'Set quality rules' },
  5: { icon: Brain,          desc: 'AI proposes entities, metrics and relations from your data. You approve.', cta: 'Generate model' },
  6: { icon: ClipboardCheck, desc: 'Review and certify every AI-generated item before it goes live.', cta: 'Review items' },
  7: { icon: Rocket,         desc: 'All checks green? Build the semantic layer and activate your workspace.', cta: 'Activate' },
  8: { icon: TrendingUp,     desc: 'Monitor freshness and report issues — the model keeps improving.', cta: 'Open monitoring' },
}

function WorkbenchRail({ steps, onJump }: { steps: WorkbenchStep[]; onJump: (anchor: string) => void }) {
  const doneCount = steps.filter(s => s.status === 'done').length
  const current = steps.find(s => s.status === 'current')
  const allDone = doneCount === steps.length
  const pct = Math.round((doneCount / steps.length) * 100)

  return (
    <div className="panel">
      {/* Header band */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-5 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-teal-500/15 ring-1 ring-teal-400/30">
            <Database className="w-4 h-4 text-teal-300" />
          </span>
          <div>
            <p className="text-sm font-bold text-white leading-none">Data Pipeline</p>
            <p className="t-mini text-slate-400 mt-1">
              {allDone ? 'Fully operational' : current ? `Up next · ${current.label}` : 'Getting started'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-teal-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="t-mini font-semibold text-teal-300 tabular-nums">{doneCount}/{steps.length}</span>
        </div>
      </div>

      {/* Phase labels (weighted to match step counts 2/4/2) */}
      <div className="flex px-5 pt-4">
        {PHASE_META.map((p, i) => (
          <div
            key={p.id}
            style={{ flexGrow: p.span }}
            className={`flex justify-center ${i > 0 ? 'border-l border-slate-100' : ''}`}
          >
            <span className="eyebrow text-slate-400">{p.label}</span>
          </div>
        ))}
      </div>

      {/* Nodes */}
      <div className="flex px-5 pt-2 pb-4">
        {steps.map((s, i) => {
          const isLast = i === steps.length - 1
          const segDone = s.status === 'done'
          const Icon = STEP_DETAIL[s.n].icon
          return (
            <div key={s.n} className="flex-1 flex flex-col items-center relative min-w-0">
              {/* connector to next node */}
              {!isLast && (
                <div
                  className={`absolute top-4 left-1/2 w-full h-0.5 ${segDone ? 'bg-teal-400' : 'bg-slate-200'}`}
                />
              )}
              <button
                onClick={() => onJump(s.anchor)}
                title={`${s.n}. ${s.label}`}
                className="relative z-10 group flex flex-col items-center gap-1.5 min-w-0 w-full"
              >
                <span
                  className={`flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 transition-all ${
                    s.status === 'done'
                      ? 'bg-teal-600 text-white shadow-sm'
                      : s.status === 'current'
                      ? 'bg-white ring-2 ring-teal-500 text-teal-600 shadow-sm scale-110'
                      : 'bg-white ring-1 ring-slate-200 text-slate-300'
                  }`}
                >
                  {s.status === 'done'
                    ? <Check className="w-4 h-4" />
                    : <Icon className="w-4 h-4" />}
                </span>
                <span
                  className={`t-micro text-center leading-tight px-0.5 truncate max-w-full ${
                    s.status === 'done' ? 'text-teal-700 font-medium'
                    : s.status === 'current' ? 'text-slate-800 font-semibold'
                    : 'text-slate-400'
                  } group-hover:text-teal-600`}
                >
                  {s.label}
                </span>
              </button>
            </div>
          )
        })}
      </div>

      {/* Spotlight — current step detail + inline action */}
      {allDone ? (
        <div className="border-t border-slate-100 bg-teal-50/60 px-5 py-3 flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-teal-600 flex-shrink-0" />
          <p className="text-sm text-teal-800 font-medium">Your data model is live and queryable.</p>
        </div>
      ) : current ? (
        <div className="border-t border-slate-100 bg-gradient-to-r from-teal-50/70 to-transparent px-5 py-3 flex items-center gap-3">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-white ring-1 ring-teal-200 flex-shrink-0">
            {(() => { const I = STEP_DETAIL[current.n].icon; return <I className="w-4 h-4 text-teal-600" /> })()}
          </span>
          <div className="flex-1 min-w-0">
            <span className="eyebrow text-teal-600">You're here · Step {current.n}</span>
            <p className="t-mini text-slate-600 mt-0.5 leading-snug">{STEP_DETAIL[current.n].desc}</p>
          </div>
          <button onClick={() => onJump(current.anchor)} className="btn btn-primary btn-sm flex-shrink-0">
            {STEP_DETAIL[current.n].cta} →
          </button>
        </div>
      ) : null}
    </div>
  )
}

// ── Stage primitives (section headers tied to the rail) ─────────────────────

function StatusToken({ token, status }: { token: string; status?: StepStatus }) {
  return (
    <span
      className={`flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-full t-micro font-bold flex-shrink-0 ${
        status === 'done'
          ? 'bg-teal-600 text-white'
          : status === 'current'
          ? 'bg-white ring-2 ring-teal-500 text-teal-600'
          : 'bg-slate-100 text-slate-400 ring-1 ring-slate-200'
      }`}
    >
      {status === 'done' ? <Check className="w-3.5 h-3.5" /> : token}
    </span>
  )
}

/**
 * A collapsible stage: completed (`done`) steps start collapsed showing only a
 * one-line summary, keeping the workbench focused on the current step. Current
 * and upcoming steps start expanded.
 */
function CollapsibleStage({
  token, phase, title, status, summary, trailing, children,
}: {
  token: string
  phase: string
  title: string
  status?: StepStatus
  summary?: React.ReactNode
  trailing?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(status !== 'done')
  return (
    <>
      <div className="flex items-center gap-2.5 mb-3">
        <StatusToken token={token} status={status} />
        <button
          onClick={() => setOpen(o => !o)}
          className="flex-1 flex items-center gap-2 text-left min-w-0 group"
        >
          <div className="flex-shrink-0">
            <span className="eyebrow text-slate-400">{phase}</span>
            <h2 className="text-sm font-bold text-slate-800 leading-tight group-hover:text-teal-700 transition-colors">{title}</h2>
          </div>
          {!open && summary && (
            <span className="flex-1 t-mini text-slate-500 truncate min-w-0">{summary}</span>
          )}
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {trailing}
            {open
              ? <ChevronDown className="w-4 h-4 text-slate-400" />
              : <ChevronRight className="w-4 h-4 text-slate-400" />}
          </div>
        </button>
      </div>
      {open && children}
    </>
  )
}

// ── Guided empty state (no sources yet) ─────────────────────────────────────

const PHASE_PREVIEW: { phase: string; title: string; desc: string; icon: typeof Database }[] = [
  { phase: 'Setup',   title: 'Connect sources',   desc: 'Link your ERP, CRM, files — data loads automatically.', icon: Plug },
  { phase: 'Build',   title: 'AI builds the model', desc: 'Profiling, quality, and an ontology proposed from your data.', icon: Brain },
  { phase: 'Operate', title: 'Activate & ask',      desc: 'Go live and query everything in plain language.', icon: Rocket },
]

function GuidedEmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="panel panel-accent">
      <div className="px-6 py-6 bg-gradient-to-br from-teal-50/80 to-white">
        <div className="flex items-center gap-2 mb-1">
          <span className="eyebrow text-teal-600">Get started</span>
        </div>
        <h3 className="text-lg font-bold text-slate-900">Turn your business systems into answers</h3>
        <p className="text-sm text-slate-500 mt-1 max-w-xl">
          Connect your first source and the platform walks you through an 8-step
          pipeline — from raw tables to a queryable, governed data model.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
          {PHASE_PREVIEW.map((p, i) => (
            <div key={p.phase} className="bg-white border border-slate-200 rounded-lg p-3.5 relative">
              <span className="absolute top-3 right-3 t-micro font-bold text-slate-300">0{i + 1}</span>
              <p.icon className="w-4 h-4 text-teal-600" />
              <p className="eyebrow text-slate-400 mt-2">{p.phase}</p>
              <p className="text-sm font-semibold text-slate-800 mt-0.5">{p.title}</p>
              <p className="t-mini text-slate-500 mt-1 leading-snug">{p.desc}</p>
            </div>
          ))}
        </div>

        <button onClick={onConnect} className="btn btn-primary mt-5">
          <Plug className="w-4 h-4" /> Connect your first source
        </button>
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function DataSourcesView({ onNavigate }: { onNavigate?: (tab: NavTab) => void } = {}) {
  const { sectorId, sector } = useSector()
  const { steps: journeySteps } = useJourneyProgress()
  const semBuilt = journeySteps.find(s => s.id === 'model')?.done ?? false
  const ontology = useExtendedOntology(sectorId)

  // ── Backend sources state
  const [sources, setSources] = useState<BackendSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourcesError, setSourcesError] = useState<string | null>(null)

  // ── Quality profiles
  const [tableProfiles, setTableProfiles] = useState<Record<string, TableProfile>>({})
  const [profilingLoading, setProfilingLoading] = useState(false)

  // ── Quality rules (live mode)
  const [qualityRules, setQualityRules] = useState<QualityRule[]>(() => loadQualityRules())
  useEffect(() => {
    const handler = () => setQualityRules(loadQualityRules())
    window.addEventListener('quality-rules-updated', handler)
    return () => window.removeEventListener('quality-rules-updated', handler)
  }, [])

  const handleUpdateRule = useCallback((rule: QualityRule) => {
    setQualityRules(prev => {
      const next = upsertRule(prev, rule)
      saveQualityRules(next)
      return next
    })
  }, [])

  const handleRemoveRule = useCallback((tableKey: string, columnName: string) => {
    setQualityRules(prev => {
      const next = removeRule(prev, tableKey, columnName)
      saveQualityRules(next)
      return next
    })
  }, [])

  // ── Review queue (Step 6, live mode)
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>(() =>
    IS_DEMO_MODE ? [] : loadReviewQueue(sectorId)
  )
  useEffect(() => {
    if (IS_DEMO_MODE) return
    const handler = () => setReviewItems(loadReviewQueue(sectorId))
    window.addEventListener('review-queue-updated', handler)
    return () => window.removeEventListener('review-queue-updated', handler)
  }, [sectorId])

  const handleUpdateReview = useCallback((id: string, status: ReviewStatus, notes: string) => {
    updateReviewItem(sectorId, id, status, notes)
    setReviewItems(loadReviewQueue(sectorId))
  }, [sectorId])

  const handleCertifyAll = useCallback(() => {
    certifyAll(sectorId)
    setReviewItems(loadReviewQueue(sectorId))
  }, [sectorId])

  // ── Evolution feedback (Step 8, live mode)
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>(() =>
    IS_DEMO_MODE ? [] : loadFeedback(sectorId)
  )
  useEffect(() => {
    if (IS_DEMO_MODE) return
    const handler = () => setFeedbackItems(loadFeedback(sectorId))
    window.addEventListener('evolution-feedback-updated', handler)
    return () => window.removeEventListener('evolution-feedback-updated', handler)
  }, [sectorId])

  const handleAddFeedback = useCallback((kind: FeedbackKind, title: string, notes: string) => {
    addFeedback(sectorId, kind, title, notes)
    setFeedbackItems(loadFeedback(sectorId))
  }, [sectorId])

  const handleResolveFeedback = useCallback((id: string) => {
    resolveFeedback(sectorId, id)
    setFeedbackItems(loadFeedback(sectorId))
  }, [sectorId])

  // ── User-added ontology entity count (reactive signal for the workbench rail)
  const [extNodeCount, setExtNodeCount] = useState(() =>
    IS_DEMO_MODE ? 0 : loadExtension(sectorId).nodes.length
  )
  useEffect(() => {
    if (IS_DEMO_MODE) return
    const refresh = () => setExtNodeCount(loadExtension(sectorId).nodes.length)
    refresh()
    window.addEventListener('ontology-entity-added', refresh)
    window.addEventListener('ontology-builder-changed', refresh)
    return () => {
      window.removeEventListener('ontology-entity-added', refresh)
      window.removeEventListener('ontology-builder-changed', refresh)
    }
  }, [sectorId])

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

  const refreshProfiles = useCallback(() => {
    if (IS_DEMO_MODE) return
    setProfilingLoading(true)
    getSourceProfiles()
      .then(setTableProfiles)
      .catch(() => {})
      .finally(() => setProfilingLoading(false))
  }, [])

  // ── Auto-profile when user sources become active
  useEffect(() => {
    if (IS_DEMO_MODE) return
    const hasActive = sources.some(s => !s.is_default && s.status === 'active')
    if (!hasActive) return
    refreshProfiles()
  }, [sources, refreshProfiles])

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

  const BUILD_STEPS = ['Scanning data sources…', 'Building data model…', 'Extracting metrics & relations…']

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

  // ── Workbench rail: derive the 8-step pipeline status from live signals.
  const scrollRef = useRef<HTMLDivElement>(null)
  const jumpTo = useCallback((anchor: string) => {
    scrollRef.current?.querySelector(`#${anchor}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const workbenchSteps = useMemo<WorkbenchStep[]>(() => {
    const hasActiveSources = sources.some(s => !s.is_default && s.status === 'active')
    const hasProfiled = Object.keys(tableProfiles).length > 0
    const hasQualityRules = qualityRules.length > 0
    const hasEntities = extNodeCount > 0
    const reviewEngaged = reviewItems.length > 0 && reviewItems.every(i => i.status !== 'pending')

    const defs: Omit<WorkbenchStep, 'status'>[] = [
      { n: 1, phase: 'SETUP',   label: 'Discovery',  anchor: 'wb-connect' },
      { n: 2, phase: 'SETUP',   label: 'Sources',    anchor: 'wb-sources' },
      { n: 3, phase: 'BUILD',   label: 'Profiling',  anchor: 'wb-sources' },
      { n: 4, phase: 'BUILD',   label: 'Quality',    anchor: 'wb-sources' },
      { n: 5, phase: 'BUILD',   label: 'Data Model', anchor: 'wb-step5' },
      { n: 6, phase: 'BUILD',   label: 'Review',     anchor: 'wb-step6' },
      { n: 7, phase: 'OPERATE', label: 'Activation', anchor: 'wb-step7' },
      { n: 8, phase: 'OPERATE', label: 'Evolution',  anchor: 'wb-step8' },
    ]
    const doneRaw = [
      true, hasActiveSources, hasProfiled, hasQualityRules,
      hasEntities, reviewEngaged, semBuilt, semBuilt,
    ]
    // High-water mark: the frontier is the first not-done step after the last
    // done one. Optional steps (e.g. quality) auto-complete once you move past.
    let lastDone = -1
    doneRaw.forEach((d, i) => { if (d) lastDone = i })
    return defs.map((d, i) => ({
      ...d,
      status: (i <= lastDone ? 'done' : i === lastDone + 1 ? 'current' : 'upcoming') as StepStatus,
    }))
  }, [sources, tableProfiles, qualityRules, extNodeCount, reviewItems, semBuilt])

  const statusByN = useMemo(() => {
    const m: Record<number, StepStatus> = {}
    workbenchSteps.forEach(s => { m[s.n] = s.status })
    return m
  }, [workbenchSteps])

  // ── Celebrate when a pipeline step completes (skips the initial mount count).
  const prevDoneRef = useRef<number>(-1)
  useEffect(() => {
    if (IS_DEMO_MODE) return
    const done = workbenchSteps.filter(s => s.status === 'done').length
    if (prevDoneRef.current === -1) { prevDoneRef.current = done; return }
    if (done > prevDoneRef.current) {
      const justCompleted = workbenchSteps[done - 1]
      if (justCompleted) {
        globalToast(
          done === workbenchSteps.length
            ? '🎉 Your data model is live — every step complete!'
            : `✓ ${justCompleted.label} complete · ${done}/${workbenchSteps.length} done`,
          'success',
        )
      }
    }
    prevDoneRef.current = done
  }, [workbenchSteps])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 flex-shrink-0 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{IS_DEMO_MODE ? 'Data Sources' : 'Data Workbench'}</h1>
          <p className="text-slate-500 mt-1 text-sm">
            {IS_DEMO_MODE
              ? `${workspaceLabel(sector.name)} · Connect business systems or upload files — data loads automatically and becomes queryable instantly`
              : `${workspaceLabel(sector.name)} · From raw sources to a governed, queryable data model — one guided pipeline`}
          </p>
        </div>
        {!IS_DEMO_MODE && (
          <div className="hidden md:flex items-center gap-2 flex-shrink-0">
            <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
              semBuilt
                ? 'bg-teal-50 text-teal-700 border-teal-200'
                : 'bg-slate-50 text-slate-500 border-slate-200'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${semBuilt ? 'bg-teal-500' : 'bg-slate-300'}`} />
              {semBuilt ? 'Operational' : 'Setup in progress'}
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-8 py-6 space-y-6">

        {/* Workbench pipeline rail (live mode — orchestrates the 8-step flow) */}
        {!IS_DEMO_MODE && (
          <WorkbenchRail steps={workbenchSteps} onJump={jumpTo} />
        )}

        {/* Guided empty state — no user sources connected yet */}
        {!IS_DEMO_MODE && !sourcesLoading && sources.filter(s => !s.is_default).length === 0 && (
          <GuidedEmptyState onConnect={() => jumpTo('wb-connect')} />
        )}

        {/* AW active sources (manufacturing demo only) */}
        {IS_DEMO_MODE && sectorId === 'manufacturing' && <AWSourcesPanel />}

        {/* Sources error */}
        {sourcesError && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {sourcesError}
          </div>
        )}

        {/* Connected sources from backend — hidden in live mode when empty
            (the GuidedEmptyState above covers that case) */}
        {(IS_DEMO_MODE || sources.filter(s => !s.is_default).length > 0) && (
          <section id="wb-sources" className="scroll-mt-4">
            <CollapsibleStage
              token="2–4"
              phase="Setup → Build"
              title="Sources, Profiling & Quality"
              status={statusByN[3]}
              summary={`${sources.filter(s => !s.is_default).length} sources · ${Object.keys(tableProfiles).length} tables profiled`}
              trailing={sourcesLoading
                ? <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />
                : <span className="t-mini text-slate-400">{sources.filter(s => !s.is_default).length} active</span>}
            >
              <ConnectedSourcesPanel
                sources={sources}
                onDisconnect={disconnectSource}
                onSync={syncById}
                tableProfiles={tableProfiles}
                profilingLoading={profilingLoading}
                onRefreshProfiles={refreshProfiles}
                qualityRules={qualityRules}
                onUpdateRule={handleUpdateRule}
                onRemoveRule={handleRemoveRule}
              />
            </CollapsibleStage>
          </section>
        )}

        {/* Step 5: AI-Assisted Ontology Generation */}
        {!IS_DEMO_MODE && sources.some(s => !s.is_default && s.status === 'active') && (
          <section id="wb-step5" className="scroll-mt-4">
            <CollapsibleStage
              token="5"
              phase="Build"
              title="AI Data Model"
              status={statusByN[5]}
              summary={`${extNodeCount} ${extNodeCount === 1 ? 'entity' : 'entities'} in model`}
            >
              <OntologyGenerationPanel
                sectorId={sectorId}
                onNavigateToOntology={() => onNavigate?.('sembuilder')}
              />
            </CollapsibleStage>
          </section>
        )}

        {/* Step 6: Human Review & Maintainment */}
        {!IS_DEMO_MODE && reviewItems.length > 0 && (
          <section id="wb-step6" className="scroll-mt-4">
            <CollapsibleStage
              token="6"
              phase="Build"
              title="Human Review"
              status={statusByN[6]}
              summary={`${reviewItems.filter(i => i.status === 'certified').length}/${reviewItems.length} certified`}
            >
              <ReviewPanel
                items={reviewItems}
                onUpdate={handleUpdateReview}
                onCertifyAll={handleCertifyAll}
              />
            </CollapsibleStage>
          </section>
        )}

        {/* Step 7: Activation & Onboarding */}
        {!IS_DEMO_MODE && sources.some(s => !s.is_default && s.status === 'active') && (() => {
          const hasProfiled = Object.keys(tableProfiles).length > 0
          const hasEntities = extNodeCount > 0
          const allCertified = reviewItems.length === 0 || reviewItems.every(i => i.status !== 'pending')
          const checks: ReadinessCheck[] = [
            {
              label: 'Data sources connected',
              done: true,
              hint: 'Connect at least one data source',
              actionLabel: 'Connect source',
            },
            {
              label: 'Sources profiled & quality reviewed',
              done: hasProfiled,
              hint: 'Expand a connected source to run profiling',
            },
            {
              label: 'AI data model generated',
              done: hasEntities,
              hint: 'Run "Generate Data Model" in the AI Data Model section above',
            },
            {
              label: 'Ontology items certified',
              done: allCertified,
              hint: 'Certify all items in the Human Review section above',
            },
            {
              label: 'Semantic layer built',
              done: semBuilt,
              hint: 'Build the semantic layer to make data queryable',
            },
          ]
          const allReady = checks.every(c => c.done)
          const doneChecks = checks.filter(c => c.done).length
          return (
            <section id="wb-step7" className="scroll-mt-4">
              <CollapsibleStage
                token="7"
                phase="Operate"
                title="Activation"
                status={statusByN[7]}
                summary={semBuilt ? 'Semantic layer built' : `${doneChecks}/${checks.length} checks ready`}
              >
                <ActivationReadinessPanel
                  checks={checks}
                  allReady={allReady}
                  onActivate={handleBuildSemanticLayer}
                  activating={building}
                />
              </CollapsibleStage>
            </section>
          )
        })()}

        {/* Step 8: Continuous Evolution */}
        {!IS_DEMO_MODE && semBuilt && (
          <section id="wb-step8" className="scroll-mt-4">
            <CollapsibleStage
              token="8"
              phase="Operate"
              title="Continuous Evolution"
              status={statusByN[8]}
              summary={`${feedbackItems.filter(f => f.status === 'open').length} open · monitoring active`}
            >
              <ContinuousEvolutionPanel
                sources={sources.filter(s => !s.is_default)}
                feedbackItems={feedbackItems}
                onAddFeedback={handleAddFeedback}
                onResolve={handleResolveFeedback}
              />
            </CollapsibleStage>
          </section>
        )}

        {/* Build progress (both modes) + idle trigger (demo only — live uses Step 7 Activation) */}
        {sources.length > 0 && (building || IS_DEMO_MODE) && (
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
        <section id="wb-connect" className="scroll-mt-4">
          <div className="flex items-center justify-between mb-3 gap-4 flex-wrap">
            {IS_DEMO_MODE ? (
              <div className="flex items-center gap-2">
                <Plug className="w-4 h-4 text-slate-500" />
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Connect a New Source</h2>
                <span className="text-xs text-slate-400">· {CONNECTORS.filter(c => c.status !== 'coming-soon').length} integrations</span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <StatusToken token="2" status={statusByN[2]} />
                <div>
                  <span className="eyebrow text-slate-400">Setup</span>
                  <h2 className="text-sm font-bold text-slate-800 leading-tight">
                    Connect a Source
                    <span className="ml-2 t-mini font-normal text-slate-400">{CONNECTORS.filter(c => c.status !== 'coming-soon').length} integrations</span>
                  </h2>
                </div>
              </div>
            )}
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
