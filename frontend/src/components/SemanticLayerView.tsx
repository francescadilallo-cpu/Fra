import { useState, useEffect } from 'react'
import {
  Database, GitBranch, AlertTriangle, CheckCircle, Info, Plus, Zap, X,
  Network, MessageSquare, ChevronDown, ChevronRight, ArrowRight,
  BookOpen, FileCode, Play, Layers, Server, Trash2, Edit3, Save,
} from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { useExtendedOntology, loadExtension, saveExtension, applyNodeChange } from '../data/ontologyExtensions'
import { SECTORS } from '../data/sectors'
import type { OntologyProperty, PropertyType } from '../types'

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
  localStorage.setItem(SOURCES_KEY(id), JSON.stringify(v))
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

// ── AdventureWorks static data ────────────────────────────────────────────────

const AW_SOURCES = [
  { id: 'erp', name: 'ERP — OrionSales', type: 'PostgreSQL', icon: '🏭',
    colorBorder: 'border-blue-200', colorBg: 'bg-blue-50', colorText: 'text-blue-700', colorDot: 'bg-blue-500',
    entities: [{ name: 'SalesOrder', rows: 31465 }, { name: 'SalesOrderLine', rows: 121317 }, { name: 'Salesperson', rows: 17 }, { name: 'Territory', rows: 10 }, { name: 'SpecialOffer', rows: 16 }], total: 152825 },
  { id: 'crm', name: 'CRM — ClientHub', type: 'SQLite', icon: '🤝',
    colorBorder: 'border-teal-200', colorBg: 'bg-teal-50', colorText: 'text-teal-700', colorDot: 'bg-teal-500',
    entities: [{ name: 'accounts', rows: 20201 }, { name: 'contacts', rows: 19302 }, { name: 'addresses', rows: 19614 }, { name: 'territories', rows: 70 }], total: 59193,
    warning: '372 duplicate accounts (accountId < 0) — removed from KG' },
  { id: 'hr', name: 'HR — Employees', type: 'CSV (Italian schema)', icon: '👥',
    colorBorder: 'border-violet-200', colorBg: 'bg-violet-50', colorText: 'text-violet-700', colorDot: 'bg-violet-500',
    entities: [{ name: 'dipendenti_hr', rows: 290 }], total: 290,
    warning: 'Italian schema: matricolaDip, cognome, nome, stipendio — translated by semantic layer' },
  { id: 'pim', name: 'PIM — Catalog', type: 'JSON', icon: '📦',
    colorBorder: 'border-amber-200', colorBg: 'bg-amber-50', colorText: 'text-amber-700', colorDot: 'bg-amber-500',
    entities: [{ name: 'product_catalog', rows: 504 }], total: 504 },
]

const AW_BRIDGES = [
  { id: 1, label: 'PLACED_BY', cardinality: 'N:1', matchRate: 93.2,
    from: { source: 'ERP — OrionSales', entity: 'SalesOrder', field: 'customer_ref : int' },
    to:   { source: 'CRM — ClientHub',  entity: 'accounts',   field: 'accountId : int' },
    detail: '18,484 / 19,829 matched · 1,345 CRM-only prospects excluded',
    note: '19,829 unique customers after dedup', impact: 'Enables: customer geography, segment, creditLimit on orders' },
  { id: 2, label: 'SOLD_BY', cardinality: 'N:1', matchRate: 100,
    from: { source: 'ERP — OrionSales', entity: 'SalesOrder',    field: 'salesPersonId : int' },
    to:   { source: 'HR — Employees',   entity: 'dipendenti_hr', field: 'matricolaDip : int' },
    detail: '14 / 14 sales reps matched · Italian ↔ ERP schema resolved', note: '',
    impact: 'Enables: salesperson name, salary, department from HR on sales queries' },
  { id: 3, label: 'OF_PRODUCT', cardinality: 'N:1', matchRate: 99.6,
    from: { source: 'ERP — OrionSales', entity: 'SalesOrderLine', field: 'productId : int' },
    to:   { source: 'PIM — Catalog',    entity: 'product_catalog', field: 'internal_id : int' },
    detail: '121,270 / 121,317 matched · 47 orphan lines', note: '',
    impact: 'Enables: product category, cost, margin on order line queries' },
]

const AW_ENTITY_DETAIL: Record<string, {
  source: string; semanticAlias?: string
  fields: { semantic: string; physical: string; type: string; note?: string; bridge?: string }[]
}> = {
  SalesOrder: { source: 'erp.SalesOrder', fields: [
    { semantic: 'orderId', physical: 'orderId', type: 'integer PK' },
    { semantic: 'orderDate', physical: 'orderDate', type: 'date' },
    { semantic: 'revenue.net', physical: 'subtotalAmount', type: 'decimal', note: '⚠ "fatturato" disambiguation — net, excl. tax' },
    { semantic: 'revenue.gross', physical: 'totalDue', type: 'decimal', note: '⚠ "fatturato" disambiguation — gross, incl. tax+freight' },
    { semantic: 'taxAmt', physical: 'taxAmt', type: 'decimal' },
    { semantic: 'freight', physical: 'freight', type: 'decimal' },
    { semantic: 'channel', physical: 'onlineOrderFlag', type: 'boolean', note: '1=Online (87.9%) / 0=In-store (12.1%)' },
    { semantic: 'customer →', physical: 'customer_ref', type: 'FK int', bridge: 'PLACED_BY → crm.accounts.accountId' },
    { semantic: 'salesperson →', physical: 'salesPersonId', type: 'FK int', bridge: 'SOLD_BY → hr.dipendenti_hr.matricolaDip' },
    { semantic: 'territory →', physical: 'territoryId', type: 'FK int', bridge: '→ erp.SalesTerritory.territoryId' },
  ]},
  Customer: { source: 'crm.accounts', semanticAlias: 'Unified Customer (ERP + CRM)', fields: [
    { semantic: 'customerId', physical: 'accountId', type: 'integer PK' },
    { semantic: 'companyName', physical: 'companyName', type: 'string' },
    { semantic: 'country', physical: 'country', type: 'string' },
    { semantic: 'segment', physical: 'segment', type: 'string' },
    { semantic: 'creditLimit', physical: 'creditLimit', type: 'decimal' },
    { semantic: 'email', physical: 'email', type: 'string' },
    { semantic: 'ordersIn →', physical: 'accountId', type: 'FK', bridge: 'PLACED_BY ← erp.SalesOrder.customer_ref' },
  ]},
  Employee: { source: 'hr.dipendenti_hr', semanticAlias: 'Employee — Italian schema translated', fields: [
    { semantic: 'employeeId', physical: 'matricolaDip', type: 'integer PK', note: 'Italian field' },
    { semantic: 'lastName', physical: 'cognome', type: 'string', note: '"cognome"' },
    { semantic: 'firstName', physical: 'nome', type: 'string', note: '"nome"' },
    { semantic: 'role', physical: 'ruolo', type: 'string', note: '"ruolo"' },
    { semantic: 'salary', physical: 'stipendio', type: 'decimal', note: '"stipendio"' },
    { semantic: 'deptId', physical: 'repartoId', type: 'FK int', note: '"repartoId"' },
    { semantic: 'salesperson →', physical: 'matricolaDip', type: 'FK', bridge: 'SOLD_BY ← erp.SalesOrder.salesPersonId' },
  ]},
  Product: { source: 'pim.product_catalog', fields: [
    { semantic: 'productId', physical: 'internal_id', type: 'integer PK' },
    { semantic: 'name', physical: 'name', type: 'string' },
    { semantic: 'category', physical: 'category', type: 'string', note: 'Bikes=98% revenue' },
    { semantic: 'subcategory', physical: 'subcategory', type: 'string' },
    { semantic: 'listPrice', physical: 'listPrice', type: 'decimal' },
    { semantic: 'standardCost', physical: 'standardCost', type: 'decimal', note: 'Used for margin calc' },
    { semantic: 'orderLines →', physical: 'internal_id', type: 'FK', bridge: 'OF_PRODUCT ← erp.SalesOrderLine.productId' },
  ]},
  SalesOrderLine: { source: 'erp.SalesOrderLine', fields: [
    { semantic: 'lineId', physical: 'lineId', type: 'integer PK' },
    { semantic: 'orderId →', physical: 'orderId', type: 'FK int', bridge: '→ erp.SalesOrder.orderId' },
    { semantic: 'product →', physical: 'productId', type: 'FK int', bridge: 'OF_PRODUCT → pim.product_catalog.internal_id' },
    { semantic: 'quantity', physical: 'quantity', type: 'integer' },
    { semantic: 'unitPrice', physical: 'unitPrice', type: 'decimal' },
    { semantic: 'discount', physical: 'unitPriceDiscount', type: 'decimal', note: '>0 = discounted by SpecialOffer' },
    { semantic: 'lineTotal', physical: 'lineTotal', type: 'decimal', note: '= qty × (unitPrice − discount)' },
  ]},
  Salesperson: { source: 'erp.SalesPerson', fields: [
    { semantic: 'salesPersonId', physical: 'salesPersonId', type: 'integer PK' },
    { semantic: 'salesYTD', physical: 'salesYTD', type: 'decimal', note: 'Year-to-date revenue' },
    { semantic: 'bonus', physical: 'bonus', type: 'decimal' },
    { semantic: 'commissionPct', physical: 'commissionPct', type: 'decimal' },
    { semantic: 'territory →', physical: 'territoryId', type: 'FK int', bridge: '→ erp.SalesTerritory' },
    { semantic: 'employee →', physical: 'salesPersonId', type: 'FK', bridge: 'SOLD_BY → hr.dipendenti_hr.matricolaDip' },
  ]},
}

const AW_DISAMBIGUATION_RULES = [
  { term: '"fatturato" / "revenue"', problem: 'Ambiguous — maps to two different ERP fields with a $2.3M difference',
    options: [
      { label: 'subtotalAmount', value: '$20,127,070', desc: 'Net commercial revenue (excl. tax & freight)', semantic: 'revenue.net', recommended: true },
      { label: 'totalDue', value: '$22,410,568', desc: 'Gross billed amount (incl. tax + freight)', semantic: 'revenue.gross', recommended: false },
    ], resolution: 'Query AI asks for explicit disambiguation before running' },
  { term: '"dipendente" / "employee"', problem: 'Italian HR schema uses different field names from ERP schema',
    options: [
      { label: 'matricolaDip', value: 'HR CSV', desc: 'Italian: unique employee ID in HR system', semantic: 'Employee.employeeId', recommended: false },
      { label: 'salesPersonId', value: 'ERP', desc: 'ERP: sales representative identifier', semantic: 'Salesperson.salesPersonId', recommended: false },
    ], resolution: 'Resolved via SOLD_BY bridge (100% match rate) — semantic layer joins transparently' },
  { term: '"ordini" / "orders"', problem: 'Could mean SalesOrder (header) or SalesOrderLine (detail rows)',
    options: [
      { label: 'SalesOrder', value: '31,465 rows', desc: 'Order header — one per transaction', semantic: 'SalesOrder', recommended: true },
      { label: 'SalesOrderLine', value: '121,317 rows', desc: 'Line items — one per product per order', semantic: 'SalesOrderLine', recommended: false },
    ], resolution: 'Default: SalesOrder for counts/revenue, SalesOrderLine for product-level analysis' },
]

const AW_QUERY_EXAMPLES = [
  { question: 'Who is the top salesperson by revenue in 2014?', path: ['SalesOrder (ERP)', '⚡ SOLD_BY', 'Employee (HR)'], bridges: ['SOLD_BY'],
    sql: `SELECT e.cognome || ' ' || e.nome AS name, sp.salesYTD\nFROM   erp.SalesPerson sp\nJOIN   hr.dipendenti_hr e ON sp.salesPersonId = e.matricolaDip\nORDER  BY sp.salesYTD DESC LIMIT 1`,
    result: 'Linda Mitchell · $4,251,368 YTD' },
  { question: 'What is the gross margin by product category?', path: ['SalesOrderLine (ERP)', '⚡ OF_PRODUCT', 'Product (PIM)'], bridges: ['OF_PRODUCT'],
    sql: `SELECT p.category,\n       ROUND((SUM(sol.lineTotal - sol.quantity*p.standardCost) / SUM(sol.lineTotal)) * 100, 1) AS margin_pct\nFROM   erp.SalesOrderLine sol\nJOIN   pim.product_catalog p ON sol.productId = p.internal_id\nGROUP  BY p.category ORDER BY margin_pct DESC`,
    result: 'Clothing 65.3% · Accessories 64.5% · Bikes 48.0%' },
  { question: 'Show customers by country with average order value', path: ['SalesOrder (ERP)', '⚡ PLACED_BY', 'Customer (CRM)'], bridges: ['PLACED_BY'],
    sql: `SELECT c.country, COUNT(DISTINCT o.customer_ref) AS customers, AVG(o.subtotalAmount) AS avg_order\nFROM   erp.SalesOrder o\nJOIN   crm.accounts c ON o.customer_ref = c.accountId\nGROUP  BY c.country ORDER BY avg_order DESC`,
    result: 'Canada avg $1,813 · Australia $1,148 · US $905' },
  { question: 'What is the online vs in-store channel split?', path: ['SalesOrder (ERP)', 'onlineOrderFlag semantic decode'], bridges: [],
    sql: `SELECT CASE WHEN onlineOrderFlag=1 THEN 'Online' ELSE 'In-store' END AS channel,\n       COUNT(*) AS orders, AVG(subtotalAmount) AS avg_order\nFROM   erp.SalesOrder GROUP BY onlineOrderFlag`,
    result: 'Online 87.9% (27,659 orders, avg $356) · In-store 12.1% (3,806 orders, avg $2,704)' },
]

const AW_QUALITY_ISSUES = [
  { severity: 'warning' as const, entity: 'Customer — CRM accounts', issue: '372 accounts with accountId < 0 — duplicates from legacy CRM migration', resolution: 'Filtered in KG build: 20,201 raw → 19,829 clean unique accounts' },
  { severity: 'warning' as const, entity: 'SalesOrder — revenue field', issue: 'subtotalAmount ($20.1M) vs totalDue ($22.4M) — $2.3M gap from tax + freight', resolution: 'Disambiguated at query time via isDisambiguation flag' },
  { severity: 'info' as const, entity: 'Employee — HR CSV', issue: 'Italian column names: matricolaDip, cognome, nome, ruolo, stipendio, repartoId', resolution: 'Mapped to semantic aliases in ontology: employeeId, lastName, firstName…' },
  { severity: 'info' as const, entity: 'SalesOrderLine — product match', issue: '47 / 121,317 order lines have productId not in PIM catalog (0.04% unmatched)', resolution: 'Treated as unknown products — excluded from category analysis' },
]

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

  const prefix = sectorId === 'manufacturing' ? 'mfg' : sectorId === 'retail' ? 'rtl' : sectorId === 'healthcare' ? 'hc' : 'fin'

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

function GenericBridgeCard({ edge }: { edge: { id: string; source: string; target: string; label: string; cardinality?: string } }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
      <span className="text-xs font-semibold text-slate-700 flex-1">{edge.source}</span>
      <span className="text-[11px] font-bold text-teal-600 bg-teal-50 border border-teal-200 rounded-full px-2.5 py-1 whitespace-nowrap">{edge.label}</span>
      {edge.cardinality && <span className="text-[10px] text-slate-400">{edge.cardinality}</span>}
      <ArrowRight className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />
      <span className="text-xs font-semibold text-slate-700 flex-1 text-right">{edge.target}</span>
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

// ── Main ───────────────────────────────────────────────────────────────────────

type BuilderTab = 'entities' | 'bridges' | 'rules'

export default function SemanticLayerView() {
  const { sectorId, sector } = useSector()
  const ontology = useExtendedOntology(sectorId)

  const [userSources, setUserSources] = useState<SourceDef[]>(() => loadSources(sectorId))
  const [showAddSource, setShowAddSource] = useState(false)
  const [sourceForm, setSourceForm] = useState({ name: '', type: 'PostgreSQL', description: '', tables: '' })
  const [builderTab, setBuilderTab] = useState<BuilderTab>('entities')
  const [showAddEntity, setShowAddEntity] = useState(false)

  useEffect(() => { setUserSources(loadSources(sectorId)) }, [sectorId])

  const isManufacturing = sectorId === 'manufacturing'
  const baseNodeIds = new Set(SECTORS[sectorId].ontology.nodes.map(n => n.id))
  const nodeCount = ontology.nodes.length
  const edgeCount = ontology.edges.length
  const totalRows = isManufacturing ? 193062 : ontology.nodes.reduce((sum, n) => sum + (n.data.row_count ?? 0), 0)
  const entityOptions = ontology.nodes.map(n => n.data.label)

  function addSource() {
    if (!sourceForm.name.trim()) return
    const updated = [...userSources, { id: `src-${Date.now()}`, ...sourceForm }]
    setUserSources(updated); saveSources(sectorId, updated)
    setSourceForm({ name: '', type: 'PostgreSQL', description: '', tables: '' }); setShowAddSource(false)
  }

  const TAB = (active: boolean) =>
    `px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${active ? 'bg-teal-600 text-white' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'}`

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
            <p className="text-slate-400 text-sm">Ontology · Physical mapping · Cross-source bridges · Disambiguation rules</p>
          </div>
          {isManufacturing && (
            <div className="flex items-center gap-2 text-xs bg-teal-50 border border-teal-200 text-teal-700 rounded-full px-3 py-1.5 font-medium">
              <Zap className="w-3.5 h-3.5" />3 cross-source bridges · 4 sources integrated
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 px-8 py-6 space-y-8">

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Ontology Entities" value={nodeCount.toString()} sub="semantic concepts" />
          <StatCard label="Relationships" value={edgeCount.toString()} sub="edges in ontology graph" />
          <StatCard label="KG Nodes" value={isManufacturing ? '193,062' : totalRows.toLocaleString()} sub={isManufacturing ? 'entity instances' : 'total data rows'} accent />
          <StatCard label="KG Edges" value={isManufacturing ? '313,193' : (edgeCount * 8).toLocaleString()} sub={isManufacturing ? 'relationships' : 'semantic relationships'} accent />
        </div>

        {/* ── SEMANTIC ENTITIES ─────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <Layers className="w-4 h-4 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Semantic Entities</h2>
            <span className="text-xs text-slate-400">— expand to see fields · click Edit to map semantic → physical</span>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Each entity abstracts a physical table. Click <strong>Edit</strong> to rename fields, set physical column names, change types, and add custom fields.
          </p>
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
        </section>

        {/* ── SOURCE ARCHITECTURE ────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-500" />
              <h2 className="font-semibold text-slate-900">Source Architecture</h2>
              <span className="text-xs text-slate-400">{isManufacturing ? '— 4 heterogeneous systems integrated' : '— define your physical data systems'}</span>
            </div>
            {!isManufacturing && (
              <button onClick={() => setShowAddSource(v => !v)}
                className="flex items-center gap-1.5 text-xs bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 px-3 py-1.5 rounded-lg font-medium transition-colors">
                <Plus className="w-3.5 h-3.5" />Add data source
              </button>
            )}
          </div>
          {isManufacturing ? (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
              {AW_SOURCES.map(s => <SourceCard key={s.id} source={s} />)}
            </div>
          ) : (
            <div className="space-y-3">
              {userSources.length === 0 && !showAddSource && (
                <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-6 text-center">
                  <Server className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">No data sources defined yet.</p>
                  <p className="text-xs text-slate-400 mt-0.5">Document your databases, CSVs, and APIs.</p>
                  <button onClick={() => setShowAddSource(true)} className="mt-3 text-xs text-teal-600 hover:text-teal-700 font-medium transition-colors">+ Add first source</button>
                </div>
              )}
              {userSources.map(s => <UserSourceCard key={s.id} source={s} onDelete={() => { const u = userSources.filter(x => x.id !== s.id); setUserSources(u); saveSources(sectorId, u) }} />)}
              {showAddSource && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-blue-800">New data source</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 mb-1 block">Name <span className="text-red-400">*</span></label>
                      <input value={sourceForm.name} onChange={e => setSourceForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. ERP — SAP S/4HANA"
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white focus:border-blue-400 outline-none" />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 mb-1 block">Type</label>
                      <select value={sourceForm.type} onChange={e => setSourceForm(f => ({ ...f, type: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white focus:border-blue-400 outline-none">
                        {SOURCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 mb-1 block">Description</label>
                      <input value={sourceForm.description} onChange={e => setSourceForm(f => ({ ...f, description: e.target.value }))}
                        placeholder="What data does this source contain?"
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white focus:border-blue-400 outline-none" />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 mb-1 block">Tables / collections</label>
                      <input value={sourceForm.tables} onChange={e => setSourceForm(f => ({ ...f, tables: e.target.value }))}
                        placeholder="orders, customers, products"
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white focus:border-blue-400 outline-none font-mono" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={addSource} disabled={!sourceForm.name.trim()}
                      className="text-xs bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors font-medium">
                      Save source
                    </button>
                    <button onClick={() => setShowAddSource(false)} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2 transition-colors">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── CROSS-SOURCE BRIDGES ───────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <GitBranch className="w-4 h-4 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Cross-source Bridges</h2>
            <span className="text-xs text-slate-400">— semantic joins across physical systems</span>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Bridges enable queries that span multiple sources by resolving relationships between heterogeneous schemas.
          </p>
          {isManufacturing ? (
            <div className="space-y-3">{AW_BRIDGES.map(b => <BridgeCard key={b.id} bridge={b} />)}</div>
          ) : (
            <div className="space-y-2">
              {ontology.edges.filter(e => e.animated).map(e => <GenericBridgeCard key={e.id} edge={e} />)}
              {ontology.edges.filter(e => e.animated).length === 0 && (
                <p className="text-sm text-slate-400 italic">No cross-source bridges defined. Add one in the builder below.</p>
              )}
            </div>
          )}
        </section>

        {/* ── DISAMBIGUATION RULES ──────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="w-4 h-4 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Semantic Rules & Disambiguation</h2>
            <span className="text-xs text-slate-400">— where language meets data ambiguity</span>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Terms that map to multiple physical fields. Applied at query time — the AI asks before running.
          </p>
          <div className="space-y-3">
            {isManufacturing && AW_DISAMBIGUATION_RULES.map((rule, i) => <DisambiguationCard key={i} rule={rule} />)}
            {loadUserRules(sectorId).length === 0 && !isManufacturing && (
              <p className="text-sm text-slate-400 italic">No rules defined. Add them in the builder below.</p>
            )}
            {loadUserRules(sectorId).map(rule => (
              <div key={rule.id} className="bg-white border border-amber-200 rounded-xl p-4">
                <div className="flex items-start gap-3 mb-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900 font-mono">"{rule.term}"</p>
                    {rule.problem && <p className="text-xs text-slate-500 mt-0.5">{rule.problem}</p>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[{ l: rule.opt1, d: rule.opt1Desc }, { l: rule.opt2, d: rule.opt2Desc }].map((o, i) => (
                    <div key={i} className={`border rounded-lg p-2 ${i === 0 ? 'border-teal-200 bg-teal-50' : 'border-slate-200 bg-slate-50'}`}>
                      <p className="text-[10px] font-mono font-bold text-slate-700">{o.l}</p>
                      {o.d && <p className="text-[10px] text-slate-500 mt-0.5">{o.d}</p>}
                    </div>
                  ))}
                </div>
                {rule.resolution && (
                  <div className="mt-2 flex items-start gap-1.5 text-[11px] text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-2.5 py-1.5">
                    <CheckCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />{rule.resolution}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

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
                      {isWarning ? <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" /> : <Info className="w-4 h-4 text-sky-500 mt-0.5 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-xs font-semibold text-slate-700">{issue.entity}</span>
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${isWarning ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>{issue.severity}</span>
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
            <p className="text-xs text-slate-400 mb-3">Each example shows the full resolution path: natural language → entities → bridges → SQL.</p>
            <div className="space-y-3">
              {AW_QUERY_EXAMPLES.map((ex, i) => <QueryExampleCard key={i} ex={ex} />)}
            </div>
          </section>
        )}

        {/* ── SEMANTIC LAYER BUILDER ────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <Plus className="w-4 h-4 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Semantic Layer Builder</h2>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Build your semantic layer: add entities with field mappings, define cross-source bridges, and create disambiguation rules.
          </p>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex items-center gap-1 px-4 pt-4 pb-3 border-b border-slate-100">
              <button className={TAB(builderTab === 'entities')} onClick={() => setBuilderTab('entities')}>Entities</button>
              <button className={TAB(builderTab === 'bridges')} onClick={() => setBuilderTab('bridges')}>Bridges</button>
              <button className={TAB(builderTab === 'rules')} onClick={() => setBuilderTab('rules')}>Disambiguation Rules</button>
            </div>
            <div className="p-5">
              {builderTab === 'entities' && (
                <div>
                  <p className="text-xs text-slate-500 mb-4">
                    Add a new semantic entity with full field-level mapping. Define the semantic name (how you'll query it) and the physical column name (what it's called in the database). <br />
                    To edit an existing entity, click <strong>Edit</strong> on any entity card above.
                  </p>
                  {showAddEntity
                    ? <AddEntityForm sectorId={sectorId} entityOptions={entityOptions} onDone={() => setShowAddEntity(false)} />
                    : <button onClick={() => setShowAddEntity(true)}
                        className="flex items-center gap-1.5 text-xs bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium">
                        <Plus className="w-3.5 h-3.5" /> Add new entity
                      </button>
                  }
                </div>
              )}
              {builderTab === 'bridges' && <BridgesBuilder sectorId={sectorId} entityOptions={entityOptions} />}
              {builderTab === 'rules' && <RulesBuilder sectorId={sectorId} />}
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
