import type { OntologyNode, OntologyProperty } from '../types'

// ── Seeded PRNG ──────────────────────────────────────────────────────────────
function seededRng(seed: number) {
  let s = seed >>> 0
  return () => { s = Math.imul(s ^ (s >>> 15), s | 1) ^ (s ^ (s >>> 7)) * 0x9e370001; return ((s >>> 0) / 0xffffffff) }
}

// ── Value pools ──────────────────────────────────────────────────────────────
const COMPANIES = ['Acciaierie Lombarde SpA','TechFab SRL','Metalwork SpA','Ferretti & C.','BioMed Italia','FinTech Adriatico','RetailHub SRL','GreenEnergy SpA','DataSync SRL','Logistica Pronto']
const PEOPLE = ['Marco Rossi','Laura Bianchi','Giuseppe Ferrara','Giulia Esposito','Andrea Colombo','Valentina Ricci','Luca Mancini','Sara Romano','Davide Conti','Federica Moretti']
const COUNTRIES = ['Italy','Germany','France','Spain','Netherlands','Poland','Austria','Belgium','Switzerland','Sweden']
const STATUSES_GEN = ['active','pending','completed','cancelled','draft','approved','rejected']
const PRODUCT_NAMES = ['Industrial Valve A4','Hydraulic Pump X2','Steel Beam 120mm','Circuit Board PCB-7','Precision Motor M3','Carbon Filter CF-12','Sensor Unit SU-8','Bearing Assembly BA-5']
const MEDS = ['Amoxicillin 500mg','Metformin 1000mg','Lisinopril 10mg','Atorvastatin 20mg','Omeprazole 20mg','Sertraline 50mg','Levothyroxine 75mcg','Amlodipine 5mg']
const ICD10S = ['J06.9','E11.9','I10','K21.0','F32.1','M54.5','J45.20','E78.5','N39.0','G43.909']
const CURRENCIES = ['EUR','EUR','EUR','EUR','USD','GBP','CHF']
const BLOOD_TYPES = ['A+','A-','B+','B-','O+','O-','AB+','AB-']
const SPECIALIZATIONS = ['Cardiology','Neurology','Oncology','Orthopedics','General Medicine','Endocrinology','Psychiatry','Pulmonology']

function pick<T>(arr: T[], r: () => number): T { return arr[Math.floor(r() * arr.length)] }
function randInt(min: number, max: number, r: () => number) { return Math.floor(r() * (max - min + 1)) + min }
function randDec(min: number, max: number, r: () => number, decimals = 2) { return parseFloat((r() * (max - min) + min).toFixed(decimals)) }

function randDate(daysBack: number, r: () => number): string {
  const d = new Date(Date.now() - Math.floor(r() * daysBack) * 86_400_000)
  return d.toISOString().slice(0, 10)
}
function randDatetime(daysBack: number, r: () => number): string {
  const d = new Date(Date.now() - Math.floor(r() * daysBack) * 86_400_000 - Math.floor(r() * 86_400_000))
  return d.toISOString().slice(0, 16).replace('T', ' ')
}
function randUuid(r: () => number): string {
  return 'xxxxxxxx'.replace(/x/g, () => Math.floor(r() * 16).toString(16))
}
function randVat(r: () => number): string {
  return 'IT' + String(Math.floor(r() * 90_000_000_000 + 10_000_000_000))
}
function randIban(r: () => number): string {
  return `IT${randInt(10,99,r)}B${randInt(10000,99999,r)}${randInt(10000,99999,r)}0${randInt(100000000000,999999999999,r)}`
}
function randSku(r: () => number): string {
  return `SKU-${randInt(100,999,r)}-${String.fromCharCode(65 + Math.floor(r() * 26))}${randInt(1,9,r)}`
}

// ── Property value generator ─────────────────────────────────────────────────
function generateValue(prop: OntologyProperty, entityLabel: string, index: number, r: () => number): unknown {
  const n = prop.name.toLowerCase()
  const t = prop.type

  // ID fields
  if (n === 'id' || t === 'uuid') return randUuid(r)

  // Booleans
  if (t === 'boolean') return r() > 0.3

  // Dates / datetimes
  if (t === 'datetime' || n.endsWith('at') || n.includes('time')) return randDatetime(180, r)
  if (t === 'date' || n.includes('date') || n.includes('day')) return randDate(365, r)

  // Specific string patterns
  if (n === 'iban') return randIban(r)
  if (n === 'vatnumber' || n === 'vatid' || n === 'fiscalcode') return randVat(r)
  if (n === 'sku') return randSku(r)
  if (n === 'icd10') return pick(ICD10S, r)
  if (n === 'bloodtype') return pick(BLOOD_TYPES, r)
  if (n === 'currency') return pick(CURRENCIES, r)
  if (n === 'country') return pick(COUNTRIES, r)
  if (n === 'gender') return r() > 0.5 ? 'M' : 'F'
  if (n === 'licensenumber') return `MCN-${randInt(10000,99999,r)}-IT`
  if (n === 'specialization') return pick(SPECIALIZATIONS, r)

  // Numeric types
  if (t === 'decimal' || t === 'integer') {
    if (/amount|value|price|total|cost/.test(n)) return randDec(500, 150000, r)
    if (/rate|score|pct|percent|pd/.test(n)) return randDec(0, 100, r, 1)
    if (/limit|balance|income/.test(n)) return randDec(10000, 500000, r)
    if (/weight|fee/.test(n)) return randDec(0.1, 50, r)
    if (/deductible/.test(n)) return randDec(100, 2000, r)
    if (/qty|quantity|count|level|stock/.test(n)) return randInt(0, 1000, r)
    if (/term|days|min|installment|renewals/.test(n)) return randInt(1, 120, r)
    if (/efficiency/.test(n)) return randDec(60, 99, r, 1)
    if (/rating/.test(n)) return randDec(1, 5, r, 1)
    return t === 'integer' ? randInt(1, 500, r) : randDec(1, 1000, r)
  }

  // Text
  if (t === 'text' || /notes|description|comment|protocol|factor|chronic|certif/.test(n)) {
    return ['N/A', 'Standard procedure applied', 'Pending review', 'Approved per policy', 'See attached documentation', 'Automatically generated'][Math.floor(r() * 6)]
  }

  // String fallbacks by field name
  if (/name/.test(n)) {
    if (/entity|company|firm|supplier|partner/.test(entityLabel.toLowerCase()) || /company|firm/.test(n)) return pick(COMPANIES, r)
    return pick(PEOPLE, r)
  }
  if (/product|item|med/.test(entityLabel.toLowerCase()) && n === 'name') return pick(PRODUCT_NAMES, r)
  if (/medication/.test(entityLabel.toLowerCase())) return pick(MEDS, r)
  if (/email/.test(n)) {
    const person = pick(PEOPLE, r).toLowerCase().replace(' ', '.')
    return `${person}@example.com`
  }
  if (/status|state/.test(n)) return pick(STATUSES_GEN, r)
  if (/tier|category|type|level|class/.test(n)) return pick(['Standard','Premium','Gold','Silver','Basic'], r)
  if (/code|ref|number|id$/.test(n)) return `${entityLabel.slice(0,3).toUpperCase()}-${String(index + 1).padStart(4, '0')}`
  if (/slug/.test(n)) return `category-${randInt(1, 50, r)}`
  if (/address/.test(n)) return `Via Roma ${randInt(1,200,r)}, Milano`
  if (/tracking/.test(n)) return `TRK${randInt(100000,999999,r)}`
  if (/provider|payer/.test(n)) return pick(['Generali','Allianz','UnipolSai','AXA','Zurich'], r)
  if (/plan|coverage/.test(n)) return pick(['Basic','Comprehensive','Premium Plus','Family'], r)
  if (/document/.test(n)) return pick(['Passport','ID Card','Driver License','Residence Permit'], r)
  if (/employment/.test(n)) return pick(['Employed','Self-employed','Retired','Unemployed'], r)
  if (/department/.test(n)) return pick(['Cardiology','Emergency','Surgery','Oncology','Neurology'], r)
  if (/location/.test(n)) return pick(['Ward A','Ward B','ICU','Outpatient','OR-3','ER-1'], r)
  if (/outcome/.test(n)) return pick(['Resolved','Ongoing','Improved','Referred','Pending'], r)
  if (/severity/.test(n)) return pick(['Mild','Moderate','Severe','Critical'], r)
  if (/risk/.test(n)) return pick(['Low','Medium','High','Critical'], r)
  if (/priority/.test(n)) return pick(['Low','Normal','High','Urgent'], r)
  if (/frequency|dosage|strength/.test(n)) return pick(['Once daily','Twice daily','As needed','Weekly'], r)
  if (/form/.test(n)) return pick(['Tablet','Capsule','Injection','Syrup','Patch'], r)

  return `${entityLabel}-${String.fromCharCode(65 + Math.floor(r() * 26))}${randInt(100,999,r)}`
}

// ── Public API ───────────────────────────────────────────────────────────────
export function generateMockData(node: OntologyNode, count = 15): Record<string, string | number | boolean>[] {
  return Array.from({ length: count }, (_, i) => {
    const r = seededRng((node.id.charCodeAt(0) * 31 + i) * 1234567)
    const row: Record<string, string | number | boolean> = {}
    for (const prop of node.data.properties) {
      const val = generateValue(prop, node.data.label, i, r)
      row[prop.name] = val as string | number | boolean
    }
    return row
  })
}
