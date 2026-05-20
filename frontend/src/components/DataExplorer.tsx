import { useState, useMemo } from 'react'
import { Database, Search, ChevronUp, ChevronDown, X, Table2 } from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { useExtendedOntology } from '../data/ontologyExtensions'
import { generateMockData } from '../data/mockDataGenerator'
import type { OntologyNode } from '../types'

// ── Type badge colours (same as OntologyGraph) ───────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  uuid:     'bg-orange-100 text-orange-700',
  string:   'bg-slate-100 text-slate-600',
  integer:  'bg-blue-100 text-blue-700',
  decimal:  'bg-purple-100 text-purple-700',
  boolean:  'bg-amber-100 text-amber-700',
  date:     'bg-green-100 text-green-700',
  datetime: 'bg-green-100 text-green-700',
  text:     'bg-slate-100 text-slate-500',
  fk:       'bg-teal-100 text-teal-700',
}

// ── Data table ────────────────────────────────────────────────────────────────
type SortDir = 'asc' | 'desc'

function DataTable({ node }: { node: OntologyNode }) {
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 10

  const rows = useMemo(() => generateMockData(node, 30), [node.id])

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(row =>
      Object.values(row).some(v => String(v).toLowerCase().includes(q))
    )
  }, [rows, search])

  const sorted = useMemo(() => {
    if (!sortCol) return filtered
    return [...filtered].sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol]
      const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortCol, sortDir])

  const pages = Math.ceil(sorted.length / PAGE_SIZE)
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const columns = node.data.properties.map(p => p.name)

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
    setPage(0)
  }

  const propByName = Object.fromEntries(node.data.properties.map(p => [p.name, p]))

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-200 flex-shrink-0 bg-white">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="Filter rows…"
            className="w-full pl-8 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 focus:border-teal-400 rounded-lg outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <span className="text-xs text-slate-400 flex-shrink-0">
          {filtered.length} of {rows.length} rows
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr>
              {columns.map(col => {
                const prop = propByName[col]
                const isSorted = sortCol === col
                return (
                  <th
                    key={col}
                    onClick={() => handleSort(col)}
                    className="bg-slate-50 border-b border-slate-200 px-3 py-2.5 text-left font-medium text-slate-600 cursor-pointer whitespace-nowrap hover:bg-slate-100 transition-colors select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{col}</span>
                      {prop && (
                        <span className={`text-[9px] px-1 rounded font-mono ${TYPE_COLORS[prop.type] ?? 'bg-slate-100 text-slate-500'}`}>
                          {prop.type}
                        </span>
                      )}
                      {prop?.required && <span className="text-red-400 text-[10px]">*</span>}
                      {isSorted && (
                        sortDir === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-teal-500" />
                          : <ChevronDown className="w-3 h-3 text-teal-500" />
                      )}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i} className="hover:bg-teal-50/30 transition-colors group">
                {columns.map(col => {
                  const val = row[col]
                  const prop = propByName[col]
                  return (
                    <td key={col} className="border-b border-slate-100 px-3 py-2 text-slate-700 whitespace-nowrap">
                      {typeof val === 'boolean' ? (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${val ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                          {val ? 'true' : 'false'}
                        </span>
                      ) : prop?.type === 'uuid' ? (
                        <span className="font-mono text-[10px] text-slate-400">{String(val)}</span>
                      ) : typeof val === 'number' && (prop?.type === 'decimal' || /amount|value|price|cost|limit|balance|income/.test(col)) ? (
                        <span className="font-mono">
                          {col.includes('pct') || col.includes('rate') || col.includes('score') || col.includes('efficiency')
                            ? `${val}%`
                            : val > 1000
                              ? `€${Number(val).toLocaleString('en-US')}`
                              : val}
                        </span>
                      ) : (
                        String(val)
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between px-6 py-2.5 border-t border-slate-200 bg-white flex-shrink-0">
          <span className="text-xs text-slate-400">Page {page + 1} of {pages}</span>
          <div className="flex gap-1">
            {Array.from({ length: pages }, (_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                  i === page ? 'bg-teal-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Entity selector sidebar ───────────────────────────────────────────────────
function EntityList({ nodes, selected, onSelect }: {
  nodes: OntologyNode[]
  selected: OntologyNode | null
  onSelect: (n: OntologyNode) => void
}) {
  return (
    <div className="w-52 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Entities</p>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {nodes.map(n => (
          <button
            key={n.id}
            onClick={() => onSelect(n)}
            className={`w-full text-left px-4 py-2.5 flex items-center gap-2.5 transition-colors ${
              selected?.id === n.id
                ? 'bg-teal-50 text-teal-700 border-r-2 border-teal-500'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Database className={`w-3.5 h-3.5 flex-shrink-0 ${selected?.id === n.id ? 'text-teal-500' : 'text-slate-400'}`} />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{n.data.label}</p>
              {n.data.db_table && (
                <p className="text-[10px] text-slate-400 font-mono truncate">{n.data.db_table}</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DataExplorer() {
  const { sector, sectorId } = useSector()
  const ontology = useExtendedOntology(sectorId)
  const [selected, setSelected] = useState<OntologyNode | null>(() => ontology.nodes[0] ?? null)

  const props = selected?.data.properties.length ?? 0
  const rowCount = selected?.data.row_count ?? 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Data Explorer</h1>
          {selected && (
            <span className="text-sm text-slate-400 font-normal ml-1">
              · {selected.data.label}
            </span>
          )}
        </div>
        <p className="text-slate-500 mt-1 text-sm">
          {sector.name} · Browse mock data for each ontology entity
          {selected && rowCount > 0 && (
            <span className="ml-2 text-teal-600 font-medium">{rowCount.toLocaleString('en-US')} records in production DB</span>
          )}
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden flex">
        <EntityList
          nodes={ontology.nodes}
          selected={selected}
          onSelect={setSelected}
        />

        <div className="flex-1 overflow-hidden flex flex-col">
          {selected ? (
            <>
              {/* Entity meta bar */}
              <div className="flex items-center gap-4 px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex-shrink-0">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Table2 className="w-3.5 h-3.5 text-teal-600" />
                  <span className="font-mono text-teal-700">{selected.data.db_table ?? '—'}</span>
                </div>
                <span className="text-slate-300">·</span>
                <span className="text-xs text-slate-500">{props} properties</span>
                <span className="text-slate-300">·</span>
                <span className="text-xs text-slate-500 font-mono text-slate-400">{selected.data.uri}</span>
                <div className="ml-auto flex flex-wrap gap-1">
                  {selected.data.properties.slice(0, 6).map(p => (
                    <span key={p.name} className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${TYPE_COLORS[p.type] ?? 'bg-slate-100'}`}>
                      {p.type}
                    </span>
                  ))}
                  {selected.data.properties.length > 6 && (
                    <span className="text-[9px] text-slate-400">+{selected.data.properties.length - 6} more</span>
                  )}
                </div>
              </div>
              <DataTable key={selected.id} node={selected} />
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              <div className="text-center space-y-2">
                <Database className="w-10 h-10 mx-auto text-slate-300" />
                <p className="text-sm">Select an entity to browse its data</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
