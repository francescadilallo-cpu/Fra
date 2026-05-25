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
  type: 'bar' | 'line'
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
        type: 'bar',
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
        type: 'bar',
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
  // ── Revenue disambiguation ────────────────────────────────────────────────────
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
      summary: '**Southwest** leads with $10.5M YTD (8,512 orders), followed by **Northwest** ($7.9M). North America $32.2M combined. Europe (UK, France, Germany) $13.6M.',
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
    test: q => /product|item|sku|catalog|which.*product|product.*revenue|top.*product|best.*product/i.test(q),
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
        { name: 'Mountain-200 Black, 38',  category: 'Bikes', subcategory: 'Mountain Bikes', listPrice: 2049.00, revenue: 261435.60, units_sold: 3 },
        { name: 'Road-150 Red, 62',        category: 'Bikes', subcategory: 'Road Bikes',     listPrice: 3578.27, revenue: 106419.60, units_sold: 2 },
        { name: 'Touring-1000 Blue, 60',   category: 'Bikes', subcategory: 'Touring Bikes',  listPrice: 2384.07, revenue:  32726.48, units_sold: 1 },
        { name: 'Mountain-100 Silver, 44', category: 'Bikes', subcategory: 'Mountain Bikes', listPrice: 3399.99, revenue:  14289.93, units_sold: 5 },
        { name: 'Road-650 Red, 58',        category: 'Bikes', subcategory: 'Road Bikes',     listPrice:  782.99, revenue:   8159.97, units_sold: 6 },
        { name: 'Long-Sleeve Logo Jersey', category: 'Clothing', subcategory: 'Jerseys',     listPrice:   49.99, revenue:   4079.98, units_sold: 2 },
        { name: 'Sport-100 Helmet Blue',   category: 'Accessories', subcategory: 'Helmets',  listPrice:   34.99, revenue:   2039.99, units_sold: 1 },
        { name: 'AWC Logo Cap',            category: 'Accessories', subcategory: 'Caps',     listPrice:    8.99, revenue:   2024.99, units_sold: 1 },
      ],
      summary: 'Top product: **Mountain-200 Black, 38** ($261K, 3 units). All top 5 are bikes. 47 PIM products had no matching ERP orders (orphans). Cross-source: ERP SalesOrderLine × PIM Catalog via `productId ↔ internal_id`.',
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
        '② Bridge resolved: productId ↔ internal_id (457/504 matched — 99.6%)',
        '③ 47 orphan products flagged (in PIM, no ERP sales history)',
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
    test: q => /order|sales order|show.*order|list.*order|recent.*order/i.test(q),
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
LIMIT  12`,
      rows: [
        { orderId: 75124, orderDate: '2014-12-28', shipDate: null,         status: 'Confirmed',  subtotalAmount:  53209.80, totalDue:  56994.49, channel: 'In-store' },
        { orderId: 75123, orderDate: '2014-12-28', shipDate: null,         status: 'Confirmed',  subtotalAmount:  87145.20, totalDue:  93345.65, channel: 'In-store' },
        { orderId: 75122, orderDate: '2014-12-01', shipDate: '2014-12-08', status: 'Shipped',    subtotalAmount:   1898.00, totalDue:   2031.62, channel: 'In-store' },
        { orderId: 75121, orderDate: '2014-12-01', shipDate: '2014-12-08', status: 'Shipped',    subtotalAmount:     48.68, totalDue:     52.18, channel: 'Online'   },
        { orderId: 75120, orderDate: '2014-12-01', shipDate: '2014-12-08', status: 'Processing', subtotalAmount:   2049.00, totalDue:   2193.15, channel: 'In-store' },
        { orderId: 75119, orderDate: '2014-11-30', shipDate: '2014-12-07', status: 'Processing', subtotalAmount:   2039.99, totalDue:   2185.98, channel: 'Online'   },
        { orderId: 75118, orderDate: '2014-11-30', shipDate: '2014-12-07', status: 'Processing', subtotalAmount:   1429.00, totalDue:   1532.21, channel: 'Online'   },
        { orderId: 75117, orderDate: '2014-11-30', shipDate: '2014-12-07', status: 'Shipped',    subtotalAmount:      9.99, totalDue:     13.07, channel: 'Online'   },
        { orderId: 43662, orderDate: '2011-05-31', shipDate: '2011-06-07', status: 'Shipped',    subtotalAmount:  28832.53, totalDue:  32474.93, channel: 'In-store' },
        { orderId: 43661, orderDate: '2011-05-31', shipDate: '2011-06-07', status: 'Shipped',    subtotalAmount:  32726.48, totalDue:  36865.80, channel: 'In-store' },
      ],
      summary: 'Showing **10 orders** from ERP OrionSales (31,465 total). Two large confirmed orders (#75123 $87K, #75124 $53K) from Dec 2014 are pending shipment. Note: `subtotalAmount` ≠ `totalDue` — tax + freight adds ~11%.',
      interpreted_as: 'ERP.SalesOrder · ORDER BY orderDate DESC · LIMIT 12',
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
        { bridge_name: 'OF_PRODUCT',    source_a: 'ERP OrderLine',   field_a: 'productId',     source_b: 'PIM JSON',    field_b: 'internal_id', total_a: 504,    matched: 457,   unmatched: 47, match_pct: '99.6%'  },
        { bridge_name: 'PLACED_BY',     source_a: 'ERP SalesOrder',  field_a: 'customer_ref',  source_b: 'CRM ClientHub', field_b: 'accountId', total_a: 19829,  matched: 18484, unmatched: 1345, match_pct: '93.2%' },
      ],
      summary: '3 cross-source bridges validated. **SOLD_BY** (ERP × HR): 100% — all 14 sales reps matched. **OF_PRODUCT** (ERP × PIM): 99.6% — 47 orphan products. **PLACED_BY** (ERP × CRM): 93.2% — 1,345 CRM-only prospects. KG: **193,062 nodes · 313,193 edges**.',
      interpreted_as: 'kg.bridge_validation_report · 3 bridges · match rates',
      sources: [SRC.ERP, SRC.CRM, SRC.HR, SRC.PIM, SRC.KG],
      steps: [
        '① Knowledge Graph loaded: 193,062 nodes · 313,193 edges',
        '② Bridge SOLD_BY: salesPersonId ↔ matricolaDip → 14/14 (100%)',
        '③ Bridge OF_PRODUCT: productId ↔ internal_id → 457/504 (99.6%, 47 orphans)',
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
        { category: 'Components',  products: 189, units_sold: 82_341, revenue:   931_644,  avg_list_price:  218.30 },
        { category: 'Clothing',    products: 35,  units_sold: 14_987, revenue:   339_772,  avg_list_price:   34.82 },
        { category: 'Accessories', products: 36,  units_sold: 9_082,  revenue:   231_521,  avg_list_price:   25.23 },
      ],
      summary: '**Bikes dominate**: $19.8M revenue (98% of net), 97 SKUs. Components $932K, Clothing $340K, Accessories $232K. Bikes avg list price $1,508 vs Accessories $25. Cross-source: ERP SalesOrderLine × PIM product_catalog.',
      interpreted_as: 'PIM.category GROUP BY category · SUM(lineTotal) · ERP × PIM bridge',
      chartData: {
        type: 'bar',
        title: 'Revenue by product category (ERP × PIM)',
        labels: ['Bikes', 'Components', 'Clothing', 'Accessories'],
        values: [19791723, 931644, 339772, 231521],
        unit: '$',
      },
      sources: [SRC.ERP, SRC.PIM],
      steps: [
        '① PIM product_catalog: 504 products across 4 categories',
        '② Bridge OF_PRODUCT: productId ↔ internal_id (457/504 — 99.6%)',
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
        type: 'bar',
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
        { channel: 'In-store', quarter: 'Q1', orders: 901,  avg_net: 2628.16, avg_gross: 2814.23, min_order: 2.29,    max_order: 187487.83 },
        { channel: 'In-store', quarter: 'Q2', orders: 1102, avg_net: 2851.90, avg_gross: 3054.37, min_order: 5.70,    max_order: 217628.97 },
        { channel: 'In-store', quarter: 'Q3', orders: 1187, avg_net: 2791.44, avg_gross: 2988.96, min_order: 3.99,    max_order: 189519.73 },
        { channel: 'In-store', quarter: 'Q4', orders:  616, avg_net: 2380.09, avg_gross: 2549.06, min_order: 0.99,    max_order: 112103.14 },
        { channel: 'Online',   quarter: 'Q1', orders: 6411, avg_net:  342.41, avg_gross: 366.71,  min_order: 2.29,    max_order:   9887.43 },
        { channel: 'Online',   quarter: 'Q2', orders: 7102, avg_net:  365.98, avg_gross: 391.90,  min_order: 2.29,    max_order:  12049.37 },
        { channel: 'Online',   quarter: 'Q3', orders: 7660, avg_net:  382.13, avg_gross: 409.01,  min_order: 2.29,    max_order:  11988.73 },
        { channel: 'Online',   quarter: 'Q4', orders: 6486, avg_net:  308.97, avg_gross: 331.04,  min_order: 1.99,    max_order:   9437.82 },
      ],
      summary: 'Global avg order net: **$639.65**. In-store avg **$2,704** (7.6× higher than online $356). Q2 is peak for both channels. Largest single order: $217K in-store Q2 2014.',
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
        type: 'bar',
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
        { territory: 'Southwest',      orders: 8512, total_tax: 906432, total_freight: 226608, total_overhead: 1133040, overhead_pct: '10.8%' },
        { territory: 'Northwest',      orders: 6438, total_tax: 680145, total_freight: 170036, total_overhead: 850181, overhead_pct: '10.8%' },
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
]

function tryAWQuery(question: string): EngineResult | null {
  for (const pattern of AW_PATTERNS) {
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
