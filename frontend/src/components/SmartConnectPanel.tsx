/**
 * SmartConnectPanel — Smart Connect Step 2 & 3.
 *
 * Calls POST /api/semantic/analyze, shows the AI-proposed data model
 * (entities, metrics, relations) with all items pre-checked, lets the user
 * deselect what they don't want, then applies the approved subset:
 *   - Entities   → saved to the ontology extension (localStorage + backend)
 *   - Metrics    → created via POST /api/semantic/metrics
 *   - Relations  → created via POST /api/semantic/draft/relations
 */

import { useState, useCallback } from 'react'
import { Sparkles, Loader2, CheckCircle2, ChevronRight, BarChart2, Link2, Box, AlertCircle, RotateCcw } from 'lucide-react'
import { analyzeSources, createMetric, addRelation, type AnalyzeResult, type EntityProposal, type MetricProposal, type RelationProposal } from '../api/semantic'
import { loadExtension, saveExtension } from '../data/ontologyExtensions'

// ── Types ─────────────────────────────────────────────────────────────────────

type PanelState = 'idle' | 'loading' | 'review' | 'applying' | 'done' | 'error'
type ReviewTab  = 'entities' | 'metrics' | 'relations'

interface Props {
  sectorId: string   // used to scope ontology extension storage
  onApplied?: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function confColor(c: number): string {
  if (c >= 0.80) return 'bg-teal-400'
  if (c >= 0.55) return 'bg-amber-400'
  return 'bg-slate-300'
}
function confLabel(c: number): string {
  if (c >= 0.80) return 'High'
  if (c >= 0.55) return 'Medium'
  return 'Low'
}

function initialSelected<T extends { confidence: number }>(items: T[]): Set<number> {
  return new Set(items.map((_, i) => i))
}

/** Turn a camelCase or snake_case label into a readable sentence. */
function humanize(s: string): string {
  return s.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfidenceBadge({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
      <span className={`w-1.5 h-1.5 rounded-full ${confColor(value)}`} />
      {confLabel(value)}
    </span>
  )
}

function EntityRow({ item, checked, onToggle }: { item: EntityProposal; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
      <input type="checkbox" checked={checked} onChange={onToggle}
        className="mt-0.5 w-4 h-4 rounded accent-teal-600 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-800">{item.name}</span>
          <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-1.5 py-0.5 rounded">
            {item.table}
          </span>
          {item.primary_key && (
            <span className="text-[10px] text-violet-600 font-mono bg-violet-50 px-1.5 py-0.5 rounded">
              PK: {item.primary_key}
            </span>
          )}
          <ConfidenceBadge value={item.confidence} />
        </div>
        {item.description && (
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{item.description}</p>
        )}
      </div>
    </label>
  )
}

function MetricRow({ item, checked, onToggle }: { item: MetricProposal; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
      <input type="checkbox" checked={checked} onChange={onToggle}
        className="mt-0.5 w-4 h-4 rounded accent-teal-600 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-800">{humanize(item.name)}</span>
          {item.unit && <span className="text-[10px] text-slate-400">{item.unit}</span>}
          <ConfidenceBadge value={item.confidence} />
        </div>
        {item.description && (
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{item.description}</p>
        )}
        <p className="text-[11px] font-mono text-violet-700 bg-violet-50 px-2 py-0.5 rounded mt-1 truncate">
          {item.formula}
        </p>
      </div>
    </label>
  )
}

function RelationRow({ item, checked, onToggle }: { item: RelationProposal; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
      <input type="checkbox" checked={checked} onChange={onToggle}
        className="mt-0.5 w-4 h-4 rounded accent-teal-600 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-slate-800 font-mono">{item.from_table}</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-slate-800 font-mono">{item.to_table}</span>
          {item.via_column && (
            <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-1.5 py-0.5 rounded">
              via {item.via_column}
            </span>
          )}
          <ConfidenceBadge value={item.confidence} />
        </div>
        {item.description && (
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{item.description}</p>
        )}
      </div>
    </label>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SmartConnectPanel({ sectorId, onApplied }: Props) {
  const [state, setState]       = useState<PanelState>('idle')
  const [result, setResult]     = useState<AnalyzeResult | null>(null)
  const [activeTab, setTab]     = useState<ReviewTab>('entities')
  const [errorMsg, setErrorMsg] = useState('')

  // Selection sets — indices into proposal arrays (all pre-checked)
  const [selEntities,  setSelEntities]  = useState<Set<number>>(new Set())
  const [selMetrics,   setSelMetrics]   = useState<Set<number>>(new Set())
  const [selRelations, setSelRelations] = useState<Set<number>>(new Set())

  const [appliedCount, setAppliedCount] = useState(0)

  // ── Analyze ──────────────────────────────────────────────────────────────

  const runAnalysis = useCallback(async () => {
    setState('loading')
    setErrorMsg('')
    try {
      const res = await analyzeSources()
      setResult(res)
      setSelEntities(initialSelected(res.proposal.entities))
      setSelMetrics(initialSelected(res.proposal.metrics))
      setSelRelations(initialSelected(res.proposal.relations))
      setTab('entities')
      setState('review')
    } catch {
      setErrorMsg('Could not analyze sources — check your connection and try again.')
      setState('error')
    }
  }, [])

  // ── Apply ─────────────────────────────────────────────────────────────────

  const applyProposals = useCallback(async () => {
    if (!result) return
    setState('applying')

    const { entities, metrics, relations } = result.proposal
    const approvedEntities  = entities.filter((_, i) => selEntities.has(i))
    const approvedMetrics   = metrics.filter((_, i) => selMetrics.has(i))
    const approvedRelations = relations.filter((_, i) => selRelations.has(i))

    let saved = 0

    // 1. Entities → ontology extension
    if (approvedEntities.length) {
      const ext = loadExtension(sectorId)
      const existingIds = new Set(ext.nodes.map(n => n.id))
      const newNodes = approvedEntities
        .filter(e => !existingIds.has(`sc-${e.table}`))
        .map((e, i) => ({
          id:         `sc-${e.table}`,
          label:      e.name,
          uri:        `urn:entity:${e.name.toLowerCase().replace(/\s+/g, '_')}`,
          properties: e.primary_key
            ? [{ name: e.primary_key, type: 'string' as const }]
            : [],
          position:   { x: 120 + (i % 4) * 260, y: 120 + Math.floor(i / 4) * 200 },
          db_table:   e.table,
        }))
      if (newNodes.length) {
        saveExtension(sectorId, { ...ext, nodes: [...ext.nodes, ...newNodes] })
        saved += newNodes.length
      }
    }

    // 2. Metrics → sl_metrics
    // formula from the proposal maps to `expression`; type='derived' covers SQL formulas.
    for (const m of approvedMetrics) {
      try {
        await createMetric({
          name:           m.name,
          description:    m.description,
          sector_id:      sectorId,
          type:           'derived',
          entity:         '',
          field:          '',
          numerator:      '',
          denominator:    '',
          expression:     m.formula,
          filters:        [],
          time_dimension: '',
          grains:         ['month', 'quarter', 'year'],
          format:         'number',
          status:         'draft',
          owner:          '',
          tags:           [],
        })
        saved++
      } catch { /* metric may already exist — skip */ }
    }

    // 3. Relations → manual_relations
    for (const r of approvedRelations) {
      try {
        await addRelation({
          from_table:  r.from_table,
          to_table:    r.to_table,
          via_column:  r.via_column,
          edge_type:   'foreign_key',
        })
        saved++
      } catch { /* relation may already exist — skip */ }
    }

    setAppliedCount(saved)
    setState('done')
    window.dispatchEvent(new CustomEvent('ontology-entity-added'))
    window.dispatchEvent(new CustomEvent('pipeline-run-updated'))
    onApplied?.()
  }, [result, selEntities, selMetrics, selRelations, sectorId, onApplied])

  // ── Toggle helpers ────────────────────────────────────────────────────────

  function toggleEntity(i: number) {
    setSelEntities(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s })
  }
  function toggleMetric(i: number) {
    setSelMetrics(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s })
  }
  function toggleRelation(i: number) {
    setSelRelations(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s })
  }

  const totalSelected = selEntities.size + selMetrics.size + selRelations.size

  // ── Render ────────────────────────────────────────────────────────────────

  if (state === 'idle') {
    return (
      <div className="bg-gradient-to-br from-teal-50 to-violet-50 border border-teal-200/60 rounded-xl p-5 flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-4 h-4 text-teal-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">Let AI build your data model</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Analyzes your connected tables and proposes entities, metrics and relations — you review and approve in 30 seconds.
            </p>
          </div>
        </div>
        <button
          onClick={() => void runAnalysis()}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors flex-shrink-0 shadow-sm"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Analyze with AI
        </button>
      </div>
    )
  }

  if (state === 'loading') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center gap-4">
        <Loader2 className="w-5 h-5 text-teal-500 animate-spin flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-slate-800">Analyzing your data sources…</p>
          <p className="text-xs text-slate-400 mt-0.5">Reading schema, profiling quality, consulting AI</p>
        </div>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{errorMsg}</p>
        </div>
        <button onClick={() => void runAnalysis()}
          className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 font-medium transition-colors">
          <RotateCcw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    )
  }

  if (state === 'done') {
    return (
      <div className="bg-teal-50 border border-teal-200 rounded-xl p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-teal-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-teal-800">
              {appliedCount} item{appliedCount !== 1 ? 's' : ''} added to your data model
            </p>
            <p className="text-xs text-teal-600 mt-0.5">
              Entities are in the Entity Graph · Metrics in the Data Model tab · Run Setup to index everything.
            </p>
          </div>
        </div>
        <button onClick={() => { setState('idle'); setResult(null) }}
          className="text-xs text-teal-600 hover:text-teal-700 font-medium transition-colors flex-shrink-0">
          Re-analyze
        </button>
      </div>
    )
  }

  if (state === 'applying') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center gap-4">
        <Loader2 className="w-5 h-5 text-teal-500 animate-spin flex-shrink-0" />
        <p className="text-sm font-semibold text-slate-800">Saving your selections…</p>
      </div>
    )
  }

  // ── state === 'review' ────────────────────────────────────────────────────

  const r = result!
  const totalProposed = r.proposal.entities.length + r.proposal.metrics.length + r.proposal.relations.length
  const TAB_DEFS: { id: ReviewTab; label: string; icon: typeof Box; count: number; sel: number }[] = [
    { id: 'entities',  label: 'Entities',   icon: Box,       count: r.proposal.entities.length,  sel: selEntities.size },
    { id: 'metrics',   label: 'Metrics',    icon: BarChart2, count: r.proposal.metrics.length,   sel: selMetrics.size },
    { id: 'relations', label: 'Connections', icon: Link2,    count: r.proposal.relations.length, sel: selRelations.size },
  ]

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-teal-500" />
          <div>
            <span className="text-sm font-semibold text-slate-800">AI Data Model Proposal</span>
            <span className="text-xs text-slate-400 ml-2">
              {r.source_count} table{r.source_count !== 1 ? 's' : ''} · {totalProposed} proposals
              {!r.llm_used && <span className="ml-1 text-amber-500">(no LLM key — basic analysis)</span>}
            </span>
          </div>
        </div>
        <button onClick={() => { setState('idle'); setResult(null) }}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
          Cancel
        </button>
      </div>

      {/* Quality strip */}
      {Object.keys(r.tables).length > 0 && (
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-4 overflow-x-auto">
          {Object.entries(r.tables).map(([tname, prof]) => (
            <div key={tname} className="flex items-center gap-1.5 flex-shrink-0 text-[11px]">
              <span className="font-mono text-slate-600">{tname}</span>
              <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${prof.quality_score >= 90 ? 'bg-teal-400' : prof.quality_score >= 70 ? 'bg-amber-400' : 'bg-red-400'}`}
                  style={{ width: `${prof.quality_score}%` }} />
              </div>
              <span className="text-slate-400">{prof.quality_score}%</span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-400">{(prof.row_count ?? 0).toLocaleString()} rows</span>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-100">
        {TAB_DEFS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-5 py-3 text-xs font-medium transition-colors border-b-2 ${
              activeTab === t.id
                ? 'border-teal-500 text-teal-600 bg-teal-50/40'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${
              activeTab === t.id ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'
            }`}>
              {t.sel}/{t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Items */}
      <div className="px-2 py-2 max-h-64 overflow-y-auto">
        {activeTab === 'entities' && (
          r.proposal.entities.length === 0
            ? <p className="text-xs text-slate-400 text-center py-6">No entities proposed</p>
            : r.proposal.entities.map((e, i) => (
                <EntityRow key={i} item={e} checked={selEntities.has(i)} onToggle={() => toggleEntity(i)} />
              ))
        )}
        {activeTab === 'metrics' && (
          r.proposal.metrics.length === 0
            ? <p className="text-xs text-slate-400 text-center py-6">No metrics proposed — connect an LLM key for smarter analysis</p>
            : r.proposal.metrics.map((m, i) => (
                <MetricRow key={i} item={m} checked={selMetrics.has(i)} onToggle={() => toggleMetric(i)} />
              ))
        )}
        {activeTab === 'relations' && (
          r.proposal.relations.length === 0
            ? <p className="text-xs text-slate-400 text-center py-6">No relations found — tables may not share key columns</p>
            : r.proposal.relations.map((rel, i) => (
                <RelationRow key={i} item={rel} checked={selRelations.has(i)} onToggle={() => toggleRelation(i)} />
              ))
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-400">
          {totalSelected} of {totalProposed} proposals selected
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (!result) return
              if (totalSelected === totalProposed) {
                setSelEntities(new Set())
                setSelMetrics(new Set())
                setSelRelations(new Set())
              } else {
                setSelEntities(initialSelected(result.proposal.entities))
                setSelMetrics(initialSelected(result.proposal.metrics))
                setSelRelations(initialSelected(result.proposal.relations))
              }
            }}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            {totalSelected === totalProposed ? 'Deselect all' : 'Select all'}
          </button>
          <button
            onClick={() => void applyProposals()}
            disabled={totalSelected === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Apply {totalSelected} proposal{totalSelected !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
