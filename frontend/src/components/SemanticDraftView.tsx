import { useState, useEffect } from 'react'
import {
  Database, GitBranch, BarChart3, FileText,
  Edit2, Check, X, Plus, Trash2, Loader2, RefreshCw,
} from 'lucide-react'
import {
  getDraft, patchDraftEntity, patchDraftMetric,
  addContextDoc, deleteContextDoc,
  type SemanticDraft, type DraftEntity, type DraftMetric, type ContextDoc,
} from '../api/semantic'

type DraftTab = 'entities' | 'relations' | 'metrics' | 'context'

export function SemanticDraftView() {
  const [draft, setDraft] = useState<SemanticDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<DraftTab>('entities')

  useEffect(() => { loadDraft() }, [])

  async function loadDraft() {
    setLoading(true)
    try { setDraft(await getDraft()) } catch { /* backend offline */ }
    finally { setLoading(false) }
  }

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-slate-500 p-6">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading semantic layer draft…
    </div>
  )

  if (!draft?.loaded) return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center mb-6">
      <p className="text-sm text-slate-500 font-medium">Semantic layer not built yet.</p>
      <p className="text-xs text-slate-400 mt-1">Go to Sources and click "Build Semantic Layer".</p>
    </div>
  )

  const tabs: { id: DraftTab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'entities', label: 'Entities', icon: <Database className="w-3.5 h-3.5" />, count: draft.entities.length },
    { id: 'relations', label: 'Relations', icon: <GitBranch className="w-3.5 h-3.5" />, count: draft.relations.length },
    { id: 'metrics', label: 'Metrics', icon: <BarChart3 className="w-3.5 h-3.5" />, count: draft.metrics.length },
    { id: 'context', label: 'Context', icon: <FileText className="w-3.5 h-3.5" />, count: draft.context_docs.length },
  ]

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden mb-6">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-800">Semantic Layer — Schema Config</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Auto-extracted · {draft.entities.length} entities · {draft.relations.length} relations · edit to refine
          </p>
        </div>
        <button
          onClick={loadDraft}
          className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-50"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
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
        {activeTab === 'entities' && <EntitiesTab entities={draft.entities} onUpdate={loadDraft} />}
        {activeTab === 'relations' && <RelationsTab relations={draft.relations} />}
        {activeTab === 'metrics' && <MetricsTab metrics={draft.metrics} onUpdate={loadDraft} />}
        {activeTab === 'context' && <ContextDocsTab docs={draft.context_docs} onUpdate={loadDraft} />}
      </div>
    </div>
  )
}

// ── Entities tab ──────────────────────────────────────────────────────────────

function EntitiesTab({ entities, onUpdate }: { entities: DraftEntity[]; onUpdate: () => void }) {
  if (entities.length === 0) return <p className="text-sm text-slate-400">No entities detected.</p>
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
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 hover:bg-slate-100 text-left gap-3"
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
                  placeholder={`e.g. "Only include ${entity.name} records where status='active'. Exclude test records."`}
                  className="w-full text-xs border border-slate-200 rounded-md p-2 outline-none focus:border-teal-400 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs rounded-md transition-colors">
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                </button>
                <button onClick={() => { setEditing(false); setUserDesc(entity.user_description); setCtxNotes(entity.context_notes) }}
                  className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 text-slate-600 text-xs rounded-md hover:bg-slate-50">
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
              <button onClick={() => setEditing(true)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded hover:bg-slate-50 flex-shrink-0">
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
    <p className="text-sm text-slate-400">
      No relations detected. FK edges are auto-detected from column names ending in _id, _ref, _fk.
    </p>
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
  if (metrics.length === 0) return <p className="text-sm text-slate-400">No metrics defined yet.</p>
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
    } catch { /* ignore */ } finally { setSaving(false) }
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
              <input value={label} onChange={e => setLabel(e.target.value)}
                placeholder="Display label" className="w-full text-xs border border-slate-200 rounded p-1.5 outline-none focus:border-teal-400" />
              <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
                placeholder="Description" className="w-full text-xs border border-slate-200 rounded p-1.5 outline-none focus:border-teal-400 resize-none" />
              <input value={formula} onChange={e => setFormula(e.target.value)}
                placeholder="SQL formula, e.g. SUM(table.column)" className="w-full font-mono text-xs border border-slate-200 rounded p-1.5 outline-none focus:border-teal-400" />
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs rounded-md">
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                </button>
                <button onClick={() => { setEditing(false); setLabel(metric.label); setDesc(metric.description); setFormula(metric.formula) }}
                  className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 text-slate-600 text-xs rounded-md hover:bg-slate-50">
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
          <button onClick={() => setEditing(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded hover:bg-slate-50 flex-shrink-0">
            <Edit2 className="w-3 h-3" /> Edit
          </button>
        )}
      </div>
    </div>
  )
}

// ── Context docs tab ──────────────────────────────────────────────────────────

function ContextDocsTab({ docs, onUpdate }: { docs: ContextDoc[]; onUpdate: () => void }) {
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
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    try { await deleteContextDoc(id); onUpdate() } catch { /* ignore */ }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Context documents are injected into LLM prompts when generating SQL. Add business rules, glossary definitions, or domain constraints.
      </p>

      {docs.map(d => (
        <div key={d.id} className="rounded-lg border border-slate-200 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800">{d.title}</p>
              <p className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{d.content}</p>
            </div>
            <button onClick={() => handleDelete(d.id)}
              className="text-slate-400 hover:text-red-500 p-1 flex-shrink-0 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3 space-y-2">
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
            placeholder="Document title…"
            className="w-full text-xs border border-slate-200 rounded p-2 outline-none focus:border-teal-400 bg-white" />
          <textarea value={newContent} onChange={e => setNewContent(e.target.value)} rows={4}
            placeholder="Business context, glossary entries, domain rules…"
            className="w-full text-xs border border-slate-200 rounded p-2 outline-none focus:border-teal-400 resize-none bg-white" />
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={saving || !newTitle.trim() || !newContent.trim()}
              className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs rounded-md">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Add
            </button>
            <button onClick={() => { setAdding(false); setNewTitle(''); setNewContent('') }}
              className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 text-slate-600 text-xs rounded-md hover:bg-slate-50">
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:border-teal-400 hover:text-teal-600 w-full transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add context document
        </button>
      )}
    </div>
  )
}
