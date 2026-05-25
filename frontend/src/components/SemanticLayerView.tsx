import { useState } from 'react'
import {
  Database, GitBranch, AlertTriangle, CheckCircle, Info, Plus, Zap, X,
  Network, MessageSquare, ChevronDown, ChevronRight, ArrowRight,
  BookOpen, FileCode, Play, Layers,
} from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { useExtendedOntology } from '../data/ontologyExtensions'

// ── Navigation helper ─────────────────────────────────────────────────────────

function tryInQueryAI(question: string) {
  sessionStorage.setItem('query-prefill', question)
  window.dispatchEvent(new CustomEvent('navigate-to-query', { detail: { question } }))
}

// ── AdventureWorks static data ────────────────────────────────────────────────

const AW_SOURCES = [
  {
    id: 'erp', name: 'ERP — OrionSales', type: 'PostgreSQL',
    icon: '🏭', colorBorder: 'border-blue-200', colorBg: 'bg-blue-50',
    colorText: 'text-blue-700', colorDot: 'bg-blue-500',
    entities: [
      { name: 'SalesOrder', rows: 31465 }, { name: 'SalesOrderLine', rows: 121317 },
      { name: 'Salesperson', rows: 17 }, { name: 'Territory', rows: 10 }, { name: 'SpecialOffer', rows: 16 },
    ],
    total: 152825,
  },
  {
    id: 'crm', name: 'CRM — ClientHub', type: 'SQLite',
    icon: '🤝', colorBorder: 'border-teal-200', colorBg: 'bg-teal-50',
    colorText: 'text-teal-700', colorDot: 'bg-teal-500',
    entities: [
      { name: 'accounts', rows: 20201 }, { name: 'contacts', rows: 19302 },
      { name: 'addresses', rows: 19614 }, { name: 'territories', rows: 70 },
    ],
    total: 59193,
    warning: '372 duplicate accounts (accountId < 0) — removed from KG',
  },
  {
    id: 'hr', name: 'HR — Employees', type: 'CSV (Italian schema)',
    icon: '👥', colorBorder: 'border-violet-200', colorBg: 'bg-violet-50',
    colorText: 'text-violet-700', colorDot: 'bg-violet-500',
    entities: [{ name: 'dipendenti_hr', rows: 290 }],
    total: 290,
    warning: 'Italian schema: matricolaDip, cognome, nome, stipendio — translated by semantic layer',
  },
  {
    id: 'pim', name: 'PIM — Catalog', type: 'JSON',
    icon: '📦', colorBorder: 'border-amber-200', colorBg: 'bg-amber-50',
    colorText: 'text-amber-700', colorDot: 'bg-amber-500',
    entities: [{ name: 'product_catalog', rows: 504 }],
    total: 504,
  },
]

const AW_BRIDGES = [
  {
    id: 1, label: 'PLACED_BY', cardinality: 'N:1', matchRate: 93.2,
    from: { source: 'ERP — OrionSales', entity: 'SalesOrder',     field: 'customer_ref : int' },
    to:   { source: 'CRM — ClientHub', entity: 'accounts',        field: 'accountId : int' },
    detail: '18,484 / 19,829 matched · 1,345 CRM-only prospects excluded',
    note: '19,829 unique customers after dedup (372 neg-ID removed)',
    impact: 'Enables: customer geography, segment, creditLimit on orders',
  },
  {
    id: 2, label: 'SOLD_BY', cardinality: 'N:1', matchRate: 100,
    from: { source: 'ERP — OrionSales', entity: 'SalesOrder',     field: 'salesPersonId : int' },
    to:   { source: 'HR — Employees',   entity: 'dipendenti_hr',  field: 'matricolaDip : int' },
    detail: '14 / 14 sales reps matched · Italian ↔ ERP schema resolved',
    note: 'Enables Italian HR fields (cognome, stipendio) on ERP sales data',
    impact: 'Enables: salesperson name, salary, department from HR on sales queries',
  },
  {
    id: 3, label: 'OF_PRODUCT', cardinality: 'N:1', matchRate: 99.6,
    from: { source: 'ERP — OrionSales', entity: 'SalesOrderLine', field: 'productId : int' },
    to:   { source: 'PIM — Catalog',    entity: 'product_catalog', field: 'internal_id : int' },
    detail: '121,270 / 121,317 matched · 47 orphan lines',
    note: '504 products enriched with category, listPrice, standardCost, color',
    impact: 'Enables: product category, cost, margin on order line queries',
  },
]

// Field-level semantic → physical mapping per entity
const AW_ENTITY_DETAIL: Record<string, {
  source: string
  semanticAlias?: string
  fields: { semantic: string; physical: string; type: string; note?: string; bridge?: string }[]
}> = {
  SalesOrder: {
    source: 'erp.SalesOrder',
    fields: [
      { semantic: 'orderId',         physical: 'orderId',        type: 'integer PK' },
      { semantic: 'orderDate',       physical: 'orderDate',      type: 'date' },
      { semantic: 'revenue.net',     physical: 'subtotalAmount', type: 'decimal', note: '⚠ "fatturato" disambiguation — net, excl. tax' },
      { semantic: 'revenue.gross',   physical: 'totalDue',       type: 'decimal', note: '⚠ "fatturato" disambiguation — gross, incl. tax+freight' },
      { semantic: 'taxAmt',          physical: 'taxAmt',         type: 'decimal' },
      { semantic: 'freight',         physical: 'freight',        type: 'decimal' },
      { semantic: 'channel',         physical: 'onlineOrderFlag',type: 'boolean', note: '1=Online (87.9%) / 0=In-store (12.1%)' },
      { semantic: 'customer →',      physical: 'customer_ref',   type: 'FK int',  bridge: 'PLACED_BY → crm.accounts.accountId' },
      { semantic: 'salesperson →',   physical: 'salesPersonId',  type: 'FK int',  bridge: 'SOLD_BY → hr.dipendenti_hr.matricolaDip' },
      { semantic: 'territory →',     physical: 'territoryId',    type: 'FK int',  bridge: '→ erp.SalesTerritory.territoryId' },
    ],
  },
  Customer: {
    source: 'crm.accounts',
    semanticAlias: 'Unified Customer (ERP + CRM)',
    fields: [
      { semantic: 'customerId',   physical: 'accountId',   type: 'integer PK' },
      { semantic: 'companyName',  physical: 'companyName', type: 'string' },
      { semantic: 'country',      physical: 'country',     type: 'string' },
      { semantic: 'segment',      physical: 'segment',     type: 'string' },
      { semantic: 'creditLimit',  physical: 'creditLimit', type: 'decimal' },
      { semantic: 'email',        physical: 'email',       type: 'string' },
      { semantic: 'ordersIn →',   physical: 'accountId',   type: 'FK',      bridge: 'PLACED_BY ← erp.SalesOrder.customer_ref' },
    ],
  },
  Employee: {
    source: 'hr.dipendenti_hr',
    semanticAlias: 'Employee — Italian schema translated',
    fields: [
      { semantic: 'employeeId',  physical: 'matricolaDip', type: 'integer PK', note: 'Italian field → semantic employeeId' },
      { semantic: 'lastName',    physical: 'cognome',      type: 'string',     note: 'Italian "cognome"' },
      { semantic: 'firstName',   physical: 'nome',         type: 'string',     note: 'Italian "nome"' },
      { semantic: 'role',        physical: 'ruolo',        type: 'string',     note: 'Italian "ruolo"' },
      { semantic: 'salary',      physical: 'stipendio',    type: 'decimal',    note: 'Italian "stipendio"' },
      { semantic: 'deptId',      physical: 'repartoId',    type: 'FK int',     note: 'Italian "repartoId"' },
      { semantic: 'salesperson →', physical: 'matricolaDip', type: 'FK',      bridge: 'SOLD_BY ← erp.SalesOrder.salesPersonId' },
    ],
  },
  Product: {
    source: 'pim.product_catalog',
    fields: [
      { semantic: 'productId',    physical: 'internal_id',   type: 'integer PK' },
      { semantic: 'name',         physical: 'name',          type: 'string' },
      { semantic: 'category',     physical: 'category',      type: 'string',  note: 'Bikes=98% revenue' },
      { semantic: 'subcategory',  physical: 'subcategory',   type: 'string' },
      { semantic: 'listPrice',    physical: 'listPrice',     type: 'decimal' },
      { semantic: 'standardCost', physical: 'standardCost',  type: 'decimal', note: 'Used for margin calculation' },
      { semantic: 'orderLines →', physical: 'internal_id',   type: 'FK',      bridge: 'OF_PRODUCT ← erp.SalesOrderLine.productId' },
    ],
  },
  SalesOrderLine: {
    source: 'erp.SalesOrderLine',
    fields: [
      { semantic: 'lineId',     physical: 'lineId',            type: 'integer PK' },
      { semantic: 'orderId →',  physical: 'orderId',           type: 'FK int',  bridge: '→ erp.SalesOrder.orderId' },
      { semantic: 'product →',  physical: 'productId',         type: 'FK int',  bridge: 'OF_PRODUCT → pim.product_catalog.internal_id' },
      { semantic: 'quantity',   physical: 'quantity',          type: 'integer' },
      { semantic: 'unitPrice',  physical: 'unitPrice',         type: 'decimal' },
      { semantic: 'discount',   physical: 'unitPriceDiscount', type: 'decimal', note: '>0 = discounted by SpecialOffer' },
      { semantic: 'lineTotal',  physical: 'lineTotal',         type: 'decimal', note: '= quantity × (unitPrice − discount)' },
    ],
  },
  Salesperson: {
    source: 'erp.SalesPerson',
    fields: [
      { semantic: 'salesPersonId', physical: 'salesPersonId', type: 'integer PK' },
      { semantic: 'salesYTD',      physical: 'salesYTD',      type: 'decimal',  note: 'Year-to-date revenue' },
      { semantic: 'bonus',         physical: 'bonus',         type: 'decimal' },
      { semantic: 'commissionPct', physical: 'commissionPct', type: 'decimal' },
      { semantic: 'territory →',   physical: 'territoryId',   type: 'FK int',   bridge: '→ erp.SalesTerritory' },
      { semantic: 'employee →',    physical: 'salesPersonId', type: 'FK',       bridge: 'SOLD_BY → hr.dipendenti_hr.matricolaDip' },
    ],
  },
}

const AW_DISAMBIGUATION_RULES = [
  {
    term: '"fatturato" / "revenue"',
    problem: 'Ambiguous — maps to two different ERP fields with a $2.3M difference',
    options: [
      { label: 'subtotalAmount', value: '$20,127,070', desc: 'Net commercial revenue (excl. tax & freight)', semantic: 'revenue.net', recommended: true },
      { label: 'totalDue',       value: '$22,410,568', desc: 'Gross billed amount (incl. tax + freight)',    semantic: 'revenue.gross', recommended: false },
    ],
    resolution: 'Query AI asks for explicit disambiguation before running — isDisambiguation: true',
  },
  {
    term: '"dipendente" / "employee"',
    problem: 'Italian HR schema uses different field names from ERP schema',
    options: [
      { label: 'matricolaDip', value: 'HR CSV', desc: 'Italian: unique employee ID in HR system', semantic: 'Employee.employeeId', recommended: false },
      { label: 'salesPersonId', value: 'ERP',  desc: 'ERP: sales representative identifier',      semantic: 'Salesperson.salesPersonId', recommended: false },
    ],
    resolution: 'Resolved via SOLD_BY bridge (100% match rate) — semantic layer joins transparently',
  },
  {
    term: '"ordini" / "orders"',
    problem: 'Could mean SalesOrder (header) or SalesOrderLine (detail rows)',
    options: [
      { label: 'SalesOrder',     value: '31,465 rows', desc: 'Order header — one per transaction', semantic: 'SalesOrder', recommended: true },
      { label: 'SalesOrderLine', value: '121,317 rows', desc: 'Line items — one per product per order', semantic: 'SalesOrderLine', recommended: false },
    ],
    resolution: 'Default: SalesOrder for counts/revenue, SalesOrderLine for product-level analysis',
  },
]

const AW_QUERY_EXAMPLES = [
  {
    question: 'Who is the top salesperson by revenue in 2014?',
    path: ['SalesOrder (ERP)', '⚡ SOLD_BY', 'Employee (HR)'],
    bridges: ['SOLD_BY'],
    sql: `SELECT e.cognome || ' ' || e.nome AS name,
       sp.salesYTD
FROM   erp.SalesPerson sp
JOIN   hr.dipendenti_hr e ON sp.salesPersonId = e.matricolaDip
ORDER  BY sp.salesYTD DESC
LIMIT  1`,
    result: 'Linda Mitchell · $4,251,368 YTD',
  },
  {
    question: 'What is the gross margin by product category?',
    path: ['SalesOrderLine (ERP)', '⚡ OF_PRODUCT', 'Product (PIM)'],
    bridges: ['OF_PRODUCT'],
    sql: `SELECT p.category,
       ROUND((SUM(sol.lineTotal - sol.quantity*p.standardCost)
              / SUM(sol.lineTotal)) * 100, 1) AS margin_pct
FROM   erp.SalesOrderLine sol
JOIN   pim.product_catalog p ON sol.productId = p.internal_id
GROUP  BY p.category
ORDER  BY margin_pct DESC`,
    result: 'Clothing 65.3% · Accessories 64.5% · Bikes 48.0%',
  },
  {
    question: 'Show customers by country with average order value',
    path: ['SalesOrder (ERP)', '⚡ PLACED_BY', 'Customer (CRM)'],
    bridges: ['PLACED_BY'],
    sql: `SELECT c.country,
       COUNT(DISTINCT o.customer_ref) AS customers,
       AVG(o.subtotalAmount)           AS avg_order
FROM   erp.SalesOrder  o
JOIN   crm.accounts    c ON o.customer_ref = c.accountId
GROUP  BY c.country
ORDER  BY avg_order DESC`,
    result: 'Canada avg $1,813 · Australia $1,148 · US $905',
  },
  {
    question: 'What is the online vs in-store channel split?',
    path: ['SalesOrder (ERP)', 'onlineOrderFlag semantic decode'],
    bridges: [],
    sql: `SELECT CASE WHEN onlineOrderFlag=1 THEN 'Online' ELSE 'In-store' END AS channel,
       COUNT(*) AS orders,  AVG(subtotalAmount) AS avg_order
FROM   erp.SalesOrder
GROUP  BY onlineOrderFlag`,
    result: 'Online 87.9% (27,659 orders, avg $356) · In-store 12.1% (3,806 orders, avg $2,704)',
  },
]

const AW_QUALITY_ISSUES = [
  {
    severity: 'warning' as const,
    entity: 'Customer — CRM accounts',
    issue: '372 accounts with accountId < 0 — duplicates from legacy CRM migration',
    resolution: 'Filtered in KG build: 20,201 raw → 19,829 clean unique accounts',
  },
  {
    severity: 'warning' as const,
    entity: 'SalesOrder — revenue field',
    issue: 'subtotalAmount ($20.1M) vs totalDue ($22.4M) — $2.3M gap from tax + freight',
    resolution: 'Disambiguated at query time via isDisambiguation flag in semantic engine',
  },
  {
    severity: 'info' as const,
    entity: 'Employee — HR CSV',
    issue: 'Italian column names: matricolaDip, cognome, nome, ruolo, stipendio, repartoId',
    resolution: 'Mapped to semantic aliases in ontology: employeeId, lastName, firstName…',
  },
  {
    severity: 'info' as const,
    entity: 'SalesOrderLine — product match',
    issue: '47 / 121,317 order lines have productId not in PIM catalog (0.04% unmatched)',
    resolution: 'Treated as unknown products — excluded from category analysis (negligible)',
  },
]

// ── Sub-components ─────────────────────────────────────────────────────────────

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
          <span className={`mt-1 inline-block text-[10px] font-mono px-2 py-0.5 rounded-full ${source.colorBg} ${source.colorText} font-medium`}>
            {source.type}
          </span>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-slate-800">{source.total.toLocaleString('en-US')}</p>
          <p className="text-[11px] text-slate-400">total rows</p>
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
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          {source.warning}
        </div>
      )}
    </div>
  )
}

function BridgeCard({ bridge }: { bridge: typeof AW_BRIDGES[0] }) {
  const pct = bridge.matchRate
  const color = pct === 100 ? 'bg-teal-500' : pct >= 95 ? 'bg-blue-500' : 'bg-amber-500'
  const textColor = pct === 100 ? 'text-teal-700 bg-teal-100' : pct >= 95 ? 'text-blue-700 bg-blue-100' : 'text-amber-700 bg-amber-100'

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">From</p>
          <p className="text-xs font-semibold text-slate-700 mt-0.5">{bridge.from.entity}</p>
          <p className="text-[11px] font-mono text-slate-500">{bridge.from.source}</p>
          <p className="text-[10px] font-mono text-blue-600 bg-blue-50 rounded px-1.5 py-0.5 mt-1 inline-block">{bridge.from.field}</p>
        </div>

        <div className="flex flex-col items-center gap-1.5 flex-shrink-0 px-2">
          <span className="text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-3 py-1 whitespace-nowrap">
            ⚡ {bridge.label}
          </span>
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

      {/* Match rate bar */}
      <div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[10px] text-slate-500 mt-1.5 font-mono">{bridge.detail}</p>
      </div>

      {/* Impact */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-0.5">Enables</p>
        <p className="text-[11px] text-slate-600">{bridge.impact}</p>
      </div>
    </div>
  )
}

function EntityCard({ nodeId, ontologyNode }: {
  nodeId: string
  ontologyNode: { label: string; uri: string; db_table: string | null; row_count: number }
}) {
  const [open, setOpen] = useState(false)
  const detail = AW_ENTITY_DETAIL[nodeId]

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        {open ? <ChevronDown className="w-4 h-4 text-teal-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900">{ontologyNode.label}</span>
            <span className="text-[10px] font-mono text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">{ontologyNode.uri}</span>
            {detail?.semanticAlias && (
              <span className="text-[10px] text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">{detail.semanticAlias}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {ontologyNode.db_table && (
            <span className="text-[10px] font-mono text-blue-600 bg-blue-50 rounded px-2 py-0.5">{ontologyNode.db_table}</span>
          )}
          {ontologyNode.row_count > 0 && (
            <span className="text-[11px] text-slate-400">{ontologyNode.row_count.toLocaleString('en-US')} rows</span>
          )}
        </div>
      </button>

      {open && detail && (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-2">
            Field mapping — semantic concept → physical column
          </p>
          <div className="space-y-1">
            {detail.fields.map((f, i) => (
              <div key={i} className={`flex items-start gap-2 py-1.5 px-2 rounded-lg text-xs ${f.bridge ? 'bg-teal-50 border border-teal-100' : f.note?.startsWith('⚠') ? 'bg-amber-50 border border-amber-100' : 'hover:bg-slate-50'}`}>
                <div className="w-36 flex-shrink-0">
                  <span className={`font-mono font-semibold ${f.bridge ? 'text-teal-700' : 'text-slate-700'}`}>{f.semantic}</span>
                </div>
                <ArrowRight className="w-3 h-3 text-slate-300 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-blue-600">{f.physical}</span>
                  <span className="text-slate-400 ml-2 text-[10px]">{f.type}</span>
                  {f.bridge && (
                    <span className="ml-2 text-[10px] font-semibold text-teal-600 bg-teal-100 rounded px-1.5 py-0.5">⚡ {f.bridge}</span>
                  )}
                  {f.note && !f.note.startsWith('⚠') && (
                    <span className="ml-2 text-[10px] text-slate-400 italic">{f.note}</span>
                  )}
                  {f.note?.startsWith('⚠') && (
                    <span className="ml-2 text-[10px] text-amber-700 font-medium">{f.note}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {open && !detail && (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="text-[11px] text-slate-400 italic">No detailed field mapping available for this entity.</p>
        </div>
      )}
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
        <CheckCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>{rule.resolution}</span>
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
          {/* Resolution path */}
          <div className="flex items-center gap-1 flex-wrap mt-2">
            {ex.path.map((step, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${step.startsWith('⚡') ? 'bg-teal-100 text-teal-700 font-bold' : 'bg-slate-100 text-slate-600'}`}>
                  {step}
                </span>
                {i < ex.path.length - 1 && <ArrowRight className="w-2.5 h-2.5 text-slate-300 flex-shrink-0" />}
              </span>
            ))}
          </div>
          {/* Bridges used */}
          {ex.bridges.length > 0 && (
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mr-1">Bridges:</span>
              {ex.bridges.map(b => (
                <span key={b} className="text-[10px] font-bold text-teal-600 bg-teal-50 border border-teal-200 rounded-full px-2 py-0.5">⚡ {b}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-right">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-0.5">Result</p>
            <p className="text-xs font-semibold text-teal-700 max-w-[160px] leading-snug">{ex.result}</p>
          </div>
          <button
            onClick={() => tryInQueryAI(ex.question)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-[11px] font-semibold transition-colors flex-shrink-0"
          >
            <Play className="w-3 h-3" />
            Try
          </button>
        </div>
      </div>
      <button
        onClick={() => setOpen(v => !v)}
        className="mt-2.5 flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        View SQL
      </button>
      {open && (
        <pre className="mt-2 text-[10px] font-mono bg-slate-900 text-teal-300 rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre leading-relaxed">
          {ex.sql}
        </pre>
      )}
    </div>
  )
}

// ── Generic sector view (Retail / Healthcare / Finance) ───────────────────────

function GenericBridgeCard({ edge }: {
  edge: { id: string; source: string; target: string; label: string; cardinality?: string }
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
      <span className="text-xs font-semibold text-slate-700 flex-1">{edge.source}</span>
      <span className="text-[11px] font-bold text-teal-600 bg-teal-50 border border-teal-200 rounded-full px-2.5 py-1 whitespace-nowrap">
        {edge.label}
      </span>
      {edge.cardinality && <span className="text-[10px] text-slate-400">{edge.cardinality}</span>}
      <ArrowRight className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />
      <span className="text-xs font-semibold text-slate-700 flex-1 text-right">{edge.target}</span>
    </div>
  )
}

// ── KG Builder ────────────────────────────────────────────────────────────────

interface CustomBridge { from: string; to: string; label: string }

function KGBuilder({ bridges, onAdd, onRemove, entityOptions }: {
  bridges: CustomBridge[]
  onAdd: (b: CustomBridge) => void
  onRemove: (i: number) => void
  entityOptions: string[]
}) {
  const [form, setForm] = useState({ from: '', to: '', label: '' })

  function submit() {
    if (!form.from || !form.to || !form.label) return
    onAdd({ ...form })
    setForm({ from: '', to: '', label: '' })
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h3 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
        <Plus className="w-4 h-4 text-teal-600" />
        Add Custom Relationship
      </h3>
      <p className="text-xs text-slate-500 mb-4">Define a new cross-source bridge or custom relationship in the Knowledge Graph.</p>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-[11px] font-medium text-slate-600 mb-1 block">From entity</label>
          <select
            value={form.from}
            onChange={e => setForm(f => ({ ...f, from: e.target.value }))}
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-slate-50 focus:border-teal-400 outline-none"
          >
            <option value="">Select entity…</option>
            {entityOptions.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-600 mb-1 block">Relationship label</label>
          <input
            value={form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
            placeholder="e.g. MANAGED_BY"
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-slate-50 focus:border-teal-400 outline-none font-mono"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-600 mb-1 block">To entity</label>
          <select
            value={form.to}
            onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-slate-50 focus:border-teal-400 outline-none"
          >
            <option value="">Select entity…</option>
            {entityOptions.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
      </div>
      <button
        onClick={submit}
        disabled={!form.from || !form.to || !form.label}
        className="text-xs bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-40 transition-colors font-medium"
      >
        Add to Knowledge Graph
      </button>
      {bridges.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Custom relationships added</p>
          {bridges.map((b, i) => (
            <div key={i} className="flex items-center gap-2 text-xs bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
              <span className="text-slate-600 font-mono truncate flex-1">{b.from}</span>
              <span className="text-violet-600 font-bold whitespace-nowrap">— {b.label} →</span>
              <span className="text-slate-600 font-mono truncate flex-1 text-right">{b.to}</span>
              <button onClick={() => onRemove(i)} className="text-slate-400 hover:text-red-500 transition-colors flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function SemanticLayerView() {
  const { sectorId, sector } = useSector()
  const ontology = useExtendedOntology(sectorId)
  const [customBridges, setCustomBridges] = useState<CustomBridge[]>([])

  const isManufacturing = sectorId === 'manufacturing'

  const nodeCount = ontology.nodes.length
  const edgeCount = ontology.edges.length
  const totalRows = isManufacturing ? 193062 : ontology.nodes.reduce((sum, n) => sum + (n.data.row_count ?? 0), 0)

  const entityOptions = ontology.nodes.map(n => n.data.label)

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 bg-white flex-shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Network className="w-5 h-5 text-teal-600" />
              <h1 className="text-2xl font-bold text-slate-900">Semantic Layer</h1>
              <span className="text-xs font-medium text-slate-400 bg-slate-100 rounded-full px-2.5 py-1">{sector.name}</span>
            </div>
            <p className="text-slate-400 text-sm">
              Ontology · Physical mapping · Cross-source bridges · Disambiguation rules
            </p>
          </div>
          {isManufacturing && (
            <div className="flex items-center gap-2 text-xs bg-teal-50 border border-teal-200 text-teal-700 rounded-full px-3 py-1.5 font-medium">
              <Zap className="w-3.5 h-3.5" />
              3 cross-source bridges · 4 sources integrated
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 px-8 py-6 space-y-8">

        {/* KG Stats */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Ontology Entities" value={nodeCount.toString()} sub="semantic concepts" />
          <StatCard label="Relationships" value={edgeCount.toString()} sub="edges in ontology graph" />
          <StatCard label="KG Nodes" value={isManufacturing ? '193,062' : totalRows.toLocaleString()} sub={isManufacturing ? 'entity instances' : 'total data rows'} accent />
          <StatCard label="KG Edges" value={isManufacturing ? '313,193' : (edgeCount * 8).toLocaleString()} sub={isManufacturing ? 'relationships' : 'semantic relationships'} accent />
        </div>

        {/* ── SEMANTIC ENTITIES ──────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <Layers className="w-4 h-4 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Semantic Entities</h2>
            <span className="text-xs text-slate-400">— click to expand field-level physical mapping</span>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Each semantic entity abstracts one or more physical tables. Properties show the translation from semantic concept → source column.
          </p>
          <div className="space-y-2">
            {ontology.nodes.map(node => (
              <EntityCard key={node.id} nodeId={node.id} ontologyNode={node.data} />
            ))}
          </div>
        </section>

        {/* ── SOURCE ARCHITECTURE ────────────────────────────────────── */}
        {isManufacturing && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-4 h-4 text-slate-500" />
              <h2 className="font-semibold text-slate-900">Source Architecture</h2>
              <span className="text-xs text-slate-400">— 4 heterogeneous systems integrated</span>
            </div>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
              {AW_SOURCES.map(s => <SourceCard key={s.id} source={s} />)}
            </div>
          </section>
        )}

        {/* ── CROSS-SOURCE BRIDGES ───────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <GitBranch className="w-4 h-4 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Cross-source Bridges</h2>
            <span className="text-xs text-slate-400">— semantic joins across physical systems</span>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Bridges enable queries that span multiple sources by resolving foreign-key relationships between heterogeneous schemas.
          </p>
          {isManufacturing ? (
            <div className="space-y-3">
              {AW_BRIDGES.map(b => <BridgeCard key={b.id} bridge={b} />)}
            </div>
          ) : (
            <div className="space-y-2">
              {ontology.edges.filter(e => e.animated).map(e => (
                <GenericBridgeCard key={e.id} edge={e} />
              ))}
              {ontology.edges.filter(e => e.animated).length === 0 && (
                <p className="text-sm text-slate-400 italic">No animated (cross-source) bridges defined for this sector.</p>
              )}
            </div>
          )}
        </section>

        {/* ── DISAMBIGUATION RULES ──────────────────────────────────── */}
        {isManufacturing && (
          <section>
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="w-4 h-4 text-slate-500" />
              <h2 className="font-semibold text-slate-900">Semantic Rules & Disambiguation</h2>
              <span className="text-xs text-slate-400">— where language meets data ambiguity</span>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Natural language terms that map to multiple physical fields require explicit disambiguation. These rules are applied at query time.
            </p>
            <div className="space-y-3">
              {AW_DISAMBIGUATION_RULES.map((rule, i) => (
                <DisambiguationCard key={i} rule={rule} />
              ))}
            </div>
          </section>
        )}

        {/* ── DATA QUALITY ──────────────────────────────────────────── */}
        {isManufacturing && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-slate-500" />
              <h2 className="font-semibold text-slate-900">Data Quality</h2>
            </div>
            <div className="space-y-2">
              {AW_QUALITY_ISSUES.map((issue, i) => {
                const isWarning = issue.severity === 'warning'
                return (
                  <div key={i} className={`border rounded-xl p-4 ${isWarning ? 'bg-amber-50 border-amber-200' : 'bg-sky-50 border-sky-200'}`}>
                    <div className="flex items-start gap-3">
                      {isWarning
                        ? <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                        : <Info className="w-4 h-4 text-sky-500 mt-0.5 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-xs font-semibold text-slate-700">{issue.entity}</span>
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${isWarning ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>
                            {issue.severity}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700">{issue.issue}</p>
                        <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-teal-500 flex-shrink-0" />
                          {issue.resolution}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ── QUERY EXAMPLES ────────────────────────────────────────── */}
        {isManufacturing && (
          <section>
            <div className="flex items-center gap-2 mb-1">
              <FileCode className="w-4 h-4 text-slate-500" />
              <h2 className="font-semibold text-slate-900">Cross-source Query Examples</h2>
              <span className="text-xs text-slate-400">— click "Try" to run in Query AI</span>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Each example shows the semantic resolution path: natural language → entities → bridges → SQL.
            </p>
            <div className="space-y-3">
              {AW_QUERY_EXAMPLES.map((ex, i) => (
                <QueryExampleCard key={i} ex={ex} />
              ))}
            </div>
          </section>
        )}

        {/* ── KG BUILDER ────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Plus className="w-4 h-4 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Semantic Layer Builder</h2>
          </div>
          <KGBuilder
            bridges={customBridges}
            onAdd={b => setCustomBridges(prev => [...prev, b])}
            onRemove={i => setCustomBridges(prev => prev.filter((_, idx) => idx !== i))}
            entityOptions={entityOptions}
          />
        </section>

      </div>
    </div>
  )
}
