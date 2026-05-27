import type { OntologyNode } from '../types'
import { generateMockData } from './mockDataGenerator'

// ── Types ─────────────────────────────────────────────────────────────────────

export type FilterOp = '>' | '<' | '>=' | '<=' | '=' | '!=' | 'like'
export interface Filter { field: string; op: FilterOp; value: unknown }
export interface SortClause { field: string; dir: 'ASC' | 'DESC' }
export type AggFn = 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN'
export interface Aggregation { fn: AggFn; field: string; groupBy?: string }

export interface ParsedQuery {
  node: OntologyNode
  filters: Filter[]
  aggregation?: Aggregation
  orderBy?: SortClause
  limit: number
  selectFields: string[]
}

export interface ChartData {
  type: 'bar' | 'line' | 'pie'
  title: string
  labels: string[]
  values: number[]
  unit?: string
}

export interface SourceBadge {
  id: string
  label: string
  bg: string
  text: string
}

export interface EngineResult {
  sql: string
  rows: Record<string, unknown>[]
  summary: string
  interpreted_as: string
  chartData?: ChartData
  followUps?: string[]
  isDisambiguation?: boolean
  sources?: SourceBadge[]
  steps?: string[]
}

// ── Entity matching ───────────────────────────────────────────────────────────

const ENTITY_ALIASES: Record<string, string[]> = {
  Customer:       ['customer','customers','client','clients','buyer','buyers','clienti','cliente'],
  Product:        ['product','products','prodotto','prodotti','item','items','sku'],
  Quote:          ['quote','quotes','preventivo','preventivi','quotation','quotations'],
  Order:          ['order','orders','ordine','ordini','purchase','sale'],
  Supplier:       ['supplier','suppliers','vendor','vendors','fornitore','fornitori'],
  WorkOrder:      ['workorder','work order','work orders','production order','wo'],
  BillOfMaterial: ['bom','bill of material','billofmaterial','bill'],
  Machine:        ['machine','machines','macchina','macchinario','equipment'],
  Cart:           ['cart','carts','carrello','basket','baskets'],
  Category:       ['category','categories','categoria','categorie'],
  Inventory:      ['inventory','inventario','stock','warehouse'],
  Promotion:      ['promotion','promotions','promozione','promo','discount'],
  Store:          ['store','stores','negozio','shop','outlet'],
  Patient:        ['patient','patients','paziente','pazienti'],
  Diagnosis:      ['diagnosis','diagnosi','diagnoses'],
  Treatment:      ['treatment','treatments','trattamento','therapy'],
  Encounter:      ['encounter','encounters','visit','visits','appointment','incontro'],
  Doctor:         ['doctor','doctors','medico','physician','clinician'],
  Prescription:   ['prescription','prescriptions','ricetta','prescrizione'],
  Medication:     ['medication','medications','drug','drugs','farmaco','medicine'],
  InsurancePlan:  ['insurance','insuranceplan','assicurazione','coverage','piano'],
  Applicant:      ['applicant','applicants','borrower','borrowers','richiedente','applicazione'],
  Loan:           ['loan','loans','prestito','credit','finanziamento'],
  Collateral:     ['collateral','collaterals','garanzia','security'],
  Transaction:    ['transaction','transactions','transazione','payment transfer'],
  RiskProfile:    ['riskprofile','risk profile','profilo rischio','risk'],
  KYCRecord:      ['kyc','kycrecord','kyc record','document check','verifica'],
  Payment:        ['payment','payments','pagamento','installment','rata'],
  BankAccount:    ['bankaccount','bank account','conto','iban','account'],
}

function findNode(q: string, nodes: OntologyNode[]): OntologyNode | null {
  const lower = q.toLowerCase()
  for (const node of nodes) {
    const aliases = ENTITY_ALIASES[node.data.label] ?? [node.data.label.toLowerCase()]
    if (aliases.some(a => lower.includes(a))) return node
    if (node.data.db_table && lower.includes(node.data.db_table.replace('_', ' '))) return node
  }
  return nodes[0] ?? null // fallback to first entity
}

// ── Field matching ────────────────────────────────────────────────────────────

const FIELD_ALIASES: Record<string, string[]> = {
  // Generic
  name:          ['name','nome','company','azienda','called'],
  status:        ['status','stato','state'],
  country:       ['country','paese','nazione','location'],
  email:         ['email','mail'],
  // Financial
  creditLimit:   ['credit limit','creditlimit','fido','credit'],
  totalValue:    ['total value','totalvalue','valore','value','worth'],
  totalAmount:   ['total','amount','importo','totale'],
  amount:        ['amount','importo','valore'],
  unitPrice:     ['unit price','unitprice','price','prezzo','costo'],
  price:         ['price','prezzo','costo'],
  balance:       ['balance','saldo'],
  rate:          ['rate','tasso','interest'],
  // Risk / scoring
  riskScore:     ['risk score','riskscore','score','punteggio','rating'],
  rating:        ['rating','valutazione','score'],
  // Inventory
  stockLevel:    ['stock','stocklevel','stock level','quantity','quantità','inventory'],
  quantity:      ['quantity','quantità','qty'],
  // Dates
  date:          ['date','data'],
  validUntil:    ['expir','scadenza','valid until','expiry'],
  deliveryDate:  ['delivery','consegna','deliver'],
  dueDate:       ['due','scadenza','deadline'],
  // Healthcare
  icd10:         ['icd','diagnosis code','codice'],
  severity:      ['severity','gravità','critical'],
  // Other
  leadTimeDays:  ['lead time','leadtime','delivery time'],
  efficiency:    ['efficiency','efficienza'],
  active:        ['active','attivo','enabled'],
  discountPct:   ['discount','sconto','rebate'],
  annualIncome:  ['income','reddito','salary'],
  termMonths:    ['term','durata','months'],
}

function findField(q: string, node: OntologyNode): string | null {
  const lower = q.toLowerCase()
  const propNames = node.data.properties.map(p => p.name)
  // Direct alias match
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (propNames.includes(field) && aliases.some(a => lower.includes(a))) return field
  }
  // Direct property name match
  for (const p of node.data.properties) {
    if (lower.includes(p.name.toLowerCase())) return p.name
  }
  return null
}

function bestNumericField(node: OntologyNode): string | null {
  const prefs = ['totalValue','totalAmount','amount','price','unitPrice','value','balance','creditLimit','riskScore','rating','quantity','stockLevel','leadTimeDays','efficiency','rate']
  for (const p of prefs) {
    if (node.data.properties.some(pr => pr.name === p)) return p
  }
  const dec = node.data.properties.find(p => p.type === 'decimal' || p.type === 'integer')
  return dec?.name ?? null
}

function bestLabelField(node: OntologyNode): string | null {
  const prefs = ['name','email','sku','icd10','country','type','status','planCode']
  for (const p of prefs) {
    if (node.data.properties.some(pr => pr.name === p)) return p
  }
  return node.data.properties.find(p => p.type === 'string')?.name ?? null
}

// ── Filter extraction ─────────────────────────────────────────────────────────

function extractFilters(q: string, node: OntologyNode): Filter[] {
  const filters: Filter[] = []
  const lower = q

  // Numeric comparisons: > < >= <= followed by number (with optional k/m suffix)
  const numericRe = /([\w\s]+?)\s*(>=|<=|>|<|=)\s*[€$]?\s*(\d+(?:\.\d+)?)\s*(k|m)?/gi
  let m: RegExpExecArray | null
  while ((m = numericRe.exec(lower)) !== null) {
    const keyword = m[1].trim()
    const op = m[2] as FilterOp
    let val = parseFloat(m[3])
    if (m[4] === 'k') val *= 1000
    if (m[4] === 'm') val *= 1_000_000
    const field = findField(keyword, node)
    if (field) filters.push({ field, op, value: val })
  }

  // "below/above/over/under X" patterns
  const threshRe = /\b(below|above|over|under|less than|more than|at least|greater than)\b\s+[€$]?\s*(\d+(?:\.\d+)?)\s*(k|m)?/gi
  while ((m = threshRe.exec(lower)) !== null) {
    const word = m[1]
    let val = parseFloat(m[2])
    if (m[3] === 'k') val *= 1000
    if (m[3] === 'm') val *= 1_000_000
    const op: FilterOp = /below|under|less/.test(word) ? '<' : '>'
    // Try to find field from context
    const field = bestNumericField(node)
    if (field && !filters.some(f => f.field === field)) {
      filters.push({ field, op, value: val })
    }
  }

  // Status/string filters
  const stringMatchers: Array<{ pattern: RegExp; field: string; value: string }> = [
    { pattern: /\b(active|attivi?)\b/i,      field: 'status', value: 'active' },
    { pattern: /\b(pending|in attesa)\b/i,   field: 'status', value: 'pending' },
    { pattern: /\b(confirmed|confermati?)\b/i,field:'status', value: 'confirmed' },
    { pattern: /\b(cancelled|annullati?)\b/i, field:'status', value: 'cancelled' },
    { pattern: /\b(completed|completati?)\b/i,field:'status', value: 'completed' },
    { pattern: /\b(approved|approvati?)\b/i,  field:'status', value: 'approved' },
    { pattern: /\b(rejected|rifiutati?)\b/i,  field:'status', value: 'rejected' },
    { pattern: /\b(gold)\b/i,    field: 'loyaltyTier', value: 'Gold' },
    { pattern: /\b(silver)\b/i,  field: 'loyaltyTier', value: 'Silver' },
    { pattern: /\b(italy|italian|italiani?)\b/i, field: 'country', value: 'Italy' },
    { pattern: /\b(germany|german)\b/i, field: 'country', value: 'Germany' },
    { pattern: /\b(high risk)\b/i, field: 'category', value: 'High' },
    { pattern: /\b(low risk)\b/i,  field: 'category', value: 'Low' },
  ]
  for (const sm of stringMatchers) {
    if (sm.pattern.test(lower) && node.data.properties.some(p => p.name === sm.field)) {
      filters.push({ field: sm.field, op: '=', value: sm.value })
    }
  }

  // "no outcome", "no follow-up", "null" patterns
  if (/\bno outcome\b|\bwithout outcome\b/i.test(lower) && node.data.properties.some(p => p.name === 'outcome')) {
    filters.push({ field: 'outcome', op: '=', value: 'Pending' })
  }

  return filters
}

// ── Aggregation detection ─────────────────────────────────────────────────────

function extractAggregation(q: string, node: OntologyNode): Aggregation | undefined {
  const lower = q.toLowerCase()

  if (/\bhow many\b|\bcount\b|\bnumero di\b|\bquanti\b/i.test(lower)) {
    const groupField = /\bby\b|\bper\b|\bgroup\b/i.test(lower) ? (findField(lower.replace(/.*\bby\b/i, ''), node) ?? undefined) : undefined
    return { fn: 'COUNT', field: '*', groupBy: groupField }
  }
  if (/\btotal\b|\bsum\b|\btotale\b|\bsomma\b/i.test(lower)) {
    const field = findField(lower, node) ?? bestNumericField(node) ?? '*'
    const groupBy = /\bby\b|\bper\b/i.test(lower) ? (findField(lower.replace(/.*\bby\b/i, ''), node) ?? undefined) : undefined
    return { fn: 'SUM', field, groupBy }
  }
  if (/\baverage\b|\bavg\b|\bmedia\b|\bmedian\b/i.test(lower)) {
    const field = findField(lower, node) ?? bestNumericField(node) ?? '*'
    const groupBy = /\bby\b|\bper\b/i.test(lower) ? (findField(lower.replace(/.*\bby\b/i, ''), node) ?? undefined) : undefined
    return { fn: 'AVG', field, groupBy }
  }
  return undefined
}

// ── Sort / limit detection ────────────────────────────────────────────────────

function extractSort(q: string, node: OntologyNode): SortClause | undefined {
  const lower = q.toLowerCase()
  const isDesc = /\btop\b|\bhighest\b|\bbest\b|\bmost\b|\blargest\b|\bbiggest\b|\bmax\b|\brecent\b|\blatest\b|\bmaggiori?\b/i.test(lower)
  const isAsc  = /\blowest\b|\bsmallest\b|\bworst\b|\bcheapest\b|\bmin\b|\boldest\b|\bminori?\b/i.test(lower)

  if (!isDesc && !isAsc) return undefined

  const field = findField(lower, node) ?? bestNumericField(node) ?? bestLabelField(node)
  if (!field) return undefined
  return { field, dir: isAsc ? 'ASC' : 'DESC' }
}

function extractLimit(q: string): number {
  const m = q.match(/\b(?:top|first|show|last)\s+(\d+)\b/i) ?? q.match(/\b(\d+)\s+(?:result|row|record|item)/i)
  if (m) return Math.min(parseInt(m[1]), 50)
  return 20
}

// ── SQL generation ────────────────────────────────────────────────────────────

function buildSQL(pq: ParsedQuery): string {
  const tbl = pq.node.data.db_table ?? pq.node.data.label.toLowerCase() + 's'
  const select = pq.aggregation
    ? pq.aggregation.fn === 'COUNT'
      ? pq.aggregation.groupBy
        ? `${pq.aggregation.groupBy}, COUNT(*) AS count`
        : 'COUNT(*) AS total'
      : pq.aggregation.groupBy
        ? `${pq.aggregation.groupBy}, ${pq.aggregation.fn}(${pq.aggregation.field}) AS result`
        : `${pq.aggregation.fn}(${pq.aggregation.field}) AS result`
    : pq.selectFields.slice(0, 8).join(', ')

  const where = pq.filters.length > 0
    ? '\nWHERE ' + pq.filters.map(f => {
        const v = typeof f.value === 'string' ? `'${f.value}'` : f.value
        return `${f.field} ${f.op} ${v}`
      }).join('\n  AND ')
    : ''

  const groupBy = pq.aggregation?.groupBy ? `\nGROUP BY ${pq.aggregation.groupBy}` : ''
  const orderBy = pq.orderBy ? `\nORDER BY ${pq.orderBy.field} ${pq.orderBy.dir}` : ''
  const limit = !pq.aggregation ? `\nLIMIT ${pq.limit}` : ''

  return `SELECT ${select}\nFROM ${tbl}${where}${groupBy}${orderBy}${limit}`
}

// ── Execution ─────────────────────────────────────────────────────────────────

function applyFilter(row: Record<string, unknown>, f: Filter): boolean {
  const val = row[f.field]
  if (val === undefined) return true // field missing → don't exclude
  const rv = f.value
  if (typeof val === 'number' && typeof rv === 'number') {
    if (f.op === '>') return val > rv
    if (f.op === '<') return val < rv
    if (f.op === '>=') return val >= rv
    if (f.op === '<=') return val <= rv
    if (f.op === '=') return Math.abs(val - rv) < 0.001
    if (f.op === '!=') return Math.abs(val - rv) >= 0.001
  }
  if (typeof val === 'string') {
    const sv = String(rv).toLowerCase()
    if (f.op === '=') return val.toLowerCase() === sv
    if (f.op === '!=') return val.toLowerCase() !== sv
    if (f.op === 'like') return val.toLowerCase().includes(sv)
  }
  if (typeof val === 'boolean') {
    if (f.op === '=') return val === (rv === true || rv === 'true' || rv === 1)
  }
  return true
}

function aggregate(rows: Record<string, unknown>[], agg: Aggregation): Record<string, unknown>[] {
  if (!agg.groupBy) {
    if (agg.fn === 'COUNT') return [{ total: rows.length }]
    const nums = rows.map(r => Number(r[agg.field])).filter(n => !isNaN(n))
    if (agg.fn === 'SUM') return [{ result: nums.reduce((a, b) => a + b, 0).toFixed(2) }]
    if (agg.fn === 'AVG') return [{ result: (nums.reduce((a, b) => a + b, 0) / (nums.length || 1)).toFixed(2) }]
    if (agg.fn === 'MAX') return [{ result: Math.max(...nums) }]
    if (agg.fn === 'MIN') return [{ result: Math.min(...nums) }]
  } else {
    const grouped: Record<string, number[]> = {}
    for (const row of rows) {
      const key = String(row[agg.groupBy!] ?? 'Unknown')
      if (!grouped[key]) grouped[key] = []
      const v = Number(row[agg.field === '*' ? Object.keys(row)[0] : agg.field])
      grouped[key].push(isNaN(v) ? 1 : v)
    }
    return Object.entries(grouped).map(([key, vals]) => {
      let result: number
      if (agg.fn === 'COUNT') result = vals.length
      else if (agg.fn === 'SUM') result = vals.reduce((a, b) => a + b, 0)
      else if (agg.fn === 'AVG') result = vals.reduce((a, b) => a + b, 0) / vals.length
      else if (agg.fn === 'MAX') result = Math.max(...vals)
      else result = Math.min(...vals)
      return { [agg.groupBy!]: key, result: parseFloat(result.toFixed(2)) }
    }).sort((a, b) => Number(b.result) - Number(a.result))
  }
  return []
}

// ── Summary generation ────────────────────────────────────────────────────────

function buildSummary(rows: Record<string, unknown>[], pq: ParsedQuery): string {
  const label = pq.node.data.label
  const n = rows.length

  if (pq.aggregation && n === 1) {
    const val = Object.values(rows[0])[0]
    const fn = pq.aggregation.fn.toLowerCase()
    if (pq.aggregation.fn === 'COUNT') return `Found **${val}** ${label.toLowerCase()} records matching your criteria.`
    const field = pq.aggregation.field
    return `The ${fn} of **${field}** across ${label} is **${val}**.`
  }
  if (pq.aggregation?.groupBy && n > 0) {
    const topVal = Object.values(rows[0]).pop()
    const topKey = Object.values(rows[0])[0]
    return `Grouped ${label.toLowerCase()} by **${pq.aggregation.groupBy}**: ${n} groups found. Top: **${topKey}** (${topVal}).`
  }
  if (n === 0) return `No ${label.toLowerCase()} records match your criteria. Try relaxing the filters.`
  if (pq.filters.length > 0) return `Found **${n}** ${label.toLowerCase()} records matching your filters.`
  if (pq.orderBy) {
    const dir = pq.orderBy.dir === 'DESC' ? 'highest' : 'lowest'
    return `Showing the ${n} ${label.toLowerCase()} records with the ${dir} **${pq.orderBy.field}**.`
  }
  return `Showing **${n}** ${label.toLowerCase()} records from the semantic layer.`
}

// ── Chart data ────────────────────────────────────────────────────────────────

function buildChartData(rows: Record<string, unknown>[], pq: ParsedQuery): ChartData | undefined {
  const numField = pq.aggregation?.field !== '*' ? pq.aggregation?.field : bestNumericField(pq.node)
  const labelField = pq.aggregation?.groupBy ?? bestLabelField(pq.node)

  if (!numField || !labelField || rows.length < 2 || rows.length > 20) return undefined
  if (!rows[0]) return undefined

  const labels = rows.slice(0, 10).map(r => String(r[labelField] ?? '—').slice(0, 20))
  const values = rows.slice(0, 10).map(r => {
    const v = r['result'] ?? r[numField!]
    return parseFloat(String(v)) || 0
  })

  if (values.every(v => v === 0)) return undefined

  const isMonetary = /amount|value|price|cost|limit|balance|income/.test(numField ?? '')
  const unit = isMonetary ? '€' : /rate|score|pct|percent/.test(numField ?? '') ? '%' : ''

  return {
    type: 'bar',
    title: pq.aggregation
      ? `${pq.aggregation.fn}(${pq.aggregation.field}) by ${pq.aggregation.groupBy ?? 'entity'}`
      : `${pq.node.data.label} by ${numField}`,
    labels,
    values,
    unit,
  }
}

// ── AdventureWorks canned responses ──────────────────────────────────────────
// Pattern-matched for the real AW demo scenario — returns precise data from
// actual source tables instead of random mock rows.

const SRC: Record<string, SourceBadge> = {
  ERP: { id: 'erp', label: 'ERP OrionSales',  bg: 'bg-blue-100',   text: 'text-blue-700'   },
  CRM: { id: 'crm', label: 'CRM ClientHub',   bg: 'bg-violet-100', text: 'text-violet-700' },
  HR:  { id: 'hr',  label: 'HR CSV',           bg: 'bg-amber-100',  text: 'text-amber-700'  },
  PIM: { id: 'pim', label: 'PIM JSON',         bg: 'bg-teal-100',   text: 'text-teal-700'   },
  KG:  { id: 'kg',  label: 'Knowledge Graph',  bg: 'bg-slate-100',  text: 'text-slate-600'  },
}

const AW_PATTERNS: Array<{
  test: (q: string) => boolean
  result: () => EngineResult
}> = [
  // ── Net revenue (specific — before the general disambiguation pattern) ───────
  {
    test: q => /subtotalAmount|net.?revenue|commercial.?revenue/i.test(q),
    result: () => ({
      sql: `-- Net revenue by quarter 2014 (subtotal_amount = excl. tax + freight)
SELECT
  CONCAT('Q', DATEPART(quarter, orderDate), ' 2014') AS quarter,
  COUNT(*)                     AS orders,
  SUM(subtotalAmount)          AS net_revenue,
  AVG(subtotalAmount)          AS avg_order_net
FROM erp.SalesOrder
WHERE YEAR(orderDate) = 2014
GROUP BY DATEPART(quarter, orderDate)
ORDER BY quarter`,
      rows: [
        { quarter: 'Q1 2014', orders: 7312,  net_revenue: '$4,121,485', avg_order_net: '$563.63' },
        { quarter: 'Q2 2014', orders: 8204,  net_revenue: '$5,182,930', avg_order_net: '$631.76' },
        { quarter: 'Q3 2014', orders: 8847,  net_revenue: '$5,847,621', avg_order_net: '$661.07' },
        { quarter: 'Q4 2014', orders: 7102,  net_revenue: '$4,975,034', avg_order_net: '$700.51' },
      ],
      summary: '**Net revenue (subtotal_amount) 2014: $20.1M** across 31,465 orders. Peak quarter is Q3 ($5.85M). Average net order: $639.65. This excludes tax and freight — the commercial "fatturato" figure.',
      interpreted_as: 'SUM(subtotalAmount) GROUP BY quarter · ERP SalesOrder · YEAR 2014',
      chartData: {
        type: 'line',
        title: 'Net revenue by quarter — subtotal_amount',
        labels: ['Q1 2014', 'Q2 2014', 'Q3 2014', 'Q4 2014'],
        values: [4121485, 5182930, 5847621, 4975034],
        unit: '$',
      },
      sources: [SRC.ERP],
      steps: [
        '① "net revenue" resolved → subtotal_amount (commercial, excl. tax + freight)',
        '② Filter: YEAR(orderDate) = 2014 · 31,465 orders in scope',
        '③ GROUP BY quarter · SUM(subtotalAmount) · AVG(subtotalAmount)',
        '④ Total verified: $20,127,070',
      ],
      followUps: [
        'Who is the top salesperson by revenue in 2014?',
        'Show orders by territory ranked by sales YTD',
        'Which products generated the most revenue?',
      ],
    }),
  },
  // ── Gross revenue (specific — before the general disambiguation pattern) ─────
  {
    test: q => /totalDue|total.?due|gross.?revenue|billed.?amount/i.test(q),
    result: () => ({
      sql: `-- Gross revenue by quarter 2014 (total_due = incl. tax + freight)
SELECT
  CONCAT('Q', DATEPART(quarter, orderDate), ' 2014') AS quarter,
  COUNT(*)                     AS orders,
  SUM(totalDue)                AS gross_revenue,
  SUM(totalDue) - SUM(subtotalAmount) AS tax_freight
FROM erp.SalesOrder
WHERE YEAR(orderDate) = 2014
GROUP BY DATEPART(quarter, orderDate)
ORDER BY quarter`,
      rows: [
        { quarter: 'Q1 2014', orders: 7312,  gross_revenue: '$4,588,234', tax_freight: '$466,749' },
        { quarter: 'Q2 2014', orders: 8204,  gross_revenue: '$5,768,412', tax_freight: '$585,482' },
        { quarter: 'Q3 2014', orders: 8847,  gross_revenue: '$6,504,891', tax_freight: '$657,270' },
        { quarter: 'Q4 2014', orders: 7102,  gross_revenue: '$5,549,031', tax_freight: '$573,997' },
      ],
      summary: '**Gross revenue (total_due) 2014: $22.4M** — includes $2.28M in tax + freight on top of net. Same 31,465 orders. Q3 peak at $6.5M gross. Average gross order: $712.24.',
      interpreted_as: 'SUM(totalDue) GROUP BY quarter · ERP SalesOrder · YEAR 2014',
      chartData: {
        type: 'line',
        title: 'Gross revenue by quarter — total_due',
        labels: ['Q1 2014', 'Q2 2014', 'Q3 2014', 'Q4 2014'],
        values: [4588234, 5768412, 6504891, 5549031],
        unit: '$',
      },
      sources: [SRC.ERP],
      steps: [
        '① "gross revenue" resolved → total_due (billing amount, incl. tax + freight)',
        '② Filter: YEAR(orderDate) = 2014 · 31,465 orders in scope',
        '③ GROUP BY quarter · SUM(totalDue) · delta = totalDue − subtotalAmount',
        '④ Total verified: $22,410,568 (+$2,283,498 vs net)',
      ],
      followUps: [
        'Who is the top salesperson by revenue in 2014?',
        'Show orders by territory ranked by sales YTD',
        'Which products generated the most revenue?',
      ],
    }),
  },
  // ── Top salesperson ───────────────────────────────────────────────────────────
  {
    test: q => /top sales(person|rep)|best sales|who.*sold|jae pak|salesperson.*revenue|revenue.*salesperson/i.test(q),
    result: () => ({
      sql: `-- ERP (OrionSales) × HR (dipendenti_hr) cross-source join
SELECT e.cognome || ', ' || e.nome AS salesperson,
       sp.salesYTD,
       sp.bonus,
       sp.commissionPct,
       sp.salesPersonId AS erp_id,
       e.matricolaDip   AS hr_id   -- bridge: salesperson_ref ↔ matricolaDip
FROM   erp.SalesPerson sp
JOIN   hr.dipendenti_hr e ON sp.salesPersonId = e.matricolaDip
ORDER  BY sp.salesYTD DESC
LIMIT  10`,
      rows: [
        { salesperson: 'Mitchell, Linda',   salesYTD: 4251368.55, bonus: 2000, commissionPct: '1.5%', erp_id: 276, hr_id: 276 },
        { salesperson: 'Reiter, Rachel',    salesYTD: 4116871.23, bonus: 5150, commissionPct: '2.0%', erp_id: 289, hr_id: 289 },
        { salesperson: 'Saraiva, José',     salesYTD: 3763178.18, bonus: 4100, commissionPct: '1.2%', erp_id: 275, hr_id: 275 },
        { salesperson: 'Tsoflias, Lynn',    salesYTD: 3189418.37, bonus: 2500, commissionPct: '1.5%', erp_id: 277, hr_id: 277 },
        { salesperson: 'Vargas, Ranjit',    salesYTD: 3121616.32, bonus:  985, commissionPct: '1.6%', erp_id: 290, hr_id: 290 },
        { salesperson: 'Campbell, David',   salesYTD: 2604540.72, bonus: 5000, commissionPct: '1.5%', erp_id: 282, hr_id: 282 },
        { salesperson: 'Valdez, Sonia',     salesYTD: 2458535.62, bonus: 3550, commissionPct: '1.0%', erp_id: 281, hr_id: 281 },
        { salesperson: 'Pak, Jae',          salesYTD: 2315185.61, bonus: 6700, commissionPct: '1.0%', erp_id: 279, hr_id: 279 },
        { salesperson: 'Mensa-Bonsu, Syed', salesYTD: 1827066.71, bonus:   75, commissionPct: '1.8%', erp_id: 288, hr_id: 288 },
        { salesperson: 'Alberts, Pamela',   salesYTD: 1453719.47, bonus:  500, commissionPct: '1.0%', erp_id: 278, hr_id: 278 },
      ],
      summary: 'Top salesperson is **Linda Mitchell** ($4.25M YTD), followed by **Rachel Reiter** ($4.12M). **Jae Pak** ranks 8th with the highest bonus ($6,700). Cross-source join: ERP OrionSales × HR CSV via `salesPersonId ↔ matricolaDip`.',
      interpreted_as: 'ERP.SalesPerson JOIN HR.dipendenti_hr · ORDER BY salesYTD DESC · LIMIT 10',
      chartData: {
        type: 'bar',
        title: 'Sales YTD by salesperson (ERP × HR)',
        labels: ['Mitchell', 'Reiter', 'Saraiva', 'Tsoflias', 'Vargas', 'Campbell', 'Valdez', 'Pak'],
        values: [4251368, 4116871, 3763178, 3189418, 3121616, 2604540, 2458535, 2315185],
        unit: '$',
      },
      sources: [SRC.ERP, SRC.HR],
      steps: [
        '① Bridge resolved: salesPersonId ↔ matricolaDip (14/14 matches — 100%)',
        '② Cross-join ERP.SalesPerson × HR.dipendenti_hr on bridge key',
        '③ Semantic mapping: cognome || \', \' || nome → salesperson label',
        '④ ORDER BY salesYTD DESC · 14 reps ranked · LIMIT 10',
      ],
      followUps: [
        'Show orders by territory ranked by sales YTD',
        'What is our total revenue — subtotal vs total due?',
        'Which products generated the most revenue?',
      ],
    }),
  },
  // ── Customer / CRM dedup ──────────────────────────────────────────────────────
  {
    test: q => /customer|client|account|how many.*customer|crm|dedup|duplicate/i.test(q),
    result: () => ({
      sql: `-- CRM ClientHub deduplication result
-- Raw table: 20,201 accounts
-- Invalid: accountId < 0 → 372 legacy migration duplicates removed

SELECT
  COUNT(*)                                          AS raw_accounts,
  COUNT(*) FILTER (WHERE accountId < 0)             AS duplicates_removed,
  COUNT(*) FILTER (WHERE accountId > 0)             AS unique_customers,
  ROUND(AVG(creditLimit), 2)                        AS avg_credit_limit,
  COUNT(*) FILTER (WHERE country = 'United States') AS us_customers
FROM crm.ClientHub_accounts`,
      rows: [
        { metric: 'Raw CRM accounts',      value: '20,201', note: 'ClientHub SQLite before dedup' },
        { metric: 'Duplicates removed',    value: '372',    note: 'accountId < 0 — legacy migration artefacts' },
        { metric: 'Unique customers (KG)', value: '19,829', note: 'Retained in Knowledge Graph' },
        { metric: 'ERP↔CRM bridge',        value: '18,484', note: 'Matched via customer_ref ↔ accountId' },
        { metric: 'Unmatched CRM-only',    value: '1,345',  note: 'No ERP order history — prospects' },
      ],
      summary: 'After CRM deduplication, **19,829 unique customers** in the Knowledge Graph (372 duplicates with `accountId < 0` removed). **18,484** cross-referenced with ERP orders via `customer_ref ↔ accountId` bridge (93.2% match).',
      interpreted_as: 'CRM.ClientHub_accounts · dedup filter accountId < 0 · ERP bridge join',
      chartData: {
        type: 'bar',
        title: 'CRM account breakdown',
        labels: ['Unique customers', 'ERP-matched', 'CRM-only prospects', 'Duplicates removed'],
        values: [19829, 18484, 1345, 372],
        unit: '',
      },
      sources: [SRC.CRM, SRC.ERP, SRC.KG],
      steps: [
        '① CRM ClientHub loaded: 20,201 raw accounts',
        '② Dedup rule applied: accountId < 0 → 372 legacy migration artefacts removed',
        '③ Clean set: 19,829 unique customers ingested into Knowledge Graph',
        '④ Bridge customer_ref ↔ accountId: 18,484/19,829 matched to ERP (93.2%)',
      ],
      followUps: [
        'Who is the top salesperson by revenue in 2014?',
        'Show orders by territory ranked by sales YTD',
        'Which products generated the most revenue?',
      ],
    }),
  },
  // ── Territory ─────────────────────────────────────────────────────────────────
  {
    test: q => /territory|region|area|geographic|by.*country|country.*by/i.test(q),
    result: () => ({
      sql: `SELECT t.name          AS territory,
       t.countryRegion,
       t.group,
       t.salesYTD,
       COUNT(o.orderId) AS order_count
FROM   erp.SalesTerritory t
LEFT   JOIN erp.SalesOrder o ON o.territoryId = t.territoryId
GROUP  BY t.territoryId
ORDER  BY t.salesYTD DESC`,
      rows: [
        { territory: 'Southwest',      countryRegion: 'US', group: 'North America', salesYTD: 10510853.87, order_count: 8512 },
        { territory: 'Northwest',      countryRegion: 'US', group: 'North America', salesYTD:  7887186.79, order_count: 6438 },
        { territory: 'Canada',         countryRegion: 'CA', group: 'North America', salesYTD:  6771829.14, order_count: 4821 },
        { territory: 'Australia',      countryRegion: 'AU', group: 'Pacific',       salesYTD:  5977814.92, order_count: 3944 },
        { territory: 'United Kingdom', countryRegion: 'GB', group: 'Europe',        salesYTD:  5012905.37, order_count: 3201 },
        { territory: 'France',         countryRegion: 'FR', group: 'Europe',        salesYTD:  4772398.31, order_count: 2988 },
        { territory: 'Germany',        countryRegion: 'DE', group: 'Europe',        salesYTD:  3805202.35, order_count: 2477 },
        { territory: 'Central',        countryRegion: 'US', group: 'North America', salesYTD:  3072175.12, order_count: 2341 },
        { territory: 'Southeast',      countryRegion: 'US', group: 'North America', salesYTD:  2538667.25, order_count: 1910 },
        { territory: 'Northeast',      countryRegion: 'US', group: 'North America', salesYTD:  2402176.85, order_count: 1833 },
      ],
      summary: '**Southwest** leads with $10.5M YTD (8,512 orders), followed by **Northwest** ($7.9M). North America $33.2M combined. Europe (UK, France, Germany) $13.6M.',
      interpreted_as: 'ERP.SalesTerritory LEFT JOIN SalesOrder · GROUP BY territory · ORDER BY salesYTD DESC',
      chartData: {
        type: 'bar',
        title: 'Sales YTD by territory',
        labels: ['Southwest', 'Northwest', 'Canada', 'Australia', 'UK', 'France', 'Germany', 'Central'],
        values: [10510853, 7887186, 6771829, 5977814, 5012905, 4772398, 3805202, 3072175],
        unit: '$',
      },
      sources: [SRC.ERP],
      steps: [
        '① ERP.SalesTerritory loaded: 10 territories across 4 groups',
        '② LEFT JOIN ERP.SalesOrder ON territoryId',
        '③ GROUP BY territory · SUM(salesYTD) · COUNT(orderId)',
        '④ ORDER BY salesYTD DESC · Southwest #1 at $10.5M',
      ],
      followUps: [
        'Who is the top salesperson by revenue in 2014?',
        'What is our total revenue — subtotal vs total due?',
        'Which products generated the most revenue?',
      ],
    }),
  },
  // ── Products ──────────────────────────────────────────────────────────────────
  {
    test: q => /product|item|sku|catalog|which.*product|product.*revenue|top.*product|best.*product/i.test(q) && !/\bcategor/i.test(q),
    result: () => ({
      sql: `-- ERP × PIM cross-source join
-- PIM product_catalog (JSON, 504 products) joined to ERP SalesOrderLine
-- via product_ref ↔ internal_id bridge

SELECT   p.name,
         p.category,
         p.subcategory,
         p.listPrice,
         SUM(sol.lineTotal)   AS revenue,
         SUM(sol.quantity)    AS units_sold
FROM     pim.product_catalog p
JOIN     erp.SalesOrderLine sol ON sol.productId = p.internal_id
GROUP BY p.internal_id
ORDER BY revenue DESC
LIMIT    10`,
      rows: [
        { name: 'Mountain-200 Black, 38',  category: 'Bikes', subcategory: 'Mountain Bikes', listPrice: 2049.00, revenue: 261435.60, units_sold: 139 },
        { name: 'Road-150 Red, 62',        category: 'Bikes', subcategory: 'Road Bikes',     listPrice: 3578.27, revenue: 106419.60, units_sold: 32  },
        { name: 'Touring-1000 Blue, 60',   category: 'Bikes', subcategory: 'Touring Bikes',  listPrice: 2384.07, revenue:  32726.48, units_sold: 15  },
        { name: 'Mountain-100 Silver, 44', category: 'Bikes', subcategory: 'Mountain Bikes', listPrice: 3399.99, revenue:  14289.93, units_sold: 5   },
        { name: 'Road-650 Red, 58',        category: 'Bikes', subcategory: 'Road Bikes',     listPrice:  782.99, revenue:   8159.97, units_sold: 11  },
        { name: 'Long-Sleeve Logo Jersey', category: 'Clothing', subcategory: 'Jerseys',     listPrice:   49.99, revenue:   4079.98, units_sold: 89  },
        { name: 'Sport-100 Helmet Blue',   category: 'Accessories', subcategory: 'Helmets',  listPrice:   34.99, revenue:   2039.99, units_sold: 63  },
        { name: 'AWC Logo Cap',            category: 'Accessories', subcategory: 'Caps',     listPrice:    8.99, revenue:   2024.99, units_sold: 245 },
      ],
      summary: 'Top product: **Mountain-200 Black, 38** ($261K, 139 units). All top 5 are bikes. 47 PIM products have no ERP order history (orphans). Cross-source: ERP SalesOrderLine × PIM Catalog via `productId ↔ internal_id`.',
      interpreted_as: 'PIM.product_catalog JOIN ERP.SalesOrderLine · SUM(lineTotal) · ORDER BY revenue DESC',
      chartData: {
        type: 'bar',
        title: 'Revenue by product (ERP × PIM)',
        labels: ['Mtn-200 Blk', 'Road-150 Red', 'Touring-1000', 'Mtn-100 Slv', 'Road-650 Red', 'Jersey', 'Helmet', 'Logo Cap'],
        values: [261435, 106419, 32726, 14289, 8159, 4079, 2039, 2024],
        unit: '$',
      },
      sources: [SRC.ERP, SRC.PIM],
      steps: [
        '① PIM product_catalog loaded: 504 products (JSON, field: internal_id)',
        '② Bridge resolved: productId ↔ internal_id (457/459 ERP products matched — 99.6%)',
        '③ 47 PIM products have no ERP sales history (PIM orphans — unlaunched or discontinued)',
        '④ Cross-join ERP.SalesOrderLine × PIM · GROUP BY product · SUM(lineTotal)',
      ],
      followUps: [
        'Who is the top salesperson by revenue in 2014?',
        'Show orders by territory ranked by sales YTD',
        'How many unique customers after CRM deduplication?',
      ],
    }),
  },
  // ── Employees / HR ────────────────────────────────────────────────────────────
  {
    test: q => /employee|hr|staff|headcount|hired|dipendenti|matricola/i.test(q),
    result: () => ({
      sql: `-- HR CSV (dipendenti_hr) — Italian schema fields preserved
-- Semantic layer maps: matricolaDip→employeeId, cognome→lastName,
--                      nome→firstName, ruolo→jobTitle

SELECT matricolaDip AS employeeId,
       cognome      AS lastName,
       nome         AS firstName,
       ruolo        AS jobTitle,
       dataAssunzione AS hireDate
FROM   hr.dipendenti_hr
ORDER  BY matricolaDip
LIMIT  10`,
      rows: [
        { employeeId: 1,   lastName: 'Sánchez',   firstName: 'Ken',     jobTitle: 'Chief Executive Officer',       hireDate: '2009-01-14' },
        { employeeId: 2,   lastName: 'Duffy',      firstName: 'Terri',   jobTitle: 'VP of Engineering',             hireDate: '2008-01-31' },
        { employeeId: 3,   lastName: 'Tamburello', firstName: 'Roberto', jobTitle: 'Engineering Manager',           hireDate: '2007-11-11' },
        { employeeId: 5,   lastName: 'Erickson',   firstName: 'Gail',    jobTitle: 'Design Engineer',               hireDate: '2008-01-06' },
        { employeeId: 16,  lastName: 'Bradley',    firstName: 'David',   jobTitle: 'Marketing Manager',             hireDate: '2007-12-20' },
        { employeeId: 274, lastName: 'Ito',        firstName: 'Shu',     jobTitle: 'Sales Representative',          hireDate: '2009-01-06' },
        { employeeId: 276, lastName: 'Mitchell',   firstName: 'Linda',   jobTitle: 'Sales Manager',                 hireDate: '2009-01-06' },
        { employeeId: 279, lastName: 'Pak',        firstName: 'Jae',     jobTitle: 'Sales Representative',          hireDate: '2009-01-06' },
        { employeeId: 289, lastName: 'Reiter',     firstName: 'Rachel',  jobTitle: 'Sales Representative',          hireDate: '2009-01-06' },
        { employeeId: 290, lastName: 'Vargas',     firstName: 'Ranjit',  jobTitle: 'Sales Representative',          hireDate: '2009-01-06' },
      ],
      summary: '**290 employees** in the HR CSV (Italian schema). Semantic layer maps: `matricolaDip→employeeId`, `cognome→lastName`, `nome→firstName`, `ruolo→jobTitle`. 14 sales reps linked to ERP via `matricolaDip ↔ salesperson_ref` (100% match).',
      interpreted_as: 'HR.dipendenti_hr · Italian schema · semantic layer field mapping applied',
      sources: [SRC.HR],
      steps: [
        '① HR CSV loaded: 290 rows · schema language: Italian',
        '② Semantic mapping: matricolaDip→employeeId, cognome→lastName, nome→firstName',
        '③ ruolo→jobTitle, dataNascita→birthDate, dataAssunzione→hireDate',
        '④ Bridge available: matricolaDip ↔ salesPersonId (14 sales reps, 100% matched)',
      ],
      followUps: [
        'Who is the top salesperson by revenue in 2014?',
        'Show orders by territory ranked by sales YTD',
        'How many unique customers after CRM deduplication?',
      ],
    }),
  },
  // ── Orders ────────────────────────────────────────────────────────────────────
  {
    test: q => /order|sales order|show.*order|list.*order|recent.*order/i.test(q)
      && !/average.*order|avg.*order|\border.*value\b/i.test(q),
    result: () => ({
      sql: `SELECT orderId,
       orderDate,
       shipDate,
       status,
       subtotalAmount,
       totalDue,
       CASE WHEN onlineOrderFlag THEN 'Online' ELSE 'In-store' END AS channel
FROM   erp.SalesOrder
ORDER  BY orderDate DESC
LIMIT  10`,
      rows: [
        { orderId: 75124, orderDate: '2014-12-28', shipDate: null,         status: 'Confirmed',  subtotalAmount:  53209.80, totalDue:  56994.49, channel: 'In-store' },
        { orderId: 75123, orderDate: '2014-12-28', shipDate: null,         status: 'Confirmed',  subtotalAmount:  87145.20, totalDue:  93345.65, channel: 'In-store' },
        { orderId: 75122, orderDate: '2014-12-01', shipDate: '2014-12-08', status: 'Shipped',    subtotalAmount:   1898.00, totalDue:   2031.62, channel: 'In-store' },
        { orderId: 75121, orderDate: '2014-12-01', shipDate: '2014-12-08', status: 'Shipped',    subtotalAmount:     48.68, totalDue:     52.18, channel: 'Online'   },
        { orderId: 75120, orderDate: '2014-12-01', shipDate: '2014-12-08', status: 'Processing', subtotalAmount:   2049.00, totalDue:   2193.15, channel: 'In-store' },
        { orderId: 75119, orderDate: '2014-11-30', shipDate: '2014-12-07', status: 'Processing', subtotalAmount:   2039.99, totalDue:   2185.98, channel: 'Online'   },
        { orderId: 75118, orderDate: '2014-11-30', shipDate: '2014-12-07', status: 'Processing', subtotalAmount:   1429.00, totalDue:   1532.21, channel: 'Online'   },
        { orderId: 75117, orderDate: '2014-11-30', shipDate: '2014-12-07', status: 'Shipped',    subtotalAmount:      9.99, totalDue:     13.07, channel: 'Online'   },
        { orderId: 75116, orderDate: '2014-11-29', shipDate: '2014-12-06', status: 'Shipped',    subtotalAmount:    732.40, totalDue:    784.77, channel: 'Online'   },
        { orderId: 75115, orderDate: '2014-11-28', shipDate: '2014-12-05', status: 'Shipped',    subtotalAmount:   3578.27, totalDue:   3831.82, channel: 'In-store' },
      ],
      summary: 'Showing **10 most recent orders** from ERP OrionSales (31,465 total). Two large confirmed orders (#75123 $87K, #75124 $53K) from Dec 2014 are pending shipment. Note: `subtotalAmount` ≠ `totalDue` — tax + freight adds ~11%.',
      interpreted_as: 'ERP.SalesOrder · ORDER BY orderDate DESC · LIMIT 10',
      sources: [SRC.ERP],
      steps: [
        '① ERP.SalesOrder loaded: 31,465 rows total',
        '② ORDER BY orderDate DESC · most recent orders first',
        '③ Channel decoded: onlineOrderFlag → \'Online\' / \'In-store\'',
        '④ Note: subtotalAmount (net) vs totalDue (gross) differ by tax + freight',
      ],
      followUps: [
        'Who is the top salesperson by revenue in 2014?',
        'What is our total revenue — subtotal vs total due?',
        'Show orders by territory ranked by sales YTD',
      ],
    }),
  },
  // ── Bridge & Knowledge Graph health ──────────────────────────────────────────
  {
    test: q => /bridge|data.?quality|match.?rate|knowledge.?graph|\bkg\b|cross.source.?health|identity.?resolution/i.test(q),
    result: () => ({
      sql: `-- Cross-source bridge validation report
-- Knowledge Graph: 193,062 nodes · 313,193 edges

SELECT
  bridge_name,
  source_a, field_a,
  source_b, field_b,
  total_a, matched, unmatched,
  ROUND(matched * 100.0 / total_a, 1) AS match_pct
FROM kg.bridge_validation_report
ORDER BY match_pct DESC`,
      rows: [
        { bridge_name: 'SOLD_BY',       source_a: 'ERP SalesPerson', field_a: 'salesPersonId', source_b: 'HR CSV',      field_b: 'matricolaDip', total_a: 14,     matched: 14,    unmatched: 0,  match_pct: '100.0%' },
        { bridge_name: 'OF_PRODUCT',    source_a: 'ERP OrderLine',   field_a: 'productId',     source_b: 'PIM JSON',    field_b: 'internal_id', total_a: 459,    matched: 457,   unmatched: 2,  match_pct: '99.6%'  },
        { bridge_name: 'PLACED_BY',     source_a: 'ERP SalesOrder',  field_a: 'customer_ref',  source_b: 'CRM ClientHub', field_b: 'accountId', total_a: 19829,  matched: 18484, unmatched: 1345, match_pct: '93.2%' },
      ],
      summary: '3 cross-source bridges validated. **SOLD_BY** (ERP × HR): 100% — all 14 sales reps matched. **OF_PRODUCT** (ERP × PIM): 99.6% (457/459 ERP products) — 47 PIM orphans. **PLACED_BY** (ERP × CRM): 93.2% — 1,345 CRM-only prospects. KG: **193,062 nodes · 313,193 edges**.',
      interpreted_as: 'kg.bridge_validation_report · 3 bridges · match rates',
      sources: [SRC.ERP, SRC.CRM, SRC.HR, SRC.PIM, SRC.KG],
      steps: [
        '① Knowledge Graph loaded: 193,062 nodes · 313,193 edges',
        '② Bridge SOLD_BY: salesPersonId ↔ matricolaDip → 14/14 (100%)',
        '③ Bridge OF_PRODUCT: productId ↔ internal_id → 457/459 ERP products (99.6%) · 47 PIM orphans',
        '④ Bridge PLACED_BY: customer_ref ↔ accountId → 18,484/19,829 (93.2%)',
      ],
      followUps: [
        'How many unique customers after CRM deduplication?',
        'Who is the top salesperson by revenue in 2014?',
        'Which products generated the most revenue?',
      ],
    }),
  },

  // ── Product categories ────────────────────────────────────────────────────────
  {
    test: q => /\bcategor|bike|bicycle|mountain.*bike|road.*bike|touring|cloth|accessori/i.test(q),
    result: () => ({
      sql: `-- Revenue and unit distribution by product category (ERP × PIM)
SELECT   p.category,
         COUNT(DISTINCT p.internal_id)  AS products,
         SUM(sol.quantity)              AS units_sold,
         SUM(sol.lineTotal)             AS revenue,
         AVG(p.listPrice)               AS avg_list_price
FROM     pim.product_catalog p
JOIN     erp.SalesOrderLine sol ON sol.productId = p.internal_id
GROUP BY p.category
ORDER BY revenue DESC`,
      rows: [
        { category: 'Bikes',       products: 97,  units_sold: 15_204, revenue: 19_791_723, avg_list_price: 1508.46 },
        { category: 'Components',  products: 189, units_sold:  1_907, revenue:   207_915,  avg_list_price:  218.30 },
        { category: 'Clothing',    products: 35,  units_sold:  2_561, revenue:    75_788,  avg_list_price:   34.82 },
        { category: 'Accessories', products: 36,  units_sold:  2_733, revenue:    51_644,  avg_list_price:   25.23 },
      ],
      summary: '**Bikes dominate**: $19.8M revenue (98.3% of net), 97 SKUs. Components $208K, Clothing $76K, Accessories $52K. Bikes avg list price $1,508 vs Accessories $25. Cross-source: ERP SalesOrderLine × PIM product_catalog.',
      interpreted_as: 'PIM.category GROUP BY category · SUM(lineTotal) · ERP × PIM bridge',
      chartData: {
        type: 'bar',
        title: 'Revenue by product category (ERP × PIM)',
        labels: ['Bikes', 'Components', 'Clothing', 'Accessories'],
        values: [19791723, 207915, 75788, 51644],
        unit: '$',
      },
      sources: [SRC.ERP, SRC.PIM],
      steps: [
        '① PIM product_catalog: 504 products across 4 categories',
        '② Bridge OF_PRODUCT: productId ↔ internal_id (457/459 ERP products — 99.6%)',
        '③ GROUP BY category · SUM(lineTotal) for revenue · AVG(listPrice)',
        '④ Bikes = 97 SKUs but 98% of revenue — high unit price drives result',
      ],
      followUps: [
        'Which products generated the most revenue?',
        'Who is the top salesperson by revenue in 2014?',
        'Show orders by territory ranked by sales YTD',
      ],
    }),
  },
  // ── Online vs in-store channel ────────────────────────────────────────────────
  {
    test: q => /online|in.?store|channel|e.?commerce|web.*order|canale|direct.*sale/i.test(q),
    result: () => ({
      sql: `-- Online vs in-store order split (ERP SalesOrder)
SELECT
  CASE WHEN onlineOrderFlag = 1 THEN 'Online' ELSE 'In-store' END AS channel,
  COUNT(*)                    AS orders,
  SUM(subtotalAmount)         AS net_revenue,
  AVG(subtotalAmount)         AS avg_order_value,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct_orders
FROM erp.SalesOrder
WHERE YEAR(orderDate) = 2014
GROUP BY onlineOrderFlag
ORDER BY orders DESC`,
      rows: [
        { channel: 'Online',   orders: 27_659, net_revenue: '$9,836,152',  avg_order_value: '$355.60', pct_orders: '87.9%' },
        { channel: 'In-store', orders:  3_806, net_revenue: '$10,290,918', avg_order_value: '$2,704.39', pct_orders: '12.1%' },
      ],
      summary: '**87.9% of orders are online** (27,659) but in-store orders have **7.6× higher avg value** ($2,704 vs $356). In-store revenue ($10.3M) narrowly edges online ($9.8M) despite far fewer transactions.',
      interpreted_as: 'ERP.SalesOrder · GROUP BY onlineOrderFlag · 2014',
      chartData: {
        type: 'pie',
        title: 'Net revenue by channel — 2014',
        labels: ['In-store', 'Online'],
        values: [10290918, 9836152],
        unit: '$',
      },
      sources: [SRC.ERP],
      steps: [
        '① ERP.SalesOrder: onlineOrderFlag decoded → Online / In-store',
        '② Filter: YEAR(orderDate) = 2014 · 31,465 orders',
        '③ GROUP BY channel · COUNT · SUM(subtotalAmount) · AVG(subtotalAmount)',
        '④ Insight: online = volume, in-store = value (7.6× higher avg order)',
      ],
      followUps: [
        'Show orders by territory ranked by sales YTD',
        'Who is the top salesperson by revenue in 2014?',
        'What is our total revenue — subtotal vs total due?',
      ],
    }),
  },
  // ── Bonus & commission ────────────────────────────────────────────────────────
  {
    test: q => /bonus|commission|compensat|incentiv|pay.*salesrep|salesrep.*pay|stipendio.*sales/i.test(q),
    result: () => ({
      sql: `-- Salesperson compensation vs YTD performance (ERP × HR)
SELECT e.cognome || ', ' || e.nome AS salesperson,
       sp.salesYTD,
       sp.bonus,
       sp.commissionPct,
       ROUND(sp.bonus + sp.salesYTD * sp.commissionPct / 100, 2) AS est_total_comp,
       ROUND(sp.bonus * 100.0 / sp.salesYTD, 4)                  AS bonus_pct_ytd
FROM   erp.SalesPerson sp
JOIN   hr.dipendenti_hr e ON sp.salesPersonId = e.matricolaDip
ORDER  BY sp.bonus DESC`,
      rows: [
        { salesperson: 'Pak, Jae',          salesYTD: 2315185.61, bonus: 6700, commissionPct: '1.0%', est_total_comp: 29851.86, bonus_pct_ytd: '0.29%' },
        { salesperson: 'Reiter, Rachel',    salesYTD: 4116871.23, bonus: 5150, commissionPct: '2.0%', est_total_comp: 87487.42, bonus_pct_ytd: '0.13%' },
        { salesperson: 'Campbell, David',   salesYTD: 2604540.72, bonus: 5000, commissionPct: '1.5%', est_total_comp: 44068.11, bonus_pct_ytd: '0.19%' },
        { salesperson: 'Saraiva, José',     salesYTD: 3763178.18, bonus: 4100, commissionPct: '1.2%', est_total_comp: 49258.14, bonus_pct_ytd: '0.11%' },
        { salesperson: 'Valdez, Sonia',     salesYTD: 2458535.62, bonus: 3550, commissionPct: '1.0%', est_total_comp: 28135.36, bonus_pct_ytd: '0.14%' },
        { salesperson: 'Tsoflias, Lynn',    salesYTD: 3189418.37, bonus: 2500, commissionPct: '1.5%', est_total_comp: 50341.28, bonus_pct_ytd: '0.08%' },
        { salesperson: 'Mitchell, Linda',   salesYTD: 4251368.55, bonus: 2000, commissionPct: '1.5%', est_total_comp: 65770.53, bonus_pct_ytd: '0.05%' },
        { salesperson: 'Vargas, Ranjit',    salesYTD: 3121616.32, bonus:  985, commissionPct: '1.6%', est_total_comp: 50930.86, bonus_pct_ytd: '0.03%' },
      ],
      summary: '**Jae Pak** has the highest bonus ($6,700) but ranks 8th by salesYTD. **Rachel Reiter** has the highest estimated total comp ($87K: 2% commission + bonus). **Linda Mitchell** #1 by revenue but modest bonus ($2,000). Cross-source: ERP × HR bridge.',
      interpreted_as: 'ERP.SalesPerson JOIN HR.dipendenti_hr · ORDER BY bonus DESC',
      sources: [SRC.ERP, SRC.HR],
      steps: [
        '① Bridge SOLD_BY: salesPersonId ↔ matricolaDip (14/14 — 100%)',
        '② ERP: salesYTD, bonus, commissionPct per sales rep',
        '③ Calculated: est_total_comp = bonus + salesYTD × commissionPct',
        '④ Insight: highest bonus ≠ highest revenue (Pak vs Mitchell)',
      ],
      followUps: [
        'Who is the top salesperson by revenue in 2014?',
        'Show orders by territory ranked by sales YTD',
        'What is our total revenue — subtotal vs total due?',
      ],
    }),
  },
  // ── Average order value ───────────────────────────────────────────────────────
  {
    test: q => /average.*order|avg.*order|order.*value|mean.*order|valore.*medio|ordine.*medio/i.test(q),
    result: () => ({
      sql: `-- Average order value by channel and quarter (ERP SalesOrder)
SELECT
  CASE WHEN onlineOrderFlag = 1 THEN 'Online' ELSE 'In-store' END AS channel,
  CONCAT('Q', DATEPART(quarter, orderDate)) AS quarter,
  COUNT(*)               AS orders,
  AVG(subtotalAmount)    AS avg_net,
  AVG(totalDue)          AS avg_gross,
  MIN(subtotalAmount)    AS min_order,
  MAX(subtotalAmount)    AS max_order
FROM erp.SalesOrder
WHERE YEAR(orderDate) = 2014
GROUP BY onlineOrderFlag, DATEPART(quarter, orderDate)
ORDER BY channel, quarter`,
      rows: [
        { channel: 'In-store', quarter: 'Q1', orders: 901,  avg_net: 2628.16, avg_gross: 2926.18, min_order: 2.29,    max_order: 187487.83 },
        { channel: 'In-store', quarter: 'Q2', orders: 1102, avg_net: 2851.90, avg_gross: 3175.26, min_order: 5.70,    max_order: 217628.97 },
        { channel: 'In-store', quarter: 'Q3', orders: 1187, avg_net: 2791.44, avg_gross: 3107.91, min_order: 3.99,    max_order: 189519.73 },
        { channel: 'In-store', quarter: 'Q4', orders:  616, avg_net: 2380.09, avg_gross: 2649.99, min_order: 0.99,    max_order: 112103.14 },
        { channel: 'Online',   quarter: 'Q1', orders: 6411, avg_net:  273.52, avg_gross: 304.54,  min_order: 2.29,    max_order:   9887.43 },
        { channel: 'Online',   quarter: 'Q2', orders: 7102, avg_net:  287.26, avg_gross: 319.85,  min_order: 2.29,    max_order:  12049.37 },
        { channel: 'Online',   quarter: 'Q3', orders: 7660, avg_net:  330.81, avg_gross: 368.25,  min_order: 2.29,    max_order:  11988.73 },
        { channel: 'Online',   quarter: 'Q4', orders: 6486, avg_net:  540.94, avg_gross: 602.24,  min_order: 1.99,    max_order:   9437.82 },
      ],
      summary: 'Global avg order net: **$639.65**. In-store avg **$2,704** (7.6× higher than online $356). Q2 peak for in-store avg ($2,852). **Q4 highest online avg ($541)** as in-store drops to 616 orders. Largest single order: $217K in-store Q2 2014.',
      interpreted_as: 'ERP.SalesOrder · AVG(subtotalAmount) GROUP BY channel, quarter · 2014',
      sources: [SRC.ERP],
      steps: [
        '① ERP.SalesOrder: 31,465 orders in 2014',
        '② Split by channel (onlineOrderFlag) and quarter',
        '③ AVG, MIN, MAX of subtotalAmount and totalDue per group',
        '④ Global avg: $20,127,070 ÷ 31,465 orders = $639.65',
      ],
      followUps: [
        'Show orders by territory ranked by sales YTD',
        'What is our total revenue — subtotal vs total due?',
        'Who is the top salesperson by revenue in 2014?',
      ],
    }),
  },
  // ── Monthly distribution ──────────────────────────────────────────────────────
  {
    test: q => /\bmonth|mensil|monthly|per month|month.{0,10}distribut|distribut.{0,10}month|month.{0,10}sale|sale.{0,10}month/i.test(q),
    result: () => ({
      sql: `-- Monthly net revenue breakdown 2014
SELECT
  MONTH(orderDate)            AS month_num,
  DATENAME(month, orderDate)  AS month_name,
  COUNT(*)                    AS orders,
  SUM(subtotalAmount)         AS net_revenue,
  AVG(subtotalAmount)         AS avg_order_net
FROM erp.SalesOrder
WHERE YEAR(orderDate) = 2014
GROUP BY MONTH(orderDate), DATENAME(month, orderDate)
ORDER BY month_num`,
      rows: [
        { month: 'Jan', month_num: 1,  orders: 2253, net_revenue: 1_247_000, avg_order_net: 553.48 },
        { month: 'Feb', month_num: 2,  orders: 2412, net_revenue: 1_397_000, avg_order_net: 579.10 },
        { month: 'Mar', month_num: 3,  orders: 2647, net_revenue: 1_477_485, avg_order_net: 558.19 },
        { month: 'Apr', month_num: 4,  orders: 2658, net_revenue: 1_617_000, avg_order_net: 608.35 },
        { month: 'May', month_num: 5,  orders: 2789, net_revenue: 1_726_000, avg_order_net: 618.93 },
        { month: 'Jun', month_num: 6,  orders: 2757, net_revenue: 1_839_930, avg_order_net: 667.44 },
        { month: 'Jul', month_num: 7,  orders: 2894, net_revenue: 1_891_000, avg_order_net: 653.21 },
        { month: 'Aug', month_num: 8,  orders: 3041, net_revenue: 2_007_621, avg_order_net: 660.18 },
        { month: 'Sep', month_num: 9,  orders: 2912, net_revenue: 1_949_000, avg_order_net: 669.33 },
        { month: 'Oct', month_num: 10, orders: 2421, net_revenue: 1_621_000, avg_order_net: 669.56 },
        { month: 'Nov', month_num: 11, orders: 2318, net_revenue: 1_646_034, avg_order_net: 710.11 },
        { month: 'Dec', month_num: 12, orders: 2363, net_revenue: 1_708_000, avg_order_net: 722.81 },
      ],
      summary: '**August is the peak month** ($2.01M, 3,041 orders). January is the slowest ($1.25M). Sales build steadily from Jan through Aug, then plateau in Q4. Full-year net: **$20,127,070** across 31,465 orders.',
      interpreted_as: 'ERP.SalesOrder GROUP BY MONTH(orderDate) · net_revenue, orders · 2014',
      chartData: {
        type: 'bar',
        title: 'Monthly net revenue — 2014',
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        values: [1_247_000, 1_397_000, 1_477_485, 1_617_000, 1_726_000, 1_839_930, 1_891_000, 2_007_621, 1_949_000, 1_621_000, 1_646_034, 1_708_000],
        unit: '$',
      },
      sources: [SRC.ERP],
      steps: [
        '① ERP.SalesOrder: 31,465 orders in YEAR 2014',
        '② GROUP BY MONTH(orderDate) · 12 groups',
        '③ SUM(subtotalAmount) per month · total $20,127,070',
        '④ Peak: Aug $2.01M | Trough: Jan $1.25M | Range $760K',
      ],
      followUps: [
        'Show quarterly revenue breakdown for 2014',
        'How does online vs in-store split by month?',
        'Which month had the highest average order value?',
      ],
    }),
  },
  // ── Quarterly analysis ────────────────────────────────────────────────────────
  {
    test: q => /\bquart|\bQ1\b|\bQ2\b|\bQ3\b|\bQ4\b|quarterly|trimest/i.test(q),
    result: () => ({
      sql: `-- Full quarterly breakdown 2014 — revenue, orders, avg, channel split
SELECT
  CONCAT('Q', DATEPART(quarter, orderDate), ' 2014') AS quarter,
  COUNT(*)                         AS orders,
  SUM(subtotalAmount)              AS net_revenue,
  SUM(totalDue)                    AS gross_revenue,
  AVG(subtotalAmount)              AS avg_order_net,
  SUM(CASE WHEN onlineOrderFlag=1 THEN 1 ELSE 0 END) AS online_orders,
  SUM(CASE WHEN onlineOrderFlag=0 THEN 1 ELSE 0 END) AS store_orders
FROM erp.SalesOrder
WHERE YEAR(orderDate) = 2014
GROUP BY DATEPART(quarter, orderDate)
ORDER BY quarter`,
      rows: [
        { quarter: 'Q1 2014', orders: 7312,  net_revenue: 4121485,  gross_revenue: 4588234,  avg_order_net: 563.63, online_orders: 6411, store_orders: 901 },
        { quarter: 'Q2 2014', orders: 8204,  net_revenue: 5182930,  gross_revenue: 5768412,  avg_order_net: 631.76, online_orders: 7102, store_orders: 1102 },
        { quarter: 'Q3 2014', orders: 8847,  net_revenue: 5847621,  gross_revenue: 6504891,  avg_order_net: 661.07, online_orders: 7660, store_orders: 1187 },
        { quarter: 'Q4 2014', orders: 7102,  net_revenue: 4975034,  gross_revenue: 5549031,  avg_order_net: 700.51, online_orders: 6486, store_orders: 616 },
      ],
      summary: '**Q3 2014 is the peak quarter** ($5.85M net, 8,847 orders). Q4 has the highest avg order ($700) despite fewer orders. Full year: $20.1M net / $22.4M gross. Q4 store_orders drop sharply (616 vs 1,187 in Q3).',
      interpreted_as: 'ERP.SalesOrder GROUP BY quarter · net + gross + channel split · 2014',
      chartData: {
        type: 'line',
        title: 'Net revenue by quarter — 2014',
        labels: ['Q1 2014', 'Q2 2014', 'Q3 2014', 'Q4 2014'],
        values: [4121485, 5182930, 5847621, 4975034],
        unit: '$',
      },
      sources: [SRC.ERP],
      steps: [
        '① ERP.SalesOrder: 31,465 orders filtered to YEAR 2014',
        '② GROUP BY DATEPART(quarter) · 4 groups',
        '③ SUM net + gross · AVG net · channel split by onlineOrderFlag',
        '④ Q3 peak: highest orders (8,847) and highest net ($5.85M)',
      ],
      followUps: [
        'What is our total revenue — subtotal vs total due?',
        'Show online vs in-store channel breakdown',
        'Who is the top salesperson by revenue in 2014?',
      ],
    }),
  },
  // ── Year-over-year comparison ─────────────────────────────────────────────────
  {
    test: q => /2011|year.{0,10}year|year.{0,10}compar|yoy|annual.{0,10}compar|confronto.*anno|vs.*2014/i.test(q),
    result: () => ({
      sql: `-- Year-over-year comparison: 2011 vs 2014 (ERP SalesOrder)
SELECT
  YEAR(orderDate)           AS year,
  COUNT(*)                  AS orders,
  SUM(subtotalAmount)       AS net_revenue,
  AVG(subtotalAmount)       AS avg_order,
  COUNT(DISTINCT customer_ref) AS unique_customers
FROM erp.SalesOrder
WHERE YEAR(orderDate) IN (2011, 2014)
GROUP BY YEAR(orderDate)
ORDER BY year`,
      rows: [
        { year: 2011, orders: 1607,  net_revenue: 12646110,  avg_order:  7868.49, unique_customers: 1401 },
        { year: 2014, orders: 31465, net_revenue: 20127070,  avg_order:   639.65, unique_customers: 19829 },
        { year: 'Δ (2011→2014)', orders: '+29858 (+1858%)', net_revenue: '+$7,480,960 (+59%)', avg_order: '-$7,229 (-92%)', unique_customers: '+18,428 (+1315%)' },
      ],
      summary: '**Orders grew 1,858%** from 2011→2014 (1,607→31,465) but **avg order dropped 92%** ($7,868→$640) as online channel expanded. Net revenue grew +59% ($12.6M→$20.1M). Customer base grew 13×.',
      interpreted_as: 'ERP.SalesOrder · GROUP BY YEAR · 2011 vs 2014 comparison',
      chartData: {
        type: 'bar',
        title: 'Net revenue 2011 vs 2014',
        labels: ['2011', '2014'],
        values: [12646110, 20127070],
        unit: '$',
      },
      sources: [SRC.ERP],
      steps: [
        '① ERP.SalesOrder filtered to YEAR IN (2011, 2014)',
        '② 2011: 1,607 orders — mostly large in-store orders (avg $7,868)',
        '③ 2014: 31,465 orders — online expansion drove volume, avg order fell to $640',
        '④ Net revenue +59% · orders +1,858% · avg order -92% → channel mix shift',
      ],
      followUps: [
        'Show online vs in-store channel breakdown',
        'What is our total revenue — subtotal vs total due?',
        'Who is the top salesperson by revenue in 2014?',
      ],
    }),
  },
  // ── Tax & freight analysis ────────────────────────────────────────────────────
  {
    test: q => /tax|freight|spese.*spediz|spedizione|shipping.?cost|tasse|impost/i.test(q),
    result: () => ({
      sql: `-- Tax and freight breakdown by territory (ERP SalesOrder)
SELECT t.name           AS territory,
       COUNT(o.orderId) AS orders,
       SUM(o.taxAmt)    AS total_tax,
       SUM(o.freight)   AS total_freight,
       SUM(o.taxAmt + o.freight) AS total_overhead,
       ROUND(SUM(o.taxAmt + o.freight) * 100.0 / SUM(o.totalDue), 1) AS overhead_pct
FROM   erp.SalesOrder o
JOIN   erp.SalesTerritory t ON o.territoryId = t.territoryId
WHERE  YEAR(o.orderDate) = 2014
GROUP  BY t.territoryId
ORDER  BY total_overhead DESC`,
      rows: [
        { territory: 'Southwest',      orders: 8512, total_tax: 800_000, total_freight: 164_000, total_overhead: 964_000, overhead_pct: '10.8%' },
        { territory: 'Northwest',      orders: 6438, total_tax: 600_000, total_freight: 120_000, total_overhead: 720_000, overhead_pct: '10.8%' },
        { territory: 'Canada',         orders: 4821, total_tax: 0,       total_freight: 127843, total_overhead: 127843, overhead_pct: '1.9%' },
        { territory: 'Australia',      orders: 3944, total_tax: 0,       total_freight: 104634, total_overhead: 104634, overhead_pct: '1.7%' },
        { territory: 'United Kingdom', orders: 3201, total_tax: 0,       total_freight: 84981,  total_overhead: 84981,  overhead_pct: '1.7%' },
      ],
      summary: 'Total 2014 overhead: **$2,283,498** (tax $1,717,041 + freight $566,457). US territories pay ~10.8% overhead; international territories pay freight only (no US sales tax). Tax + freight = **11.3% of net revenue**.',
      interpreted_as: 'ERP.SalesOrder · SUM(taxAmt + freight) GROUP BY territory · 2014',
      sources: [SRC.ERP],
      steps: [
        '① ERP.SalesOrder: taxAmt and freight are separate columns',
        '② JOIN SalesTerritory for geographic grouping',
        '③ US territories (Southwest, Northwest): tax ~10.8% overhead',
        '④ International: freight only · no US sales tax applies',
      ],
      followUps: [
        'What is our total revenue — subtotal vs total due?',
        'Show orders by territory ranked by sales YTD',
        'Show quarterly revenue breakdown',
      ],
    }),
  },
  // ── Special offers / discounts ────────────────────────────────────────────────
  {
    test: q => /discount|special.?offer|offer|promotion|promo|sconto|offerta/i.test(q),
    result: () => ({
      sql: `-- Special offer usage and discount impact (ERP SalesOrderLine × SpecialOffer)
SELECT   so.description                      AS offer,
         so.category,
         so.discountPct,
         COUNT(sol.orderId)                  AS lines_applied,
         SUM(sol.lineTotal)                  AS net_revenue,
         SUM(sol.quantity * sol.unitPriceDiscount) AS discount_given
FROM     erp.SalesOrderLine sol
JOIN     erp.SpecialOffer   so  ON so.offerId = sol.offerId
WHERE    sol.unitPriceDiscount > 0
GROUP BY so.description, so.category, so.discountPct
ORDER BY discount_given DESC
LIMIT 8`,
      rows: [
        { offer: 'Mountain-100 Clearance',    category: 'Clearance',  discountPct: '0.35', lines_applied:   318, net_revenue:   184_621, discount_given: 99_411 },
        { offer: 'Volume Discount 61 to 100', category: 'Reseller',   discountPct: '0.05', lines_applied: 1_843, net_revenue: 1_214_509, discount_given: 63_921 },
        { offer: 'Road-650 Overstock',        category: 'Clearance',  discountPct: '0.30', lines_applied:   241, net_revenue:   117_882, discount_given: 50_521 },
        { offer: 'Touring-3000 Promotion',    category: 'Seasonal',   discountPct: '0.10', lines_applied:   892, net_revenue:   413_221, discount_given: 45_913 },
        { offer: 'Volume Discount 41 to 60',  category: 'Reseller',   discountPct: '0.02', lines_applied: 4_221, net_revenue: 1_847_312, discount_given: 37_702 },
      ],
      summary: '**5 active offer types** applied to 7,515 order lines. Mountain-100 Clearance deepest discount (35%) — $99K given away but cleared aged inventory. Volume discounts (Reseller tier) account for most lines. Total discount given: **$297,468** (~1.5% of net revenue).',
      interpreted_as: 'ERP.SalesOrderLine × SpecialOffer · unitPriceDiscount > 0 · GROUP BY offer',
      chartData: {
        type: 'bar',
        title: 'Discount given by special offer',
        labels: ['Mountain-100', 'Volume 61-100', 'Road-650', 'Touring-3000', 'Volume 41-60'],
        values: [99411, 63921, 50521, 45913, 37702],
        unit: '$',
      },
      sources: [SRC.ERP],
      steps: [
        '① ERP.SalesOrderLine: offerId FK links to SpecialOffer (16 offers defined)',
        '② Filter unitPriceDiscount > 0 — only lines where discount was applied',
        '③ SUM(quantity × unitPriceDiscount) = total dollar discount given per offer',
        '④ Mountain-100 Clearance: 35% discount, highest per-line impact',
      ],
      followUps: [
        'What is our total revenue — subtotal vs total due?',
        'Which products generated the most revenue?',
        'Show orders by territory ranked by sales YTD',
      ],
    }),
  },
  // ── Customer geographic breakdown (by country) ────────────────────────────────
  {
    test: q => /customer.*country|country.*customer|geographic.*customer|customer.*geograph|where.*customer|clienti.*paese|paese.*clienti|customer.*region/i.test(q),
    result: () => ({
      sql: `SELECT   c.country,
         COUNT(*)                     AS customers,
         SUM(o.subtotalAmount)        AS total_revenue,
         AVG(o.subtotalAmount)        AS avg_order,
         ROUND(COUNT(*) * 100.0 / 19829, 1) AS pct_of_base
FROM     crm.accounts c
JOIN     erp.SalesOrder o ON o.customer_ref = c.accountId
GROUP BY c.country
ORDER BY total_revenue DESC
LIMIT 8`,
      rows: [
        { country: 'United States',  customers: 9_841, total_revenue: 8_312_000, avg_order: 845,   pct_of_base: '49.6%' },
        { country: 'Australia',      customers: 3_591, total_revenue: 3_841_000, avg_order: 1_070, pct_of_base: '18.1%' },
        { country: 'Canada',         customers: 1_571, total_revenue: 2_654_000, avg_order: 1_689, pct_of_base: '7.9%'  },
        { country: 'United Kingdom', customers: 1_913, total_revenue: 2_276_000, avg_order: 1_190, pct_of_base: '9.7%'  },
        { country: 'Germany',        customers: 1_241, total_revenue: 1_722_000, avg_order: 1_388, pct_of_base: '6.3%'  },
        { country: 'France',         customers: 1_128, total_revenue: 1_322_070, avg_order: 1_172, pct_of_base: '5.7%'  },
      ],
      summary: '**US dominates** with 49.6% of customers (9,841) and 41.3% of matched revenue ($8.3M). Australian customers have higher avg per customer ($1,070 vs US $845). Bridge PLACED_BY (93.2%) used to join CRM × ERP — 1,345 CRM-only prospects excluded.',
      interpreted_as: 'CRM.accounts × ERP.SalesOrder via PLACED_BY · GROUP BY country',
      chartData: {
        type: 'bar',
        title: 'Revenue by customer country (CRM × ERP)',
        labels: ['United States', 'Australia', 'Canada', 'United Kingdom', 'Germany', 'France'],
        values: [8312000, 3841000, 2654000, 2276000, 1722000, 1322070],
        unit: '$',
      },
      sources: [SRC.ERP, SRC.CRM],
      steps: [
        '① CRM.accounts: 19,829 deduped (excluded 372 with accountId<0)',
        '② Bridge PLACED_BY: customer_ref ↔ accountId — 93.2% match rate',
        '③ JOIN ERP.SalesOrder ON customer_ref = accountId',
        '④ GROUP BY country · SUM(subtotalAmount) · AVG(subtotalAmount)',
      ],
      followUps: [
        'How many unique customers after CRM deduplication?',
        'Show orders by territory ranked by sales YTD',
        'What is the online vs in-store channel split?',
      ],
    }),
  },
  // ── Gross margin / profitability by category ──────────────────────────────────
  {
    test: q => /margin|profit|cost.*product|product.*cost|markup|gross.?profit|redditività|margine/i.test(q),
    result: () => ({
      sql: `SELECT   p.category,
         SUM(sol.lineTotal)                            AS revenue,
         SUM(sol.quantity * p.standardCost)            AS cogs,
         SUM(sol.lineTotal - sol.quantity*p.standardCost) AS gross_profit,
         ROUND((SUM(sol.lineTotal - sol.quantity*p.standardCost)
                / SUM(sol.lineTotal)) * 100, 1)        AS margin_pct
FROM     pim.product_catalog  p
JOIN     erp.SalesOrderLine   sol ON sol.productId = p.internal_id
GROUP BY p.category
ORDER BY margin_pct DESC`,
      rows: [
        { category: 'Clothing',    revenue:  75_788,    cogs:  26_299,    gross_profit:  49_489,   margin_pct: '65.3%' },
        { category: 'Accessories', revenue:  51_644,    cogs:  18_333,    gross_profit:  33_311,   margin_pct: '64.5%' },
        { category: 'Bikes',       revenue: 19_791_723, cogs: 10_284_696, gross_profit: 9_507_027, margin_pct: '48.0%' },
        { category: 'Components',  revenue: 207_915,    cogs: 116_433,    gross_profit:  91_482,   margin_pct: '44.0%' },
      ],
      summary: '**Clothing and Accessories are highest margin** (65.3% and 64.5%) but low volume. Bikes drive $9.5M gross profit at 48% margin — dominant category at 98.3% of revenue. Total gross profit: **$9,681,309** (48.1% blended margin). Cross-source: ERP SalesOrderLine × PIM standardCost.',
      interpreted_as: 'PIM.standardCost × ERP.lineTotal · gross margin = (revenue − COGS) / revenue',
      chartData: {
        type: 'bar',
        title: 'Gross margin % by category',
        labels: ['Clothing', 'Accessories', 'Bikes', 'Components'],
        values: [65.3, 64.5, 48.0, 44.0],
        unit: '%',
      },
      sources: [SRC.ERP, SRC.PIM],
      steps: [
        '① PIM.product_catalog: standardCost = unit cost of goods',
        '② Bridge OF_PRODUCT: productId ↔ internal_id (99.6%)',
        '③ COGS = quantity × standardCost per line',
        '④ Gross profit = lineTotal − COGS · Margin % = GP / revenue',
      ],
      followUps: [
        'Which products generated the most revenue?',
        'What is our revenue by product category?',
        'Show orders by territory ranked by sales YTD',
      ],
    }),
  },
  // ── HR department headcount and salary ───────────────────────────────────────
  {
    test: q => /department|reparto|org.?chart|headcount.*dept|department.*headcount|salary|stipendio|payroll|\bwage/i.test(q),
    result: () => ({
      sql: `SELECT   d.repartoNome                AS department,
         COUNT(*)                     AS headcount,
         AVG(d.stipendio)             AS avg_salary,
         MIN(d.stipendio)             AS min_salary,
         MAX(d.stipendio)             AS max_salary,
         SUM(d.stipendio)             AS total_payroll
FROM     hr.dipendenti_hr d
GROUP BY d.repartoNome
ORDER BY headcount DESC`,
      rows: [
        { department: 'Production',      headcount: 211, avg_salary: 28_241,  min_salary: 18_000, max_salary: 84_000,  total_payroll: 5_958_851 },
        { department: 'Sales',           headcount: 18,  avg_salary: 52_180,  min_salary: 35_000, max_salary: 91_000,  total_payroll: 939_240   },
        { department: 'Engineering',     headcount: 31,  avg_salary: 71_432,  min_salary: 48_000, max_salary: 135_000, total_payroll: 2_214_392 },
        { department: 'Finance',         headcount: 12,  avg_salary: 65_812,  min_salary: 42_000, max_salary: 112_000, total_payroll: 789_744   },
        { department: 'Human Resources', headcount: 6,   avg_salary: 58_921,  min_salary: 41_000, max_salary: 78_000,  total_payroll: 353_526   },
        { department: 'IT',              headcount: 8,   avg_salary: 69_441,  min_salary: 52_000, max_salary: 98_000,  total_payroll: 555_528   },
        { department: 'Executive',       headcount: 4,   avg_salary: 124_500, min_salary: 98_000, max_salary: 165_000, total_payroll: 498_000   },
      ],
      summary: '**290 employees** across 7 departments. Production is largest (211 FTE, avg $28K). Engineering highest avg salary ($71K, 31 FTE). Total payroll: **$11,309,281/year**. Executive team (4): avg $124,500. Cross-reference: Sales dept ↔ ERP SalesPerson via SOLD_BY bridge (100% match).',
      interpreted_as: 'HR.dipendenti_hr · GROUP BY repartoNome · payroll analysis',
      chartData: {
        type: 'bar',
        title: 'Headcount by department (HR CSV)',
        labels: ['Production', 'Sales', 'Engineering', 'Finance', 'IT', 'HR', 'Executive'],
        values: [211, 18, 31, 12, 8, 6, 4],
        unit: '',
      },
      sources: [SRC.HR],
      steps: [
        '① HR CSV (Italian schema): 290 rows, columns cognome/nome/ruolo/stipendio/repartoId',
        '② repartoNome resolved via repartoId FK',
        '③ GROUP BY department · COUNT · AVG/MIN/MAX salary',
        '④ Sales dept bridges to ERP SalesPerson via SOLD_BY (100%)',
      ],
      followUps: [
        'Show salary and bonus for the sales team',
        'Who is the top salesperson by revenue in 2014?',
        'What is the online vs in-store channel split?',
      ],
    }),
  },
  // ── Revenue disambiguation (last — fires only when no specific pattern matches) ─
  {
    test: q => /\brevenue\b|fatturato|how much.*sold|total.*sales|sales.*total/i.test(q),
    result: () => ({
      sql: `-- "fatturato" disambiguation: two valid interpretations
-- Use subtotal_amount for NET commercial revenue (excl. tax + freight)
-- Use total_due for GROSS amount billed to customer

SELECT
  SUM(subtotalAmount) AS net_revenue,    -- $20,127,070 — commercial "fatturato"
  SUM(totalDue)       AS gross_revenue,  -- $22,410,568 — incl. tax + freight
  COUNT(*)            AS order_count,
  AVG(subtotalAmount) AS avg_order_net
FROM erp.SalesOrder
WHERE YEAR(orderDate) = 2014`,
      rows: [
        { metric: 'Net revenue (subtotal)', value: '$20,127,070', note: 'Excl. tax + freight — use for "commercial revenue"' },
        { metric: 'Gross revenue (total_due)', value: '$22,410,568', note: 'Incl. tax + freight — use for "billed amount"' },
        { metric: 'Order count (2014)', value: '31,465', note: 'ERP OrionSales · all statuses' },
        { metric: 'Avg order net', value: '$639.65', note: 'Per order, net of discounts' },
        { metric: 'Tax + freight delta', value: '+$2,283,498', note: '11.3% of net revenue' },
      ],
      summary: '⚠️ **"Revenue" is ambiguous in AdventureWorks.** `subtotal_amount` = **$20.1M** (net, excl. tax+freight) vs `total_due` = **$22.4M** (gross, billed). The semantic layer flags this as a disambiguation point — choose which definition applies below.',
      interpreted_as: 'SUM(subtotalAmount) ≠ SUM(totalDue) · SalesOrder 2014 · user resolution required',
      isDisambiguation: true,
      sources: [SRC.ERP],
      steps: [
        '① Term "revenue" / "fatturato" matched → ambiguity detected',
        '② Definition A: subtotal_amount = $20,127,070 (commercial net, excl. tax + freight)',
        '③ Definition B: total_due = $22,410,568 (billed gross, incl. tax + freight)',
        '④ Semantic layer paused — awaiting user disambiguation choice',
      ],
      followUps: [
        'Who is the top salesperson by revenue in 2014?',
        'Show orders by territory ranked by sales YTD',
        'How many unique customers after CRM deduplication?',
      ],
    }),
  },
]

function tryAWQuery(question: string): EngineResult | null {
  for (const pattern of AW_PATTERNS) {
    if (pattern.test(question)) return pattern.result()
  }
  return null
}

// ── Retail canned responses ───────────────────────────────────────────────────

const RETAIL_PATTERNS: Array<{
  test: (q: string) => boolean
  result: () => EngineResult
}> = [
  // ── Top products by revenue ───────────────────────────────────────────────
  {
    test: q => /top.*product|product.*revenue|best.*sell|best.*product|prodotto.*venduto|più.*venduto|prodotti.*top/i.test(q),
    result: () => ({
      sql: `SELECT p.name, p.sku, p.price, SUM(oi.quantity) AS units, SUM(oi.quantity*oi.unit_price) AS revenue FROM products p JOIN order_items oi ON oi.product_id = p.id GROUP BY p.id ORDER BY revenue DESC LIMIT 8`,
      rows: [
        { name: 'Wireless Headphones Pro', sku: 'TECH-001',  price: 149.99, units: 312,  revenue: 46797 },
        { name: 'Running Shoes Elite',     sku: 'SPORT-021', price: 89.99,  units: 481,  revenue: 43275 },
        { name: 'Smart Watch Series 5',    sku: 'TECH-008',  price: 199.99, units: 204,  revenue: 40798 },
        { name: 'Yoga Mat Premium',        sku: 'SPORT-004', price: 34.99,  units: 892,  revenue: 31211 },
        { name: 'Coffee Maker Deluxe',     sku: 'HOME-014',  price: 79.99,  units: 341,  revenue: 27277 },
        { name: 'Laptop Sleeve 15"',       sku: 'TECH-022',  price: 24.99,  units: 1043, revenue: 26064 },
        { name: 'Resistance Band Set',     sku: 'SPORT-009', price: 19.99,  units: 1211, revenue: 24208 },
        { name: 'Electric Kettle',         sku: 'HOME-003',  price: 44.99,  units: 512,  revenue: 23035 },
      ],
      summary: '**Wireless Headphones Pro** leads with $46.8K revenue (312 units at $150). Electronics dominate top 3. Yoga Mat and Resistance Bands show strong unit velocity (892 and 1,211 sold). Total top-8 revenue: **$263K** of $740 paid orders.',
      interpreted_as: 'products JOIN order_items · SUM(quantity×unit_price) · ORDER BY revenue DESC',
      chartData: {
        type: 'bar',
        title: 'Revenue by top product',
        labels: ['Headphones Pro', 'Running Shoes', 'Smart Watch', 'Yoga Mat', 'Coffee Maker', 'Laptop Sleeve', 'Resist. Bands', 'Elec. Kettle'],
        values: [46797, 43275, 40798, 31211, 27277, 26064, 24208, 23035],
        unit: '$',
      },
      sources: [
        { id: 'pos',     label: 'POS Database',   bg: 'bg-blue-100', text: 'text-blue-700' },
        { id: 'catalog', label: 'Product Catalog', bg: 'bg-teal-100', text: 'text-teal-700' },
      ],
      steps: [
        '① products: 2,840 active SKUs across 84 categories',
        '② JOIN order_items on product_id (740 paid orders)',
        '③ SUM(quantity × unit_price) = revenue per product',
        '④ ORDER BY revenue DESC LIMIT 8',
      ],
      followUps: ['Which promotions are active?', 'Show gold loyalty customers', 'What is the total amount of paid orders?'],
    }),
  },
  // ── Promotions / active offers ────────────────────────────────────────────
  {
    test: q => /promot|discount.*code|coupon|promo.*code|offerta|sconto.*codice|active.*offer|offer.*active/i.test(q),
    result: () => ({
      sql: `SELECT code, discountPct, validFrom, validTo, active, (SELECT COUNT(*) FROM orders WHERE promo_code = p.code) AS uses FROM promotions p WHERE active = TRUE ORDER BY discountPct DESC`,
      rows: [
        { code: 'SUMMER30', discountPct: 0.30, validFrom: '2024-06-01', validTo: '2024-08-31', active: true, uses: 94  },
        { code: 'LOYAL20',  discountPct: 0.20, validFrom: '2024-01-01', validTo: '2024-12-31', active: true, uses: 187 },
        { code: 'SPORT15',  discountPct: 0.15, validFrom: '2024-07-01', validTo: '2024-09-30', active: true, uses: 63  },
        { code: 'TECH10',   discountPct: 0.10, validFrom: '2024-05-01', validTo: '2024-10-31', active: true, uses: 241 },
        { code: 'NEWCUST',  discountPct: 0.05, validFrom: '2024-01-01', validTo: '2024-12-31', active: true, uses: 312 },
      ],
      summary: '**5 active promotions** out of 32 total. LOYAL20 (20% off) has highest adoption (187 uses). TECH10 (10%) most used (241 uses) — broad category scope. SUMMER30 (30%) most aggressive discount, 94 orders. Total promo-driven orders: **897** (121% of baseline).',
      interpreted_as: 'promotions WHERE active=TRUE · ORDER BY discountPct DESC',
      sources: [
        { id: 'pos', label: 'POS Database', bg: 'bg-blue-100', text: 'text-blue-700' },
      ],
      steps: [
        '① promotions table: 32 total, 5 currently active',
        '② Filter active=TRUE · ORDER BY discountPct DESC',
        '③ Correlated subquery: count orders per promo code',
        '④ LOYAL20 valid full-year — loyalty program staple',
      ],
      followUps: ['Show gold loyalty customers', 'Show the top 10 products by stock level', 'What is the total amount of paid orders?'],
    }),
  },
  // ── Total revenue / orders paid ───────────────────────────────────────────
  {
    test: q => /total.*order|order.*total|paid.*order|revenue.*order|order.*revenue|order.*amount|amount.*order|fatturato.*ordine|ordine.*pagat/i.test(q),
    result: () => ({
      sql: `SELECT DATE_TRUNC('month', paidAt) AS month, COUNT(*) AS orders, SUM(total) AS revenue, AVG(total) AS avg_order FROM orders WHERE status = 'paid' GROUP BY 1 ORDER BY 1`,
      rows: [
        { month: '2024-04', orders: 112, revenue: 20944, avg_order: 186.8 },
        { month: '2024-05', orders: 128, revenue: 24192, avg_order: 189.0 },
        { month: '2024-06', orders: 141, revenue: 26169, avg_order: 185.6 },
        { month: '2024-07', orders: 156, revenue: 28704, avg_order: 184.0 },
        { month: '2024-08', orders: 134, revenue: 23478, avg_order: 175.2 },
        { month: '2024-09', orders: 69,  revenue: 12042, avg_order: 174.5 },
      ],
      summary: '**740 paid orders** total, $138K revenue, avg order **$186.49**. Peak July (156 orders, $28.7K). Revenue growing +37% April→July, then seasonal dip in Sept (partial month). Checkout conversion: 740/920 started = **80.4%**.',
      interpreted_as: "orders WHERE status='paid' · GROUP BY month · SUM(total) · AVG(total)",
      chartData: {
        type: 'line',
        title: 'Monthly paid orders revenue',
        labels: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
        values: [20944, 24192, 26169, 28704, 23478, 12042],
        unit: '$',
      },
      sources: [
        { id: 'pos', label: 'POS Database', bg: 'bg-blue-100', text: 'text-blue-700' },
      ],
      steps: [
        '① orders: 740 with status=paid (of 920 checkouts started)',
        '② GROUP BY DATE_TRUNC month',
        '③ SUM(total) = revenue · AVG(total) = basket size',
        '④ Trend: +37% Apr-Jul, Sept partial month explains dip',
      ],
      followUps: ['Show the top 10 products by stock level', 'Which promotions are active?', 'Show gold loyalty customers'],
    }),
  },
  // ── Customer loyalty tiers ────────────────────────────────────────────────
  {
    test: q => /loyalt|loyalty.*tier|gold.*customer|silver.*customer|tier.*customer|customer.*tier|fidelty|fidelità|fedeltà/i.test(q),
    result: () => ({
      sql: `SELECT loyaltyTier, COUNT(*) AS customers, AVG(totalSpent) AS avg_lifetime_value, SUM(totalSpent) AS total_ltv FROM customers GROUP BY loyaltyTier ORDER BY avg_lifetime_value DESC`,
      rows: [
        { loyaltyTier: 'Gold',   customers: 312,  avg_lifetime_value: 892.4, total_ltv: 278429 },
        { loyaltyTier: 'Silver', customers: 841,  avg_lifetime_value: 421.7, total_ltv: 354650 },
        { loyaltyTier: 'Bronze', customers: 1847, avg_lifetime_value: 184.3, total_ltv: 340378 },
        { loyaltyTier: 'None',   customers: 1520, avg_lifetime_value: 91.2,  total_ltv: 138624 },
      ],
      summary: '**4,520 customers** across 4 loyalty tiers. Gold (312 = 6.9%) generates $278K LTV at avg **$892 each**. Silver (841 = 18.6%) largest revenue contributor ($354K). Bronze+None = 74.5% of base, $479K total. Gold customers spend **9.8× more** than non-loyalty.',
      interpreted_as: 'customers GROUP BY loyaltyTier · SUM(totalSpent) · AVG(totalSpent)',
      chartData: {
        type: 'pie',
        title: 'Avg lifetime value by loyalty tier',
        labels: ['Gold', 'Silver', 'Bronze', 'None'],
        values: [892.4, 421.7, 184.3, 91.2],
        unit: '$',
      },
      sources: [
        { id: 'crm', label: 'CRM', bg: 'bg-violet-100', text: 'text-violet-700' },
      ],
      steps: [
        '① customers: 4,520 total with loyaltyTier column',
        '② GROUP BY loyaltyTier · COUNT · AVG/SUM(totalSpent)',
        '③ Gold: 312 customers, avg $892 lifetime spend',
        '④ Silver has highest total LTV ($354K) — largest high-value group',
      ],
      followUps: ['Show the top 10 products by stock level', 'Which promotions are active?', 'What is the total amount of paid orders?'],
    }),
  },
  // ── Stock / inventory levels ──────────────────────────────────────────────
  {
    test: q => /stock|inventory|low.*stock|out.*of.*stock|scorta|magazzino|stock.*level|reorder/i.test(q),
    result: () => ({
      sql: `SELECT p.name, p.sku, i.quantity AS stock, i.reservedQty, (i.quantity - i.reservedQty) AS available, i.location FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.quantity < 50 ORDER BY i.quantity ASC LIMIT 10`,
      rows: [
        { name: 'Smart Watch Series 5',    sku: 'TECH-008',  stock: 3,  reservedQty: 2, available: 1,  location: 'Warehouse-A' },
        { name: 'Wireless Headphones Pro', sku: 'TECH-001',  stock: 8,  reservedQty: 5, available: 3,  location: 'Warehouse-A' },
        { name: 'Running Shoes Elite',     sku: 'SPORT-021', stock: 12, reservedQty: 4, available: 8,  location: 'Warehouse-B' },
        { name: 'Coffee Maker Deluxe',     sku: 'HOME-014',  stock: 21, reservedQty: 3, available: 18, location: 'Warehouse-A' },
        { name: 'Yoga Mat Premium',        sku: 'SPORT-004', stock: 34, reservedQty: 8, available: 26, location: 'Warehouse-B' },
        { name: 'Electric Kettle',         sku: 'HOME-003',  stock: 41, reservedQty: 6, available: 35, location: 'Warehouse-C' },
      ],
      summary: '**6 products below 50 units** — reorder alert. Smart Watch Series 5: **only 1 available** (3 stock − 2 reserved). Top sellers Headphones Pro and Running Shoes also at risk. Recommended: trigger PO for TECH-001, TECH-008, SPORT-021 immediately.',
      interpreted_as: 'inventory JOIN products · WHERE quantity < 50 · ORDER BY quantity ASC',
      sources: [
        { id: 'wms',     label: 'Warehouse WMS',   bg: 'bg-amber-100', text: 'text-amber-700' },
        { id: 'catalog', label: 'Product Catalog',  bg: 'bg-teal-100',  text: 'text-teal-700'  },
      ],
      steps: [
        '① inventory: 2,840 rows (one per product)',
        '② Filter quantity < 50 — low-stock threshold',
        '③ JOIN products for name/SKU · available = quantity − reservedQty',
        '④ Smart Watch: 3 total, 2 reserved = 1 available → critical',
      ],
      followUps: ['Show the top 10 products by stock level', 'Which promotions are active?', 'What is the total amount of paid orders?'],
    }),
  },
]

function tryRetailQuery(question: string): EngineResult | null {
  for (const pattern of RETAIL_PATTERNS) {
    if (pattern.test(question)) return pattern.result()
  }
  return null
}

// ── Healthcare canned responses ───────────────────────────────────────────────

const HEALTHCARE_PATTERNS: Array<{
  test: (q: string) => boolean
  result: () => EngineResult
}> = [
  // ── Active patients / patient count ──────────────────────────────────────
  {
    test: q => /patient|active.*patient|patient.*count|pazient|how many.*patient|patient.*condition|chronic/i.test(q),
    result: () => ({
      sql: `SELECT chronicConditions AS condition, COUNT(*) AS patients, AVG(DATEDIFF(NOW(), birthDate)/365) AS avg_age FROM patients WHERE chronicConditions IS NOT NULL GROUP BY chronicConditions ORDER BY patients DESC LIMIT 8`,
      rows: [
        { condition: 'Hypertension',      patients: 284, avg_age: 58.3 },
        { condition: 'Type 2 Diabetes',   patients: 231, avg_age: 54.7 },
        { condition: 'Chronic Back Pain', patients: 178, avg_age: 47.2 },
        { condition: 'Asthma',            patients: 142, avg_age: 38.1 },
        { condition: 'Osteoarthritis',    patients: 98,  avg_age: 63.4 },
        { condition: 'Anxiety Disorder',  patients: 87,  avg_age: 34.9 },
        { condition: 'COPD',              patients: 63,  avg_age: 67.2 },
        { condition: 'Heart Failure',     patients: 41,  avg_age: 71.8 },
      ],
      summary: '**1,240 registered patients**, 872 with documented chronic conditions. Hypertension most prevalent (284, avg age 58). Heart Failure cohort oldest (avg 71.8). 368 patients with no chronic condition on record — may require data completion.',
      interpreted_as: 'patients GROUP BY chronicConditions · COUNT · AVG age · WHERE condition NOT NULL',
      chartData: {
        type: 'bar',
        title: 'Patients by chronic condition',
        labels: ['Hypertension', 'T2 Diabetes', 'Back Pain', 'Asthma', 'Osteoarthritis', 'Anxiety', 'COPD', 'Heart Failure'],
        values: [284, 231, 178, 142, 98, 87, 63, 41],
        unit: '',
      },
      sources: [
        { id: 'ehr', label: 'EHR System', bg: 'bg-blue-100', text: 'text-blue-700' },
      ],
      steps: [
        '① patients: 1,240 registered in EHR',
        '② Filter chronicConditions IS NOT NULL (872 have conditions)',
        '③ GROUP BY condition · COUNT · AVG age from birthDate',
        '④ 368 patients with no chronic condition — check data completeness',
      ],
      followUps: ['How many encounters per doctor?', 'Show prescriptions issued recently', 'Which treatments have no outcome recorded?'],
    }),
  },
  // ── Prescriptions by doctor ───────────────────────────────────────────────
  {
    test: q => /prescription|prescri|doctor.*prescri|prescri.*doctor|medic.*issued|issued.*medic|ricett|farmac/i.test(q),
    result: () => ({
      sql: `SELECT d.name AS doctor, d.specialization, COUNT(p.id) AS prescriptions, COUNT(DISTINCT p.patientId) AS unique_patients, AVG(p.renewals) AS avg_renewals FROM prescriptions p JOIN doctors d ON d.id = p.doctorId GROUP BY d.id ORDER BY prescriptions DESC LIMIT 8`,
      rows: [
        { doctor: 'Dr. Sarah Chen',     specialization: 'Internal Medicine', prescriptions: 412, unique_patients: 189, avg_renewals: 2.3 },
        { doctor: 'Dr. Marco Bianchi',  specialization: 'Cardiology',        prescriptions: 387, unique_patients: 201, avg_renewals: 3.1 },
        { doctor: 'Dr. Amara Okafor',   specialization: 'Endocrinology',     prescriptions: 341, unique_patients: 163, avg_renewals: 4.2 },
        { doctor: 'Dr. James Kovacs',   specialization: 'Pulmonology',       prescriptions: 298, unique_patients: 147, avg_renewals: 1.8 },
        { doctor: 'Dr. Luisa Ferretti', specialization: 'General Practice',  prescriptions: 271, unique_patients: 231, avg_renewals: 1.2 },
        { doctor: 'Dr. Raj Patel',      specialization: 'Orthopedics',       prescriptions: 184, unique_patients: 142, avg_renewals: 0.9 },
      ],
      summary: '**3,100 total prescriptions** across 142 doctors. Dr. Sarah Chen leads volume (412). Endocrinologist Dr. Okafor has highest avg renewals (4.2) — chronic condition management. Dr. Ferretti covers most unique patients (231) — broad GP practice.',
      interpreted_as: 'prescriptions JOIN doctors · GROUP BY doctor · COUNT · AVG renewals',
      chartData: {
        type: 'bar',
        title: 'Prescriptions by top doctor',
        labels: ['S.Chen', 'M.Bianchi', 'A.Okafor', 'J.Kovacs', 'L.Ferretti', 'R.Patel'],
        values: [412, 387, 341, 298, 271, 184],
        unit: '',
      },
      sources: [
        { id: 'ehr', label: 'EHR System',       bg: 'bg-blue-100', text: 'text-blue-700' },
        { id: 'pms', label: 'Pharmacy System',   bg: 'bg-teal-100', text: 'text-teal-700' },
      ],
      steps: [
        '① prescriptions: 3,100 issued in current period',
        '② JOIN doctors on doctorId for name/specialization',
        '③ COUNT(DISTINCT patientId) = patient breadth per doctor',
        '④ AVG(renewals) measures chronic condition load',
      ],
      followUps: ['Show active patients', 'How many encounters per doctor?', 'Which treatments have no outcome recorded?'],
    }),
  },
  // ── Encounters per doctor ─────────────────────────────────────────────────
  {
    test: q => /encounter|visit.*doctor|doctor.*visit|how many.*encounter|encounter.*count|visite.*medico|medico.*visite/i.test(q),
    result: () => ({
      sql: `SELECT d.name, d.specialization, COUNT(e.id) AS encounters, AVG(e.durationMin) AS avg_duration_min, SUM(e.durationMin)/60 AS total_hours FROM encounters e JOIN doctors d ON d.id = e.doctorId GROUP BY d.id ORDER BY encounters DESC LIMIT 8`,
      rows: [
        { name: 'Dr. Luisa Ferretti', specialization: 'General Practice',  encounters: 412, avg_duration_min: 18.4, total_hours: 126 },
        { name: 'Dr. Sarah Chen',     specialization: 'Internal Medicine', encounters: 387, avg_duration_min: 24.1, total_hours: 156 },
        { name: 'Dr. Marco Bianchi',  specialization: 'Cardiology',        encounters: 341, avg_duration_min: 31.7, total_hours: 180 },
        { name: 'Dr. James Kovacs',   specialization: 'Pulmonology',       encounters: 298, avg_duration_min: 28.9, total_hours: 144 },
        { name: 'Dr. Amara Okafor',   specialization: 'Endocrinology',     encounters: 271, avg_duration_min: 35.2, total_hours: 159 },
        { name: 'Dr. Raj Patel',      specialization: 'Orthopedics',       encounters: 184, avg_duration_min: 22.1, total_hours: 68  },
      ],
      summary: '**4,200 encounters** total in the period. Dr. Ferretti (GP) highest volume (412) but shortest avg visit (18 min). Dr. Bianchi (Cardiology) most time per patient (31.7 min) = complex cases. Dr. Okafor: 35 min avg — longest consultations (endocrinology management).',
      interpreted_as: 'encounters JOIN doctors · GROUP BY doctor · COUNT · AVG durationMin',
      chartData: {
        type: 'bar',
        title: 'Encounters by doctor',
        labels: ['Ferretti', 'Chen', 'Bianchi', 'Kovacs', 'Okafor', 'Patel'],
        values: [412, 387, 341, 298, 271, 184],
        unit: '',
      },
      sources: [
        { id: 'ehr', label: 'EHR System', bg: 'bg-blue-100', text: 'text-blue-700' },
      ],
      steps: [
        '① encounters: 4,200 total across all providers and locations',
        '② JOIN doctors on doctorId for name/specialization',
        '③ COUNT(encounters) + AVG(durationMin) + SUM for total hours',
        '④ GP highest volume but shortest time — specialist visits are longer',
      ],
      followUps: ['Show prescriptions issued recently', 'Show active patients', 'Which treatments have no outcome recorded?'],
    }),
  },
  // ── Treatments without outcome ────────────────────────────────────────────
  {
    test: q => /treatment.*outcome|outcome.*treatment|no.*outcome|missing.*outcome|incomplete.*treatment|trattamenti.*senza|esito.*mancante/i.test(q),
    result: () => ({
      sql: `SELECT t.type, COUNT(*) AS treatments, COUNT(CASE WHEN t.outcome IS NULL THEN 1 END) AS no_outcome, ROUND(COUNT(CASE WHEN t.outcome IS NULL THEN 1 END)*100.0/COUNT(*),1) AS pct_missing FROM treatments t GROUP BY t.type ORDER BY pct_missing DESC`,
      rows: [
        { type: 'Physical Therapy',  treatments: 184, no_outcome: 74, pct_missing: '40.2%' },
        { type: 'Chemotherapy',      treatments: 23,  no_outcome: 8,  pct_missing: '34.8%' },
        { type: 'Surgery',           treatments: 89,  no_outcome: 21, pct_missing: '23.6%' },
        { type: 'Medication Course', treatments: 341, no_outcome: 62, pct_missing: '18.2%' },
        { type: 'Radiation',         treatments: 31,  no_outcome: 5,  pct_missing: '16.1%' },
        { type: 'Psychotherapy',     treatments: 72,  no_outcome: 8,  pct_missing: '11.1%' },
      ],
      summary: '**178 treatments (24.7%) have no outcome recorded**. Physical Therapy worst (40.2% missing) — likely because outcomes documented at discharge, not start. Surgery 23.6% gap. Medication Course highest volume (341) with 62 missing. Action required: close outcome loop for 170 treatments.',
      interpreted_as: 'treatments GROUP BY type · COUNT(outcome IS NULL) / COUNT(*)',
      sources: [
        { id: 'ehr', label: 'EHR System', bg: 'bg-blue-100', text: 'text-blue-700' },
      ],
      steps: [
        '① treatments: 720 total in the system',
        '② GROUP BY type · conditional COUNT for NULL outcome',
        '③ pct_missing = missing/total × 100',
        '④ Physical Therapy 40% gap — outcome typically at discharge, check EHR workflow',
      ],
      followUps: ['Show active patients', 'How many encounters per doctor?', 'Show prescriptions issued recently'],
    }),
  },
]

function tryHealthcareQuery(question: string): EngineResult | null {
  for (const pattern of HEALTHCARE_PATTERNS) {
    if (pattern.test(question)) return pattern.result()
  }
  return null
}

// ── Finance canned responses ──────────────────────────────────────────────────

const FINANCE_PATTERNS: Array<{
  test: (q: string) => boolean
  result: () => EngineResult
}> = [
  // ── Loan portfolio by status ──────────────────────────────────────────────
  {
    test: q => /loan.*portfolio|portfolio.*loan|loan.*status|status.*loan|prestit|loan.*amount|amount.*loan|loan.*breakdown/i.test(q),
    result: () => ({
      sql: `SELECT status, COUNT(*) AS loans, SUM(amount) AS total_amount, AVG(amount) AS avg_amount, AVG(rate) AS avg_rate FROM loans GROUP BY status ORDER BY total_amount DESC`,
      rows: [
        { status: 'Active',    loans: 89, total_amount: 2341800, avg_amount: 26312, avg_rate: 0.0612 },
        { status: 'Disbursed', loans: 43, total_amount: 1131400, avg_amount: 26312, avg_rate: 0.0587 },
        { status: 'Pending',   loans: 65, total_amount: 1710500, avg_amount: 26315, avg_rate: 0.0641 },
        { status: 'Rejected',  loans: 87, total_amount: 2288700, avg_amount: 26307, avg_rate: 0.0698 },
        { status: 'Closed',    loans: 36, total_amount: 946800,  avg_amount: 26300, avg_rate: 0.0554 },
      ],
      summary: '**320 total loan applications**, $8.4M total exposure. Active portfolio: 89 loans × $2.34M. 65 pending review ($1.71M). Approval rate: **45.3%** (145/320). Rejected avg rate 6.98% vs Active 6.12% — risk-based pricing visible.',
      interpreted_as: 'loans GROUP BY status · SUM(amount) · AVG(rate)',
      chartData: {
        type: 'pie',
        title: 'Loan portfolio by status (€)',
        labels: ['Active', 'Disbursed', 'Pending', 'Rejected', 'Closed'],
        values: [2341800, 1131400, 1710500, 2288700, 946800],
        unit: '€',
      },
      sources: [
        { id: 'los', label: 'Loan Origination System', bg: 'bg-blue-100', text: 'text-blue-700' },
      ],
      steps: [
        '① loans: 320 applications in LOS across all statuses',
        '② GROUP BY status · COUNT · SUM/AVG amount and rate',
        '③ Approval = Active + Disbursed + Closed = 168/320 = 52.5%',
        '④ Rejected avg rate 6.98% — higher-risk profiles priced out',
      ],
      followUps: ['What is the average risk score?', 'Which payments are overdue?', 'Show pending loan applications'],
    }),
  },
  // ── Risk score distribution ───────────────────────────────────────────────
  {
    test: q => /risk.*score|score.*risk|risk.*profile|risk.*distribut|risk.*category|rischio|punteggio.*rischio/i.test(q),
    result: () => ({
      sql: `SELECT rp.category, COUNT(*) AS applicants, AVG(rp.score) AS avg_score, AVG(rp.pdRate)*100 AS avg_pd_pct, AVG(a.annualIncome) AS avg_income FROM risk_profiles rp JOIN applicants a ON a.id = rp.applicantId GROUP BY rp.category ORDER BY avg_score DESC`,
      rows: [
        { category: 'AAA – Prime',    applicants: 48, avg_score: 812, avg_pd_pct: 0.4,  avg_income: 94200 },
        { category: 'AA – Standard',  applicants: 87, avg_score: 721, avg_pd_pct: 1.2,  avg_income: 71300 },
        { category: 'A – Acceptable', applicants: 92, avg_score: 641, avg_pd_pct: 3.1,  avg_income: 58400 },
        { category: 'BB – Watch',     applicants: 61, avg_score: 558, avg_pd_pct: 7.4,  avg_income: 42100 },
        { category: 'B – Subprime',   applicants: 32, avg_score: 481, avg_pd_pct: 14.2, avg_income: 31800 },
      ],
      summary: '**320 applicants scored**. Prime/Standard (135 = 42.2%) have avg PD < 1.5% — low risk. BB Watch (61 = 19%) and Subprime (32 = 10%) elevate portfolio risk. Income clearly correlates: AAA avg $94K vs Subprime $31K. Blended portfolio PD: **3.8%**.',
      interpreted_as: 'risk_profiles JOIN applicants · GROUP BY category · AVG score, PD rate, income',
      chartData: {
        type: 'bar',
        title: 'Applicants by risk category',
        labels: ['AAA', 'AA', 'A', 'BB', 'B'],
        values: [48, 87, 92, 61, 32],
        unit: '',
      },
      sources: [
        { id: 'risk', label: 'Risk Engine',             bg: 'bg-red-100',  text: 'text-red-700'  },
        { id: 'los',  label: 'Loan Origination System', bg: 'bg-blue-100', text: 'text-blue-700' },
      ],
      steps: [
        '① risk_profiles: 320 computed scores (one per applicant)',
        '② JOIN applicants for income data',
        '③ GROUP BY risk category · COUNT · AVG score, PD rate, income',
        '④ PD (Probability of Default) ranges from 0.4% (AAA) to 14.2% (Subprime)',
      ],
      followUps: ['Show loan portfolio by status', 'Which payments are overdue?', 'Show pending loan applications'],
    }),
  },
  // ── Overdue payments ──────────────────────────────────────────────────────
  {
    test: q => /overdue|late.*payment|payment.*late|payment.*miss|miss.*payment|scadut|pagament.*ritard|ritard.*pagament/i.test(q),
    result: () => ({
      sql: `SELECT l.id AS loan_id, a.name, p.dueDate, p.amount, p.lateFee, DATEDIFF(NOW(), p.dueDate) AS days_overdue FROM payments p JOIN loans l ON l.id = p.loan_id JOIN applicants a ON a.id = l.applicant_id WHERE p.paidAt IS NULL AND p.dueDate < NOW() ORDER BY days_overdue DESC LIMIT 10`,
      rows: [
        { loan_id: 'L-0041', name: 'Giovanni Marchetti', dueDate: '2024-06-15', amount: 1240, lateFee: 62,   days_overdue: 92 },
        { loan_id: 'L-0028', name: 'Elena Russo',         dueDate: '2024-07-01', amount: 890,  lateFee: 44.5, days_overdue: 76 },
        { loan_id: 'L-0093', name: 'David Müller',        dueDate: '2024-07-20', amount: 2100, lateFee: 105,  days_overdue: 57 },
        { loan_id: 'L-0117', name: 'Fatima Al-Hassan',    dueDate: '2024-08-01', amount: 1560, lateFee: 78,   days_overdue: 45 },
        { loan_id: 'L-0054', name: 'Marc Dupont',         dueDate: '2024-08-10', amount: 720,  lateFee: 36,   days_overdue: 36 },
        { loan_id: 'L-0081', name: 'Sara Bianchi',        dueDate: '2024-08-25', amount: 980,  lateFee: 49,   days_overdue: 21 },
      ],
      summary: '**6 payments overdue** (of 1,840 installments). L-0041 most critical: 92 days overdue, $62 late fee accrued. Total overdue principal: **$7,490** · total late fees: **$374.5**. Action: escalate L-0041 and L-0028 to collections (>60 days).',
      interpreted_as: 'payments WHERE paidAt IS NULL AND dueDate < NOW() · ORDER BY days_overdue DESC',
      sources: [
        { id: 'los', label: 'Loan Origination System', bg: 'bg-blue-100', text: 'text-blue-700' },
      ],
      steps: [
        '① payments: 1,840 scheduled installments across all active loans',
        '② Filter paidAt IS NULL AND dueDate < NOW() = unpaid past-due',
        '③ JOIN loans and applicants for context',
        '④ days_overdue = DATEDIFF(NOW(), dueDate) — L-0041 at 92 days',
      ],
      followUps: ['Show loan portfolio by status', 'What is the average risk score?', 'Show pending loan applications'],
    }),
  },
  // ── Pending applications / KYC pipeline ──────────────────────────────────
  {
    test: q => /pending.*application|application.*pending|kyc|know.*your.*customer|verif.*pending|pipeline.*loan|loan.*pipeline|pending.*review/i.test(q),
    result: () => ({
      sql: `SELECT k.status, COUNT(*) AS applicants, AVG(DATEDIFF(NOW(), a.submittedAt)) AS avg_wait_days, SUM(l.amount) AS total_exposure FROM kyc_records k JOIN applicants a ON a.id = k.applicantId LEFT JOIN loans l ON l.applicant_id = a.id GROUP BY k.status ORDER BY applicants DESC`,
      rows: [
        { status: 'Completed',    applicants: 280, avg_wait_days: 2.1,  total_exposure: 7350000 },
        { status: 'In Review',    applicants: 24,  avg_wait_days: 8.4,  total_exposure: 631200  },
        { status: 'Pending Docs', applicants: 18,  avg_wait_days: 14.7, total_exposure: 473400  },
        { status: 'Rejected',     applicants: 12,  avg_wait_days: 5.2,  total_exposure: 315600  },
        { status: 'Escalated',    applicants: 6,   avg_wait_days: 21.3, total_exposure: 157800  },
      ],
      summary: '**280/320 (87.5%) KYC completed**. 24 in active review (avg 8.4 days wait). 18 awaiting documents (avg 14.7 days — risk of abandonment). 6 escalated cases avg **21 days** — likely PEP or AML flags. Total pipeline blocked: **$1.26M** exposure pending KYC clearance.',
      interpreted_as: 'kyc_records GROUP BY status · COUNT · AVG wait · LEFT JOIN loans for exposure',
      sources: [
        { id: 'kyc', label: 'KYC System',              bg: 'bg-violet-100', text: 'text-violet-700' },
        { id: 'los', label: 'Loan Origination System', bg: 'bg-blue-100',   text: 'text-blue-700'   },
      ],
      steps: [
        '① kyc_records: 280 completed + 60 in various pipeline stages',
        '② GROUP BY status · COUNT · AVG(DATEDIFF) for wait time',
        '③ LEFT JOIN loans for $ exposure per KYC bucket',
        '④ Escalated avg 21 days — likely AML/PEP enhanced due diligence',
      ],
      followUps: ['Show loan portfolio by status', 'What is the average risk score?', 'Which payments are overdue?'],
    }),
  },
]

function tryFinanceQuery(question: string): EngineResult | null {
  for (const pattern of FINANCE_PATTERNS) {
    if (pattern.test(question)) return pattern.result()
  }
  return null
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function executeQuery(question: string, nodes: OntologyNode[], sectorId?: string): EngineResult {
  if (sectorId === 'manufacturing') {
    const aw = tryAWQuery(question)
    if (aw) return aw
  }
  if (sectorId === 'retail') {
    const r = tryRetailQuery(question)
    if (r) return r
  }
  if (sectorId === 'healthcare') {
    const h = tryHealthcareQuery(question)
    if (h) return h
  }
  if (sectorId === 'finance') {
    const f = tryFinanceQuery(question)
    if (f) return f
  }

  const node = findNode(question, nodes)!
  const filters = extractFilters(question, node)
  const aggregation = extractAggregation(question, node)
  const orderBy = extractSort(question, node)
  const limit = extractLimit(question)
  const selectFields = node.data.properties.map(p => p.name)

  const pq: ParsedQuery = { node, filters, aggregation, orderBy, limit, selectFields }
  const sql = buildSQL(pq)

  // Generate 50 mock rows for better filter coverage
  let rows = generateMockData(node, 50) as Record<string, unknown>[]

  // Apply filters
  for (const f of filters) rows = rows.filter(r => applyFilter(r, f))

  // Aggregation
  if (aggregation) {
    rows = aggregate(rows, aggregation)
  } else {
    // Sort
    if (orderBy) {
      rows = [...rows].sort((a, b) => {
        const va = Number(a[orderBy.field]) || String(a[orderBy.field])
        const vb = Number(b[orderBy.field]) || String(b[orderBy.field])
        if (typeof va === 'number' && typeof vb === 'number') return orderBy.dir === 'DESC' ? vb - va : va - vb
        return orderBy.dir === 'DESC' ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb))
      })
    }
    // Limit
    rows = rows.slice(0, limit)
  }

  // If no rows after filtering, relax and return sample
  if (rows.length === 0 && filters.length > 0) {
    rows = (generateMockData(node, limit) as Record<string, unknown>[]).slice(0, 5)
    const summary = `No exact matches found. Showing a **sample** of ${pq.node.data.label} records — adjust your filters for precise results.`
    return { sql, rows, summary, interpreted_as: `Query ${node.data.label} with filters (relaxed)` }
  }

  const summary = buildSummary(rows, pq)
  const chartData = buildChartData(rows, pq)

  const filterDesc = filters.map(f => `${f.field} ${f.op} ${f.value}`).join(', ')
  const interpreted_as = [
    aggregation ? `${aggregation.fn}(${aggregation.field})` : `Select ${node.data.label}`,
    filterDesc ? `WHERE ${filterDesc}` : '',
    aggregation?.groupBy ? `GROUP BY ${aggregation.groupBy}` : '',
    orderBy ? `ORDER BY ${orderBy.field} ${orderBy.dir}` : '',
    !aggregation ? `LIMIT ${limit}` : '',
  ].filter(Boolean).join(' · ')

  return { sql, rows, summary, interpreted_as, chartData }
}
