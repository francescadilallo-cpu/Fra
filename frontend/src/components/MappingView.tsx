import { useState, useMemo } from 'react'
import { Table2, Pencil, Check, X, Search, GitBranch, ChevronDown, ChevronRight } from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { useExtendedOntology } from '../data/ontologyExtensions'
import type { OntologyNode } from '../types'

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

export default function MappingView() {
  const { sectorId, sector } = useSector()
  const ontology = useExtendedOntology(sectorId)

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

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 bg-white flex-shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Mappings</h1>
            <p className="text-slate-400 mt-1 text-sm">
              {sector.name} · {totalTables} tables · {totalFields} field mappings · click any property to edit
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

        {/* Search */}
        <div className="mt-4 relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search fields, classes, properties…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 focus:border-teal-400 rounded-lg outline-none transition-colors"
          />
        </div>

        {/* Type legend */}
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
    </div>
  )
}
