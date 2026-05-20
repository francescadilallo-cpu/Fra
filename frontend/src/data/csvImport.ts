import type { OntologyNode, PropertyType } from '../types'

// ── CSV parsing (simple, handles quoted fields and commas inside quotes) ─────
export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }

  function splitLine(line: string): string[] {
    const out: string[] = []
    let cur = ''
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++ }
        else inQuote = !inQuote
      } else if ((ch === ',' || ch === ';') && !inQuote) {
        out.push(cur); cur = ''
      } else {
        cur += ch
      }
    }
    out.push(cur)
    return out.map(c => c.trim())
  }

  const headers = splitLine(lines[0])
  const rows = lines.slice(1).map(splitLine)
  return { headers, rows }
}

// ── Type detection from sample values ────────────────────────────────────────
const UUID_RE     = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE     = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/
const INT_RE      = /^-?\d+$/
const DECIMAL_RE  = /^-?\d+[.,]\d+$/
const BOOL_RE     = /^(true|false|yes|no|si|sì|0|1)$/i

export function detectType(values: string[]): PropertyType {
  const samples = values.filter(v => v && v.trim().length > 0).slice(0, 20)
  if (samples.length === 0) return 'string'

  const match = (re: RegExp) => samples.every(v => re.test(v))
  if (match(UUID_RE))     return 'uuid'
  if (match(DATETIME_RE)) return 'datetime'
  if (match(DATE_RE))     return 'date'
  if (match(BOOL_RE))     return 'boolean'
  if (match(DECIMAL_RE))  return 'decimal'
  if (match(INT_RE))      return 'integer'
  if (samples.some(v => v.length > 100)) return 'text'
  return 'string'
}

// ── Auto-mapping suggestions ─────────────────────────────────────────────────
function normalize(s: string): string {
  return s.toLowerCase().replace(/[_\-\s]/g, '').replace(/[^a-z0-9]/g, '')
}

const SYNONYMS: Record<string, string[]> = {
  id:         ['code', 'codice', 'identifier', 'uuid'],
  name:       ['nome', 'denominazione', 'descrizione', 'label', 'title', 'titolo'],
  email:      ['mail', 'posta'],
  phone:      ['telefono', 'tel', 'cell', 'mobile'],
  address:    ['indirizzo', 'address1', 'via'],
  city:       ['citta', 'città', 'town'],
  country:    ['paese', 'nazione'],
  total:      ['totale', 'amount', 'importo', 'value', 'valore'],
  price:      ['prezzo', 'cost', 'costo'],
  quantity:   ['qty', 'quantita', 'quantità'],
  date:       ['data', 'datetime', 'timestamp', 'createdat', 'created'],
  status:     ['stato', 'state'],
  customer:   ['cliente', 'buyer', 'compratore'],
  supplier:   ['fornitore', 'vendor'],
  product:    ['prodotto', 'item', 'articolo', 'sku'],
}

export interface MappingSuggestion {
  column: string
  detectedType: PropertyType
  sampleValues: string[]
  suggestedEntity: string | null    // ontology node label
  suggestedProperty: string | null  // ontology property name
  confidence: 'high' | 'medium' | 'low' | 'none'
}

function scoreMatch(colNorm: string, propNorm: string): number {
  if (colNorm === propNorm) return 1.0
  if (colNorm.includes(propNorm) || propNorm.includes(colNorm)) return 0.7
  for (const [canonical, syns] of Object.entries(SYNONYMS)) {
    const all = [canonical, ...syns].map(normalize)
    if (all.includes(colNorm) && all.includes(propNorm)) return 0.85
  }
  return 0
}

export function suggestMappings(
  headers: string[],
  rows: string[][],
  nodes: OntologyNode[],
): MappingSuggestion[] {
  return headers.map((col, colIdx) => {
    const colValues = rows.map(r => r[colIdx] ?? '')
    const detected = detectType(colValues)
    const sample = colValues.filter(v => v.length > 0).slice(0, 3)
    const colNorm = normalize(col)

    let best: { node: OntologyNode; prop: string; score: number } | null = null
    for (const node of nodes) {
      for (const prop of node.data.properties) {
        if (prop.type === 'fk') continue
        const score = scoreMatch(colNorm, normalize(prop.name))
        // small bonus if detected type matches property type
        const typeBonus = prop.type === detected ? 0.1 : 0
        const total = score + typeBonus
        if (total > 0 && (!best || total > best.score)) {
          best = { node, prop: prop.name, score: total }
        }
      }
    }

    let confidence: MappingSuggestion['confidence'] = 'none'
    if (best) {
      confidence = best.score >= 0.95 ? 'high' : best.score >= 0.7 ? 'medium' : 'low'
    }

    return {
      column: col,
      detectedType: detected,
      sampleValues: sample,
      suggestedEntity: best?.node.data.label ?? null,
      suggestedProperty: best?.prop ?? null,
      confidence,
    }
  })
}

// ── Pre-made sample CSV per sector for demo purposes ─────────────────────────
export const SAMPLE_CSV_BY_SECTOR: Record<string, { filename: string; content: string }> = {
  manufacturing: {
    filename: 'orders_export.csv',
    content:
`order_id,customer_name,product_sku,quantity,unit_price,total_amount,delivery_date,status
ORD-1001,Acciaierie Lombarde SpA,SKU-091,150,42.50,6375.00,2026-06-12,confirmed
ORD-1002,Metalwork SRL,SKU-134,80,128.00,10240.00,2026-06-15,confirmed
ORD-1003,TechFab Industries,SKU-091,220,42.50,9350.00,2026-06-18,pending
ORD-1004,Pressofusioni Veneto,SKU-208,45,890.00,40050.00,2026-06-20,confirmed
ORD-1005,Acciaierie Lombarde SpA,SKU-134,120,128.00,15360.00,2026-06-22,confirmed`,
  },
  retail: {
    filename: 'shopify_orders.csv',
    content:
`order_id,customer_email,total,currency,created_at,payment_status,fulfillment_status
SH-2401,marco.rossi@example.it,89.50,EUR,2026-05-18T10:23:00,paid,fulfilled
SH-2402,laura.bianchi@example.it,234.00,EUR,2026-05-18T11:45:00,paid,pending
SH-2403,andrea.verdi@example.it,156.80,EUR,2026-05-18T14:12:00,paid,fulfilled
SH-2404,giulia.neri@example.it,42.00,EUR,2026-05-19T09:01:00,pending,unfulfilled
SH-2405,marco.rossi@example.it,67.30,EUR,2026-05-19T16:38:00,paid,fulfilled`,
  },
  healthcare: {
    filename: 'patient_visits.csv',
    content:
`encounter_id,patient_name,doctor_name,visit_date,diagnosis_code,status
ENC-501,Mario Rossi,Dr. Bianchi,2026-05-15,I10,completed
ENC-502,Anna Verdi,Dr. Esposito,2026-05-15,E11.9,completed
ENC-503,Luca Neri,Dr. Bianchi,2026-05-16,J45.909,scheduled
ENC-504,Marta Bianchi,Dr. Romano,2026-05-16,M54.5,completed
ENC-505,Paolo Rossi,Dr. Esposito,2026-05-17,K21.0,scheduled`,
  },
  finance: {
    filename: 'loan_applications.csv',
    content:
`application_id,applicant_name,amount,term_months,risk_score,status,submitted_at
LA-7801,Carla Ferraro,25000.00,36,712,approved,2026-05-10
LA-7802,Marco Innocenti,80000.00,60,648,pending,2026-05-12
LA-7803,Sofia Lombardi,15000.00,24,791,approved,2026-05-13
LA-7804,Davide Pratesi,120000.00,84,580,review,2026-05-14
LA-7805,Elena Marchetti,45000.00,48,720,approved,2026-05-15`,
  },
}
