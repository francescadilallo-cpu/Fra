import { useEffect, useState, useCallback } from 'react'
import { Loader2, AlertCircle, Pencil, Check, X, Table2, RefreshCw } from 'lucide-react'
import { fetchMappings, updateMapping } from '../api/client'
import type { MappingEntry } from '../types'

// ── Type badge ─────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  integer:        'bg-blue-50 text-blue-600',
  string:         'bg-green-50 text-green-600',
  decimal:        'bg-amber-50 text-amber-600',
  date:           'bg-purple-50 text-purple-600',
  objectProperty: 'bg-teal-50 text-teal-700',
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`badge text-xs ${TYPE_COLORS[type] ?? 'bg-slate-100 text-slate-500'}`}>
      {type}
    </span>
  )
}

// ── Editable cell ──────────────────────────────────────────────────────────────

interface EditableCellProps {
  value: string
  onSave: (newValue: string) => Promise<void>
}

function EditableCell({ value, onSave }: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (draft === value) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } catch {
      setDraft(value) // revert on error
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
            if (e.key === 'Escape') handleCancel()
          }}
          className="flex-1 bg-white border border-teal-500 focus:ring-2 focus:ring-teal-100 rounded px-2 py-1 text-xs text-slate-900 outline-none min-w-0"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-teal-600 hover:text-teal-700 flex-shrink-0"
          title="Save"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </button>
        <button onClick={handleCancel} className="text-slate-400 hover:text-slate-600 flex-shrink-0" title="Cancel">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div
      className="group flex items-center gap-1.5 cursor-pointer"
      onClick={() => setEditing(true)}
    >
      <span className="text-sm text-slate-700 font-mono">{value}</span>
      <Pencil className="w-3 h-3 text-slate-400 group-hover:text-slate-600 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all" />
    </div>
  )
}

// ── Table group ────────────────────────────────────────────────────────────────

interface TableGroupProps {
  tableName: string
  rows: MappingEntry[]
  onUpdate: (entry: MappingEntry, newOntologyPath: string) => Promise<void>
}

function TableGroup({ tableName, rows, onUpdate }: TableGroupProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="card overflow-hidden p-0">
      {/* Table header */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-slate-50 hover:bg-slate-100 transition-colors border-b border-slate-200"
      >
        <div className="flex items-center gap-2">
          <Table2 className="w-4 h-4 text-teal-600" />
          <span className="font-semibold text-slate-900 font-mono">{tableName}</span>
          <span className="badge bg-slate-100 text-slate-500 text-xs">{rows.length} fields</span>
        </div>
        <span className="text-slate-400 text-xs">{collapsed ? 'Espandi' : 'Comprimi'}</span>
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-5 py-2.5 text-left text-xs text-slate-400 font-medium uppercase tracking-wide w-40">
                  Campo ERP
                </th>
                <th className="px-5 py-2.5 text-left text-xs text-slate-400 font-medium uppercase tracking-wide w-44">
                  Classe Ontologica
                </th>
                <th className="px-5 py-2.5 text-left text-xs text-slate-400 font-medium uppercase tracking-wide">
                  Proprietà Ontologica
                </th>
                <th className="px-5 py-2.5 text-left text-xs text-slate-400 font-medium uppercase tracking-wide w-36">
                  Tipo
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.table}-${row.field}`} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3">
                    <span className="text-sm font-mono text-amber-600">{row.field}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-sm text-slate-600">{row.ontology_class}</span>
                  </td>
                  <td className="px-5 py-3">
                    <EditableCell
                      value={`${row.ontology_class}.${row.ontology_property}`}
                      onSave={(newPath) => onUpdate(row, newPath)}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <TypeBadge type={row.field_type} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function MappingView() {
  const [mappings, setMappings] = useState<MappingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savedCount, setSavedCount] = useState(0)

  const loadMappings = useCallback(() => {
    setLoading(true)
    fetchMappings()
      .then((data) => setMappings(data.mappings))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadMappings()
  }, [loadMappings])

  const handleUpdate = async (entry: MappingEntry, newOntologyPath: string) => {
    await updateMapping({
      table: entry.table,
      field: entry.field,
      ontology_path: newOntologyPath,
    })
    // Update local state
    setMappings((prev) =>
      prev.map((m) => {
        if (m.table === entry.table && m.field === entry.field) {
          const parts = newOntologyPath.split('.', 2)
          return {
            ...m,
            ontology_class: parts[0] ?? m.ontology_class,
            ontology_property: parts[1] ?? newOntologyPath,
          }
        }
        return m
      }),
    )
    setSavedCount((c) => c + 1)
  }

  // Group by table
  const grouped = mappings.reduce<Record<string, MappingEntry[]>>((acc, row) => {
    ;(acc[row.table] ??= []).push(row)
    return acc
  }, {})

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="card flex items-center gap-3 text-red-600">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>Errore: {error}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 sticky top-0 bg-white z-10 flex-shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Configurazione Mappature</h1>
            <p className="text-slate-500 mt-1 text-sm">
              Configura come i campi ERP si mappano ai concetti dell'ontologia. Clicca su una proprietà per modificarla.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {savedCount > 0 && (
              <span className="badge bg-teal-50 text-teal-700 border border-teal-200 text-xs">
                {savedCount} modifiche salvate
              </span>
            )}
            <button onClick={loadMappings} className="btn-ghost flex items-center gap-2 text-sm">
              <RefreshCw className="w-3.5 h-3.5" />
              Ricarica
            </button>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="px-8 py-3 border-b border-slate-200 flex items-center gap-6 flex-shrink-0 bg-white">
        <span className="text-xs text-slate-400">Tipi di campo:</span>
        {['integer', 'string', 'decimal', 'date', 'objectProperty'].map((t) => (
          <TypeBadge key={t} type={t} />
        ))}
      </div>

      {/* Tables */}
      <div className="flex-1 px-8 py-6 space-y-5">
        {Object.entries(grouped).map(([tableName, rows]) => (
          <TableGroup
            key={tableName}
            tableName={tableName}
            rows={rows}
            onUpdate={handleUpdate}
          />
        ))}
      </div>
    </div>
  )
}
