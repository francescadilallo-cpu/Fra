/**
 * Curated demo-workspace content for the Semantic Layer view.
 *
 * This is the rich, hand-written narrative for the AdventureWorks-style demo
 * scenario (OrionSales ERP + ClientHub CRM + HR CSV + PIM JSON): cross-source
 * bridges with match rates, data-quality findings, disambiguation rules,
 * entity field mappings and worked query examples. It documents the dataset
 * that actually ships in the backend snapshot — the numbers (row counts,
 * match rates, revenue figures) match the real data.
 *
 * Shown only when IS_DEMO_MODE is true and the manufacturing sector is
 * selected; live-mode workspaces never see any of this.
 */

// ── Sources ───────────────────────────────────────────────────────────────────

export interface DemoSource {
  id: string
  name: string
  type: string
  icon: string
  colorBorder: string
  colorBg: string
  colorText: string
  colorDot: string
  entities: { name: string; rows: number }[]
  total: number
  warning?: string
}

export const DEMO_SOURCES: DemoSource[] = [
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

// ── Source freshness ──────────────────────────────────────────────────────────

export interface DemoFreshness {
  lastSync: string
  sla: string
  quality: number
  status: 'fresh' | 'stale' | 'warning'
  label: string
}

export const DEMO_SOURCE_FRESHNESS: Record<string, DemoFreshness> = {
  erp: { lastSync: '02:00', sla: 'Daily',  quality: 97, status: 'fresh',   label: 'ERP (OrionSales)' },
  crm: { lastSync: '01:30', sla: 'Daily',  quality: 94, status: 'fresh',   label: 'CRM (ClientHub)' },
  hr:  { lastSync: '09:00', sla: 'Weekly', quality: 99, status: 'warning', label: 'HR CSV' },
  pim: { lastSync: '18:00', sla: 'Daily',  quality: 91, status: 'fresh',   label: 'PIM JSON' },
}

// ── Cross-source bridges ──────────────────────────────────────────────────────

export interface DemoBridge {
  id: number
  label: string
  cardinality: string
  matchRate: number
  from: { source: string; entity: string; field: string }
  to: { source: string; entity: string; field: string }
  detail: string
  note: string
  impact: string
}

export const DEMO_BRIDGES: DemoBridge[] = [
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

// ── Entity field mappings ─────────────────────────────────────────────────────

export interface DemoEntityField {
  semantic: string
  physical: string
  type: string
  note?: string
  bridge?: string
}

export const DEMO_ENTITY_DETAIL: Record<string, {
  source: string
  semanticAlias?: string
  fields: DemoEntityField[]
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

// ── Disambiguation rules ──────────────────────────────────────────────────────

export interface DemoDisambiguationRule {
  term: string
  problem: string
  options: { label: string; value: string; desc: string; semantic: string; recommended: boolean }[]
  resolution: string
}

export const DEMO_DISAMBIGUATION_RULES: DemoDisambiguationRule[] = [
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

// ── Worked query examples ─────────────────────────────────────────────────────

export interface DemoQueryExample {
  question: string
  path: string[]
  bridges: string[]
  sql: string
  result: string
}

export const DEMO_QUERY_EXAMPLES: DemoQueryExample[] = [
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

// ── Data quality findings ─────────────────────────────────────────────────────

export interface DemoQualityIssue {
  severity: 'warning' | 'info'
  entity: string
  issue: string
  resolution: string
}

export const DEMO_QUALITY_ISSUES: DemoQualityIssue[] = [
  { severity: 'warning', entity: 'Customer — CRM accounts', issue: '372 accounts with accountId < 0 — duplicates from legacy CRM migration', resolution: 'Filtered in KG build: 20,201 raw → 19,829 clean unique accounts' },
  { severity: 'warning', entity: 'SalesOrder — revenue field', issue: 'subtotalAmount ($20.1M) vs totalDue ($22.4M) — $2.3M gap from tax + freight', resolution: 'Disambiguated at query time via isDisambiguation flag' },
  { severity: 'info', entity: 'Employee — HR CSV', issue: 'Italian column names: matricolaDip, cognome, nome, ruolo, stipendio, repartoId', resolution: 'Mapped to semantic aliases in ontology: employeeId, lastName, firstName…' },
  { severity: 'info', entity: 'SalesOrderLine — product match', issue: '47 / 121,317 order lines have productId not in PIM catalog (0.04% unmatched)', resolution: 'Treated as unknown products — excluded from category analysis' },
]
