import { useState, useMemo } from 'react'
import { Table2, Pencil, Check, X, Search, GitBranch, ChevronDown, ChevronRight, BookOpen, AlertTriangle, Plus, Tag } from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { useExtendedOntology } from '../data/ontologyExtensions'
import type { OntologyNode } from '../types'

// ── Semantic Definitions ──────────────────────────────────────────────────────

interface SemanticDef {
  entity: string
  field: string
  definition: string
  status: 'ok' | 'ambiguous' | 'todo'
}

const INITIAL_DEFS: SemanticDef[] = [
  { entity: 'SalesOrder', field: 'subtotal_amount', definition: 'Net order amount before taxes and shipping. Use for "commercial revenue" ($20.1M 2014).', status: 'ok' },
  { entity: 'SalesOrder', field: 'total_due',       definition: 'Total amount due including taxes and freight. Use for "gross revenue" ($22.4M 2014).', status: 'ambiguous' },
  { entity: 'SalesOrder', field: 'online_order_flag', definition: 'TRUE = online order (B2C), FALSE = offline order (B2B via sales rep).', status: 'ok' },
  { entity: 'Customer',   field: 'accountId',       definition: 'CRM primary key. Negative values = duplicates from legacy migration. Removed from KG (372 accounts).', status: 'ok' },
  { entity: 'Customer',   field: 'customer_ref',    definition: 'Foreign key in ERP pointing to CRM.accountId. Main ERP↔CRM bridge.', status: 'ok' },
  { entity: 'Employee',   field: 'matricolaDip',    definition: 'HR employee code (Italian schema). Corresponds to salesperson_ref in ERP for the ERP↔HR bridge.', status: 'ok' },
  { entity: 'Employee',   field: 'cognome',         definition: 'Employee last name (Italian). Maps to Employee.lastName in the semantic layer.', status: 'ok' },
  { entity: 'Product',    field: 'internal_id',     definition: 'PIM product code. Corresponds to product_ref in ERP for the ERP↔PIM bridge.', status: 'ok' },
  { entity: 'Territory',  field: 'sales_ytd',       definition: 'Territory year-to-date revenue. Southwest = top territory ($7.9M, 6,692 orders).', status: 'ok' },
]

const STATUS_BADGE: Record<SemanticDef['status'], string> = {
  ok:        'bg-teal-50 text-teal-700 border border-teal-200',
  ambiguous: 'bg-amber-50 text-amber-700 border border-amber-200',
  todo:      'bg-slate-100 text-slate-500',
}

const AMBIGUITIES = [
  {
    term: 'fatturato',
    context: 'SalesOrder (ERP)',
    candidates: [
      { label: 'subtotal_amount', desc: 'Net taxable amount — $20,057,928 (2014)', recommended: true },
      { label: 'total_due',       desc: 'Total with taxes+freight — $22,419,498 (2014)', recommended: false },
    ],
    resolution: 'Query AI asks for disambiguation. If context = "commercial" → subtotal. If "financial/accounting" → total_due.',
  },
  {
    term: 'cliente',
    context: 'CRM (account) vs ERP (customer_ref)',
    candidates: [
      { label: 'CRM.account (20,201)', desc: 'Includes 372 duplicates with accountId < 0', recommended: false },
      { label: 'CRM.account dedup (19,829)', desc: 'Valid accounts only, after dedup removal', recommended: true },
    ],
    resolution: 'The KG always uses the dedup version. Show 19,829 as "unique customers".',
  },
]

function SemanticDefinitionsPanel() {
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
    setNewForm({ entity: '', field: '', definition: '' })
    setShowAdd(false)
  }

  const grouped = defs.reduce<Record<string, SemanticDef[]>>((acc, d) => {
    ;(acc[d.entity] ??= []).push(d)
    return acc
  }, {})

  return (
    <div className="flex-1 px-8 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{defs.length} semantic definitions · {defs.filter(d => d.status === 'ambiguous').length} ambiguous · click a row to edit</p>
        <button onClick={() => setShowAdd(v => !v)} className="flex items-center gap-1.5 text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 transition-colors font-medium">
          <Plus className="w-3.5 h-3.5" />
          Add definition
        </button>
      </div>

      {showAdd && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-700">New semantic definition</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">Entity</label>
              <input value={newForm.entity} onChange={e => setNewForm(f => ({ ...f, entity: e.target.value }))} placeholder="e.g. SalesOrder" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400" />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">Field</label>
              <input value={newForm.field} onChange={e => setNewForm(f => ({ ...f, field: e.target.value }))} placeholder="e.g. subtotal_amount" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white font-mono outline-none focus:border-teal-400" />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">Definition</label>
              <input value={newForm.definition} onChange={e => setNewForm(f => ({ ...f, definition: e.target.value }))} placeholder="What does this field mean?" className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-teal-400" />
            </div>
          </div>
          <button onClick={addDef} className="text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 transition-colors">Add</button>
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
            {entityDefs.map((def, i) => {
              const globalIdx = defs.indexOf(def)
              const isEditing = editing === globalIdx
              return (
                <div key={i} className="px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start gap-3">
                    <code className="text-[11px] font-mono text-teal-700 bg-teal-50 px-2 py-0.5 rounded mt-0.5 flex-shrink-0">{def.field}</code>
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={editText}
                            onChange={e => setEditText(e.target.value)}
                            className="flex-1 text-xs border border-teal-300 rounded px-2 py-1 outline-none"
                          />
                          <button onClick={() => saveEdit(globalIdx)} className="text-teal-600 hover:text-teal-700"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-600 leading-relaxed cursor-pointer hover:text-slate-900" onClick={() => startEdit(globalIdx)}>{def.definition}</p>
                      )}
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_BADGE[def.status]}`}>
                      {def.status}
                    </span>
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
    <div className="flex-1 px-8 py-6 space-y-4">
      <p className="text-sm text-slate-500">{AMBIGUITIES.length} documented ambiguities — resolved at query time by the semantic layer</p>
      {AMBIGUITIES.map((amb, i) => (
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
                  {c.recommended
                    ? <Check className="w-4 h-4 text-teal-600 mt-0.5 flex-shrink-0" />
                    : <X className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                  }
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

// ── Generate mappings from ontology ──────────────────────────────────────────

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

// ── Type badge ────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  uuid:     'bg-orange-50 text-orange-600 border border-orange-200',
  string:   'bg-slate-100 text-slate-600',
  integer:  'bg-blue-50 text-blue-600',
  decimal:  'bg-purple-50 text-purple-600',
  boolean:  'bg-amber-50 text-amber-600',
  date:     'bg-green-50 text-green-700',
  datetime: 'bg-teal-50 text-teal-700',
  text:     'bg-slate-100 text-slate-500',
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`inline-block text-[10px] font-mono px-1.5 py-0.5 rounded leading-none ${TYPE_COLORS[type] ?? 'bg-slate-100 text-slate-500'}`}>
      {type}
    </span>
  )
}

// ── Editable cell ─────────────────────────────────────────────────────────────

function EditableCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  function commit() {
    onSave(draft)
    setEditing(false)
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
          className="flex-1 bg-white border border-teal-400 rounded px-2 py-0.5 text-xs text-slate-900 outline-none min-w-0 font-mono"
        />
        <button onClick={commit} className="text-teal-500 hover:text-teal-700"><Check className="w-3.5 h-3.5" /></button>
        <button onClick={cancel} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
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

// ── Table group ───────────────────────────────────────────────────────────────

function TableGroup({ table, rows, savedEdits, onSave }: {
  table: string
  rows: MappingRow[]
  savedEdits: Record<string, string>
  onSave: (key: string, value: string) => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-slate-50 hover:bg-slate-100 transition-colors border-b border-slate-200"
      >
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
                {['ERP Field', 'Ontology Class', 'Ontology Property (click to edit)', 'Type', 'URI'].map(h => (
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
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-amber-600">{row.field}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-1.5 text-xs">
                        <GitBranch className="w-3 h-3 text-teal-400 flex-shrink-0" />
                        {row.ontologyClass}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <EditableCell value={currentVal} onSave={v => onSave(editKey, v)} />
                    </td>
                    <td className="px-4 py-2.5">
                      <TypeBadge type={row.fieldType} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-[10px] font-mono text-slate-400">{row.uri}</span>
                    </td>
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

// ── Main component ────────────────────────────────────────────────────────────

type ActiveTab = 'mappings' | 'definitions' | 'ambiguity'

export default function MappingView() {
  const { sectorId, sector } = useSector()
  const ontology = useExtendedOntology(sectorId)

  const [activeTab, setActiveTab] = useState<ActiveTab>('mappings')
  const [search, setSearch] = useState('')
  const [savedEdits, setSavedEdits] = useState<Record<string, string>>({})
  const [editCount, setEditCount] = useState(0)

  const allMappings = useMemo(() => generateMappings(ontology.nodes), [ontology.nodes])

  const filtered = useMemo(() => {
    if (!search.trim()) return allMappings
    const q = search.toLowerCase()
    return allMappings.filter(r =>
      r.field.includes(q) ||
      r.table.includes(q) ||
      r.ontologyClass.toLowerCase().includes(q) ||
      r.ontologyProperty.toLowerCase().includes(q)
    )
  }, [allMappings, search])

  const grouped = useMemo(() => {
    return filtered.reduce<Record<string, MappingRow[]>>((acc, row) => {
      ;(acc[row.table] ??= []).push(row)
      return acc
    }, {})
  }, [filtered])

  function handleSave(key: string, value: string) {
    setSavedEdits(prev => ({ ...prev, [key]: value }))
    setEditCount(c => c + 1)
  }

  const totalFields = allMappings.length
  const totalTables = new Set(allMappings.map(r => r.table)).size

  const TABS: { id: ActiveTab; label: string; icon: typeof Table2 }[] = [
    { id: 'mappings',    label: 'Field Mappings',         icon: Table2    },
    { id: 'definitions', label: 'Semantic Definitions',   icon: BookOpen  },
    { id: 'ambiguity',   label: 'Ambiguity Log',          icon: AlertTriangle },
  ]

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 bg-white flex-shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="w-5 h-5 text-teal-600" />
              <h1 className="text-2xl font-bold text-slate-900">Semantic Layer</h1>
            </div>
            <p className="text-slate-400 mt-1 text-sm">
              {sector.name} · {totalTables} tables · {totalFields} field mappings · semantic definitions and ambiguities
            </p>
          </div>
          <div className="flex items-center gap-3">
            {editCount > 0 && (
              <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-3 py-1 font-medium">
                {editCount} edit{editCount !== 1 ? 's' : ''} saved
              </span>
            )}
          </div>
        </div>

        {/* Tab selector */}
        <div className="mt-4 flex items-center gap-1 border-b border-slate-100 -mb-5 pb-0">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === id
                  ? 'border-teal-500 text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'definitions' && <SemanticDefinitionsPanel />}
      {activeTab === 'ambiguity' && <AmbiguityLogPanel />}

      {activeTab === 'mappings' && (
        <>
          {/* Search + legend */}
          <div className="px-8 pt-5 pb-3 bg-white border-b border-slate-100 flex-shrink-0">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search fields, classes, properties…"
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 focus:border-teal-400 rounded-lg outline-none transition-colors"
              />
            </div>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <span className="text-[11px] text-slate-400">Types:</span>
              {Object.keys(TYPE_COLORS).map(t => <TypeBadge key={t} type={t} />)}
            </div>
          </div>

          {/* Mapping tables */}
          <div className="flex-1 px-8 py-6 space-y-4">
            {Object.keys(grouped).length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-sm">No mappings match your search.</div>
            ) : (
              Object.entries(grouped).map(([table, rows]) => (
                <TableGroup
                  key={table}
                  table={table}
                  rows={rows}
                  savedEdits={savedEdits}
                  onSave={handleSave}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
