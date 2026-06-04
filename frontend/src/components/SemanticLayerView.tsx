import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Database, GitBranch, AlertTriangle, CheckCircle, Info, Plus, Zap, X,
  Network, MessageSquare, ChevronDown, ChevronRight, ArrowRight,
  BookOpen, FileCode, Play, Layers, Server, Trash2, Edit3, Save,
  Table2, Pencil, Check, Search, Tag, BarChart2, Filter, SlidersHorizontal, TrendingUp, Sigma,
} from 'lucide-react'
import {
  checkBackend, semanticSources,
  getMetrics, createMetric, deleteMetric as apiDeleteMetric,
  getHierarchies, createHierarchy, deleteHierarchy as apiDeleteHierarchy,
  getSegments, createSegment, deleteSegment as apiDeleteSegment,
  ask as backendAsk, adaptAskResult,
  type BackendMetric, type BackendHierarchy, type BackendSegment, type BackendSource,
} from '../api/semantic'
import { useSector } from '../contexts/SectorContext'
import { SemanticDraftView } from './SemanticDraftView'
import { useExtendedOntology, loadExtension, saveExtension, applyNodeChange } from '../data/ontologyExtensions'
import { SECTORS } from '../data/sectors'
import type { OntologyProperty, PropertyType, OntologyNode } from '../types'

// ── Navigation ────────────────────────────────────────────────────────────────

function tryInQueryAI(question: string) {
  sessionStorage.setItem('query-prefill', question)
  window.dispatchEvent(new CustomEvent('navigate-to-query', { detail: { question } }))
}

// ── Persistent: data sources ──────────────────────────────────────────────────

interface SourceDef {
  id: string; name: string; type: string; description: string; tables: string
}

const SOURCE_TYPES = [
  'PostgreSQL', 'MySQL', 'SQLite', 'SQL Server', 'Oracle',
  'MongoDB', 'Snowflake', 'BigQuery', 'Redshift',
  'CSV', 'JSON', 'REST API', 'Other',
]

const SOURCES_KEY = (s: string) => `semantic-sources-${s}`
function loadSources(id: string): SourceDef[] {
  try { return JSON.parse(localStorage.getItem(SOURCES_KEY(id)) ?? '[]') } catch { return [] }
}
function saveSources(id: string, v: SourceDef[]) {
  try { localStorage.setItem(SOURCES_KEY(id), JSON.stringify(v)) } catch { /* quota */ }
}

// ── Persistent: disambiguation rules ─────────────────────────────────────────

interface UserRule {
  id: string; term: string; problem: string
  opt1: string; opt1Desc: string; opt2: string; opt2Desc: string; resolution: string
}

const RULES_KEY = (s: string) => `semantic-rules-${s}`
function loadUserRules(id: string): UserRule[] {
  try { return JSON.parse(localStorage.getItem(RULES_KEY(id)) ?? '[]') } catch { return [] }
}
function saveUserRules(id: string, v: UserRule[]) { localStorage.setItem(RULES_KEY(id), JSON.stringify(v)) }

// ── Live-data helpers (replaced hardcoded AdventureWorks stubs) ───────────────

type _AWSrcType = {
  id: string; name: string; type: string; icon: string
  colorBorder: string; colorBg: string; colorText: string; colorDot: string
  entities: { name: string; rows: number }[]; total: number; warning?: string
}
const AW_SOURCES: _AWSrcType[] = []

type _AWBridgeType = {
  id: number; label: string; cardinality: string; matchRate: number
  from: { source: string; entity: string; field: string }
  to:   { source: string; entity: string; field: string }
  detail: string; note: string; impact: string
}
const AW_BRIDGES: _AWBridgeType[] = []

const AW_ENTITY_DETAIL: Record<string, {
  source: string; semanticAlias?: string
  fields: { semantic: string; physical: string; type: string; note?: string; bridge?: string }[]
}> = {}

const AW_DISAMBIGUATION_RULES: {
  term: string; problem: string
  options: { label: string; value: string; desc: string; semantic: string; recommended: boolean }[]
  resolution: string
}[] = []

const AW_QUERY_EXAMPLES: {
  question: string; path: string[]; bridges: string[]; sql: string; result: string
}[] = []

const AW_QUALITY_ISSUES: {
  severity: 'warning' | 'info'; entity: string; issue: string; resolution: string
}[] = []

// ── Shared helpers ─────────────────────────────────────────────────────────────

function typeChip(t: string): string {
  const map: Record<string, string> = {
    integer: 'bg-blue-50 text-blue-700', decimal: 'bg-violet-50 text-violet-700',
    string: 'bg-slate-100 text-slate-600', boolean: 'bg-amber-50 text-amber-700',
    date: 'bg-teal-50 text-teal-700', datetime: 'bg-teal-50 text-teal-700',
    fk: 'bg-rose-50 text-rose-700', uuid: 'bg-indigo-50 text-indigo-700',
    text: 'bg-slate-100 text-slate-600',
  }
  return map[t] ?? 'bg-slate-100 text-slate-600'
}

const ALL_TYPES: PropertyType[] = ['string', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'uuid', 'text', 'fk']

// ── FieldRow: one property row in view or edit mode ───────────────────────────

function FieldRowView({ prop, isAW }: {
  prop: { semantic: string; physical: string; type: string; note?: string; bridge?: string }
       | OntologyProperty
  isAW: boolean
}) {
  if (isAW) {
    const f = prop as { semantic: string; physical: string; type: string; note?: string; bridge?: string }
    const sameNames = f.semantic === f.physical
    return (
      <div className={`flex items-center gap-2 py-1.5 px-2 rounded-lg text-xs ${f.bridge ? 'bg-teal-50 border border-teal-100' : f.note?.startsWith('⚠') ? 'bg-amber-50 border border-amber-100' : 'hover:bg-slate-50'}`}>
        <span className={`font-mono font-semibold w-36 flex-shrink-0 ${f.bridge ? 'text-teal-700' : 'text-slate-700'}`}>{f.semantic}</span>
        {!sameNames && <><ArrowRight className="w-3 h-3 text-slate-300 flex-shrink-0" /><span className="font-mono text-blue-600 w-36 flex-shrink-0">{f.physical}</span></>}
        <span className="text-[10px] text-slate-400">{f.type}</span>
        {f.bridge && <span className="text-[10px] font-semibold text-teal-600 bg-teal-100 rounded px-1.5 py-0.5 ml-1">⚡ {f.bridge}</span>}
        {f.note && !f.note.startsWith('⚠') && <span className="text-[10px] text-slate-400 italic ml-1">{f.note}</span>}
        {f.note?.startsWith('⚠') && <span className="text-[10px] text-amber-700 font-medium ml-1">{f.note}</span>}
      </div>
    )
  }
  const p = prop as OntologyProperty
  const physical = p.physicalName ?? p.name
  const different = physical !== p.name
  return (
    <div className={`flex items-center gap-2 py-1.5 px-2 rounded-lg text-xs ${p.fkTarget ? 'bg-teal-50 border border-teal-100' : 'hover:bg-slate-50'}`}>
      <span className={`font-mono font-semibold w-36 flex-shrink-0 ${p.fkTarget ? 'text-teal-700' : 'text-slate-700'}`}>{p.name}</span>
      {different
        ? <><ArrowRight className="w-3 h-3 text-slate-300 flex-shrink-0" /><span className="font-mono text-blue-600 w-36 flex-shrink-0">{physical}</span></>
        : <span className="w-3 flex-shrink-0" />}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${typeChip(p.type)}`}>{p.type}</span>
        {p.required && <span className="text-[10px] text-red-500 font-semibold bg-red-50 rounded px-1 py-0.5">required</span>}
        {p.unique   && <span className="text-[10px] text-violet-600 font-semibold bg-violet-50 rounded px-1 py-0.5">unique</span>}
        {p.fkTarget && <span className="text-[10px] font-semibold text-teal-600 bg-teal-100 rounded px-1.5 py-0.5">→ {p.fkTarget}</span>}
      </div>
    </div>
  )
}

// ── FieldEditor: inline table row for editing/adding a property ───────────────

const EMPTY_FIELD = { name: '', physicalName: '', type: 'string' as PropertyType, required: false, unique: false, fkTarget: '' }

function FieldEditor({ field, entityOptions, onChange, onRemove, isNew = false }: {
  field: typeof EMPTY_FIELD
  entityOptions: string[]
  onChange: (f: typeof EMPTY_FIELD) => void
  onRemove?: () => void
  isNew?: boolean
}) {
  const inp = 'w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:border-teal-400 outline-none'
  return (
    <div className={`grid gap-1.5 p-2 rounded-lg ${isNew ? 'bg-teal-50 border border-teal-200' : 'bg-white border border-slate-200'}`}
      style={{ gridTemplateColumns: '1fr 1fr 90px auto auto auto' }}>
      <div>
        {isNew && <p className="text-[10px] text-slate-400 mb-0.5">Semantic name *</p>}
        <input value={field.name} onChange={e => onChange({ ...field, name: e.target.value })}
          placeholder="e.g. customerId" className={`${inp} font-mono font-semibold`} />
      </div>
      <div>
        {isNew && <p className="text-[10px] text-slate-400 mb-0.5">Physical column</p>}
        <input value={field.physicalName} onChange={e => onChange({ ...field, physicalName: e.target.value })}
          placeholder="= semantic name" className={`${inp} font-mono text-blue-700`} />
      </div>
      <div>
        {isNew && <p className="text-[10px] text-slate-400 mb-0.5">Type</p>}
        <select value={field.type} onChange={e => onChange({ ...field, type: e.target.value as PropertyType })}
          className={`${inp} pr-1`}>
          {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="flex flex-col justify-center">
        {isNew && <p className="text-[10px] text-slate-400 mb-0.5">REQ</p>}
        <input type="checkbox" checked={field.required} onChange={e => onChange({ ...field, required: e.target.checked })}
          className="accent-teal-500 mt-1 mx-auto" title="Required" />
      </div>
      <div className="flex flex-col justify-center">
        {isNew && <p className="text-[10px] text-slate-400 mb-0.5">UNQ</p>}
        <input type="checkbox" checked={field.unique} onChange={e => onChange({ ...field, unique: e.target.checked })}
          className="accent-violet-500 mt-1 mx-auto" title="Unique" />
      </div>
      <div className="flex items-center justify-end">
        {onRemove && (
          <button onClick={onRemove} className="text-slate-300 hover:text-red-400 transition-colors mt-0.5">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {field.type === 'fk' && (
        <div className="col-span-6 pl-1">
          <select value={field.fkTarget} onChange={e => onChange({ ...field, fkTarget: e.target.value })}
            className="text-xs border border-rose-200 bg-rose-50 rounded px-2 py-1 focus:border-rose-400 outline-none text-rose-700 font-mono">
            <option value="">→ select target entity</option>
            {entityOptions.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

// ── EntityEditor: inline full editor for any entity ───────────────────────────

function EntityEditor({ nodeId, ontologyNode, sectorId, isBase, entityOptions, onClose }: {
  nodeId: string
  ontologyNode: { label: string; uri: string; db_table: string | null; row_count: number; properties: OntologyProperty[] }
  sectorId: string
  isBase: boolean
  entityOptions: string[]
  onClose: () => void
}) {
  const [label, setLabel] = useState(ontologyNode.label)
  const [dbTable, setDbTable] = useState(ontologyNode.db_table ?? '')
  const [fields, setFields] = useState<typeof EMPTY_FIELD[]>(
    ontologyNode.properties.map(p => ({
      name: p.name,
      physicalName: p.physicalName ?? '',
      type: p.type,
      required: p.required ?? false,
      unique: p.unique ?? false,
      fkTarget: p.fkTarget ?? '',
    }))
  )
  const [newField, setNewField] = useState(EMPTY_FIELD)
  const [addingField, setAddingField] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function saveEntity() {
    const props: OntologyProperty[] = fields.map(f => ({
      name: f.name,
      ...(f.physicalName.trim() && f.physicalName.trim() !== f.name && { physicalName: f.physicalName.trim() }),
      type: f.type,
      ...(f.required && { required: true }),
      ...(f.unique && { unique: true }),
      ...(f.type === 'fk' && f.fkTarget && { fkTarget: f.fkTarget }),
    }))
    applyNodeChange(sectorId, nodeId, {
      label: label.trim() || ontologyNode.label,
      db_table: dbTable.trim() || null,
      properties: props,
    }, isBase)
    onClose()
  }

  function commitNewField() {
    if (!newField.name.trim()) return
    setFields(prev => [...prev, { ...newField }])
    setNewField(EMPTY_FIELD)
    setAddingField(false)
  }

  return (
    <div className="border-t border-teal-200 bg-gradient-to-b from-teal-50 to-white px-4 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-teal-700 uppercase tracking-wide font-bold flex items-center gap-1.5">
          <Edit3 className="w-3 h-3" /> Editing entity
        </p>
        {isBase && <span className="text-[10px] text-slate-400 bg-slate-100 rounded px-2 py-0.5">overrides base definition</span>}
      </div>

      {/* Identity */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-medium text-slate-600 mb-1 block">Semantic name (concept)</label>
          <input value={label} onChange={e => setLabel(e.target.value)}
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white focus:border-teal-400 outline-none font-semibold text-slate-900" />
          <p className="text-[10px] text-slate-400 mt-0.5">What you call this entity in queries</p>
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-600 mb-1 block">Physical table</label>
          <input value={dbTable} onChange={e => setDbTable(e.target.value)}
            placeholder="e.g. crm.accounts or orders"
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white focus:border-teal-400 outline-none font-mono text-blue-700" />
          <p className="text-[10px] text-slate-400 mt-0.5">Actual table/collection name in the DB</p>
        </div>
      </div>

      {/* Field table */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div>
            <p className="text-[11px] font-semibold text-slate-700">Field mappings</p>
            <p className="text-[10px] text-slate-400">Semantic name (how you query) → Physical column (actual DB name)</p>
          </div>
          <button onClick={() => setAddingField(v => !v)}
            className="flex items-center gap-1 text-[11px] text-teal-600 hover:text-teal-700 font-medium transition-colors">
            <Plus className="w-3 h-3" /> Add field
          </button>
        </div>

        {/* Column headers */}
        <div className="grid gap-1.5 px-2 mb-1" style={{ gridTemplateColumns: '1fr 1fr 90px auto auto auto' }}>
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Semantic name</span>
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Physical column</span>
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Type</span>
          <span className="text-[10px] text-slate-400 font-semibold text-center">REQ</span>
          <span className="text-[10px] text-slate-400 font-semibold text-center">UNQ</span>
          <span />
        </div>

        <div className="space-y-1">
          {fields.map((f, i) => (
            <FieldEditor key={i} field={f} entityOptions={entityOptions}
              onChange={updated => setFields(prev => prev.map((x, idx) => idx === i ? updated : x))}
              onRemove={() => setFields(prev => prev.filter((_, idx) => idx !== i))} />
          ))}
        </div>

        {addingField && (
          <div className="mt-2 space-y-1">
            <FieldEditor field={newField} entityOptions={entityOptions} onChange={setNewField} isNew />
            <div className="flex gap-2 px-2">
              <button onClick={commitNewField} disabled={!newField.name.trim()}
                className="text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 disabled:opacity-40 transition-colors font-medium">
                Add field
              </button>
              <button onClick={() => { setAddingField(false); setNewField(EMPTY_FIELD) }}
                className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-2 border-t border-slate-100">
        <button onClick={saveEntity}
          className="flex items-center gap-1.5 text-xs bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium">
          <Save className="w-3.5 h-3.5" /> Save entity
        </button>
        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── EntityCard ─────────────────────────────────────────────────────────────────

function EntityCard({ nodeId, ontologyNode, sectorId, isBase, entityOptions }: {
  nodeId: string
  ontologyNode: { label: string; uri: string; db_table: string | null; row_count: number; properties: OntologyProperty[] }
  sectorId: string
  isBase: boolean
  entityOptions: string[]
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const awDetail = AW_ENTITY_DETAIL[nodeId]

  function toggleEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setOpen(true)
    setEditing(v => !v)
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors">
        {open ? <ChevronDown className="w-4 h-4 text-teal-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900">{ontologyNode.label}</span>
            <span className="text-[10px] font-mono text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">{ontologyNode.uri}</span>
            {awDetail?.semanticAlias && (
              <span className="text-[10px] text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">{awDetail.semanticAlias}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {ontologyNode.db_table && (
            <span className="text-[10px] font-mono text-blue-600 bg-blue-50 rounded px-2 py-0.5">{ontologyNode.db_table}</span>
          )}
          <span className="text-[10px] text-slate-400 tabular-nums">{ontologyNode.properties.length} fields</span>
          {ontologyNode.row_count > 0 && (
            <span className="text-[11px] text-slate-400 tabular-nums">{ontologyNode.row_count.toLocaleString('en-US')} rows</span>
          )}
          <button onClick={toggleEdit}
            className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg transition-colors font-medium ${editing ? 'bg-teal-100 text-teal-700' : 'text-slate-400 hover:text-teal-600 hover:bg-teal-50'}`}>
            <Edit3 className="w-3 h-3" />
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      </button>

      {open && !editing && (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-2">
            {awDetail ? 'Field mapping — semantic → physical' : 'Field definitions — semantic → physical column'}
          </p>
          <div className="space-y-1">
            {awDetail
              ? awDetail.fields.map((f, i) => <FieldRowView key={i} prop={f} isAW />)
              : ontologyNode.properties.map((p, i) => <FieldRowView key={i} prop={p} isAW={false} />)
            }
          </div>
        </div>
      )}

      {open && editing && (
        <EntityEditor
          nodeId={nodeId}
          ontologyNode={ontologyNode}
          sectorId={sectorId}
          isBase={isBase}
          entityOptions={entityOptions}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}

// ── Add Entity Form ───────────────────────────────────────────────────────────

function AddEntityForm({ sectorId, entityOptions, onDone }: {
  sectorId: string
  entityOptions: string[]
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [dbTable, setDbTable] = useState('')
  const [fields, setFields] = useState<typeof EMPTY_FIELD[]>([])
  const [newField, setNewField] = useState(EMPTY_FIELD)
  const [addingField, setAddingField] = useState(false)

  const prefix = sectorId.slice(0, 3).toLowerCase()

  function commitField() {
    if (!newField.name.trim()) return
    setFields(prev => [...prev, { ...newField }])
    setNewField(EMPTY_FIELD)
    setAddingField(false)
  }

  function create() {
    const entityName = name.trim()
    if (!entityName) return
    const props: OntologyProperty[] = fields.map(f => ({
      name: f.name,
      ...(f.physicalName.trim() && f.physicalName.trim() !== f.name && { physicalName: f.physicalName.trim() }),
      type: f.type,
      ...(f.required && { required: true }),
      ...(f.unique && { unique: true }),
      ...(f.type === 'fk' && f.fkTarget && { fkTarget: f.fkTarget }),
    }))
    const ext = loadExtension(sectorId)
    ext.nodes.push({
      id: entityName,
      label: entityName,
      uri: `${prefix}:${entityName}`,
      properties: props,
      position: { x: 1300, y: 350 + ext.nodes.length * 80 },
      db_table: dbTable.trim() || undefined,
    })
    saveExtension(sectorId, ext)
    setName(''); setDbTable(''); setFields([]); setAddingField(false)
    onDone()
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div>
        <p className="text-sm font-semibold text-slate-900 mb-0.5">New semantic entity</p>
        <p className="text-xs text-slate-400">Define an entity with semantic field names that map to your physical database schema.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-medium text-slate-600 mb-1 block">Entity name (semantic) <span className="text-red-400">*</span></label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Invoice, Patient, Contract"
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-slate-50 focus:border-teal-400 outline-none font-semibold" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-600 mb-1 block">Physical table</label>
          <input value={dbTable} onChange={e => setDbTable(e.target.value)} placeholder="e.g. invoices, source.table"
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-slate-50 focus:border-teal-400 outline-none font-mono text-blue-700" />
        </div>
      </div>

      {/* Fields */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-[11px] font-semibold text-slate-700">Field mappings</p>
            <p className="text-[10px] text-slate-400">Define how semantic field names map to physical columns in the database</p>
          </div>
          <button onClick={() => setAddingField(v => !v)}
            className="flex items-center gap-1 text-[11px] text-teal-600 hover:text-teal-700 font-medium transition-colors">
            <Plus className="w-3 h-3" /> Add field
          </button>
        </div>

        {fields.length > 0 && (
          <div className="space-y-1 mb-2">
            <div className="grid gap-1.5 px-2 mb-1" style={{ gridTemplateColumns: '1fr 1fr 90px auto auto auto' }}>
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Semantic name</span>
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Physical column</span>
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Type</span>
              <span className="text-[10px] text-slate-400 font-semibold text-center">REQ</span>
              <span className="text-[10px] text-slate-400 font-semibold text-center">UNQ</span>
              <span />
            </div>
            {fields.map((f, i) => (
              <FieldEditor key={i} field={f} entityOptions={entityOptions}
                onChange={u => setFields(prev => prev.map((x, idx) => idx === i ? u : x))}
                onRemove={() => setFields(prev => prev.filter((_, idx) => idx !== i))} />
            ))}
          </div>
        )}

        {addingField && (
          <div className="space-y-1">
            <FieldEditor field={newField} entityOptions={entityOptions} onChange={setNewField} isNew />
            <div className="flex gap-2 px-2">
              <button onClick={commitField} disabled={!newField.name.trim()}
                className="text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 disabled:opacity-40 transition-colors font-medium">
                Add field
              </button>
              <button onClick={() => { setAddingField(false); setNewField(EMPTY_FIELD) }}
                className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
            </div>
          </div>
        )}

        {fields.length === 0 && !addingField && (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg px-4 py-3 text-center">
            <p className="text-xs text-slate-400">No fields defined yet.</p>
            <button onClick={() => setAddingField(true)} className="text-xs text-teal-600 hover:text-teal-700 font-medium mt-1 transition-colors">
              + Add your first field
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1 border-t border-slate-100">
        <button onClick={create} disabled={!name.trim()}
          className="flex items-center gap-1.5 text-xs bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-40 transition-colors font-medium">
          <Plus className="w-3.5 h-3.5" /> Create entity
        </button>
        <button onClick={onDone} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Intra-DB Relations data ───────────────────────────────────────────────────
// Derived from the live semantic draft in the main component; this empty array
// is only used as a type anchor — see `liveRelationGroups` derived from draft.
const AW_RELATIONS: {
  source: string; sourceKey: string
  colorBorder: string; colorBg: string; colorText: string; colorDot: string; icon: string
  relations: { from: string; to: string; via: string; cardinality: '1:N' | 'N:1'; fromRows: number; toRows: number; note: string; soft?: boolean }[]
}[] = []

// ── Bridges Builder ───────────────────────────────────────────────────────────

function BridgesBuilder({ sectorId, entityOptions }: { sectorId: string; entityOptions: string[] }) {
  const [edges, setEdges] = useState(() => loadExtension(sectorId).edges)
  const [form, setForm] = useState({ from: '', to: '', label: '' })

  useEffect(() => {
    const refresh = () => setEdges(loadExtension(sectorId).edges)
    window.addEventListener('ontology-builder-changed', refresh)
    return () => window.removeEventListener('ontology-builder-changed', refresh)
  }, [sectorId])

  function add() {
    if (!form.from || !form.to || !form.label) return
    const ext = loadExtension(sectorId)
    ext.edges.push({ id: `custom-${Date.now()}`, source: form.from, target: form.to, label: form.label })
    saveExtension(sectorId, ext)
    setForm({ from: '', to: '', label: '' })
  }

  function remove(id: string) {
    const ext = loadExtension(sectorId)
    ext.edges = ext.edges.filter(e => e.id !== id)
    saveExtension(sectorId, ext)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">A bridge is a semantic join between two entities that live in different physical systems. Bridges are persisted and visible in the ontology graph.</p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[11px] font-medium text-slate-600 mb-1 block">From entity</label>
          <select value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))}
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-slate-50 focus:border-teal-400 outline-none">
            <option value="">Select…</option>
            {entityOptions.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-600 mb-1 block">Bridge label</label>
          <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value.toUpperCase() }))}
            placeholder="e.g. BELONGS_TO"
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-slate-50 focus:border-teal-400 outline-none font-mono" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-600 mb-1 block">To entity</label>
          <select value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-slate-50 focus:border-teal-400 outline-none">
            <option value="">Select…</option>
            {entityOptions.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
      </div>
      <button onClick={add} disabled={!form.from || !form.to || !form.label}
        className="text-xs bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-40 transition-colors font-medium">
        Add bridge
      </button>
      {edges.length > 0 && (
        <div className="space-y-2">
          {edges.map(e => (
            <div key={e.id} className="flex items-center gap-2 text-xs bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
              <span className="text-slate-700 font-semibold flex-1">{e.source}</span>
              <span className="text-violet-600 font-bold font-mono">— {e.label} →</span>
              <span className="text-slate-700 font-semibold flex-1 text-right">{e.target}</span>
              <button onClick={() => remove(e.id)} className="text-slate-300 hover:text-red-400 transition-colors ml-2">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Rules Builder ─────────────────────────────────────────────────────────────

const EMPTY_RULE = { term: '', problem: '', opt1: '', opt1Desc: '', opt2: '', opt2Desc: '', resolution: '' }

function RulesBuilder({ sectorId }: { sectorId: string }) {
  const [rules, setRules] = useState<UserRule[]>(() => loadUserRules(sectorId))
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_RULE)

  function add() {
    if (!form.term.trim() || !form.opt1.trim() || !form.opt2.trim()) return
    const updated = [...rules, { id: `rule-${Date.now()}`, ...form }]
    setRules(updated); saveUserRules(sectorId, updated)
    setForm(EMPTY_RULE); setOpen(false)
  }

  function remove(id: string) {
    const updated = rules.filter(r => r.id !== id)
    setRules(updated); saveUserRules(sectorId, updated)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Define disambiguation rules for business terms that map to multiple physical fields. The Query AI uses these to ask the right follow-up question before running a query.</p>
      {rules.length === 0 && !open && (
        <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl px-4 py-5 text-center">
          <p className="text-sm text-slate-400">No rules defined yet.</p>
          <p className="text-xs text-slate-400 mt-0.5">Example: "revenue" could mean net sales or gross billing — add a rule to disambiguate.</p>
          <button onClick={() => setOpen(true)} className="mt-3 text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors">
            + Add first rule
          </button>
        </div>
      )}
      {rules.map(rule => (
        <div key={rule.id} className="bg-white border border-amber-200 rounded-xl p-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="text-sm font-semibold text-slate-900 font-mono">"{rule.term}"</p>
              {rule.problem && <p className="text-xs text-slate-500 mt-0.5">{rule.problem}</p>}
            </div>
            <button onClick={() => remove(rule.id)} className="text-slate-300 hover:text-red-400 transition-colors flex-shrink-0">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            {[{ l: rule.opt1, d: rule.opt1Desc, a: true }, { l: rule.opt2, d: rule.opt2Desc, a: false }].map((o, i) => (
              <div key={i} className={`border rounded-lg p-2 ${o.a ? 'border-teal-200 bg-teal-50' : 'border-slate-200 bg-slate-50'}`}>
                <p className="text-[10px] font-mono font-bold text-slate-700">{o.l}</p>
                {o.d && <p className="text-[10px] text-slate-500 mt-0.5">{o.d}</p>}
              </div>
            ))}
          </div>
          {rule.resolution && (
            <div className="flex items-start gap-1.5 text-[11px] text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-2.5 py-1.5">
              <CheckCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />{rule.resolution}
            </div>
          )}
        </div>
      ))}
      {rules.length > 0 && !open && (
        <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add rule
        </button>
      )}
      {open && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-amber-800">New disambiguation rule</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-[11px] font-medium text-slate-600 mb-1 block">Ambiguous term <span className="text-red-400">*</span></label>
              <input value={form.term} onChange={e => setForm(f => ({ ...f, term: e.target.value }))}
                placeholder='e.g. "revenue" / "fatturato"'
                className="w-full text-xs border border-amber-200 rounded-lg px-2 py-2 bg-white focus:border-amber-400 outline-none font-mono" />
            </div>
            <div className="col-span-2">
              <label className="text-[11px] font-medium text-slate-600 mb-1 block">Why is it ambiguous?</label>
              <input value={form.problem} onChange={e => setForm(f => ({ ...f, problem: e.target.value }))}
                placeholder="e.g. maps to two columns with different values"
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white focus:border-teal-400 outline-none" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-600 mb-1 block">Option A <span className="text-red-400">*</span></label>
              <input value={form.opt1} onChange={e => setForm(f => ({ ...f, opt1: e.target.value }))}
                placeholder="e.g. subtotalAmount" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white focus:border-teal-400 outline-none font-mono mb-1" />
              <input value={form.opt1Desc} onChange={e => setForm(f => ({ ...f, opt1Desc: e.target.value }))}
                placeholder="Short description" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white focus:border-teal-400 outline-none" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-600 mb-1 block">Option B <span className="text-red-400">*</span></label>
              <input value={form.opt2} onChange={e => setForm(f => ({ ...f, opt2: e.target.value }))}
                placeholder="e.g. totalDue" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white focus:border-teal-400 outline-none font-mono mb-1" />
              <input value={form.opt2Desc} onChange={e => setForm(f => ({ ...f, opt2Desc: e.target.value }))}
                placeholder="Short description" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white focus:border-teal-400 outline-none" />
            </div>
            <div className="col-span-2">
              <label className="text-[11px] font-medium text-slate-600 mb-1 block">Resolution strategy</label>
              <input value={form.resolution} onChange={e => setForm(f => ({ ...f, resolution: e.target.value }))}
                placeholder="How should the Query AI handle this?"
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white focus:border-teal-400 outline-none" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={add} disabled={!form.term.trim() || !form.opt1.trim() || !form.opt2.trim()}
              className="text-xs bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 disabled:opacity-40 transition-colors font-medium">
              Save rule
            </button>
            <button onClick={() => { setOpen(false); setForm(EMPTY_RULE) }}
              className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2 transition-colors">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Static cards ──────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent = false }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className={`border rounded-xl p-4 text-center ${accent ? 'bg-teal-50 border-teal-200' : 'bg-white border-slate-200'}`}>
      <p className={`text-2xl font-bold ${accent ? 'text-teal-700' : 'text-slate-900'}`}>{value}</p>
      <p className="text-xs font-semibold text-slate-600 mt-1">{label}</p>
      <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>
    </div>
  )
}

function SourceCard({ source }: { source: typeof AW_SOURCES[0] }) {
  return (
    <div className={`border ${source.colorBorder} rounded-xl p-4 bg-white`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">{source.icon}</span>
            <span className="font-semibold text-slate-900 text-sm">{source.name}</span>
          </div>
          <span className={`mt-1 inline-block text-[10px] font-mono px-2 py-0.5 rounded-full ${source.colorBg} ${source.colorText} font-medium`}>{source.type}</span>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-slate-800">{source.total.toLocaleString('en-US')}</p>
          <p className="text-[11px] text-slate-400">total rows</p>
          {AW_SOURCE_FRESHNESS[source.id] && (
            <FreshnessBadge status={AW_SOURCE_FRESHNESS[source.id].status}
              lastSync={AW_SOURCE_FRESHNESS[source.id].lastSync} sla={AW_SOURCE_FRESHNESS[source.id].sla} />
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        {source.entities.map(e => (
          <div key={e.name} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${source.colorDot}`} />
              <span className="text-slate-600 font-mono">{e.name}</span>
            </div>
            <span className="text-slate-400">{e.rows.toLocaleString('en-US')}</span>
          </div>
        ))}
      </div>
      {'warning' in source && source.warning && (
        <div className="mt-3 flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />{source.warning}
        </div>
      )}
    </div>
  )
}

function UserSourceCard({ source, onDelete }: { source: SourceDef; onDelete: () => void }) {
  const chips: Record<string, string> = { PostgreSQL: 'bg-blue-50 text-blue-700', MySQL: 'bg-orange-50 text-orange-700', SQLite: 'bg-sky-50 text-sky-700', MongoDB: 'bg-green-50 text-green-700', Snowflake: 'bg-cyan-50 text-cyan-700', BigQuery: 'bg-yellow-50 text-yellow-700', CSV: 'bg-violet-50 text-violet-700', JSON: 'bg-amber-50 text-amber-700', 'REST API': 'bg-teal-50 text-teal-700' }
  const chip = chips[source.type] ?? 'bg-slate-100 text-slate-600'
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3">
      <Server className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-900">{source.name}</span>
          <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full ${chip}`}>{source.type}</span>
        </div>
        {source.description && <p className="text-xs text-slate-500 mt-0.5">{source.description}</p>}
        {source.tables && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {source.tables.split(',').map(t => t.trim()).filter(Boolean).map(t => (
              <span key={t} className="text-[10px] font-mono text-blue-600 bg-blue-50 rounded px-1.5 py-0.5">{t}</span>
            ))}
          </div>
        )}
      </div>
      <button onClick={onDelete} className="text-slate-300 hover:text-red-400 transition-colors flex-shrink-0">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function BridgeCard({ bridge }: { bridge: typeof AW_BRIDGES[0] }) {
  const pct = bridge.matchRate
  const color = pct === 100 ? 'bg-teal-500' : pct >= 95 ? 'bg-blue-500' : 'bg-amber-500'
  const textColor = pct === 100 ? 'text-teal-700 bg-teal-100' : pct >= 95 ? 'text-blue-700 bg-blue-100' : 'text-amber-700 bg-amber-100'
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">From</p>
          <p className="text-xs font-semibold text-slate-700 mt-0.5">{bridge.from.entity}</p>
          <p className="text-[11px] font-mono text-slate-500">{bridge.from.source}</p>
          <p className="text-[10px] font-mono text-blue-600 bg-blue-50 rounded px-1.5 py-0.5 mt-1 inline-block">{bridge.from.field}</p>
        </div>
        <div className="flex flex-col items-center gap-1.5 flex-shrink-0 px-2">
          <span className="text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-3 py-1 whitespace-nowrap">⚡ {bridge.label}</span>
          <span className="text-[10px] text-slate-400">{bridge.cardinality}</span>
          <ArrowRight className="w-3.5 h-3.5 text-teal-500" />
        </div>
        <div className="flex-1 min-w-0 text-right">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">To</p>
          <p className="text-xs font-semibold text-slate-700 mt-0.5">{bridge.to.entity}</p>
          <p className="text-[11px] font-mono text-slate-500">{bridge.to.source}</p>
          <p className="text-[10px] font-mono text-teal-600 bg-teal-50 rounded px-1.5 py-0.5 mt-1 inline-block">{bridge.to.field}</p>
        </div>
        <div className="flex flex-col items-center gap-1 flex-shrink-0 ml-3">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${textColor}`}>{pct}%</span>
          <p className="text-[10px] text-slate-400">match</p>
        </div>
      </div>
      <div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[10px] text-slate-500 mt-1.5 font-mono">{bridge.detail}</p>
      </div>
      <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-0.5">Enables</p>
        <p className="text-[11px] text-slate-600">{bridge.impact}</p>
      </div>
    </div>
  )
}


function DisambiguationCard({ rule }: { rule: typeof AW_DISAMBIGUATION_RULES[0] }) {
  return (
    <div className="bg-white border border-amber-200 rounded-xl p-4">
      <div className="flex items-start gap-3 mb-3">
        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">{rule.term}</p>
          <p className="text-xs text-slate-500 mt-0.5">{rule.problem}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {rule.options.map((opt, i) => (
          <div key={i} className={`border rounded-lg p-2.5 ${opt.recommended ? 'border-teal-300 bg-teal-50' : 'border-slate-200 bg-slate-50'}`}>
            <p className="text-[10px] font-mono font-bold text-slate-700">{opt.label}</p>
            <p className="text-xs font-bold text-slate-900 mt-0.5">{opt.value}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">{opt.desc}</p>
            <p className="text-[10px] font-mono text-violet-600 mt-1">{opt.semantic}</p>
            {opt.recommended && <p className="text-[10px] text-teal-600 font-semibold mt-1">← recommended</p>}
          </div>
        ))}
      </div>
      <div className="flex items-start gap-1.5 text-[11px] text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-2.5 py-2">
        <CheckCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />{rule.resolution}
      </div>
    </div>
  )
}

function QueryExampleCard({ ex }: { ex: typeof AW_QUERY_EXAMPLES[0] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <MessageSquare className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">"{ex.question}"</p>
          <div className="flex items-center gap-1 flex-wrap mt-2">
            {ex.path.map((step, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${step.startsWith('⚡') ? 'bg-teal-100 text-teal-700 font-bold' : 'bg-slate-100 text-slate-600'}`}>{step}</span>
                {i < ex.path.length - 1 && <ArrowRight className="w-2.5 h-2.5 text-slate-300" />}
              </span>
            ))}
          </div>
          {ex.bridges.length > 0 && (
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mr-1">Bridges:</span>
              {ex.bridges.map(b => <span key={b} className="text-[10px] font-bold text-teal-600 bg-teal-50 border border-teal-200 rounded-full px-2 py-0.5">⚡ {b}</span>)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-right">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-0.5">Result</p>
            <p className="text-xs font-semibold text-teal-700 max-w-[160px] leading-snug">{ex.result}</p>
          </div>
          <button onClick={() => tryInQueryAI(ex.question)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-[11px] font-semibold transition-colors">
            <Play className="w-3 h-3" />Try
          </button>
        </div>
      </div>
      <button onClick={() => setOpen(v => !v)} className="mt-2.5 flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors">
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}View SQL
      </button>
      {open && (
        <pre className="mt-2 text-[10px] font-mono bg-slate-900 text-teal-300 rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre leading-relaxed">{ex.sql}</pre>
      )}
    </div>
  )
}

// ── Section page header ───────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, desc, action }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  desc: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between mb-2">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-teal-50 border border-teal-200 rounded-lg flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4 text-teal-600" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}


// ── Metrics ───────────────────────────────────────────────────────────────────

type MetricType = 'sum' | 'count' | 'count_distinct' | 'avg' | 'ratio' | 'derived'
type MetricFormat = 'number' | 'currency' | 'percentage'
type MetricStatus = 'verified' | 'draft'
type TimeGrain = 'day' | 'week' | 'month' | 'quarter' | 'year'

interface Metric {
  id: string
  name: string
  description: string
  type: MetricType
  entity: string
  field?: string
  numerator?: string
  denominator?: string
  expression?: string
  filters: string[]
  timeDimension?: string
  grains: TimeGrain[]
  format: MetricFormat
  status: MetricStatus
  owner?: string
  tags: string[]
}

// AW_METRICS is no longer used — backend metrics are loaded via getMetrics()
const AW_METRICS: Metric[] = []

const METRIC_TYPE_LABEL: Record<MetricType, string> = {
  sum: 'SUM', count: 'COUNT', count_distinct: 'COUNT DISTINCT', avg: 'AVG', ratio: 'RATIO', derived: 'DERIVED',
}

const METRIC_TYPE_COLOR: Record<MetricType, string> = {
  sum:            'bg-blue-50 text-blue-700 border border-blue-200',
  count:          'bg-slate-100 text-slate-600',
  count_distinct: 'bg-purple-50 text-purple-700 border border-purple-200',
  avg:            'bg-amber-50 text-amber-700 border border-amber-200',
  ratio:          'bg-teal-50 text-teal-700 border border-teal-200',
  derived:        'bg-orange-50 text-orange-700 border border-orange-200',
}

const METRIC_GRAIN_LABEL: Record<TimeGrain, string> = {
  day: 'D', week: 'W', month: 'M', quarter: 'Q', year: 'Y',
}

function loadMetrics(sid: string): Metric[] {
  try { return JSON.parse(localStorage.getItem(`semantic-metrics-${sid}`) ?? '[]') } catch { return [] }
}
function saveMetrics(sid: string, m: Metric[]) {
  try { localStorage.setItem(`semantic-metrics-${sid}`, JSON.stringify(m)) } catch { /* quota */ }
}

function MetricCard({ metric, onDelete }: { metric: Metric; onDelete?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <button className="w-full text-left" onClick={() => setOpen(v => !v)}>
        <div className="px-4 py-3 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Sigma className="w-4 h-4 text-teal-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-bold text-slate-900">{metric.name}</span>
              {metric.status === 'verified'
                ? <span className="flex items-center gap-1 text-[10px] font-bold text-teal-600 bg-teal-50 border border-teal-200 rounded-full px-2 py-0.5"><CheckCircle className="w-2.5 h-2.5" />Verified</span>
                : <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">Draft</span>
              }
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${METRIC_TYPE_COLOR[metric.type]}`}>{METRIC_TYPE_LABEL[metric.type]}</span>
            </div>
            <p className="text-xs text-slate-500 leading-snug">{metric.description}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {onDelete && <button onClick={e => { e.stopPropagation(); onDelete() }} aria-label="Delete" className="text-slate-300 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
            {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          </div>
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-0 border-t border-slate-100 bg-slate-50 space-y-3">
          {/* Expression */}
          <div className="mt-3">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Expression</p>
            <code className="text-xs font-mono text-violet-700 bg-white border border-slate-200 rounded-lg px-3 py-2 block">
              {metric.type === 'sum' && `SUM(${metric.entity}.${metric.field})`}
              {metric.type === 'count' && `COUNT(${metric.entity}.${metric.field})`}
              {metric.type === 'count_distinct' && `COUNT(DISTINCT ${metric.entity}.${metric.field})`}
              {metric.type === 'avg' && `AVG(${metric.entity}.${metric.field})`}
              {metric.type === 'ratio' && `${metric.numerator} / ${metric.denominator}`}
              {metric.type === 'derived' && (metric.expression ?? '—')}
            </code>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {metric.filters.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Filters</p>
                {metric.filters.map((f, i) => <code key={i} className="text-[11px] font-mono text-orange-600 bg-orange-50 rounded px-1.5 py-0.5 block mb-0.5">{f}</code>)}
              </div>
            )}
            {metric.timeDimension && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Time Dimension</p>
                <code className="text-[11px] font-mono text-blue-600">{metric.timeDimension}</code>
              </div>
            )}
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Grains</p>
              <div className="flex gap-1 flex-wrap">
                {metric.grains.map(g => (
                  <span key={g} className="text-[10px] font-bold bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">{METRIC_GRAIN_LABEL[g]}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] font-semibold text-slate-500">Format: <span className="font-bold text-slate-700">{metric.format}</span></span>
            {metric.owner && <span className="text-[10px] font-semibold text-slate-500">Owner: <span className="font-bold text-slate-700">{metric.owner}</span></span>}
            {metric.tags.map(t => <span key={t} className="text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">#{t}</span>)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Hierarchies ───────────────────────────────────────────────────────────────

interface HierarchyLevel { name: string; field: string }
interface DimHierarchy {
  id: string
  name: string
  entity: string
  description: string
  type: 'time' | 'categorical'
  levels: HierarchyLevel[]
  isBuiltin?: boolean
}

// AW_HIERARCHIES is no longer used — backend hierarchies are loaded via getHierarchies()
const AW_HIERARCHIES: DimHierarchy[] = []

function loadHierarchies(sid: string): DimHierarchy[] {
  try { return JSON.parse(localStorage.getItem(`semantic-hierarchies-${sid}`) ?? '[]') } catch { return [] }
}
function saveHierarchies(sid: string, h: DimHierarchy[]) {
  try { localStorage.setItem(`semantic-hierarchies-${sid}`, JSON.stringify(h)) } catch { /* quota */ }
}

function HierarchyCard({ h, onDelete }: { h: DimHierarchy; onDelete?: () => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${h.type === 'time' ? 'bg-blue-50 border border-blue-200' : 'bg-violet-50 border border-violet-200'}`}>
          {h.type === 'time'
            ? <TrendingUp className="w-4 h-4 text-blue-600" />
            : <SlidersHorizontal className="w-4 h-4 text-violet-600" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-slate-900">{h.name}</span>
            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${h.type === 'time' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}>{h.type}</span>
            {h.isBuiltin && <span className="text-[10px] font-bold text-teal-600 bg-teal-50 border border-teal-200 rounded-full px-2 py-0.5"><CheckCircle className="w-2.5 h-2.5 inline mr-0.5" />Built-in</span>}
          </div>
          <p className="text-xs text-slate-500 mb-2">{h.description}</p>
          <div className="flex items-center gap-1 flex-wrap">
            {h.levels.map((lvl, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="text-[11px] font-semibold bg-slate-100 text-slate-700 rounded-md px-2 py-0.5">{lvl.name}</span>
                {i < h.levels.length - 1 && <ArrowRight className="w-3 h-3 text-slate-400 flex-shrink-0" />}
              </span>
            ))}
          </div>
        </div>
        {onDelete && (
          <button onClick={onDelete} aria-label="Delete" className="text-slate-300 hover:text-red-400 transition-colors flex-shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
        )}
      </div>
    </div>
  )
}

// ── Segments ──────────────────────────────────────────────────────────────────

type SegmentOperator = '=' | '!=' | 'IN' | 'NOT IN' | '>' | '<' | '>=' | '<='
interface SegmentCondition { field: string; operator: SegmentOperator; value: string }
interface Segment {
  id: string
  name: string
  description: string
  entity: string
  conditions: SegmentCondition[]
  tags: string[]
  usedBy: string[]
  isBuiltin?: boolean
}

// AW_SEGMENTS is no longer used — backend segments are loaded via getSegments()
const AW_SEGMENTS: Segment[] = []

const OPERATOR_LABELS: Record<SegmentOperator, string> = {
  '=': '=', '!=': '≠', 'IN': 'IN', 'NOT IN': 'NOT IN', '>': '>', '<': '<', '>=': '≥', '<=': '≤',
}

function loadSegments(sid: string): Segment[] {
  try { return JSON.parse(localStorage.getItem(`semantic-segments-${sid}`) ?? '[]') } catch { return [] }
}
function saveSegments(sid: string, s: Segment[]) {
  try { localStorage.setItem(`semantic-segments-${sid}`, JSON.stringify(s)) } catch { /* quota */ }
}

function SegmentCard({ seg, onDelete }: { seg: Segment; onDelete?: () => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-orange-50 border border-orange-200 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Filter className="w-4 h-4 text-orange-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-slate-900">{seg.name}</span>
            {seg.isBuiltin && <span className="text-[10px] font-bold text-teal-600 bg-teal-50 border border-teal-200 rounded-full px-2 py-0.5"><CheckCircle className="w-2.5 h-2.5 inline mr-0.5" />Built-in</span>}
            <span className="text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5 font-mono">{seg.entity}</span>
          </div>
          <p className="text-xs text-slate-500 mb-2">{seg.description}</p>
          <div className="flex flex-col gap-1">
            {seg.conditions.map((c, i) => (
              <code key={i} className="text-[11px] font-mono">
                <span className="text-amber-700">{c.field}</span>{' '}
                <span className="text-violet-600 font-bold">{OPERATOR_LABELS[c.operator]}</span>{' '}
                <span className="text-teal-700">{c.value}</span>
              </code>
            ))}
          </div>
          {seg.usedBy.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className="text-[10px] text-slate-400 font-semibold">Used by:</span>
              {seg.usedBy.map(m => <span key={m} className="text-[10px] bg-teal-50 text-teal-700 border border-teal-200 rounded px-1.5 py-0.5 font-medium">{m}</span>)}
            </div>
          )}
        </div>
        {onDelete && (
          <button onClick={onDelete} aria-label="Delete" className="text-slate-300 hover:text-red-400 transition-colors flex-shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
        )}
      </div>
    </div>
  )
}

// ── Source freshness ──────────────────────────────────────────────────────────
// No longer hardcoded — freshness data comes from backendSources (loaded via semanticSources())
const AW_SOURCE_FRESHNESS: Record<string, { lastSync: string; sla: string; quality: number; status: 'fresh' | 'stale' | 'warning'; label: string }> = {}

function FreshnessBadge({ status, lastSync, sla }: { status: 'fresh' | 'stale' | 'warning'; lastSync: string; sla: string }) {
  const colors = { fresh: 'bg-teal-50 text-teal-700 border-teal-200', stale: 'bg-red-50 text-red-600 border-red-200', warning: 'bg-amber-50 text-amber-700 border-amber-200' }
  const labels = { fresh: '● Fresh', stale: '● Stale', warning: '⚠ Delayed' }
  return (
    <div className="text-right">
      <span className={`text-[10px] font-bold border rounded-full px-2 py-0.5 ${colors[status]}`}>{labels[status]}</span>
      <p className="text-[10px] text-slate-400 mt-0.5">sync {lastSync.split(' ')[1]} · SLA {sla}</p>
    </div>
  )
}

// ── Query Playground ─────────────────────────────────────────────────────────

interface PlaygroundResolution {
  metrics: string[]
  dimensions: { name: string; grain?: string }[]
  segments: string[]
}

interface PlaygroundScenario {
  id: string
  question: string
  keywords: string[]
  resolution: PlaygroundResolution
  sql: string
  columns: string[]
  rows: Record<string, string>[]
}

// AW_PLAYGROUND is no longer used — playground scenarios come from query templates loaded via listQueryTemplates()
// resolveQuery is only used in offline mode; with no hardcoded scenarios it always returns null
function resolveQuery(_query: string): PlaygroundScenario | null {
  return null
}

interface SearchResult { section: SLSection; type: string; label: string; sub: string }

function buildSearchIndex(
  ontologyNodes: { data: { label: string; description?: string } }[],
  metrics: Metric[],
  hierarchies: DimHierarchy[],
  segments: Segment[],
): SearchResult[] {
  return [
    ...ontologyNodes.map(n => ({ section: 'entities' as SLSection, type: 'Entity', label: n.data.label, sub: n.data.description ?? '' })),
    ...metrics.map(m  => ({ section: 'metrics'    as SLSection, type: 'Metric',    label: m.name,  sub: m.description })),
    ...hierarchies.map(h => ({ section: 'hierarchies' as SLSection, type: 'Hierarchy', label: h.name, sub: h.description })),
    ...segments.map(s => ({ section: 'segments' as SLSection, type: 'Segment',   label: s.name,  sub: s.description })),
  ]
}

function scoreSearch(item: SearchResult, q: string): number {
  const lq = q.toLowerCase()
  if (item.label.toLowerCase() === lq) return 3
  if (item.label.toLowerCase().startsWith(lq)) return 2
  if (item.label.toLowerCase().includes(lq) || item.sub.toLowerCase().includes(lq)) return 1
  return 0
}

// ── Definitions data (from Semantic Layer / MappingView) ─────────────────────

interface SemanticDef {
  entity: string
  field: string
  definition: string
  status: 'ok' | 'ambiguous' | 'todo'
}

const INITIAL_DEFS: SemanticDef[] = [
  { entity: 'SalesOrder',     field: 'subtotalAmount',  definition: 'Net order amount before taxes and shipping costs. Canonical "commercial revenue" — use for sales metrics ($20.1M total 2014).', status: 'ok' },
  { entity: 'SalesOrder',     field: 'totalDue',        definition: 'Gross amount billed to customer — includes taxes and freight. Use for finance/accounting contexts ($22.4M total 2014, +$2.3M vs subtotal).', status: 'ambiguous' },
  { entity: 'SalesOrder',     field: 'onlineOrderFlag', definition: 'TRUE = online B2C order (self-service). FALSE = offline B2B order placed through a sales representative.', status: 'ok' },
  { entity: 'SalesOrder',     field: 'status',          definition: 'Order lifecycle status: Confirmed, Processing, Shipped, Delivered.', status: 'ok' },
  { entity: 'SalesOrder',     field: 'orderDate',       definition: 'Date the order was placed. Reference date for all revenue period calculations.', status: 'ok' },
  { entity: 'Customer',       field: 'accountId',       definition: 'CRM primary key. Values < 0 are duplicates from a legacy migration — 372 such records removed.', status: 'ok' },
  { entity: 'Customer',       field: 'accountNumber',   definition: 'Human-readable customer code. Stable across system migrations.', status: 'ok' },
  { entity: 'Customer',       field: 'customerType',    definition: 'Customer classification: "Company" (B2B) or "Individual" (B2C).', status: 'todo' },
  { entity: 'Salesperson',    field: 'salesPersonId',   definition: 'ERP primary key for the salesperson. Bridges to HR.matricolaDip for cross-source ERP↔HR join.', status: 'ok' },
  { entity: 'Salesperson',    field: 'salesYTD',        definition: 'Year-to-date sales revenue attributed to this rep. Top: Linda Mitchell $4.25M (2014).', status: 'ok' },
  { entity: 'Salesperson',    field: 'bonus',           definition: 'Annual bonus paid. Not proportional to revenue — Jae Pak highest bonus ($6,700) but ranks 8th in YTD.', status: 'ambiguous' },
  { entity: 'Salesperson',    field: 'commissionPct',   definition: 'Commission rate applied to net sales (subtotalAmount). Ranges from 1.0% to 2.0%.', status: 'ok' },
  { entity: 'Employee',       field: 'matricolaDip',    definition: 'HR employee ID (Italian schema). ERP↔HR bridge key — maps to Salesperson.salesPersonId.', status: 'ok' },
  { entity: 'Employee',       field: 'cognome',         definition: 'Employee last name (Italian schema). Maps to Employee.lastName in queries.', status: 'ok' },
  { entity: 'Employee',       field: 'nome',            definition: 'Employee first name (Italian schema). Maps to Employee.firstName in queries.', status: 'ok' },
  { entity: 'Employee',       field: 'ruolo',           definition: 'Job title (Italian: "ruolo"). Maps to Employee.jobTitle.', status: 'ok' },
  { entity: 'Employee',       field: 'dataAssunzione',  definition: 'Hire date (Italian). All sales staff hired 2007–2009.', status: 'ok' },
  { entity: 'Product',        field: 'internalId',      definition: 'PIM product identifier. ERP↔PIM bridge key — maps to SalesOrderLine.product_ref.', status: 'ok' },
  { entity: 'Product',        field: 'listPrice',       definition: 'Published catalog price. Not the actual sale price — discounts applied at SalesOrderLine level.', status: 'ok' },
  { entity: 'Product',        field: 'category',        definition: 'Top-level category: Bikes (~85% revenue), Accessories, Clothing, Components.', status: 'ok' },
  { entity: 'Territory',      field: 'salesYTD',        definition: 'Territory year-to-date revenue. Southwest leads at $10.5M, Northwest $7.9M, Canada $6.8M.', status: 'ok' },
  { entity: 'Territory',      field: 'group',           definition: 'Geographic group: "North America" (5), "Europe" (3), "Pacific" (Australia).', status: 'ok' },
  { entity: 'SalesOrderLine', field: 'unitPrice',       definition: 'Actual unit sale price after any list price adjustments.', status: 'ok' },
  { entity: 'SalesOrderLine', field: 'offerRef',        definition: 'Foreign key to applied discount. offerRef=1 = No Discount; higher values = up to 50% off.', status: 'ok' },
]

const DEF_AMBIGUITIES = [
  {
    term: 'fatturato / revenue',
    context: 'SalesOrder (ERP — OrionSales)',
    candidates: [
      { label: 'subtotalAmount — $20,127,070', desc: 'Net commercial revenue, excl. taxes and freight. Use for sales performance, rep KPIs, territory ranking.', recommended: true },
      { label: 'totalDue — $22,410,568',       desc: 'Gross billed amount including taxes + freight. Use for finance, AR, billing reconciliation.', recommended: false },
    ],
    resolution: '"commercial revenue" → subtotalAmount. "billed" / "total due" / "invoiced" → totalDue. When ambiguous, shows both and asks.',
  },
  {
    term: 'customer count / clienti',
    context: 'CRM — ClientHub (SQLite)',
    candidates: [
      { label: 'CRM raw — 20,201 accounts', desc: 'Includes 372 duplicates with accountId < 0 from legacy migration.', recommended: false },
      { label: 'CRM dedup — 19,829 accounts', desc: 'Clean unique accounts after removing negative-ID duplicates.', recommended: true },
    ],
    resolution: 'Knowledge Graph always uses 19,829 unique accounts. Raw count only shown in audit/data quality views.',
  },
  {
    term: 'bonus vs commissionPct',
    context: 'Salesperson (ERP)',
    candidates: [
      { label: 'bonus — fixed annual ($75–$6,700)', desc: 'Discretionary annual bonus. Not performance-proportional.', recommended: false },
      { label: 'commissionPct × salesYTD', desc: 'Variable commission proportional to net sales (1.0%–2.0%).', recommended: true },
    ],
    resolution: 'Use commissionPct × salesYTD to compare rep economic outcomes. Bonus is a separate discretionary component.',
  },
  {
    term: 'top salesperson',
    context: 'Salesperson × Employee (ERP × HR)',
    candidates: [
      { label: 'By salesYTD — Linda Mitchell ($4.25M)', desc: 'Highest revenue producer 2014.', recommended: true },
      { label: 'By bonus — Jae Pak ($6,700)', desc: 'Highest bonus but 8th in revenue. Bonus not revenue-correlated.', recommended: false },
    ],
    resolution: '"Top salesperson" defaults to highest salesYTD = Linda Mitchell. Only use bonus ranking when explicitly asked.',
  },
]

const DEF_STATUS_BADGE: Record<SemanticDef['status'], string> = {
  ok:        'bg-teal-50 text-teal-700 border border-teal-200',
  ambiguous: 'bg-amber-50 text-amber-700 border border-amber-200',
  todo:      'bg-slate-100 text-slate-500',
}

const DEF_TYPE_COLORS: Record<string, string> = {
  uuid:     'bg-orange-50 text-orange-600 border border-orange-200',
  string:   'bg-slate-100 text-slate-600',
  integer:  'bg-blue-50 text-blue-600',
  decimal:  'bg-purple-50 text-purple-600',
  boolean:  'bg-amber-50 text-amber-600',
  date:     'bg-green-50 text-green-700',
  datetime: 'bg-teal-50 text-teal-700',
  text:     'bg-slate-100 text-slate-500',
}

interface MappingRow {
  table: string
  field: string
  ontologyClass: string
  ontologyProperty: string
  fieldType: string
  uri: string
}

function toSnakeCase(name: string): string {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
}

function generateMappings(nodes: OntologyNode[]): MappingRow[] {
  const rows: MappingRow[] = []
  for (const node of nodes) {
    const table = node.data.db_table
    if (!table) continue
    for (const prop of node.data.properties) {
      if (prop.type === 'fk') continue
      rows.push({
        table,
        field: toSnakeCase(prop.name),
        ontologyClass: node.data.label,
        ontologyProperty: prop.name,
        fieldType: prop.type,
        uri: `${node.data.uri}.${prop.name}`,
      })
    }
  }
  return rows
}

function DefTypeBadge({ type }: { type: string }) {
  return (
    <span className={`inline-block text-[10px] font-mono px-1.5 py-0.5 rounded leading-none ${DEF_TYPE_COLORS[type] ?? 'bg-slate-100 text-slate-500'}`}>
      {type}
    </span>
  )
}

function DefEditableCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  function commit() { onSave(draft); setEditing(false) }
  function cancel() { setDraft(value); setEditing(false) }
  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
          className="flex-1 bg-white border border-teal-400 rounded px-2 py-0.5 text-xs text-slate-900 outline-none min-w-0 font-mono" />
        <button onClick={commit} aria-label="Save" className="text-teal-500 hover:text-teal-700"><Check className="w-3.5 h-3.5" /></button>
        <button onClick={cancel} aria-label="Cancel" className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
      </div>
    )
  }
  return (
    <div className="group flex items-center gap-1.5 cursor-pointer" onClick={() => setEditing(true)}>
      <span className="text-xs font-mono text-teal-700">{value}</span>
      <Pencil className="w-3 h-3 text-slate-300 group-hover:text-teal-400 opacity-0 group-hover:opacity-100 transition-all" />
    </div>
  )
}

function MappingTableGroup({ table, rows, savedEdits, onSave }: {
  table: string; rows: MappingRow[]; savedEdits: Record<string, string>; onSave: (k: string, v: string) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-slate-50 hover:bg-slate-100 transition-colors border-b border-slate-200">
        <div className="flex items-center gap-2.5">
          <Table2 className="w-4 h-4 text-teal-500" />
          <span className="font-semibold text-slate-900 font-mono text-sm">{table}</span>
          <span className="text-[10px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded">{rows.length} fields</span>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-white">
                {['DB Field', 'Ontology Class', 'Ontology Property (click to edit)', 'Type', 'URI'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] text-slate-400 font-semibold uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const editKey = `${row.table}.${row.field}`
                const currentVal = savedEdits[editKey] ?? `${row.ontologyClass}.${row.ontologyProperty}`
                return (
                  <tr key={editKey} className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-2.5"><span className="font-mono text-xs text-amber-600">{row.field}</span></td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-1.5 text-xs">
                        <GitBranch className="w-3 h-3 text-teal-400 flex-shrink-0" />{row.ontologyClass}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <DefEditableCell value={currentVal} onSave={v => onSave(editKey, v)} />
                    </td>
                    <td className="px-4 py-2.5"><DefTypeBadge type={row.fieldType} /></td>
                    <td className="px-4 py-2.5"><span className="text-[10px] font-mono text-slate-400">{row.uri}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SemanticDefsPanel() {
  const [defs, setDefs] = useState<SemanticDef[]>(INITIAL_DEFS)
  const [editing, setEditing] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [newForm, setNewForm] = useState({ entity: '', field: '', definition: '' })
  const [showAdd, setShowAdd] = useState(false)

  function startEdit(i: number) { setEditing(i); setEditText(defs[i].definition) }
  function saveEdit(i: number) {
    setDefs(prev => prev.map((d, idx) => idx === i ? { ...d, definition: editText } : d))
    setEditing(null)
  }
  function addDef() {
    if (!newForm.entity || !newForm.field || !newForm.definition) return
    setDefs(prev => [...prev, { ...newForm, status: 'todo' as const }])
    setNewForm({ entity: '', field: '', definition: '' }); setShowAdd(false)
  }
  const grouped = defs.reduce<Record<string, SemanticDef[]>>((acc, d) => { (acc[d.entity] ??= []).push(d); return acc }, {})

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{defs.length} definitions · {defs.filter(d => d.status === 'ambiguous').length} ambiguous · click a row to edit</p>
        <button onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1.5 text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 transition-colors font-medium">
          <Plus className="w-3.5 h-3.5" />Add definition
        </button>
      </div>
      {showAdd && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-700">New semantic definition</p>
          <div className="grid grid-cols-3 gap-3">
            {(['entity', 'field', 'definition'] as const).map(f => (
              <div key={f}>
                <label className="text-[11px] text-slate-500 mb-1 block capitalize">{f}</label>
                <input value={newForm[f]} onChange={e => setNewForm(p => ({ ...p, [f]: e.target.value }))}
                  placeholder={f === 'entity' ? 'e.g. SalesOrder' : f === 'field' ? 'e.g. subtotal_amount' : 'What does this field mean?'}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400" />
              </div>
            ))}
          </div>
          <button onClick={addDef} className="text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700">Add</button>
        </div>
      )}
      {Object.entries(grouped).map(([entity, entityDefs]) => (
        <div key={entity} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <Tag className="w-3.5 h-3.5 text-teal-600" />
            <span className="text-sm font-semibold text-slate-800">{entity}</span>
            <span className="text-[11px] text-slate-400">· {entityDefs.length} fields</span>
          </div>
          <div className="divide-y divide-slate-100">
            {entityDefs.map((def) => {
              const globalIdx = defs.indexOf(def)
              const isEditing = editing === globalIdx
              return (
                <div key={globalIdx} className="px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start gap-3">
                    <code className="text-[11px] font-mono text-teal-700 bg-teal-50 px-2 py-0.5 rounded mt-0.5 flex-shrink-0">{def.field}</code>
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input autoFocus value={editText} onChange={e => setEditText(e.target.value)}
                            className="flex-1 text-xs border border-teal-300 rounded px-2 py-1 outline-none" />
                          <button onClick={() => saveEdit(globalIdx)} aria-label="Save" className="text-teal-600 hover:text-teal-700"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setEditing(null)} aria-label="Cancel" className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-600 leading-relaxed cursor-pointer hover:text-slate-900" onClick={() => startEdit(globalIdx)}>{def.definition}</p>
                      )}
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${DEF_STATUS_BADGE[def.status]}`}>{def.status}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function AmbiguityLogPanel() {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">{DEF_AMBIGUITIES.length} documented ambiguities — resolved at query time by the semantic layer</p>
      {DEF_AMBIGUITIES.map((amb, i) => (
        <div key={i} className="bg-white border border-amber-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-bold text-slate-900">"{amb.term}"</span>
            <span className="text-xs text-slate-500">· {amb.context}</span>
          </div>
          <div className="p-4 space-y-3">
            <div className="space-y-2">
              {amb.candidates.map((c, j) => (
                <div key={j} className={`flex items-start gap-3 rounded-lg border p-3 ${c.recommended ? 'border-teal-200 bg-teal-50' : 'border-slate-200 bg-slate-50'}`}>
                  {c.recommended ? <Check className="w-4 h-4 text-teal-600 mt-0.5 flex-shrink-0" /> : <X className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />}
                  <div>
                    <code className="text-[11px] font-mono font-semibold text-slate-800">{c.label}</code>
                    <p className="text-xs text-slate-500 mt-0.5">{c.desc}</p>
                    {c.recommended && <span className="text-[10px] font-bold text-teal-600 uppercase">Recommended</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <strong>Resolution:</strong> {amb.resolution}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

type SLSection = 'overview' | 'sources' | 'entities' | 'bridges' | 'relations' | 'rules' | 'metrics' | 'hierarchies' | 'segments' | 'definitions' | 'playground'

const SECTION_NAV: { id: SLSection; label: string; Icon: React.ComponentType<{ className?: string }>; desc: string; group?: string }[] = [
  { id: 'overview',     label: 'Overview',    Icon: Layers,           desc: 'Stats & quality' },
  { id: 'playground',   label: 'Playground',  Icon: Play,             desc: 'Test NL queries', group: 'Tools' },
  { id: 'sources',      label: 'Sources',     Icon: Database,         desc: 'Data systems', group: 'Model' },
  { id: 'entities',     label: 'Entities',    Icon: Network,          desc: 'Semantic concepts' },
  { id: 'bridges',      label: 'Bridges',     Icon: GitBranch,        desc: 'Cross-system joins' },
  { id: 'relations',    label: 'Relations',   Icon: ArrowRight,       desc: 'Intra-source FK links' },
  { id: 'rules',        label: 'Rules',       Icon: BookOpen,         desc: 'Disambiguation', group: 'Semantics' },
  { id: 'metrics',      label: 'Metrics',     Icon: BarChart2,        desc: 'Business measures' },
  { id: 'hierarchies',  label: 'Hierarchies', Icon: SlidersHorizontal,desc: 'Drill-down paths' },
  { id: 'segments',     label: 'Segments',    Icon: Filter,           desc: 'Saved filters' },
  { id: 'definitions',  label: 'Definitions', Icon: Tag,              desc: 'Field glossary' },
]

// ── Relations Section ─────────────────────────────────────────────────────────

function RelationsSection({ isManufacturing, onNavigate }: {
  isManufacturing: boolean
  onNavigate: (s: SLSection) => void
}) {
  const [filterSource, setFilterSource] = useState<string>('all')
  const [filterCard, setFilterCard] = useState<string>('all')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')

  const totalRelations = AW_RELATIONS.reduce((a, g) => a + g.relations.length, 0)
  const oneToN = AW_RELATIONS.flatMap(g => g.relations).filter(r => r.cardinality === '1:N').length
  const nToOne = AW_RELATIONS.flatMap(g => g.relations).filter(r => r.cardinality === 'N:1').length
  const softCount = AW_RELATIONS.flatMap(g => g.relations).filter(r => 'soft' in r && r.soft).length

  const filtered = AW_RELATIONS
    .filter(g => filterSource === 'all' || g.sourceKey === filterSource)
    .map(g => ({
      ...g,
      relations: g.relations.filter(r =>
        (filterCard === 'all' || r.cardinality === filterCard) &&
        (!search || r.from.toLowerCase().includes(search.toLowerCase()) || r.to.toLowerCase().includes(search.toLowerCase()))
      ) as typeof g.relations,
    }))
    .filter(g => g.relations.length > 0)

  function toggleCollapse(key: string) {
    setCollapsed(c => ({ ...c, [key]: !c[key] }))
  }

  return (
    <div className="px-8 py-7 space-y-5">
      <SectionHeader icon={ArrowRight} title="Intra-source Relations"
        desc="Foreign-key relationships within each data source" />

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total relations', value: totalRelations, color: 'text-slate-700' },
          { label: '1:N (one-to-many)', value: oneToN, color: 'text-blue-600' },
          { label: 'N:1 (many-to-one)', value: nToOne, color: 'text-teal-600' },
          { label: 'Soft / denormalized', value: softCount, color: 'text-amber-600' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-center">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by entity…"
            className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-teal-400 w-44"
          />
        </div>
        <div className="flex items-center gap-1 ml-1">
          {['all', 'erp', 'crm', 'pim', 'hr'].map(k => (
            <button key={k} onClick={() => setFilterSource(k)}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                filterSource === k ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}>
              {k === 'all' ? 'All sources' : k.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {(['all', '1:N', 'N:1'] as const).map(k => (
            <button key={k} onClick={() => setFilterCard(k)}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                filterCard === k ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}>
              {k === 'all' ? 'All cardinalities' : k}
            </button>
          ))}
        </div>
      </div>

      {isManufacturing ? (
        filtered.length === 0 ? (
          <div className="border border-dashed border-slate-200 rounded-xl p-8 text-center text-xs text-slate-400">
            No relations match the current filters.
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map(group => {
              const isOpen = collapsed[group.sourceKey] !== true
              return (
                <div key={group.source} className={`border ${group.colorBorder} rounded-xl overflow-hidden`}>
                  {/* Group header — clickable to collapse */}
                  <button
                    onClick={() => toggleCollapse(group.sourceKey)}
                    className={`w-full ${group.colorBg} px-4 py-3 flex items-center gap-2 hover:opacity-90 transition-opacity`}
                  >
                    <span className="text-base">{group.icon}</span>
                    <span className={`text-xs font-semibold ${group.colorText}`}>{group.source}</span>
                    <span className="ml-1 text-[10px] text-slate-400">
                      {group.relations.length} relation{group.relations.length !== 1 ? 's' : ''}
                    </span>
                    <ChevronDown className={`ml-auto w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                  </button>

                  {/* Relations list */}
                  {isOpen && (
                    <div className="divide-y divide-slate-100">
                      {group.relations.map((r, i) => {
                        const isSoft = 'soft' in r && r.soft === true
                        return (
                          <div key={i} className="px-4 py-3.5 bg-white hover:bg-slate-50 transition-colors">
                            {/* Top row: entity → entity + badges */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`font-mono text-xs font-semibold px-2 py-0.5 rounded ${group.colorBg} ${group.colorText}`}>{r.from}</span>
                              <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                                {r.cardinality === '1:N' ? (
                                  <>
                                    <span className="text-blue-500">1</span>
                                    <ArrowRight className="w-3 h-3" />
                                    <span className="text-blue-500">N</span>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-teal-500">N</span>
                                    <ArrowRight className="w-3 h-3" />
                                    <span className="text-teal-500">1</span>
                                  </>
                                )}
                              </div>
                              <span className={`font-mono text-xs font-semibold px-2 py-0.5 rounded ${group.colorBg} ${group.colorText}`}>{r.to}</span>
                              {isSoft && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200 font-medium">soft FK</span>
                              )}
                            </div>
                            {/* Bottom row: key + counts + note */}
                            <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                              <span className="font-mono text-[10px] text-slate-400 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                                via {r.via}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {r.fromRows.toLocaleString('en-US')} → {r.toRows > 0 ? r.toRows.toLocaleString('en-US') : 'n/a'}
                              </span>
                              <span className="text-[10px] text-slate-500">{r.note}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      ) : (
        <div className="border border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50 space-y-2">
          <p className="text-xs text-slate-400">No relations defined for this sector yet.</p>
          <p className="text-[11px] text-slate-400">
            Relations are inferred from FK edges you define in the{' '}
            <button onClick={() => onNavigate('entities')} className="text-teal-600 hover:underline">Entities</button> section.
          </p>
        </div>
      )}
    </div>
  )
}

export default function SemanticLayerView() {
  const { sectorId, sector } = useSector()
  const ontology = useExtendedOntology(sectorId)
  const [section, setSection] = useState<SLSection>('overview')
  const [userSources, setUserSources] = useState<SourceDef[]>(() => loadSources(sectorId))
  const [showAddSource, setShowAddSource] = useState(false)
  const [sourceForm, setSourceForm] = useState({ name: '', type: 'PostgreSQL', description: '', tables: '' })
  const [showAddEntity, setShowAddEntity] = useState(false)
  const [defTab, setDefTab] = useState<'mappings' | 'definitions' | 'ambiguity'>('mappings')
  const [savedEdits, setSavedEdits] = useState<Record<string, string>>({})
  const [editCount, setEditCount] = useState(0)
  const [defSearch, setDefSearch] = useState('')
  // Backend state
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null)
  const [backendSources, setBackendSources] = useState<BackendSource[]>([])
  const [backendMetrics, setBackendMetrics] = useState<BackendMetric[]>([])
  const [backendHierarchies, setBackendHierarchies] = useState<BackendHierarchy[]>([])
  const [backendSegments, setBackendSegments] = useState<BackendSegment[]>([])
  const [_loadingSemantics, setLoadingSemantics] = useState(false)
  // localStorage fallback (used only when backend offline)
  const [userMetrics, setUserMetrics] = useState<Metric[]>(() => loadMetrics(sectorId))
  const [userHierarchies, setUserHierarchies] = useState<DimHierarchy[]>(() => loadHierarchies(sectorId))
  const [userSegments, setUserSegments] = useState<Segment[]>(() => loadSegments(sectorId))
  const [metricForm, setMetricForm] = useState({ name: '', description: '', type: 'sum' as MetricType, entity: '', field: '', format: 'number' as MetricFormat })
  const [showAddMetric, setShowAddMetric] = useState(false)
  const [hierarchyForm, setHierarchyForm] = useState({ name: '', entity: '', description: '', type: 'categorical' as 'time' | 'categorical', levels: '' })
  const [showAddHierarchy, setShowAddHierarchy] = useState(false)
  const [segmentForm, setSegmentForm] = useState({ name: '', description: '', entity: '', field: '', operator: '=' as SegmentOperator, value: '' })
  const [showAddSegment, setShowAddSegment] = useState(false)
  const [pgQuery, setPgQuery] = useState('')
  const [pgRunning, setPgRunning] = useState(false)
  const [pgResult, setPgResult] = useState<PlaygroundScenario | null>(null)
  const [pgNoMatch, setPgNoMatch] = useState(false)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)

  useEffect(() => {
    setUserSources(loadSources(sectorId))
    setUserMetrics(loadMetrics(sectorId))
    setUserHierarchies(loadHierarchies(sectorId))
    setUserSegments(loadSegments(sectorId))
    setSection('overview')
    setShowAddSource(false)
    setShowAddEntity(false)
    setSavedEdits({})
    setEditCount(0)
    setDefSearch('')
    setShowAddMetric(false)
    setShowAddHierarchy(false)
    setShowAddSegment(false)
    setPgQuery(''); setPgResult(null); setPgNoMatch(false); setPgRunning(false)
    setSidebarSearch(''); setSearchFocused(false)
  }, [sectorId])

  const loadFromBackend = useCallback(async () => {
    setLoadingSemantics(true)
    try {
      const ok = await checkBackend()
      setBackendOnline(ok)
      if (!ok) return
      const [srcs, mets, hiers, segs] = await Promise.all([
        semanticSources().catch(() => []),
        getMetrics(sectorId).catch(() => []),
        getHierarchies(sectorId).catch(() => []),
        getSegments(sectorId).catch(() => []),
      ])
      setBackendSources(srcs)
      setBackendMetrics(mets)
      setBackendHierarchies(hiers)
      setBackendSegments(segs)
    } catch {
      setBackendOnline(false)
    } finally {
      setLoadingSemantics(false)
    }
  }, [sectorId])

  useEffect(() => { loadFromBackend() }, [loadFromBackend])

  const isManufacturing = sectorId === 'manufacturing'
  const pgExamples: { id: number; question: string }[] = []
  const baseNodeIds = new Set(SECTORS[sectorId].ontology.nodes.map(n => n.id))
  const nodeCount = ontology.nodes.length
  const edgeCount = ontology.edges.length
  const userBridgesCount = loadExtension(sectorId).edges.length
  const userRulesCount = loadUserRules(sectorId).length
  const totalRows = isManufacturing ? 193062 : ontology.nodes.reduce((sum, n) => sum + (n.data.row_count ?? 0), 0)
  const entityOptions = ontology.nodes.map(n => n.data.label)

  const sourcesCount = isManufacturing ? 4 : userSources.length
  const bridgesCount = isManufacturing ? 3 + userBridgesCount : userBridgesCount
  const rulesCount = isManufacturing ? 3 + userRulesCount : userRulesCount

  const allMappings = useMemo(() => generateMappings(ontology.nodes), [ontology.nodes])
  const filteredMappings = useMemo(() => {
    if (!defSearch.trim()) return allMappings
    const q = defSearch.toLowerCase()
    return allMappings.filter(r =>
      r.field.includes(q) || r.table.includes(q) ||
      r.ontologyClass.toLowerCase().includes(q) || r.ontologyProperty.toLowerCase().includes(q)
    )
  }, [allMappings, defSearch])
  const groupedMappings = useMemo(() =>
    filteredMappings.reduce<Record<string, MappingRow[]>>((acc, row) => { (acc[row.table] ??= []).push(row); return acc }, {})
  , [filteredMappings])
  function handleMappingSave(key: string, value: string) { setSavedEdits(p => ({ ...p, [key]: value })); setEditCount(c => c + 1) }

  const progressItems = [
    { label: 'Sources defined',    done: sourcesCount > 0,              section: 'sources'   as SLSection },
    { label: 'Entities mapped',    done: nodeCount > 0,                  section: 'entities'  as SLSection },
    { label: 'Bridges configured', done: bridgesCount > 0,              section: 'bridges'   as SLSection },
    { label: 'Rules defined',      done: rulesCount > 0 || isManufacturing, section: 'rules' as SLSection },
  ]
  const progressPct = Math.round((progressItems.filter(p => p.done).length / progressItems.length) * 100)

  // When backend is online, use backend data; otherwise fall back to hardcoded + localStorage
  const useBackendData = backendOnline === true
  const builtinMetrics = useBackendData ? [] : (isManufacturing ? AW_METRICS : [])
  const builtinHierarchies = useBackendData ? [] : (isManufacturing ? AW_HIERARCHIES : [])
  const builtinSegments = useBackendData ? [] : (isManufacturing ? AW_SEGMENTS : [])
  // Backend data is already split into builtin+user on the server; show as one unified list
  const allMetricsList = useBackendData ? backendMetrics : [...builtinMetrics, ...userMetrics]
  const allHierarchiesList = useBackendData ? backendHierarchies : [...builtinHierarchies, ...userHierarchies]
  const allSegmentsList = useBackendData ? backendSegments : [...builtinSegments, ...userSegments]
  const metricsCount = allMetricsList.length
  const hierarchiesCount = allHierarchiesList.length
  const segmentsCount = allSegmentsList.length

  function getBadge(id: SLSection): number {
    if (id === 'sources')     return sourcesCount
    if (id === 'entities')    return nodeCount
    if (id === 'bridges')     return bridgesCount
    if (id === 'relations')   return isManufacturing ? AW_RELATIONS.reduce((acc, g) => acc + g.relations.length, 0) : 0
    if (id === 'rules')       return rulesCount
    if (id === 'definitions') return allMappings.length
    if (id === 'metrics')     return metricsCount
    if (id === 'hierarchies') return hierarchiesCount
    if (id === 'segments')    return segmentsCount
    return 0
  }

  async function addMetric() {
    if (!metricForm.name.trim() || !metricForm.entity.trim()) return
    if (useBackendData) {
      try {
        const created = await createMetric({ sector_id: sectorId as string, name: metricForm.name, description: metricForm.description, type: metricForm.type as BackendMetric['type'], entity: metricForm.entity, field: metricForm.field, format: metricForm.format as BackendMetric['format'], filters: [], grains: ['month', 'quarter', 'year'], status: 'draft', tags: [], time_dimension: '', numerator: '', denominator: '', expression: '', owner: '' })
        setBackendMetrics(prev => [...prev, created])
      } catch { /* silent */ }
    } else {
      const m: Metric = { id: `m-${Date.now()}`, ...metricForm, filters: [], grains: ['month', 'quarter', 'year'], status: 'draft', tags: [] }
      const updated = [...userMetrics, m]; setUserMetrics(updated); saveMetrics(sectorId, updated)
    }
    setMetricForm({ name: '', description: '', type: 'sum', entity: '', field: '', format: 'number' }); setShowAddMetric(false)
  }
  async function removeMetric(id: string) {
    if (useBackendData) {
      try { await apiDeleteMetric(id); setBackendMetrics(prev => prev.filter(m => m.id !== id)) } catch { /* silent */ }
    } else {
      const u = userMetrics.filter(m => m.id !== id); setUserMetrics(u); saveMetrics(sectorId, u)
    }
  }

  async function addHierarchy() {
    if (!hierarchyForm.name.trim() || !hierarchyForm.entity.trim()) return
    const levels = hierarchyForm.levels.split(',').map(l => l.trim()).filter(Boolean).map(l => ({ name: l, field: `${hierarchyForm.entity}.${l.toLowerCase()}` }))
    if (useBackendData) {
      try {
        const created = await createHierarchy({ sector_id: sectorId as string, ...hierarchyForm, levels })
        setBackendHierarchies(prev => [...prev, created])
      } catch { /* silent */ }
    } else {
      const h: DimHierarchy = { id: `h-${Date.now()}`, ...hierarchyForm, levels }
      const updated = [...userHierarchies, h]; setUserHierarchies(updated); saveHierarchies(sectorId, updated)
    }
    setHierarchyForm({ name: '', entity: '', description: '', type: 'categorical', levels: '' }); setShowAddHierarchy(false)
  }
  async function removeHierarchy(id: string) {
    if (useBackendData) {
      try { await apiDeleteHierarchy(id); setBackendHierarchies(prev => prev.filter(h => h.id !== id)) } catch { /* silent */ }
    } else {
      const u = userHierarchies.filter(h => h.id !== id); setUserHierarchies(u); saveHierarchies(sectorId, u)
    }
  }

  async function addSegment() {
    if (!segmentForm.name.trim() || !segmentForm.entity.trim() || !segmentForm.field.trim()) return
    const conditions = [{ field: segmentForm.field, operator: segmentForm.operator, value: segmentForm.value }]
    if (useBackendData) {
      try {
        const created = await createSegment({ sector_id: sectorId as string, name: segmentForm.name, description: segmentForm.description, entity: segmentForm.entity, conditions, tags: [], used_by: [] })
        setBackendSegments(prev => [...prev, created])
      } catch { /* silent */ }
    } else {
      const s: Segment = {
        id: `seg-${Date.now()}`, name: segmentForm.name, description: segmentForm.description,
        entity: segmentForm.entity, conditions, tags: [], usedBy: [],
      }
      const updated = [...userSegments, s]; setUserSegments(updated); saveSegments(sectorId, updated)
    }
    setSegmentForm({ name: '', description: '', entity: '', field: '', operator: '=', value: '' }); setShowAddSegment(false)
  }
  async function removeSegment(id: string) {
    if (useBackendData) {
      try { await apiDeleteSegment(id); setBackendSegments(prev => prev.filter(s => s.id !== id)) } catch { /* silent */ }
    } else {
      const u = userSegments.filter(s => s.id !== id); setUserSegments(u); saveSegments(sectorId, u)
    }
  }

  const allMetricsData = [...builtinMetrics, ...userMetrics]
  const allHierarchiesData = [...builtinHierarchies, ...userHierarchies]
  const allSegmentsData = [...builtinSegments, ...userSegments]

  const searchIndex = useMemo(
    () => buildSearchIndex(ontology.nodes, allMetricsData, allHierarchiesData, allSegmentsData),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ontology.nodes.length, metricsCount, hierarchiesCount, segmentsCount],
  )

  const searchResults = useMemo(() => {
    if (!sidebarSearch.trim()) return []
    return searchIndex
      .map(item => ({ item, score: scoreSearch(item, sidebarSearch) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(x => x.item)
  }, [searchIndex, sidebarSearch])

  async function runPlayground() {
    if (!pgQuery.trim()) return
    setPgRunning(true); setPgNoMatch(false); setPgResult(null)
    if (useBackendData) {
      try {
        const raw = await backendAsk(pgQuery, sectorId)
        const engineResult = adaptAskResult(raw)
        // Map backend result to PlaygroundScenario shape for the UI
        const backendScenario: PlaygroundScenario = {
          id: 'backend',
          question: pgQuery,
          keywords: [],
          resolution: {
            metrics:    raw.provenance ? Object.keys(raw.provenance).filter(k => k !== 'sources') : [],
            dimensions: [],
            segments:   [],
          },
          sql: engineResult.sql,
          columns: raw.rows.length > 0 ? Object.keys(raw.rows[0]) : [],
          rows: raw.rows as Record<string, string>[],
        }
        if (raw.ambiguity_error || raw.disambiguation_required) {
          setPgNoMatch(true)
        } else {
          setPgResult(backendScenario)
        }
      } catch {
        setPgNoMatch(true)
      } finally {
        setPgRunning(false)
      }
    } else {
      setTimeout(() => {
        if (isManufacturing) {
          const match = resolveQuery(pgQuery)
          if (match) { setPgResult(match) } else { setPgNoMatch(true) }
        } else {
          setPgNoMatch(true)
        }
        setPgRunning(false)
      }, 700)
    }
  }

  function exportYAML() {
    const layer = {
      semantic_layer: {
        version: 1,
        sector: sector.name,
        sources: isManufacturing ? [
          { id: 'erp', name: 'ERP — OrionSales', type: 'PostgreSQL' },
          { id: 'crm', name: 'CRM — ClientHub',  type: 'SQLite' },
          { id: 'hr',  name: 'HR CSV',           type: 'CSV' },
          { id: 'pim', name: 'PIM JSON',         type: 'JSON' },
        ] : userSources.map(s => ({ id: s.id, name: s.name, type: s.type })),
        entities: ontology.nodes.map(n => ({ id: n.id, label: n.data.label })),
        metrics: allMetricsData.map(m => ({
          id: m.id, name: m.name, type: m.type, entity: m.entity,
          ...(m.field && { field: m.field }),
          ...(m.numerator && { numerator: m.numerator }),
          ...(m.denominator && { denominator: m.denominator }),
          format: m.format, status: m.status,
        })),
        hierarchies: allHierarchiesData.map(h => ({
          id: h.id, name: h.name, entity: h.entity, type: h.type,
          levels: h.levels.map(l => l.name),
        })),
        segments: allSegmentsData.map(s => ({
          id: s.id, name: s.name, entity: s.entity,
          conditions: s.conditions,
        })),
      },
    }
    const json = JSON.stringify(layer, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `semantic-layer-${sectorId}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const coverageItems = [
    { label: 'Sources connected',   done: sourcesCount > 0,     pct: sourcesCount > 0 ? 100 : 0 },
    { label: 'Entities modelled',   done: nodeCount > 0,         pct: Math.min(100, nodeCount * 10) },
    { label: 'Bridges defined',     done: bridgesCount > 0,     pct: bridgesCount > 0 ? 100 : 0 },
    { label: 'Rules set',           done: rulesCount > 0,       pct: rulesCount > 0 ? 100 : 0 },
    { label: 'Metrics certified',   done: metricsCount > 0,     pct: Math.min(100, metricsCount * 17) },
    { label: 'Hierarchies defined', done: hierarchiesCount > 0, pct: Math.min(100, hierarchiesCount * 34) },
    { label: 'Segments saved',      done: segmentsCount > 0,    pct: Math.min(100, segmentsCount * 20) },
  ]
  const coverageScore = Math.round(coverageItems.reduce((s, i) => s + i.pct, 0) / coverageItems.length)

  function addSource() {
    if (!sourceForm.name.trim()) return
    const updated = [...userSources, { id: `src-${Date.now()}`, ...sourceForm }]
    setUserSources(updated); saveSources(sectorId, updated)
    setSourceForm({ name: '', type: 'PostgreSQL', description: '', tables: '' }); setShowAddSource(false)
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Sidebar ── */}
      <aside className="w-52 flex-shrink-0 border-r border-slate-200 bg-slate-50 flex flex-col overflow-hidden">
        {/* Title */}
        <div className="px-4 pt-4 pb-3 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <Network className="w-4 h-4 text-teal-600" />
            <span className="text-sm font-bold text-slate-900">Semantic Layer</span>
          </div>
          {/* Global search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
            <input
              value={sidebarSearch}
              onChange={e => setSidebarSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              placeholder="Search metrics, entities…"
              className="w-full text-[11px] pl-6 pr-2 py-1.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-teal-400 text-slate-700 placeholder-slate-400"
            />
            {sidebarSearch && (
              <button onClick={() => setSidebarSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          {/* Search results dropdown */}
          {searchFocused && sidebarSearch && searchResults.length > 0 && (
            <div className="absolute left-2 right-2 top-[calc(100%-4px)] bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
              {searchResults.map((r, i) => (
                <button key={i} onMouseDown={() => { setSection(r.section); setSidebarSearch('') }}
                  className="w-full text-left px-3 py-2 hover:bg-teal-50 border-b border-slate-100 last:border-0 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-bold rounded px-1 py-0.5 ${
                      r.type === 'Metric'    ? 'bg-blue-100 text-blue-700' :
                      r.type === 'Hierarchy' ? 'bg-violet-100 text-violet-700' :
                      r.type === 'Segment'   ? 'bg-orange-100 text-orange-700' :
                                               'bg-slate-100 text-slate-600'
                    }`}>{r.type}</span>
                    <span className="text-[11px] font-medium text-slate-800 truncate">{r.label}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          {searchFocused && sidebarSearch && searchResults.length === 0 && (
            <div className="absolute left-2 right-2 top-[calc(100%-4px)] bg-white border border-slate-200 rounded-xl shadow-lg z-50 px-3 py-2 text-[11px] text-slate-400">
              No results for "{sidebarSearch}"
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 overflow-y-auto">
          {SECTION_NAV.map(({ id, label, Icon, desc, group }, idx) => {
            const badge = getBadge(id)
            const active = section === id
            const showDivider = group && (idx === 0 || SECTION_NAV[idx - 1].group !== group)
            return (
              <div key={id}>
                {showDivider && (
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-3 pt-3 pb-1">{group}</p>
                )}
                <button
                  onClick={() => setSection(id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all mb-0.5 ${
                    active ? 'bg-teal-600 text-white shadow-sm' : 'hover:bg-white hover:shadow-sm text-slate-700'
                  }`}
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-teal-200' : 'text-slate-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold leading-none mb-0.5">{label}</p>
                    <p className={`text-[10px] truncate ${active ? 'text-teal-200' : 'text-slate-400'}`}>{desc}</p>
                  </div>
                  {badge > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                      active ? 'bg-white/25 text-white' : 'bg-teal-100 text-teal-700'
                    }`}>
                      {badge}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </nav>

        {/* Progress */}
        <div className="px-4 py-4 border-t border-slate-200 flex-shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Setup</p>
            <span className={`text-[10px] font-bold ${progressPct === 100 ? 'text-teal-600' : 'text-slate-500'}`}>
              {progressPct}%
            </span>
          </div>
          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden mb-3">
            <div
              className={`h-full rounded-full transition-all duration-500 ${progressPct === 100 ? 'bg-teal-500' : 'bg-teal-400'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="space-y-1.5">
            {progressItems.map((item, i) => (
              <button
                key={i}
                onClick={() => setSection(item.section)}
                className="w-full flex items-center gap-2 hover:opacity-80 transition-opacity text-left"
              >
                {item.done
                  ? <CheckCircle className="w-3 h-3 text-teal-500 flex-shrink-0" />
                  : <div className="w-3 h-3 rounded-full border-2 border-slate-300 flex-shrink-0" />
                }
                <span className={`text-[10px] ${item.done ? 'text-slate-600' : 'text-slate-400'}`}>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto">

        {/* ── OVERVIEW ── */}
        {section === 'overview' && (
          <div className="px-8 py-7 space-y-7">
            {/* Schema draft — auto-extracted config, always visible at top */}
            <SemanticDraftView />

            <SectionHeader icon={Layers} title="Overview"
              desc="Semantic layer status, coverage score, and data quality"
              action={
                <button onClick={exportYAML}
                  className="flex items-center gap-1.5 text-xs bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors font-medium shadow-sm">
                  <FileCode className="w-3.5 h-3.5" />Export JSON
                </button>
              }
            />

            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
              <StatCard label="Ontology Entities"  value={nodeCount.toString()} sub="semantic concepts" />
              <StatCard label="Verified Metrics"    value={metricsCount.toString()} sub="reusable measures" />
              <StatCard label="KG Nodes"            value={isManufacturing ? '193,062' : totalRows.toLocaleString()} sub="entity instances" accent />
              <StatCard label="KG Edges"            value={isManufacturing ? '313,193' : (edgeCount * 8).toLocaleString()} sub="semantic relations" accent />
            </div>

            {/* Completeness score */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Semantic Coverage</h3>
                  <p className="text-xs text-slate-500 mt-0.5">How well your data layer is defined for AI query resolution</p>
                </div>
                <div className="text-right">
                  <div className={`text-3xl font-black ${coverageScore >= 80 ? 'text-teal-600' : coverageScore >= 50 ? 'text-amber-500' : 'text-slate-400'}`}>{coverageScore}%</div>
                  <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">coverage</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-2">
                {coverageItems.map((item, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[11px] font-medium ${item.done ? 'text-slate-700' : 'text-slate-400'}`}>{item.label}</span>
                      <span className={`text-[11px] font-bold ${item.done ? 'text-teal-600' : 'text-slate-300'}`}>{item.pct}%</span>
                    </div>
                    <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${item.pct >= 80 ? 'bg-teal-400' : item.pct >= 40 ? 'bg-amber-400' : item.pct > 0 ? 'bg-slate-300' : 'bg-transparent'}`}
                        style={{ width: `${item.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quality summary */}
            {isManufacturing && (
              <div className="grid grid-cols-4 gap-3">
                {Object.entries(AW_SOURCE_FRESHNESS).map(([, f]) => (
                  <div key={f.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
                    <div className="flex items-start justify-between mb-2">
                      <p className="text-xs font-bold text-slate-800">{f.label}</p>
                      <FreshnessBadge status={f.status} lastSync={f.lastSync} sla={f.sla} />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 flex-1 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${f.quality >= 95 ? 'bg-teal-400' : f.quality >= 90 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${f.quality}%` }} />
                        </div>
                        <span className="text-[10px] font-bold text-slate-600">{f.quality}%</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className="h-1.5 w-24 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${f.quality >= 95 ? 'bg-teal-400' : f.quality >= 90 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${f.quality}%` }} />
                        </div>
                        <span className="text-[10px] font-bold text-slate-600">{f.quality}% quality</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Non-manufacturing: setup guide */}
            {!isManufacturing && (
              <div className="bg-gradient-to-br from-teal-50 to-slate-50 border border-teal-200 rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-teal-600" />
                  <h3 className="text-base font-bold text-slate-900">Build your semantic layer — step by step</h3>
                </div>
                <p className="text-sm text-slate-500 mb-5">
                  Follow these four steps to give AI agents a unified, queryable view of your company's data.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {progressItems.map((item, i) => (
                    <button key={i} onClick={() => setSection(item.section)}
                      className={`flex items-start gap-3 border rounded-xl p-4 text-left transition-all hover:shadow-md ${
                        item.done ? 'bg-white border-teal-200' : 'bg-white border-slate-200 hover:border-teal-300'
                      }`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                        item.done ? 'bg-teal-500 text-white' : 'bg-slate-200 text-slate-500'
                      }`}>
                        {item.done ? '✓' : i + 1}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900 capitalize">{item.label}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{
                          i === 0 ? 'Register your databases, CSVs and APIs' :
                          i === 1 ? 'Connect semantic names to physical tables' :
                          i === 2 ? 'Join data across different source systems' :
                          'Resolve terms that map to multiple fields'
                        }</p>
                        <span className={`mt-1.5 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          item.done ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {item.done ? `${getBadge(item.section)} configured` : 'Not started →'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Manufacturing: data quality */}
            {isManufacturing && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-slate-400" /> Data Quality Issues
                </h3>
                <div className="space-y-2">
                  {AW_QUALITY_ISSUES.map((issue, i) => {
                    const isWarn = issue.severity === 'warning'
                    return (
                      <div key={i} className={`border rounded-xl p-4 ${isWarn ? 'bg-amber-50 border-amber-200' : 'bg-sky-50 border-sky-200'}`}>
                        <div className="flex items-start gap-3">
                          {isWarn ? <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" /> : <Info className="w-4 h-4 text-sky-500 mt-0.5 flex-shrink-0" />}
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-xs font-semibold text-slate-700">{issue.entity}</span>
                              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${isWarn ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>{issue.severity}</span>
                            </div>
                            <p className="text-sm text-slate-700">{issue.issue}</p>
                            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                              <CheckCircle className="w-3 h-3 text-teal-500 flex-shrink-0" />{issue.resolution}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Manufacturing: query examples */}
            {isManufacturing && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-slate-400" /> Cross-source Query Examples
                  <span className="text-xs text-slate-400 font-normal">— click "Try" to run in Query AI</span>
                </h3>
                <p className="text-xs text-slate-400 mb-3">Full resolution path: natural language → entities → bridges → SQL.</p>
                <div className="space-y-3">
                  {AW_QUERY_EXAMPLES.map((ex, i) => <QueryExampleCard key={i} ex={ex} />)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PLAYGROUND ── */}
        {section === 'playground' && (
          <div className="px-8 py-7 space-y-5">
            <SectionHeader icon={Play} title="Query Playground"
              desc="Type a natural language question — see how the semantic layer resolves it into metrics, dimensions, segments, and SQL"
            />

            {/* Info banner */}
            <div className="bg-gradient-to-r from-violet-50 to-teal-50 border border-violet-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <Info className="w-4 h-4 text-violet-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-slate-600">
                The Query AI uses your <strong>Metrics</strong>, <strong>Hierarchies</strong>, and <strong>Segments</strong> as
                a certified resolution layer — instead of guessing column names, it maps intent to verified measures. Below you
                can see exactly what happens when a question arrives.
              </p>
            </div>

            {/* Query input */}
            <div className="flex gap-2">
              <input
                value={pgQuery}
                onChange={e => setPgQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runPlayground()}
                placeholder={isManufacturing
                  ? 'e.g. "Revenue by territory last quarter" or "Top B2B customers"'
                  : 'Connect sources and define metrics first to use the playground'}
                className="flex-1 text-sm border border-slate-200 rounded-xl px-4 py-3 bg-white outline-none focus:border-teal-400 shadow-sm"
                disabled={!isManufacturing}
              />
              <button onClick={runPlayground} disabled={pgRunning || !isManufacturing}
                className="px-5 py-3 bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-40 transition-colors font-medium text-sm flex items-center gap-2 shadow-sm">
                {pgRunning
                  ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <Play className="w-4 h-4" />}
                Resolve
              </button>
            </div>

            {/* Quick examples */}
            {!pgResult && !pgRunning && pgExamples.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Try an example</p>
                <div className="flex flex-wrap gap-2">
                  {pgExamples.map(s => (
                    <button key={s.id}
                      onClick={() => { setPgQuery(s.question); setPgResult(null); setPgNoMatch(false) }}
                      className="text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-3 py-1.5 hover:bg-teal-100 transition-colors font-medium">
                      {s.question}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Result */}
            {pgResult && !pgRunning && (
              <div className="space-y-4">
                {/* Question echo */}
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <span className="text-sm font-semibold text-slate-700">"{pgQuery}"</span>
                </div>

                {/* Resolution cards */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                      <BarChart2 className="w-3.5 h-3.5" />Metrics resolved
                    </p>
                    {pgResult.resolution.metrics.map(m => (
                      <div key={m} className="flex items-center gap-2 mb-1.5">
                        <CheckCircle className="w-3.5 h-3.5 text-teal-500 flex-shrink-0" />
                        <span className="text-xs font-semibold text-slate-800">{m}</span>
                      </div>
                    ))}
                  </div>
                  <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
                    <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3.5 h-3.5" />Dimensions
                    </p>
                    {pgResult.resolution.dimensions.length > 0
                      ? pgResult.resolution.dimensions.map(d => (
                          <div key={d.name} className="flex items-center gap-2 mb-1.5">
                            <CheckCircle className="w-3.5 h-3.5 text-teal-500 flex-shrink-0" />
                            <span className="text-xs font-semibold text-slate-800">{d.name}{d.grain ? <span className="font-normal text-slate-500"> ({d.grain})</span> : null}</span>
                          </div>
                        ))
                      : <span className="text-xs text-slate-400 italic">None needed</span>
                    }
                  </div>
                  <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                    <p className="text-[10px] font-bold text-orange-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                      <Filter className="w-3.5 h-3.5" />Segments applied
                    </p>
                    {pgResult.resolution.segments.length > 0
                      ? pgResult.resolution.segments.map(s => (
                          <div key={s} className="flex items-center gap-2 mb-1.5">
                            <CheckCircle className="w-3.5 h-3.5 text-teal-500 flex-shrink-0" />
                            <span className="text-xs font-semibold text-slate-800">{s}</span>
                          </div>
                        ))
                      : <span className="text-xs text-slate-400 italic">None applied</span>
                    }
                  </div>
                </div>

                {/* Generated SQL */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Generated SQL</p>
                    <button onClick={() => navigator.clipboard.writeText(pgResult.sql)}
                      className="flex items-center gap-1.5 text-[11px] text-teal-600 hover:text-teal-700 font-medium">
                      <FileCode className="w-3 h-3" />Copy
                    </button>
                  </div>
                  <pre className="text-xs font-mono bg-slate-900 text-slate-100 rounded-xl px-5 py-4 overflow-x-auto leading-relaxed whitespace-pre">{pgResult.sql}</pre>
                </div>

                {/* Sample results table */}
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-2">Sample Results</p>
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>{pgResult.columns.map(c => (
                          <th key={c} className="px-4 py-2.5 text-left font-bold text-slate-600 text-[11px]">{c}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {pgResult.rows.map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            {pgResult.columns.map(c => (
                              <td key={c} className="px-4 py-2.5 text-slate-700">{row[c]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Try another */}
                <button onClick={() => { setPgResult(null); setPgQuery('') }}
                  className="text-xs text-slate-500 hover:text-teal-600 font-medium flex items-center gap-1 transition-colors">
                  <ArrowRight className="w-3 h-3" />Try another query
                </button>
              </div>
            )}

            {/* No match */}
            {pgNoMatch && !pgRunning && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800 mb-1">No semantic match found</p>
                  <p className="text-xs text-amber-700">
                    No metric, hierarchy, or segment matched your query. Try one of the examples above,
                    or define new metrics and segments in the Semantics section.
                  </p>
                </div>
              </div>
            )}

            {!isManufacturing && (
              <div className="text-center py-12 text-slate-400">
                <Play className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-semibold">No semantic layer to query yet</p>
                <p className="text-xs mt-1">Connect sources, model entities, and define metrics first.</p>
              </div>
            )}
          </div>
        )}

        {/* ── SOURCES ── */}
        {section === 'sources' && (
          <div className="px-8 py-7 space-y-5">
            <SectionHeader icon={Database} title="Data Sources"
              desc={isManufacturing ? '4 heterogeneous systems integrated into the semantic layer' : 'Register every physical data system that feeds your semantic layer'}
              action={!isManufacturing
                ? <button onClick={() => setShowAddSource(v => !v)}
                    className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium transition-colors ${
                      showAddSource ? 'bg-slate-200 text-slate-700' : 'bg-teal-600 text-white hover:bg-teal-700'
                    }`}>
                    <Plus className="w-3.5 h-3.5" /> Add source
                  </button>
                : undefined
              }
            />

            {/* Backend live freshness bar */}
            {useBackendData && backendSources.length > 0 && (
              <div className="grid grid-cols-3 gap-3 pb-1">
                {backendSources.map(src => (
                  <div key={src.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-slate-800">{src.name.toUpperCase()}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{src.total_rows.toLocaleString()} rows · {src.source_type}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className="h-1.5 w-20 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${src.quality_score >= 95 ? 'bg-teal-400' : src.quality_score >= 90 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${src.quality_score}%` }} />
                        </div>
                        <span className="text-[10px] font-bold text-slate-500">{src.quality_score}%</span>
                      </div>
                    </div>
                    <FreshnessBadge status={src.freshness_status} lastSync={src.loaded_at ?? '—'} sla="Live" />
                  </div>
                ))}
              </div>
            )}

            {isManufacturing ? (
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {AW_SOURCES.map(s => <SourceCard key={s.id} source={s} />)}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Add form */}
                {showAddSource && (
                  <div className="bg-teal-50 border border-teal-200 rounded-xl p-5 space-y-4">
                    <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                      <Server className="w-4 h-4 text-teal-600" /> New data source
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-medium text-slate-600 mb-1 block">Name <span className="text-red-400">*</span></label>
                        <input value={sourceForm.name} onChange={e => setSourceForm(f => ({ ...f, name: e.target.value }))}
                          placeholder="e.g. ERP — SAP S/4HANA"
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white focus:border-teal-400 outline-none" />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-slate-600 mb-1 block">Type</label>
                        <select value={sourceForm.type} onChange={e => setSourceForm(f => ({ ...f, type: e.target.value }))}
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white focus:border-teal-400 outline-none">
                          {SOURCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-slate-600 mb-1 block">Description</label>
                        <input value={sourceForm.description} onChange={e => setSourceForm(f => ({ ...f, description: e.target.value }))}
                          placeholder="What data does this source contain?"
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white focus:border-teal-400 outline-none" />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-slate-600 mb-1 block">Tables / collections</label>
                        <input value={sourceForm.tables} onChange={e => setSourceForm(f => ({ ...f, tables: e.target.value }))}
                          placeholder="orders, customers, products"
                          className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white focus:border-teal-400 outline-none font-mono" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addSource} disabled={!sourceForm.name.trim()}
                        className="text-xs bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-40 transition-colors font-medium">
                        Save source
                      </button>
                      <button onClick={() => setShowAddSource(false)} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2 transition-colors">Cancel</button>
                    </div>
                  </div>
                )}

                {userSources.length === 0 && !showAddSource && (
                  <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center">
                    <Server className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-slate-500">No data sources defined yet</p>
                    <p className="text-xs text-slate-400 mt-1 mb-4 max-w-xs mx-auto">
                      Document each database, CSV, API, or warehouse that feeds your semantic layer.
                    </p>
                    <button onClick={() => setShowAddSource(true)} className="text-xs bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium">
                      + Add first source
                    </button>
                  </div>
                )}
                {userSources.map(s => (
                  <UserSourceCard key={s.id} source={s} onDelete={() => {
                    const u = userSources.filter(x => x.id !== s.id)
                    setUserSources(u); saveSources(sectorId, u)
                  }} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ENTITIES ── */}
        {section === 'entities' && (
          <div className="px-8 py-7 space-y-5">
            <SectionHeader icon={Network} title="Semantic Entities"
              desc="Each entity abstracts a physical table — expand to view fields, click Edit to set semantic → physical mappings"
              action={
                <button onClick={() => setShowAddEntity(v => !v)}
                  className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium transition-colors ${
                    showAddEntity ? 'bg-slate-200 text-slate-700' : 'bg-teal-600 text-white hover:bg-teal-700'
                  }`}>
                  <Plus className="w-3.5 h-3.5" /> Add entity
                </button>
              }
            />
            {showAddEntity && (
              <AddEntityForm sectorId={sectorId} entityOptions={entityOptions} onDone={() => setShowAddEntity(false)} />
            )}
            <div className="space-y-2">
              {ontology.nodes.map(node => (
                <EntityCard
                  key={node.id}
                  nodeId={node.id}
                  ontologyNode={node.data}
                  sectorId={sectorId}
                  isBase={baseNodeIds.has(node.id)}
                  entityOptions={entityOptions}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── BRIDGES ── */}
        {section === 'bridges' && (
          <div className="px-8 py-7 space-y-5">
            <SectionHeader icon={GitBranch} title="Cross-source Bridges"
              desc="Semantic joins that connect entities living in different physical systems" />
            <p className="text-xs text-slate-500 leading-relaxed">
              A bridge tells the semantic layer: <em>"field X in system A is the same concept as field Y in system B."</em>
              This enables a single query to pull data from multiple sources without knowing the underlying schema differences.
            </p>

            {/* Built-in bridges (manufacturing) */}
            {isManufacturing && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Built-in bridges</p>
                {AW_BRIDGES.map(b => <BridgeCard key={b.id} bridge={b} />)}
              </div>
            )}

            {/* User bridges (all sectors) */}
            <div className={isManufacturing ? 'border-t border-slate-200 pt-5' : ''}>
              {isManufacturing && (
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Custom bridges</p>
              )}
              <BridgesBuilder sectorId={sectorId} entityOptions={entityOptions} />
            </div>
          </div>
        )}

        {/* ── RELATIONS ── */}
        {section === 'relations' && (
          <RelationsSection isManufacturing={isManufacturing} onNavigate={setSection} />
        )}

        {/* ── RULES ── */}
        {section === 'rules' && (
          <div className="px-8 py-7 space-y-5">
            <SectionHeader icon={BookOpen} title="Disambiguation Rules"
              desc="Resolve ambiguous business terms before the Query AI runs" />
            <p className="text-xs text-slate-500 leading-relaxed">
              When a term like <em>"revenue"</em> maps to two different columns (e.g. net vs. gross), a rule makes the Query AI
              ask the right question upfront — instead of silently picking the wrong field and returning incorrect results.
            </p>

            {/* Built-in rules (manufacturing) */}
            {isManufacturing && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Built-in rules</p>
                {AW_DISAMBIGUATION_RULES.map((rule, i) => <DisambiguationCard key={i} rule={rule} />)}
              </div>
            )}

            {/* User rules (all sectors) */}
            <div className={isManufacturing ? 'border-t border-slate-200 pt-5' : ''}>
              {isManufacturing && (
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Custom rules</p>
              )}
              <RulesBuilder sectorId={sectorId} />
            </div>
          </div>
        )}

        {/* ── METRICS ── */}
        {section === 'metrics' && (
          <div className="px-8 py-7 space-y-5">
            <SectionHeader icon={BarChart2} title="Metrics Catalog"
              desc="Reusable business measures — certified, versioned, and referenced by Query AI"
              action={
                <button onClick={() => setShowAddMetric(v => !v)}
                  className="flex items-center gap-1.5 text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 transition-colors font-medium">
                  <Plus className="w-3.5 h-3.5" />Define metric
                </button>
              }
            />
            <p className="text-xs text-slate-500 leading-relaxed">
              A metric is a named, reusable aggregation — <code className="font-mono bg-slate-100 px-1 rounded">SUM</code>, <code className="font-mono bg-slate-100 px-1 rounded">COUNT</code>, <code className="font-mono bg-slate-100 px-1 rounded">RATIO</code>, etc. — that the Query AI treats as a <em>certified answer</em> rather than
              recomputing from scratch each time. Define it once; use it everywhere.
            </p>

            {showAddMetric && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-700">New metric</p>
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Name</label>
                    <input value={metricForm.name} onChange={e => setMetricForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Monthly Revenue" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400" /></div>
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Type</label>
                    <select value={metricForm.type} onChange={e => setMetricForm(f => ({ ...f, type: e.target.value as MetricType }))}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400">
                      {(['sum','count','count_distinct','avg','ratio','derived'] as MetricType[]).map(t => <option key={t} value={t}>{METRIC_TYPE_LABEL[t]}</option>)}
                    </select></div>
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Entity</label>
                    <select value={metricForm.entity} onChange={e => setMetricForm(f => ({ ...f, entity: e.target.value }))}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400">
                      <option value="">Select entity…</option>
                      {entityOptions.map(e => <option key={e} value={e}>{e}</option>)}
                    </select></div>
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Field</label>
                    <input value={metricForm.field} onChange={e => setMetricForm(f => ({ ...f, field: e.target.value }))}
                      placeholder="e.g. subtotalAmount" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white font-mono outline-none focus:border-teal-400" /></div>
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Format</label>
                    <select value={metricForm.format} onChange={e => setMetricForm(f => ({ ...f, format: e.target.value as MetricFormat }))}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400">
                      {(['number','currency','percentage'] as MetricFormat[]).map(f => <option key={f} value={f}>{f}</option>)}
                    </select></div>
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Description</label>
                    <input value={metricForm.description} onChange={e => setMetricForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="What does this measure?" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400" /></div>
                </div>
                <div className="flex gap-2">
                  <button onClick={addMetric} className="text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700">Add</button>
                  <button onClick={() => setShowAddMetric(false)} className="text-xs text-slate-500 px-3 py-1.5 rounded-lg hover:bg-slate-100">Cancel</button>
                </div>
              </div>
            )}

            {isManufacturing && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Verified · Built-in</p>
                {AW_METRICS.map(m => <MetricCard key={m.id} metric={m} />)}
              </div>
            )}

            {userMetrics.length > 0 && (
              <div className={isManufacturing ? 'border-t border-slate-200 pt-5 space-y-3' : 'space-y-3'}>
                {isManufacturing && <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Custom metrics</p>}
                {userMetrics.map(m => <MetricCard key={m.id} metric={m} onDelete={() => removeMetric(m.id)} />)}
              </div>
            )}

            {metricsCount === 0 && (
              <div className="text-center py-12 text-slate-400">
                <BarChart2 className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No metrics defined yet</p>
                <p className="text-xs mt-1">Click "Define metric" to add your first business measure.</p>
              </div>
            )}
          </div>
        )}

        {/* ── HIERARCHIES ── */}
        {section === 'hierarchies' && (
          <div className="px-8 py-7 space-y-5">
            <SectionHeader icon={SlidersHorizontal} title="Dimension Hierarchies"
              desc="Structured drill-down paths — Year → Quarter → Month → Day, Category → Product"
              action={
                <button onClick={() => setShowAddHierarchy(v => !v)}
                  className="flex items-center gap-1.5 text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 transition-colors font-medium">
                  <Plus className="w-3.5 h-3.5" />Add hierarchy
                </button>
              }
            />
            <p className="text-xs text-slate-500 leading-relaxed">
              A hierarchy tells the Query AI which drill-down paths are valid. "Break revenue down by quarter" becomes an exact
              traversal of the Date hierarchy — no guessing, no incorrect groupings.
            </p>

            {showAddHierarchy && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-700">New hierarchy</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Name</label>
                    <input value={hierarchyForm.name} onChange={e => setHierarchyForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Date" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400" /></div>
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Entity</label>
                    <select value={hierarchyForm.entity} onChange={e => setHierarchyForm(f => ({ ...f, entity: e.target.value }))}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400">
                      <option value="">Select entity…</option>
                      {entityOptions.map(e => <option key={e} value={e}>{e}</option>)}
                    </select></div>
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Type</label>
                    <select value={hierarchyForm.type} onChange={e => setHierarchyForm(f => ({ ...f, type: e.target.value as 'time' | 'categorical' }))}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400">
                      <option value="time">Time</option><option value="categorical">Categorical</option>
                    </select></div>
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Levels (comma-separated)</label>
                    <input value={hierarchyForm.levels} onChange={e => setHierarchyForm(f => ({ ...f, levels: e.target.value }))}
                      placeholder="e.g. Year, Quarter, Month, Day" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400" /></div>
                  <div className="col-span-2"><label className="text-[11px] text-slate-500 mb-1 block">Description</label>
                    <input value={hierarchyForm.description} onChange={e => setHierarchyForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="What does this hierarchy represent?" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400" /></div>
                </div>
                <div className="flex gap-2">
                  <button onClick={addHierarchy} className="text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700">Add</button>
                  <button onClick={() => setShowAddHierarchy(false)} className="text-xs text-slate-500 px-3 py-1.5 rounded-lg hover:bg-slate-100">Cancel</button>
                </div>
              </div>
            )}

            {isManufacturing && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Built-in</p>
                {AW_HIERARCHIES.map(h => <HierarchyCard key={h.id} h={h} />)}
              </div>
            )}

            {userHierarchies.length > 0 && (
              <div className={isManufacturing ? 'border-t border-slate-200 pt-5 space-y-3' : 'space-y-3'}>
                {isManufacturing && <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Custom hierarchies</p>}
                {userHierarchies.map(h => <HierarchyCard key={h.id} h={h} onDelete={() => removeHierarchy(h.id)} />)}
              </div>
            )}

            {hierarchiesCount === 0 && (
              <div className="text-center py-12 text-slate-400">
                <SlidersHorizontal className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No hierarchies defined yet</p>
                <p className="text-xs mt-1">Click "Add hierarchy" to define a drill-down path.</p>
              </div>
            )}
          </div>
        )}

        {/* ── SEGMENTS ── */}
        {section === 'segments' && (
          <div className="px-8 py-7 space-y-5">
            <SectionHeader icon={Filter} title="Saved Segments"
              desc="Named filter conditions — reused by metrics and referenced by Query AI"
              action={
                <button onClick={() => setShowAddSegment(v => !v)}
                  className="flex items-center gap-1.5 text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 transition-colors font-medium">
                  <Plus className="w-3.5 h-3.5" />Add segment
                </button>
              }
            />
            <p className="text-xs text-slate-500 leading-relaxed">
              A segment is a <em>reusable</em> WHERE clause. Instead of typing <code className="font-mono bg-slate-100 px-1 rounded">customerType = 'Company'</code> in every metric,
              you define a "B2B Customers" segment once and reference it by name.
            </p>

            {showAddSegment && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-700">New segment</p>
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Name</label>
                    <input value={segmentForm.name} onChange={e => setSegmentForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. B2B Customers" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400" /></div>
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Entity</label>
                    <select value={segmentForm.entity} onChange={e => setSegmentForm(f => ({ ...f, entity: e.target.value }))}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400">
                      <option value="">Select entity…</option>
                      {entityOptions.map(e => <option key={e} value={e}>{e}</option>)}
                    </select></div>
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Description</label>
                    <input value={segmentForm.description} onChange={e => setSegmentForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="What does this filter select?" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400" /></div>
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Field</label>
                    <input value={segmentForm.field} onChange={e => setSegmentForm(f => ({ ...f, field: e.target.value }))}
                      placeholder="e.g. Customer.customerType" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white font-mono outline-none focus:border-teal-400" /></div>
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Operator</label>
                    <select value={segmentForm.operator} onChange={e => setSegmentForm(f => ({ ...f, operator: e.target.value as SegmentOperator }))}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400">
                      {(['=','!=','IN','NOT IN','>','<','>=','<='] as SegmentOperator[]).map(op => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
                    </select></div>
                  <div><label className="text-[11px] text-slate-500 mb-1 block">Value</label>
                    <input value={segmentForm.value} onChange={e => setSegmentForm(f => ({ ...f, value: e.target.value }))}
                      placeholder="e.g. 'Company'" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white font-mono outline-none focus:border-teal-400" /></div>
                </div>
                <div className="flex gap-2">
                  <button onClick={addSegment} className="text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700">Add</button>
                  <button onClick={() => setShowAddSegment(false)} className="text-xs text-slate-500 px-3 py-1.5 rounded-lg hover:bg-slate-100">Cancel</button>
                </div>
              </div>
            )}

            {isManufacturing && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Built-in</p>
                {AW_SEGMENTS.map(s => <SegmentCard key={s.id} seg={s} />)}
              </div>
            )}

            {userSegments.length > 0 && (
              <div className={isManufacturing ? 'border-t border-slate-200 pt-5 space-y-3' : 'space-y-3'}>
                {isManufacturing && <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Custom segments</p>}
                {userSegments.map(s => <SegmentCard key={s.id} seg={s} onDelete={() => removeSegment(s.id)} />)}
              </div>
            )}

            {segmentsCount === 0 && (
              <div className="text-center py-12 text-slate-400">
                <Filter className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No segments defined yet</p>
                <p className="text-xs mt-1">Click "Add segment" to define a reusable filter condition.</p>
              </div>
            )}
          </div>
        )}

        {/* ── DEFINITIONS ── */}
        {section === 'definitions' && (
          <div className="px-8 py-7 space-y-5">
            <SectionHeader icon={Tag} title="Field Definitions"
              desc="Semantic glossary, field-to-ontology mappings, and ambiguity resolutions"
              action={editCount > 0 ? (
                <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-3 py-1 font-medium">
                  {editCount} edit{editCount !== 1 ? 's' : ''} saved
                </span>
              ) : undefined}
            />

            {/* Sub-tab selector */}
            <div className="flex items-center gap-1 border-b border-slate-200">
              {([
                { id: 'mappings'    as const, label: 'Field Mappings',       Icon: Table2       },
                { id: 'definitions' as const, label: 'Semantic Definitions', Icon: BookOpen     },
                { id: 'ambiguity'   as const, label: 'Ambiguity Log',        Icon: AlertTriangle },
              ]).map(({ id, label, Icon }) => (
                <button key={id} onClick={() => setDefTab(id)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                    defTab === id ? 'border-teal-500 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}>
                  <Icon className="w-3.5 h-3.5" />{label}
                </button>
              ))}
            </div>

            {/* Field Mappings tab */}
            {defTab === 'mappings' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input value={defSearch} onChange={e => setDefSearch(e.target.value)}
                      placeholder="Search fields, classes, tables…"
                      className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 focus:border-teal-400 rounded-lg outline-none transition-colors" />
                  </div>
                  <p className="text-xs text-slate-500">{allMappings.length} fields · {new Set(allMappings.map(r => r.table)).size} tables</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-slate-400">Types:</span>
                  {Object.keys(DEF_TYPE_COLORS).map(t => <DefTypeBadge key={t} type={t} />)}
                </div>
                {Object.keys(groupedMappings).length === 0
                  ? <div className="text-center py-12 text-slate-400 text-sm">No mappings match your search.</div>
                  : Object.entries(groupedMappings).map(([table, rows]) => (
                    <MappingTableGroup key={table} table={table} rows={rows} savedEdits={savedEdits} onSave={handleMappingSave} />
                  ))
                }
              </div>
            )}

            {/* Semantic Definitions tab */}
            {defTab === 'definitions' && <SemanticDefsPanel />}

            {/* Ambiguity Log tab */}
            {defTab === 'ambiguity' && <AmbiguityLogPanel />}
          </div>
        )}

      </div>
    </div>
  )
}
