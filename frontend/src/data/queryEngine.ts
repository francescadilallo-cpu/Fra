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

export interface EngineResult {
  sql: string
  rows: Record<string, unknown>[]
  summary: string
  interpreted_as: string
  chartData?: ChartData
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

// ── Main entry point ──────────────────────────────────────────────────────────

export function executeQuery(question: string, nodes: OntologyNode[]): EngineResult {
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
