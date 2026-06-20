import { useState, useMemo, useEffect } from 'react'
import { Database, Search, ChevronUp, ChevronDown, X, Table2, Download, GitBranch, Zap } from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { useExtendedOntology } from '../data/ontologyExtensions'
import { generateMockData } from '../data/mockDataGenerator'
import { AW_SAMPLE_DATA, type AWEntityName } from '../data/awSampleData'
import { IS_DEMO_MODE, workspaceLabel } from '../lib/demoMode'
import { getLiveConfig } from '../api/semantic'
import type { OntologyNode } from '../types'

// ── AW entity → source system map ─────────────────────────────────────────────
const AW_SOURCE_MAP: Record<string, { system: string; color: string; bg: string; border: string }> = {
  Customer:       { system: 'CRM — ClientHub',   color: 'text-teal-700',   bg: 'bg-teal-50',   border: 'border-teal-200' },
  SalesOrder:     { system: 'ERP — OrionSales',  color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200' },
  SalesOrderLine: { system: 'ERP — OrionSales',  color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200' },
  Salesperson:    { system: 'ERP — OrionSales',  color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200' },
  Territory:      { system: 'ERP — OrionSales',  color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200' },
  Offer:          { system: 'ERP — OrionSales',  color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200' },
  Employee:       { system: 'HR — CSV (IT schema)', color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
  Product:        { system: 'PIM — Catalog',     color: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200' },
}

// ── AW cross-source join examples ─────────────────────────────────────────────
const AW_JOIN_EXAMPLES: Record<string, { label: string; sql: string; rows: Record<string, unknown>[] } | undefined> = {
  SalesOrder: {
    label: 'SalesOrder × Customer (ERP ↔ CRM) × Salesperson × Employee (ERP ↔ HR)',
    sql: `SELECT o.orderId, o.orderDate, o.subtotalAmount,
       c.name       AS customer,        -- CRM · customer_ref ↔ accountId
       e.cognome || ', ' || e.nome AS salesperson  -- HR  · salesperson_ref ↔ matricolaDip
FROM   erp.SalesOrder o
JOIN   crm.account    c ON o.customer_ref    = c.accountId
JOIN   hr.dipendenti  e ON o.salesperson_ref = e.matricolaDip
LIMIT  5`,
    rows: [
      { orderId: 75123, orderDate: '2014-12-28', subtotalAmount: 87145.20, customer: 'Bike World Inc.',               salesperson: 'Mitchell, Linda'  },
      { orderId: 75124, orderDate: '2014-12-28', subtotalAmount: 53209.80, customer: 'Action Bicycle Specialists',    salesperson: 'Reiter, Rachel'   },
      { orderId: 75122, orderDate: '2014-12-01', subtotalAmount:  1898.00, customer: 'Valley Bicycle Specialists',    salesperson: 'Saraiva, José'    },
      { orderId: 75121, orderDate: '2014-12-01', subtotalAmount:    48.68, customer: 'Riding Cycles',                 salesperson: 'Pak, Jae'         },
      { orderId: 75120, orderDate: '2014-12-01', subtotalAmount:  2049.00, customer: 'Eastside Department Store',     salesperson: 'Tsoflias, Lynn'   },
    ],
  },
  SalesOrderLine: {
    label: 'SalesOrderLine × Product (ERP ↔ PIM)',
    sql: `SELECT sol.lineId, sol.quantity, sol.unitPrice, sol.lineTotal,
       p.name     AS product,    -- PIM · product_ref ↔ internal_id
       p.category AS category
FROM   erp.SalesOrderLine sol
JOIN   pim.product_catalog p ON sol.productId = p.internal_id
LIMIT  5`,
    rows: [
      { lineId: 4365901, quantity: 1, unitPrice: 2024.99, lineTotal:   2024.99, product: 'Mountain-200 Black, 38', category: 'Bikes'       },
      { lineId: 4365902, quantity: 3, unitPrice: 2024.99, lineTotal:   6074.98, product: 'Mountain-200 Black, 46', category: 'Bikes'       },
      { lineId: 4365903, quantity: 1, unitPrice: 2039.99, lineTotal:   2039.99, product: 'Road-150 Red, 62',       category: 'Bikes'       },
      { lineId: 7511701, quantity: 2, unitPrice: 2039.99, lineTotal:   4079.98, product: 'Touring-1000 Blue, 60',  category: 'Bikes'       },
      { lineId: 7512201, quantity: 5, unitPrice: 1429.00, lineTotal:   7145.00, product: 'Long-Sleeve Logo Jersey', category: 'Clothing'  },
    ],
  },
  Salesperson: {
    label: 'Salesperson × Employee (ERP ↔ HR · matricolaDip ↔ salesPersonId)',
    sql: `SELECT sp.salesPersonId, sp.salesYTD, sp.bonus,
       e.cognome    AS lastName,   -- HR Italian schema
       e.nome       AS firstName,
       e.ruolo      AS jobTitle
FROM   erp.SalesPerson sp
JOIN   hr.dipendenti_hr e ON sp.salesPersonId = e.matricolaDip
ORDER  BY sp.salesYTD DESC
LIMIT  5`,
    rows: [
      { salesPersonId: 276, salesYTD: 4251368.55, bonus: 2000, lastName: 'Mitchell',  firstName: 'Linda',   jobTitle: 'Sales Manager'        },
      { salesPersonId: 289, salesYTD: 4116871.23, bonus: 5150, lastName: 'Reiter',    firstName: 'Rachel',  jobTitle: 'Sales Representative' },
      { salesPersonId: 275, salesYTD: 3763178.18, bonus: 4100, lastName: 'Saraiva',   firstName: 'José',    jobTitle: 'Sales Representative' },
      { salesPersonId: 277, salesYTD: 3189418.37, bonus: 2500, lastName: 'Tsoflias',  firstName: 'Lynn',    jobTitle: 'Sales Representative' },
      { salesPersonId: 279, salesYTD: 2315185.61, bonus: 6700, lastName: 'Pak',       firstName: 'Jae',     jobTitle: 'Sales Representative' },
    ],
  },
}

// ── Cross-source join panel ───────────────────────────────────────────────────
function CrossSourcePanel({ entityLabel }: { entityLabel: string }) {
  const [open, setOpen] = useState(false)
  const example = AW_JOIN_EXAMPLES[entityLabel]
  if (!example) return null
  return (
    <div className="flex-shrink-0 border-t border-slate-200 bg-slate-50">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-6 py-2.5 text-xs text-slate-600 hover:bg-slate-100 transition-colors"
      >
        <GitBranch className="w-3.5 h-3.5 text-teal-600" />
        <span className="font-semibold text-teal-700">Cross-source Join Preview</span>
        <span className="text-slate-400 font-normal">— {example.label}</span>
        <Zap className="w-3 h-3 text-teal-400 ml-auto" />
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-6 pb-4 space-y-3">
          <pre className="text-[10px] font-mono bg-slate-900 text-teal-300 rounded-lg px-4 py-3 overflow-x-auto leading-relaxed whitespace-pre">{example.sql}</pre>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead>
                <tr>
                  {Object.keys(example.rows[0]).map(col => (
                    <th key={col} className="bg-slate-100 border-b border-slate-200 px-3 py-2 text-left font-medium text-slate-600 whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {example.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-teal-50/30">
                    {Object.values(row).map((val, j) => (
                      <td key={j} className="border-b border-slate-100 px-3 py-2 text-slate-700 whitespace-nowrap font-mono">
                        {typeof val === 'number' && val > 100 ? `$${val.toLocaleString('en-US')}` : String(val ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

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

  const awRows = IS_DEMO_MODE ? AW_SAMPLE_DATA[node.data.label as AWEntityName] : undefined
  const rows = useMemo(
    () => awRows ?? (IS_DEMO_MODE ? generateMockData(node, 30) : []),
    [node.id],
  )

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

  function downloadCSV() {
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
    a.download = `${node.data.db_table ?? node.data.label}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!IS_DEMO_MODE && rows.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <Database className="w-10 h-10 text-slate-200" />
          <div>
            <p className="text-sm font-semibold text-slate-600 mb-1">No row-level preview available</p>
            <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
              Row data for <span className="font-mono text-teal-600">{node.data.label}</span> isn't loaded into the browser.
              Use <strong>Query AI</strong> to run SQL against your live data.
            </p>
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('navigate-to-query', { detail: { question: `SELECT * FROM ${node.data.db_table ?? node.data.label} LIMIT 20` } }))}
            className="flex items-center gap-1.5 text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 transition-colors font-medium"
          >
            <Zap className="w-3.5 h-3.5" />
            Open in Query AI
          </button>
        </div>
      </div>
    )
  }

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
        <button onClick={downloadCSV} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-teal-600 border border-slate-200 hover:border-teal-300 rounded-lg px-2.5 py-1.5 transition-colors">
          <Download className="w-3.5 h-3.5" /> Download CSV
        </button>
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
                              ? `$${Number(val).toLocaleString('en-US')}`
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
  const [liveRowCounts, setLiveRowCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    if (IS_DEMO_MODE) return
    const refresh = () => getLiveConfig()
      .then(cfg => setLiveRowCounts(Object.fromEntries(cfg.ontology.nodes.map(n => [n.data.label, n.data.row_count]))))
      .catch(() => {})
    refresh()
    window.addEventListener('pipeline-run-updated', refresh)
    return () => window.removeEventListener('pipeline-run-updated', refresh)
  }, [])

  const props = selected?.data.properties.length ?? 0
  const rowCount = !IS_DEMO_MODE && selected
    ? (liveRowCounts[selected.data.label] ?? selected.data.row_count ?? 0)
    : (selected?.data.row_count ?? 0)

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
          {workspaceLabel(sector.name)} · {IS_DEMO_MODE ? 'Browse live data for each entity' : 'Entity schema browser · use Query AI to run SQL against your live data'}
          {selected && rowCount > 0 && (
            <span className="ml-2 text-teal-600 font-medium">{rowCount.toLocaleString('en-US')} records in production DB</span>
          )}
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden flex">
        {!IS_DEMO_MODE && ontology.nodes.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-xs space-y-3">
              <Database className="w-10 h-10 mx-auto text-slate-300" />
              <p className="text-sm font-semibold text-slate-700">No entities discovered yet</p>
              <p className="text-xs text-slate-400 leading-relaxed">
                Connect a data source and run setup — entities are auto-extracted from your tables.
              </p>
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: { tab: 'sources' } }))}
                  className="text-xs border border-slate-300 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                >
                  1. Connect a source →
                </button>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: { tab: 'process' } }))}
                  className="text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                >
                  2. Run Setup →
                </button>
              </div>
            </div>
          </div>
        ) : (
        <EntityList
          nodes={ontology.nodes}
          selected={selected}
          onSelect={setSelected}
        />
        )}

        {(IS_DEMO_MODE || ontology.nodes.length > 0) && <div className="flex-1 overflow-hidden flex flex-col">
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
                {IS_DEMO_MODE && AW_SOURCE_MAP[selected.data.label] && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${AW_SOURCE_MAP[selected.data.label].bg} ${AW_SOURCE_MAP[selected.data.label].color} ${AW_SOURCE_MAP[selected.data.label].border}`}>
                      {AW_SOURCE_MAP[selected.data.label].system}
                    </span>
                  </>
                )}
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
              {IS_DEMO_MODE && sectorId === 'manufacturing' && <CrossSourcePanel entityLabel={selected.data.label} />}
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              <div className="text-center space-y-2">
                <Database className="w-10 h-10 mx-auto text-slate-300" />
                <p className="text-sm">Select an entity to browse its data</p>
              </div>
            </div>
          )}
        </div>}
      </div>
    </div>
  )
}
