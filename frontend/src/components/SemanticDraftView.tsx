import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Database, GitBranch, BarChart3, FileText, Layers, Zap,
  Edit2, Check, X, Plus, Trash2, Loader2, RefreshCw, Download, ArrowRight,
} from 'lucide-react'
import {
  getDraft, patchDraftEntity, patchDraftMetric,
  addContextDoc, deleteContextDoc,
  createQueryTemplate, updateQueryTemplate, deleteQueryTemplate,
  backendErrorMessage,
  type SemanticDraft, type DraftEntity, type DraftMetric, type ContextDoc,
  type QueryTemplate, type QueryTemplateCreate,
} from '../api/semantic'
import { toast } from './Toast'
import { IS_DEMO_MODE } from '../lib/demoMode'

type DraftTab = 'entities' | 'relations' | 'metrics' | 'context' | 'templates'

export function SemanticDraftView() {
  const [draft, setDraft] = useState<SemanticDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<DraftTab>('entities')
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadDraft = useCallback(async () => {
    setLoading(true)
    try {
      const d = await getDraft()
      setDraft(d)
      // Backend warmup may still be running; poll every 5 s until loaded=true
      if (!d?.loaded) {
        pollRef.current = setTimeout(loadDraft, 5_000)
      }
    } catch {
      toast('Could not load semantic layer — backend may be offline', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDraft()
    return () => { if (pollRef.current) clearTimeout(pollRef.current) }
  }, [loadDraft])

  if (loading) return <LoadingSkeleton />

  if (!draft?.loaded) return <EmptyState />

  const tabs: { id: DraftTab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'entities',  label: 'Entities',  icon: <Database   className="w-3.5 h-3.5" />, count: draft.entities.length },
    { id: 'relations', label: 'Relations', icon: <GitBranch  className="w-3.5 h-3.5" />, count: draft.relations.length },
    { id: 'metrics',   label: 'Metrics',   icon: <BarChart3  className="w-3.5 h-3.5" />, count: draft.metrics.length },
    { id: 'context',   label: 'Context',   icon: <FileText   className="w-3.5 h-3.5" />, count: draft.context_docs.length },
    { id: 'templates', label: 'Query Templates', icon: <Zap className="w-3.5 h-3.5" />, count: draft.templates?.length ?? 0 },
  ]

  function handleExport() {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'semantic-layer-schema.json'; a.click()
    URL.revokeObjectURL(url)
    toast('Schema exported', 'success')
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden mb-6">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-800">Semantic Layer — Schema Config</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Auto-extracted · {draft.entities.length} entities · {draft.relations.length} relations · {draft.metrics.length} metrics · edit to refine
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {!IS_DEMO_MODE && draft.entities.length > 0 && (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: { tab: 'query' } }))}
              className="text-xs text-teal-600 hover:text-teal-700 flex items-center gap-1 px-2 py-1 rounded hover:bg-teal-50 font-medium transition-colors"
              title="Start querying your data"
            >
              Try a query <ArrowRight className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={handleExport}
            className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-50 transition-colors"
            title="Export schema as JSON"
          >
            <Download className="w-3 h-3" /> Export
          </button>
          <button
            onClick={loadDraft}
            className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors flex-shrink-0 ${
              activeTab === t.id
                ? 'border-b-2 border-teal-500 text-teal-700'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.icon} {t.label}
            {t.count !== undefined && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                activeTab === t.id ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4">
        {activeTab === 'entities'  && <EntitiesTab  entities={draft.entities}         onUpdate={loadDraft} />}
        {activeTab === 'relations' && <RelationsTab relations={draft.relations} />}
        {activeTab === 'metrics'   && <MetricsTab   metrics={draft.metrics}            onUpdate={loadDraft} />}
        {activeTab === 'context'   && <ContextDocsTab docs={draft.context_docs}        onUpdate={loadDraft} />}
        {activeTab === 'templates' && <QueryTemplatesTab templates={draft.templates ?? []} onUpdate={loadDraft} />}
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  function goToSources() {
    window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: { tab: 'sources' } }))
  }

  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-gradient-to-b from-slate-50 to-white p-12 text-center space-y-8 mb-6">
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-2xl bg-teal-100 flex items-center justify-center">
          <Layers className="w-8 h-8 text-teal-600" />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-bold text-slate-800">Build Your Semantic Layer</h3>
        <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
          Auto-extract business entities, relationships, and metrics from your data sources.
          The AI uses this knowledge graph to answer natural-language questions accurately.
        </p>
      </div>

      <div className="flex justify-center gap-8">
        <div className="text-center space-y-2">
          <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center mx-auto">
            <Database className="w-5 h-5 text-blue-600" />
          </div>
          <p className="text-xs font-semibold text-slate-700">Entities</p>
          <p className="text-[11px] text-slate-400 leading-tight">Tables as<br />business objects</p>
        </div>
        <div className="text-center space-y-2">
          <div className="w-11 h-11 rounded-xl bg-violet-100 flex items-center justify-center mx-auto">
            <GitBranch className="w-5 h-5 text-violet-600" />
          </div>
          <p className="text-xs font-semibold text-slate-700">Relations</p>
          <p className="text-[11px] text-slate-400 leading-tight">FK edges<br />auto-detected</p>
        </div>
        <div className="text-center space-y-2">
          <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center mx-auto">
            <BarChart3 className="w-5 h-5 text-amber-600" />
          </div>
          <p className="text-xs font-semibold text-slate-700">Metrics</p>
          <p className="text-[11px] text-slate-400 leading-tight">KPIs from<br />your schema</p>
        </div>
      </div>

      <div className="flex items-center justify-center gap-3">
        <p className="text-xs text-slate-400">Start from Data Sources</p>
        <ArrowRight className="w-3 h-3 text-slate-400" />
        <button
          onClick={goToSources}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <Zap className="w-4 h-4" /> Connect &amp; Build
        </button>
      </div>
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden mb-6 animate-pulse">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
        <div className="h-4 w-48 bg-slate-200 rounded" />
        <div className="h-3 w-32 bg-slate-100 rounded" />
      </div>
      <div className="flex border-b border-slate-100 gap-1 px-2 pt-1">
        {[80, 72, 64, 60].map((w, i) => (
          <div key={i} className={`h-8 bg-slate-100 rounded-t mx-1`} style={{ width: w }} />
        ))}
      </div>
      <div className="p-4 space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-12 bg-slate-100 rounded-lg" />
        ))}
      </div>
    </div>
  )
}

// ── Entities tab ──────────────────────────────────────────────────────────────

function EntitiesTab({ entities, onUpdate }: { entities: DraftEntity[]; onUpdate: () => void }) {
  if (entities.length === 0) return (
    <div className="py-8 text-center">
      <p className="text-sm text-slate-400 mb-2">No entities detected yet.</p>
      <p className="text-xs text-slate-400 mb-3 max-w-xs mx-auto">
        Entities are extracted automatically when you connect a data source and run the pipeline.
      </p>
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: { tab: 'sources' } }))}
        className="inline-flex items-center gap-1 text-xs text-teal-600 hover:underline font-medium"
      >
        Connect a data source <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  )
  return (
    <div className="space-y-2">
      {entities.map(e => <EntityCard key={e.name} entity={e} onSaved={onUpdate} />)}
    </div>
  )
}

function EntityCard({ entity, onSaved }: { entity: DraftEntity; onSaved: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [userDesc, setUserDesc] = useState(entity.user_description)
  const [ctxNotes, setCtxNotes] = useState(entity.context_notes)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await patchDraftEntity(entity.name, { user_description: userDesc, context_notes: ctxNotes })
      setEditing(false)
      onSaved()
      toast(`${entity.name} saved`, 'success')
    } catch {
      toast(`Could not save ${entity.name}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 hover:bg-slate-100 text-left gap-3 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-500 flex-shrink-0">{entity.table}</span>
          <span className="text-sm font-semibold text-slate-800 truncate">{entity.name}</span>
          {entity.record_count > 0 && (
            <span className="text-xs text-slate-400 flex-shrink-0">{entity.record_count.toLocaleString()} rows</span>
          )}
          {entity.context_notes && (
            <span className="text-[10px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full flex-shrink-0">context</span>
          )}
        </div>
        <span className="text-slate-400 text-xs flex-shrink-0">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="p-3 space-y-3 border-t border-slate-100">
          {entity.description && (
            <p className="text-xs text-slate-500 italic">{entity.description}</p>
          )}

          {entity.columns.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {entity.columns.slice(0, 20).map(col => (
                <span key={col} className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{col}</span>
              ))}
              {entity.columns.length > 20 && (
                <span className="text-[10px] text-slate-400">+{entity.columns.length - 20} more</span>
              )}
            </div>
          )}

          {editing ? (
            <div className="space-y-2">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Business description</label>
                <textarea
                  value={userDesc}
                  onChange={e => setUserDesc(e.target.value)}
                  rows={2}
                  placeholder="Describe this entity for the team…"
                  className="w-full text-xs border border-slate-200 rounded-md p-2 outline-none focus:border-teal-400 resize-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">
                  Context notes <span className="text-slate-400 font-normal">(injected into LLM prompts)</span>
                </label>
                <textarea
                  value={ctxNotes}
                  onChange={e => setCtxNotes(e.target.value)}
                  rows={3}
                  placeholder={`e.g. "Only include ${entity.name} where status='active'. Exclude test records."`}
                  className="w-full text-xs border border-slate-200 rounded-md p-2 outline-none focus:border-teal-400 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs rounded-md transition-colors"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                </button>
                <button
                  onClick={() => { setEditing(false); setUserDesc(entity.user_description); setCtxNotes(entity.context_notes) }}
                  className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 text-slate-600 text-xs rounded-md hover:bg-slate-50"
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1.5 flex-1 min-w-0">
                {userDesc
                  ? <p className="text-xs text-slate-700">{userDesc}</p>
                  : <p className="text-xs text-slate-400 italic">No business description yet — click Edit to add one</p>
                }
                {ctxNotes && (
                  <div className="text-xs text-teal-700 bg-teal-50 border border-teal-100 rounded p-2">
                    <span className="font-medium">Context: </span>{ctxNotes}
                  </div>
                )}
              </div>
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded hover:bg-slate-50 flex-shrink-0 transition-colors"
              >
                <Edit2 className="w-3 h-3" /> Edit
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Relations tab ─────────────────────────────────────────────────────────────

function RelationsTab({ relations }: { relations: SemanticDraft['relations'] }) {
  if (relations.length === 0) return (
    <div className="py-8 text-center">
      <p className="text-sm text-slate-400 mb-2">No relations detected yet.</p>
      <p className="text-xs text-slate-400 mb-3 max-w-xs mx-auto">
        Cross-source links are auto-inferred from column names ending in <code className="bg-slate-100 px-1 rounded">_id</code>, <code className="bg-slate-100 px-1 rounded">_ref</code>, or <code className="bg-slate-100 px-1 rounded">_fk</code> after a pipeline run.
      </p>
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: { tab: 'sources' } }))}
        className="inline-flex items-center gap-1 text-xs text-teal-600 hover:underline font-medium"
      >
        Connect a data source <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-100 text-left">
            <th className="py-2 px-2 text-slate-500 font-medium">From table</th>
            <th className="py-2 px-2 text-slate-500 font-medium">Via column</th>
            <th className="py-2 px-2 text-slate-500 font-medium">To table</th>
            <th className="py-2 px-2 text-slate-500 font-medium">Type</th>
          </tr>
        </thead>
        <tbody>
          {relations.map((r, i) => (
            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
              <td className="py-1.5 px-2 font-mono text-slate-700">{r.from_table}</td>
              <td className="py-1.5 px-2 font-mono text-teal-600">{r.via_column || '—'}</td>
              <td className="py-1.5 px-2 font-mono text-slate-700">{r.to_table}</td>
              <td className="py-1.5 px-2 text-slate-400 text-[11px]">{r.edge_type}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Metrics tab ───────────────────────────────────────────────────────────────

function MetricsTab({ metrics, onUpdate }: { metrics: DraftMetric[]; onUpdate: () => void }) {
  if (metrics.length === 0) return (
    <div className="py-8 text-center">
      <p className="text-sm text-slate-400 mb-2">No metrics defined yet.</p>
      <p className="text-xs text-slate-400">
        Rebuild the semantic layer from{' '}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: { tab: 'sources' } }))}
          className="text-teal-600 hover:underline"
        >
          Data Sources
        </button>
        {' '}to auto-extract KPIs, or add metrics manually using the Metrics tab in the Semantic Layer builder.
      </p>
    </div>
  )
  return (
    <div className="space-y-2">
      {metrics.map(m => <MetricCard key={m.name} metric={m} onSaved={onUpdate} />)}
    </div>
  )
}

function MetricCard({ metric, onSaved }: { metric: DraftMetric; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(metric.label)
  const [desc, setDesc] = useState(metric.description)
  const [formula, setFormula] = useState(metric.formula)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await patchDraftMetric(metric.name, { label, description: desc, formula })
      setEditing(false)
      onSaved()
      toast(`${metric.name} saved`, 'success')
    } catch {
      toast(`Could not save metric ${metric.name}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-slate-800">{metric.name}</span>
            {metric.unit && (
              <span className="text-[10px] text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">{metric.unit}</span>
            )}
          </div>
          {editing ? (
            <div className="space-y-2 mt-2">
              <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="Display label"
                className="w-full text-xs border border-slate-200 rounded p-1.5 outline-none focus:border-teal-400"
              />
              <textarea
                value={desc}
                onChange={e => setDesc(e.target.value)}
                rows={2}
                placeholder="Description"
                className="w-full text-xs border border-slate-200 rounded p-1.5 outline-none focus:border-teal-400 resize-none"
              />
              <input
                value={formula}
                onChange={e => setFormula(e.target.value)}
                placeholder="SQL formula, e.g. SUM(table.column)"
                className="w-full font-mono text-xs border border-slate-200 rounded p-1.5 outline-none focus:border-teal-400"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs rounded-md transition-colors"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                </button>
                <button
                  onClick={() => { setEditing(false); setLabel(metric.label); setDesc(metric.description); setFormula(metric.formula) }}
                  className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 text-slate-600 text-xs rounded-md hover:bg-slate-50"
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {label && <p className="text-xs font-medium text-slate-600">{label}</p>}
              {desc && <p className="text-xs text-slate-500 mt-0.5">{desc}</p>}
              {formula && (
                <code className="block font-mono text-[10px] text-slate-500 bg-slate-50 rounded px-1.5 py-1 mt-1 truncate">{formula}</code>
              )}
            </>
          )}
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded hover:bg-slate-50 flex-shrink-0 transition-colors"
          >
            <Edit2 className="w-3 h-3" /> Edit
          </button>
        )}
      </div>
    </div>
  )
}

// ── Context docs tab ──────────────────────────────────────────────────────────

const DEMO_CONTEXT_DOCS: ContextDoc[] = IS_DEMO_MODE ? [
  {
    id: '__demo_orion__',
    title: 'OrionSales — Business Context',
    created_at: '',
    content: [
      'Revenue disambiguation:',
      '• "fatturato" / "revenue" = subtotal_amount (~$20.1M net, excl. tax & freight). Use for board-level KPIs.',
      '• "total_due" = SubTotal + TaxAmt + Freight (~$22.4M). Use for customer billing totals.',
      '',
      'CRM deduplication:',
      '• 372 accounts with accountId < 0 are legacy duplicates — always filter WHERE accountId > 0.',
      '• True unique customer count: 19,829 (not 20,201 raw).',
      '',
      'Cross-source bridges:',
      '• ERP ↔ CRM: SalesOrderHeader.CustomerID → account.accountId (PLACED_BY)',
      '• ERP ↔ HR: SalesPersonID → dipendenti_hr.MatricolaDip (SOLD_BY, Italian schema)',
      '• ERP ↔ PIM: SalesOrderLine.ProductID → product_catalog_pim.internal_id (OF_PRODUCT)',
      '',
      'Key figures:',
      '• Top salesperson: Linda Mitchell (ID 276), salesYTD $4,251,368',
      '• Total net revenue 2014: $20,127,627 (subtotal_amount)',
      '• Total gross revenue 2014: $22,380,124 (total_due)',
    ].join('\n'),
  },
] : []

function ContextDocsTab({ docs, onUpdate }: { docs: ContextDoc[]; onUpdate: () => void }) {
  const effectiveDocs = IS_DEMO_MODE && docs.length === 0 ? DEMO_CONTEXT_DOCS : docs
  const isDemoFallback = IS_DEMO_MODE && docs.length === 0
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!newTitle.trim() || !newContent.trim()) return
    setSaving(true)
    try {
      await addContextDoc(newTitle.trim(), newContent.trim())
      setAdding(false)
      setNewTitle('')
      setNewContent('')
      onUpdate()
      toast('Context document added', 'success')
    } catch {
      toast('Could not add context document', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, title: string) {
    try {
      await deleteContextDoc(id)
      onUpdate()
      toast(`"${title}" removed`, 'info')
    } catch {
      toast('Could not delete document', 'error')
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Context documents are injected into LLM prompts when generating SQL. Add business rules, glossary definitions, or domain constraints.
      </p>

      {effectiveDocs.map(d => (
        <div key={d.id} className={`rounded-lg border p-3 ${isDemoFallback ? 'border-teal-200 bg-teal-50/30' : 'border-slate-200'}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-800">{d.title}</p>
                {isDemoFallback && <span className="text-[10px] font-semibold text-teal-600 bg-teal-100 rounded px-1.5 py-0.5">demo</span>}
              </div>
              <p className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{d.content}</p>
            </div>
            {!isDemoFallback && (
              <button
                onClick={() => handleDelete(d.id, d.title)}
                className="text-slate-400 hover:text-red-500 p-1 flex-shrink-0 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      ))}

      {adding ? (
        <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3 space-y-2">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="Document title…"
            className="w-full text-xs border border-slate-200 rounded p-2 outline-none focus:border-teal-400 bg-white"
          />
          <textarea
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            rows={4}
            placeholder="Business context, glossary entries, domain rules…"
            className="w-full text-xs border border-slate-200 rounded p-2 outline-none focus:border-teal-400 resize-none bg-white"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving || !newTitle.trim() || !newContent.trim()}
              className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs rounded-md transition-colors"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Add
            </button>
            <button
              onClick={() => { setAdding(false); setNewTitle(''); setNewContent('') }}
              className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 text-slate-600 text-xs rounded-md hover:bg-slate-50"
            >
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:border-teal-400 hover:text-teal-600 w-full transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add context document
        </button>
      )}
    </div>
  )
}

// ── Query Templates tab ───────────────────────────────────────────────────────────

const BLANK_TEMPLATE: QueryTemplateCreate = {
  name: '', description: '', sql_query: '', keywords: [], sources: [],
}

function QueryTemplatesTab({
  templates, onUpdate,
}: {
  templates: QueryTemplate[]
  onUpdate: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  function startAdd() { setAdding(true); setEditingId(null) }
  function cancelAdd() { setAdding(false) }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Query Templates are auto-generated from your semantic layer at build time and matched by keywords.
        You can add custom ones or edit any template — edited templates survive future rebuilds.
        Use <code className="font-mono bg-slate-100 px-1 rounded">{'{year}'}</code> and{' '}
        <code className="font-mono bg-slate-100 px-1 rounded">{'{limit}'}</code> as safe substitution tokens.
      </p>

      {templates.map(t => (
        <QueryTemplateCard
          key={t.id}
          template={t}
          isEditing={editingId === t.id}
          onEdit={() => { setEditingId(t.id); setAdding(false) }}
          onCancelEdit={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); onUpdate() }}
          onDeleted={() => onUpdate()}
        />
      ))}

      {adding ? (
        <QueryTemplateForm
          initial={BLANK_TEMPLATE}
          onSave={async (data) => {
            await createQueryTemplate(data)
            setAdding(false)
            onUpdate()
            toast('Query template created', 'success')
          }}
          onCancel={cancelAdd}
        />
      ) : (
        <button
          onClick={startAdd}
          className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:border-teal-400 hover:text-teal-600 w-full transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add query template
        </button>
      )}
    </div>
  )
}

function QueryTemplateCard({
  template, isEditing, onEdit, onCancelEdit, onSaved, onDeleted,
}: {
  template: QueryTemplate
  isEditing: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm(`Delete template "${template.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await deleteQueryTemplate(template.id)
      onDeleted()
      toast(`"${template.name}" deleted`, 'info')
    } catch {
      toast('Could not delete template', 'error')
      setDeleting(false)
    }
  }

  if (isEditing) {
    return (
      <QueryTemplateForm
        initial={{
          name: template.name,
          description: template.description,
          sql_query: template.sql_query,
          keywords: template.keywords,
          sources: template.sources,
        }}
        onSave={async (data) => {
          await updateQueryTemplate(template.id, data)
          onSaved()
          toast(`"${template.name}" saved`, 'success')
        }}
        onCancel={onCancelEdit}
      />
    )
  }

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 hover:bg-slate-100 text-left gap-3 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="font-mono text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded flex-shrink-0">
            {template.intent_type}
          </span>
          <span className="text-sm font-semibold text-slate-800 truncate">{template.name}</span>
          {template.auto_generated && (
            <span className="text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full flex-shrink-0">auto</span>
          )}
          {!template.is_active && (
            <span className="text-[10px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full flex-shrink-0">inactive</span>
          )}
        </div>
        <span className="text-slate-400 text-xs flex-shrink-0">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="p-3 space-y-2.5 border-t border-slate-100">
          {template.description && (
            <p className="text-xs text-slate-500">{template.description}</p>
          )}

          {template.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-[10px] text-slate-400 mr-1 self-center">keywords:</span>
              {template.keywords.map(kw => (
                <span key={kw} className="text-[10px] bg-teal-50 text-teal-700 border border-teal-100 px-1.5 py-0.5 rounded-full">{kw}</span>
              ))}
            </div>
          )}

          {template.sources.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-[10px] text-slate-400 mr-1 self-center">sources:</span>
              {template.sources.map(s => (
                <span key={s} className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{s}</span>
              ))}
            </div>
          )}

          <pre className="text-[10px] font-mono text-slate-600 bg-slate-50 border border-slate-100 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
            {template.sql_query}
          </pre>

          <div className="flex gap-2 pt-0.5">
            <button
              onClick={onEdit}
              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
            >
              <Edit2 className="w-3 h-3" /> Edit
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:text-red-600 border border-red-100 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />} Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function QueryTemplateForm({
  initial, onSave, onCancel,
}: {
  initial: QueryTemplateCreate
  onSave: (data: QueryTemplateCreate) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [sqlQuery, setSqlQuery] = useState(initial.sql_query)
  const [keywordsRaw, setKeywordsRaw] = useState(initial.keywords.join(', '))
  const [sourcesRaw, setSourcesRaw] = useState(initial.sources.join(', '))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parseList = (raw: string) =>
    raw.split(',').map(s => s.trim()).filter(Boolean)

  async function handleSave() {
    setError(null)
    if (!name.trim()) { setError('Name is required'); return }
    if (sqlQuery.trim().length < 10) { setError('SQL query must be at least 10 characters'); return }
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        sql_query: sqlQuery.trim(),
        keywords: parseList(keywordsRaw),
        sources: parseList(sourcesRaw),
      })
    } catch (e: unknown) {
      setError(backendErrorMessage(e) || 'Could not save template')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3 space-y-2.5">
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">Name <span className="text-red-400">*</span></label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Top customers by revenue"
          className="w-full text-xs border border-slate-200 rounded p-2 outline-none focus:border-teal-400 bg-white"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">Description</label>
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What this template answers…"
          className="w-full text-xs border border-slate-200 rounded p-2 outline-none focus:border-teal-400 bg-white"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">
          SQL Query <span className="text-red-400">*</span>
          <span className="text-slate-400 font-normal ml-1">
            — use <code className="font-mono bg-slate-100 px-1 rounded">{'{year}'}</code> and{' '}
            <code className="font-mono bg-slate-100 px-1 rounded">{'{limit}'}</code> as tokens
          </span>
        </label>
        <textarea
          value={sqlQuery}
          onChange={e => setSqlQuery(e.target.value)}
          rows={6}
          placeholder={'SELECT customer_name, SUM(amount) AS revenue\nFROM orders\nWHERE YEAR(order_date) = {year}\nGROUP BY customer_name\nORDER BY revenue DESC\nLIMIT {limit}'}
          className="w-full font-mono text-xs border border-slate-200 rounded p-2 outline-none focus:border-teal-400 resize-y bg-white"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">
          Keywords <span className="text-slate-400 font-normal">(comma-separated — trigger this template)</span>
        </label>
        <input
          value={keywordsRaw}
          onChange={e => setKeywordsRaw(e.target.value)}
          placeholder="top customers, migliori clienti, best clients"
          className="w-full text-xs border border-slate-200 rounded p-2 outline-none focus:border-teal-400 bg-white"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">
          Sources <span className="text-slate-400 font-normal">(comma-separated table names)</span>
        </label>
        <input
          value={sourcesRaw}
          onChange={e => setSourcesRaw(e.target.value)}
          placeholder="orders, customers"
          className="w-full text-xs border border-slate-200 rounded p-2 outline-none focus:border-teal-400 bg-white"
        />
      </div>

      {error && (
        <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded px-2 py-1.5">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs rounded-md transition-colors"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 text-slate-600 text-xs rounded-md hover:bg-slate-50"
        >
          <X className="w-3 h-3" /> Cancel
        </button>
      </div>
    </div>
  )
}
