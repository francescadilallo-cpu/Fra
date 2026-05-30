import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import {
  ReactFlow, Background, Controls, Handle, Position,
  type NodeProps, type Node, type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Sparkles, Send, Bot, User, CheckCircle2, XCircle, Plus, Link2,
  AlertTriangle, ShieldCheck, Wand2, Database, ChevronRight, Save, Trash2, Pencil, X, Zap,
} from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import type { OntologyNodeData, OntologyProperty, PropertyType } from '../types'
import {
  loadExtension,
  saveExtension,
  applyNodeChange,
  removeNode,
} from '../data/ontologyExtensions'
import { SECTORS } from '../data/sectors'
import { showConfirm } from './ConfirmDialog'

// ── Type color map (same as OntologyGraph) ───────────────────────────────────
const TYPE_COLORS: Record<PropertyType, string> = {
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

function inferType(name: string): PropertyType {
  const lower = name.toLowerCase()
  if (/id$|uuid/.test(lower)) return 'uuid'
  if (/date|at$|time/.test(lower)) return (lower.includes('time') || lower.endsWith('at')) ? 'datetime' : 'date'
  if (/amount|price|value|rate|score|pct|percent|decimal|weight|cost|fee|limit/.test(lower)) return 'decimal'
  if (/count|qty|quantity|number|num|level|age|days|min|max|total/.test(lower)) return 'integer'
  if (/active|enabled|flag|^is|^has/.test(lower)) return 'boolean'
  if (/notes|description|text|comment|content|body|address/.test(lower)) return 'text'
  return 'string'
}

// ── Types ───────────────────────────────────────────────────────────────────
type ChangeKind = 'add_class' | 'add_property' | 'add_relation' | 'rename'
type ChangeStatus = 'pending' | 'approved' | 'rejected'

interface PendingChange {
  id: string
  kind: ChangeKind
  status: ChangeStatus
  summary: string
  rationale: string
  // Effect on the canvas — these IDs are what approve/reject act on
  newNode?: {
    id: string
    label: string
    uri: string
    properties: OntologyProperty[]
    position: { x: number; y: number }
    db_table?: string
  }
  newEdge?: {
    id: string
    source: string
    target: string
    label: string
  }
  addPropertyTo?: { nodeId: string; property: OntologyProperty }
  warnings?: string[]
  requiresSteward?: boolean
}

// (SavedExtension + loadExtension + saveExtension are imported from ../data/ontologyExtensions)

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  suggestions?: string[]   // change-IDs proposed in this message
}

// ── Pre-canned bot intents ─────────────────────────────────────────────────-
// Each prompt produces 1+ proposed changes + assistant reply.
interface Intent {
  prompt: string
  reply: string
  changes: Omit<PendingChange, 'status'>[]
}

function buildIntents(sectorId: string, existingLabels: string[]): Intent[] {
  const has = (l: string) => existingLabels.includes(l)

  // Sector-specific suggestions
  if (sectorId === 'manufacturing') {
    return [
      {
        prompt: 'Add Supplier entity with name, VAT number, country fields',
        reply:
          'I propose a new **Supplier** class connected to **Product** via the `suppliedBy` relation. ' +
          'I checked the existing ontology: no duplicate concepts. The class will be mapped to the `suppliers` table (to be created).',
        changes: [
          {
            id: 'c-supplier',
            kind: 'add_class',
            summary: 'Add Supplier class',
            rationale: 'No existing "Supplier/Vendor" entity. New class, does not duplicate concepts.',
            newNode: {
              id: 'Supplier',
              label: 'Supplier',
              uri: 'mfg:Supplier',
              properties: [{ name: 'name', type: 'string', required: true }, { name: 'vatNumber', type: 'string', unique: true }, { name: 'country', type: 'string' }, { name: 'reliabilityScore', type: 'decimal' }],
              position: { x: 1300, y: 200 },
              db_table: 'suppliers',
            },
            requiresSteward: true,
          },
          {
            id: 'c-supplier-rel',
            kind: 'add_relation',
            summary: 'Relation: Product → suppliedBy → Supplier',
            rationale: 'Allows tracking supply per product and enables "critical suppliers" queries.',
            newEdge: { id: 'e-supplier', source: 'Product', target: 'Supplier', label: 'suppliedBy' },
          },
        ],
      },
      {
        prompt: 'I want to track production batches',
        reply:
          'I suggest a **ProductionBatch** class with `producesBatch` relation from **Order**. ' +
          'Note: Batch is the standard English manufacturing terminology.',
        changes: [
          {
            id: 'c-batch',
            kind: 'add_class',
            summary: 'Add ProductionBatch class',
            rationale: 'Central concept for batch traceability, required by EU 178/2002 (food) and MDR (medical) regulations.',
            newNode: {
              id: 'ProductionBatch',
              label: 'ProductionBatch',
              uri: 'mfg:ProductionBatch',
              properties: [{ name: 'batchNumber', type: 'string', required: true }, { name: 'producedAt', type: 'datetime' }, { name: 'quantity', type: 'integer' }, { name: 'qualityCheck', type: 'string' }],
              position: { x: 1300, y: 500 },
              db_table: 'production_batches',
            },
            requiresSteward: true,
          },
          {
            id: 'c-batch-rel',
            kind: 'add_relation',
            summary: 'Relation: Order → producesBatch → ProductionBatch',
            rationale: 'Links each batch to the order that generated it.',
            newEdge: { id: 'e-batch', source: 'Order', target: 'ProductionBatch', label: 'producesBatch' },
          },
        ],
      },
      {
        prompt: 'Add sustainabilityScore property to Product',
        reply:
          'OK, I am adding `sustainabilityScore` (decimal 0-100) as a property of **Product**. ' +
          'Does not require data steward approval (simple property, no new structure).',
        changes: [
          {
            id: 'c-sust',
            kind: 'add_property',
            summary: 'Add sustainabilityScore to Product',
            rationale: 'Numeric property, does not alter the ontology structure.',
            addPropertyTo: { nodeId: 'Product', property: { name: 'sustainabilityScore', type: 'decimal' } },
          },
        ],
      },
      {
        prompt: 'Import schema from Salesforce',
        reply:
          'I analyzed the Salesforce schema. I found 3 relevant objects, but **Account** corresponds to your existing **Customer**. ' +
          'I suggest NOT creating a duplicate — map Account→Customer.',
        changes: [
          {
            id: 'c-sf-warn',
            kind: 'rename',
            summary: 'Map Salesforce.Account → Customer (no duplicate)',
            rationale: 'Account and Customer share >80% of attributes (name, country, vatNumber). Reuse > creation.',
            warnings: [
              'I was about to create entity "Account" — duplicates existing Customer.',
              'Saved 1 redundant entity. Mapping added instead of new class.',
            ],
          },
          {
            id: 'c-opportunity',
            kind: 'add_class',
            summary: 'Add Opportunity class (CRM)',
            rationale: 'Opportunity has no equivalent in the current mfg ontology. Legitimate new class.',
            newNode: {
              id: 'Opportunity',
              label: 'Opportunity',
              uri: 'mfg:Opportunity',
              properties: [{ name: 'stage', type: 'string' }, { name: 'amount', type: 'decimal' }, { name: 'closeDate', type: 'date' }, { name: 'probability', type: 'decimal' }],
              position: { x: 100, y: 600 },
              db_table: 'sf_opportunities',
            },
            requiresSteward: true,
          },
        ],
      },
    ]
  }

  if (sectorId === 'retail') {
    return [
      {
        prompt: 'Add Loyalty Program entity',
        reply: 'I am creating **LoyaltyProgram** connected to **Customer** via `enrolledIn`. Standard pattern in retail.',
        changes: [
          {
            id: 'c-loy',
            kind: 'add_class',
            summary: 'Add LoyaltyProgram class',
            rationale: 'Concept distinct from Customer; supports multi-tier (Silver, Gold...).',
            newNode: {
              id: 'LoyaltyProgram',
              label: 'LoyaltyProgram',
              uri: 'rtl:LoyaltyProgram',
              properties: [{ name: 'programName', type: 'string', required: true }, { name: 'tier', type: 'string' }, { name: 'pointsBalance', type: 'decimal' }, { name: 'joinDate', type: 'date' }],
              position: { x: 1300, y: 200 },
              db_table: 'loyalty_programs',
            },
            requiresSteward: true,
          },
          {
            id: 'c-loy-rel',
            kind: 'add_relation',
            summary: 'Relation: Customer → enrolledIn → LoyaltyProgram',
            rationale: 'Enables queries like "Gold customers with abandoned carts > €100".',
            newEdge: { id: 'e-loy', source: 'Customer', target: 'LoyaltyProgram', label: 'enrolledIn' },
          },
        ],
      },
      {
        prompt: 'I want to map product returns',
        reply:
          'I suggest **Return** connected to **Order** via `hasReturn`. Checking if something similar already exists... no duplicates.',
        changes: [
          {
            id: 'c-return',
            kind: 'add_class',
            summary: 'Add Return class',
            rationale: 'Missing core retail concept. Necessary for reverse-logistics analytics.',
            newNode: {
              id: 'Return',
              label: 'Return',
              uri: 'rtl:Return',
              properties: [{ name: 'reason', type: 'string' }, { name: 'refundAmount', type: 'decimal' }, { name: 'returnDate', type: 'date' }, { name: 'condition', type: 'string' }],
              position: { x: 1300, y: 500 },
              db_table: 'returns',
            },
            requiresSteward: true,
          },
        ],
      },
      {
        prompt: 'Add ESG rating property to Product',
        reply: 'OK. `esgRating` as a string (A+, A, B...) on Product. Non-structural change, no steward.',
        changes: [
          {
            id: 'c-esg',
            kind: 'add_property',
            summary: 'Add esgRating to Product',
            rationale: 'Flat property, no impact on existing queries.',
            addPropertyTo: { nodeId: 'Product', property: { name: 'esgRating', type: 'string' } },
          },
        ],
      },
    ]
  }

  if (sectorId === 'healthcare') {
    return [
      {
        prompt: 'Add Insurance Plan entity',
        reply:
          'I am creating **InsurancePlan** connected to **Patient** via `coveredBy`. Aligned with HL7 FHIR `Coverage` resource.',
        changes: [
          {
            id: 'c-ins',
            kind: 'add_class',
            summary: 'Add InsurancePlan class',
            rationale: 'Maps to FHIR Coverage. Distinct from Patient, no duplicates.',
            newNode: {
              id: 'InsurancePlan',
              label: 'InsurancePlan',
              uri: 'hc:InsurancePlan',
              properties: [{ name: 'payer', type: 'string', required: true }, { name: 'policyNumber', type: 'string', unique: true }, { name: 'coverageType', type: 'string' }, { name: 'copay', type: 'decimal' }],
              position: { x: 1300, y: 200 },
              db_table: 'insurance_plans',
            },
            requiresSteward: true,
          },
          {
            id: 'c-ins-rel',
            kind: 'add_relation',
            summary: 'Relation: Patient → coveredBy → InsurancePlan',
            rationale: 'Enables billing queries and treatment routing.',
            newEdge: { id: 'e-ins', source: 'Patient', target: 'InsurancePlan', label: 'coveredBy' },
          },
        ],
      },
      {
        prompt: 'I want to track patient allergies',
        reply: 'I suggest a structured property `allergies` on Patient (JSON array). FHIR-compatible.',
        changes: [
          {
            id: 'c-allergy',
            kind: 'add_property',
            summary: 'Add allergies to Patient',
            rationale: 'Structured property, aligned with FHIR AllergyIntolerance.',
            addPropertyTo: { nodeId: 'Patient', property: { name: 'allergies', type: 'text' } },
          },
        ],
      },
    ]
  }

  // Finance
  return [
    {
      prompt: 'Add Compliance Officer entity',
      reply: 'I am creating **ComplianceOfficer** connected to **Transaction** via `reviewedBy` (for AML/KYC audit).',
      changes: [
        {
          id: 'c-co',
          kind: 'add_class',
          summary: 'Add ComplianceOfficer class',
          rationale: 'Distinct role, required for AML audit. Does not duplicate Account.',
          newNode: {
            id: 'ComplianceOfficer',
            label: 'ComplianceOfficer',
            uri: 'fin:ComplianceOfficer',
            properties: [{ name: 'name', type: 'string', required: true }, { name: 'certifications', type: 'text' }, { name: 'jurisdiction', type: 'string' }, { name: 'licensesValid', type: 'boolean' }],
            position: { x: 1300, y: 200 },
            db_table: 'compliance_officers',
          },
          requiresSteward: true,
        },
      ],
    },
    {
      prompt: 'Add riskScore property to Account',
      reply: 'OK. `riskScore` decimal 0-100. Light change, no steward.',
      changes: [
        {
          id: 'c-risk',
          kind: 'add_property',
          summary: 'Add riskScore to Account',
          rationale: 'Property computed by existing AI model.',
          addPropertyTo: { nodeId: 'Account', property: { name: 'riskScore', type: 'decimal' as PropertyType } },
        },
      ],
    },
  ]
  void has // unused — silences linter
}

// ── Custom node ─────────────────────────────────────────────────────────────
interface BuilderNodeData extends OntologyNodeData {
  state?: 'existing' | 'pending' | 'approved'
}

function BuilderNode({ data, selected }: NodeProps) {
  const d = data as unknown as BuilderNodeData
  const state = d.state ?? 'existing'

  const ring =
    state === 'pending'
      ? 'border-amber-400 border-dashed bg-amber-50/50 ring-2 ring-amber-100'
      : state === 'approved'
        ? 'border-teal-400 bg-teal-50/40 ring-2 ring-teal-100'
        : selected
          ? 'border-teal-500 shadow-lg'
          : 'border-slate-200 hover:border-slate-300'

  return (
    <div className={`min-w-[170px] rounded-xl border transition-all bg-white ${ring}`}>
      <Handle type="target" position={Position.Top} className="!bg-teal-500 !border-0 !w-2.5 !h-2.5" />
      <div className="px-3 py-2 bg-slate-50 rounded-t-xl border-b border-slate-200 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-900">{d.label}</p>
          {d.db_table && (
            <div className="flex items-center gap-1 mt-0.5">
              <Database className="w-3 h-3 text-teal-600" />
              <span className="text-xs text-teal-700 font-mono">{d.db_table}</span>
            </div>
          )}
        </div>
        {state === 'pending' && (
          <span className="text-[9px] font-bold bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 leading-none flex-shrink-0">
            PENDING
          </span>
        )}
        {state === 'approved' && (
          <span className="text-[9px] font-bold bg-teal-100 text-teal-700 rounded px-1.5 py-0.5 leading-none flex-shrink-0">
            NEW
          </span>
        )}
      </div>
      <div className="px-3 py-2 space-y-0.5">
        {d.properties.slice(0, 5).map((p) => (
          <div key={p.name} className="text-xs text-slate-500 flex items-center gap-1">
            <span className="text-slate-400">·</span>
            <span>{p.name}</span>
            <span className={`text-[9px] font-mono px-1 rounded ${TYPE_COLORS[p.type] ?? 'bg-slate-100 text-slate-500'}`}>{p.type}</span>
          </div>
        ))}
        {d.properties.length > 5 && (
          <div className="text-xs text-slate-400">+{d.properties.length - 5} more</div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-teal-500 !border-0 !w-2.5 !h-2.5" />
    </div>
  )
}
const nodeTypes = { builderNode: BuilderNode }

// ── Helpers ─────────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 9)
}

// Italianize entity name to PascalCase English-ish (best effort for demo).
function normalizeEntityName(raw: string): string {
  // Map common Italian → English
  const map: Record<string, string> = {
    fornitore: 'Supplier', fornitori: 'Supplier',
    cliente: 'Customer', clienti: 'Customer',
    prodotto: 'Product', prodotti: 'Product',
    ordine: 'Order', ordini: 'Order',
    fattura: 'Invoice', fatture: 'Invoice',
    pagamento: 'Payment', pagamenti: 'Payment',
    spedizione: 'Shipment', spedizioni: 'Shipment',
    magazzino: 'Warehouse', magazzini: 'Warehouse',
    dipendente: 'Employee', dipendenti: 'Employee',
    contratto: 'Contract', contratti: 'Contract',
    progetto: 'Project', progetti: 'Project',
    paziente: 'Patient', pazienti: 'Patient',
    medico: 'Doctor', medici: 'Doctor',
    'medico curante': 'Physician',
    diagnosi: 'Diagnosis',
    trattamento: 'Treatment', trattamenti: 'Treatment',
    farmaco: 'Medication', farmaci: 'Medication',
    appuntamento: 'Appointment', appuntamenti: 'Appointment',
    reso: 'Return', resi: 'Return',
    carrello: 'Cart', carrelli: 'Cart',
    promozione: 'Promotion', promozioni: 'Promotion',
    sconto: 'Discount', sconti: 'Discount',
    transazione: 'Transaction', transazioni: 'Transaction',
    conto: 'Account', conti: 'Account',
    rischio: 'Risk',
    audit: 'Audit',
    lotto: 'Batch', lotti: 'Batch',
    macchina: 'Machine', macchinario: 'Machine', macchinari: 'Machine',
    stabilimento: 'Plant', stabilimenti: 'Plant',
  }
  const lower = raw.toLowerCase().trim()
  if (map[lower]) return map[lower]
  // Else: PascalCase the raw input
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('')
    .replace(/[^A-Za-z0-9]/g, '')
}

// Italian → English property names (camelCase).
function normalizeProperty(raw: string): string {
  const map: Record<string, string> = {
    nome: 'name',
    'p.iva': 'vatNumber', piva: 'vatNumber', 'partita iva': 'vatNumber',
    paese: 'country', nazione: 'country',
    indirizzo: 'address',
    email: 'email', telefono: 'phone',
    prezzo: 'price', importo: 'amount', totale: 'totalAmount',
    quantità: 'quantity', quantita: 'quantity',
    data: 'date', stato: 'status',
    codice: 'code', categoria: 'category',
    descrizione: 'description', note: 'notes',
    sku: 'sku',
  }
  const lower = raw.toLowerCase().trim()
  if (map[lower]) return map[lower]
  return raw
    .trim()
    .split(/\s+/)
    .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('')
    .replace(/[^A-Za-z0-9]/g, '')
}

interface ParsedIntent {
  reply: string
  changes: Omit<PendingChange, 'status'>[]
}

// Italian/English stopwords to ignore when extracting candidate nouns.
const STOPWORDS = new Set([
  'il','lo','la','i','gli','le','un','una','uno','dei','degli','delle','un\'','di','del','della','dello','dei','delle',
  'a','al','allo','alla','ai','agli','alle','con','su','per','tra','fra','che','e','o','ma','se','non','è','sono',
  'voglio','vorrei','puoi','puo','potresti','mi','serve','servono','bisogno','ho','hai','dobbiamo',
  'creare','crea','aggiungi','aggiungere','aggiungere','definisci','modella','tracciare','gestire','mappare','registrare',
  'entità','entita','classe','class','entity','tabella','table','nuova','nuovo','un\'entità','un\'entita',
  'campo','attributo','proprietà','proprieta','property','propriet','property','attribute','field',
  'relazione','relation','collega','connetti','collegata','collegato','collegamento','link','associa','riferimento',
  'in','dal','dalla','dai','dalle','sulla','sullo','sul','sui','sugli','sulle',
  'the','a','an','to','from','of','for','with','and','or','but','want','need','new','add','create','model','track','manage','map',
  'questo','questa','questi','queste','quello','quella','quegli','quelle','chiamata','chiamato','chiamati','denominata','denominato',
  'azienda','company','customer','user','utente','sistema','system',
])

const VERB_NEW = ['aggiungi','aggiungere','crea','creare','add','new','definisci','modella','introduci','registra','inserisci']
const VERB_WANT = ['voglio','vorrei','want','need','serve','bisogno','dobbiamo','poter','poss','mi piacerebbe']
const VERB_TRACK = ['tracciare','mappare','gestire','seguire','monitorare','track','map','model','manage','catturare','salvare','memorizzare']
const VERB_LINK = ['collega','connetti','associa','link','connect','relate','riferimento','riferisci','metti in relazione']
const NOUN_ENTITY = ['entità','entita','classe','class','entity','tabella','table','oggetto','object','concept','concetto','tipo','model']

function containsAny(text: string, words: string[]) {
  return words.some((w) => text.includes(w))
}

// Extract candidate entity names from raw text.
// Strategy: tokenize, drop stopwords, prefer PascalCase or capitalized words, keep singular nouns.
function extractCandidateNouns(text: string): string[] {
  // Strip punctuation, normalize
  const cleaned = text.replace(/[.,;:!?()\[\]"]+/g, ' ').replace(/\s+/g, ' ').trim()
  const tokens = cleaned.split(' ')
  const candidates: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    const lower = tok.toLowerCase()
    if (tok.length < 3) continue
    if (STOPWORDS.has(lower)) continue
    if (lower.endsWith('mente')) continue                 // adverbs
    if (/^[0-9]+$/.test(tok)) continue                    // numbers
    // Prefer capitalized or PascalCase tokens
    candidates.push(tok)
  }
  return candidates
}

// Find an existing class label/id in the text (loose match).
function findExistingMention(text: string, existing: { id: string; label: string }[]): { id: string; label: string } | null {
  const lower = text.toLowerCase()
  for (const e of existing) {
    const lbl = e.label.toLowerCase()
    if (lower.includes(lbl)) return e
    // Italian synonyms (basic)
    const ita: Record<string, string[]> = {
      customer: ['cliente','clienti'],
      product: ['prodotto','prodotti'],
      order: ['ordine','ordini'],
      quote: ['preventivo','preventivi'],
      patient: ['paziente','pazienti'],
      doctor: ['medico','medici'],
      account: ['conto','conti'],
      transaction: ['transazione','transazioni'],
    }
    const syns = ita[lbl] ?? []
    if (syns.some((s) => lower.includes(s))) return e
  }
  return null
}

// Dynamic NLP-style parser for arbitrary user prompts.
function parseUserPrompt(
  text: string,
  sectorId: string,
  existing: { id: string; label: string }[],
): ParsedIntent | null {
  const lower = text.toLowerCase().trim()
  const prefix = sectorId === 'manufacturing' ? 'mfg' : sectorId === 'retail' ? 'rtl' : sectorId === 'healthcare' ? 'hc' : 'fin'

  // ── 1) Add property to entity ───────────────────────────────────────────
  // "aggiungi proprietà X a Y" / "aggiungi X a Y" / "Y deve avere X" /
  // "Y con campo X" / "aggiungi a Y un campo X"
  const propPatterns = [
    /(?:aggiungi|aggiungere|add)\s+(?:la\s+|una\s+|il\s+|un\s+)?(?:proprietà|proprieta|property|campo|attributo|attribute|field)\s+([a-zA-Zà-ù0-9_ ]+?)\s+(?:a|to|su|on|in|al|alla|allo|sulla|sullo)\s+([A-Za-zà-ù][A-Za-zà-ù0-9_]+)/i,
    /(?:aggiungi|add)\s+(?:a|to|al|alla|allo|su|sulla)\s+([A-Za-zà-ù][A-Za-zà-ù0-9_]+)\s+(?:una|un|la|il)?\s*(?:proprietà|proprieta|property|campo|attributo|attribute|field)\s+([a-zA-Zà-ù0-9_ ]+)/i,
    /([A-Za-zà-ù][A-Za-zà-ù0-9_]+)\s+(?:deve avere|deve contenere|has|ha|with|con campo|con la proprietà|con proprietà)\s+(?:il|la|un|una|the)?\s*([a-zA-Zà-ù0-9_ ]+)/i,
  ]
  for (const re of propPatterns) {
    const m = text.match(re)
    if (m) {
      // pattern 2 has entity in group 1, property in group 2; others have property in 1, entity in 2
      const reverseOrder = re === propPatterns[1]
      const propRaw = (reverseOrder ? m[2] : m[1]).trim()
      const entityRaw = (reverseOrder ? m[1] : m[2]).trim()
      const found = existing.find(
        (e) => e.label.toLowerCase() === entityRaw.toLowerCase() || e.id.toLowerCase() === entityRaw.toLowerCase(),
      )
      if (found && propRaw.length < 40 && propRaw.length > 1) {
        const propName = normalizeProperty(propRaw)
        const prop: OntologyProperty = { name: propName, type: inferType(propName) }
        return {
          reply:
            `I am adding the property \`${propName}\` to **${found.label}**. ` +
            'Light change (property, not structure): does not require data steward approval.',
          changes: [{
            id: `c-${uid()}`,
            kind: 'add_property',
            summary: `Add ${propName} to ${found.label}`,
            rationale: `Flat property on ${found.label}. Does not alter existing relations, no impact on queries.`,
            addPropertyTo: { nodeId: found.id, property: prop },
          }],
        }
      }
    }
  }

  // ── 2) Link/connect two entities ────────────────────────────────────────
  const relPatterns = [
    /(?:collega|connetti|link|associa|relate|metti in relazione)\s+([A-Za-zà-ù][A-Za-zà-ù0-9_]+)\s+(?:a|con|to|and|e|al|alla|allo)\s+([A-Za-zà-ù][A-Za-zà-ù0-9_]+)/i,
    /([A-Za-zà-ù][A-Za-zà-ù0-9_]+)\s+(?:è collegato|è collegata|collegato|collegata|connesso|connessa|linked|related|ha un|ha una|has)\s+(?:a|al|alla|allo|to|con|ad un|ad una)\s+([A-Za-zà-ù][A-Za-zà-ù0-9_]+)/i,
    /(?:relazione|relation|legame|link)\s+(?:tra|between|fra)?\s*([A-Za-zà-ù][A-Za-zà-ù0-9_]+)\s+(?:e|and|a|con)\s+([A-Za-zà-ù][A-Za-zà-ù0-9_]+)/i,
  ]
  for (const re of relPatterns) {
    const m = text.match(re)
    if (m) {
      const srcRaw = m[1].trim()
      const dstRaw = m[2].trim()
      const src = existing.find((e) => e.label.toLowerCase() === srcRaw.toLowerCase() || e.id.toLowerCase() === srcRaw.toLowerCase())
      const dst = existing.find((e) => e.label.toLowerCase() === dstRaw.toLowerCase() || e.id.toLowerCase() === dstRaw.toLowerCase())
      if (src && dst && src.id !== dst.id) {
        const label = `has${dst.label}`
        return {
          reply:
            `I am creating a relation **${src.label} → ${label} → ${dst.label}**. ` +
            'Checking the ontology: no duplicate relations.',
          changes: [{
            id: `c-${uid()}`,
            kind: 'add_relation',
            summary: `Relation: ${src.label} → ${label} → ${dst.label}`,
            rationale: `Connects the two existing entities. Enables cross queries ${src.label}/${dst.label}.`,
            newEdge: { id: `e-${uid()}`, source: src.id, target: dst.id, label },
          }],
        }
      }
    }
  }

  // ── 3) Rename ────────────────────────────────────────────────────────────
  const renPatterns = [
    /(?:rinomina|rename|cambia nome|cambia il nome di)\s+([A-Za-zà-ù][A-Za-zà-ù0-9_]+)\s+(?:in|to|a|come)\s+([A-Za-zà-ù][A-Za-zà-ù0-9_ ]+)/i,
  ]
  for (const re of renPatterns) {
    const m = text.match(re)
    if (m) {
      const oldName = m[1].trim()
      const newName = normalizeEntityName(m[2].trim())
      const found = existing.find((e) => e.label.toLowerCase() === oldName.toLowerCase())
      if (found) {
        return {
          reply:
            `I am renaming **${found.label}** to **${newName}**. ` +
            'Note: all mappings and queries referencing the class will be updated. Requires data steward.',
          changes: [{
            id: `c-${uid()}`,
            kind: 'rename',
            summary: `Rename ${found.label} → ${newName}`,
            rationale: 'Structural change: impacts SPARQL queries, DB mappings and MCP tools. Backup required.',
            requiresSteward: true,
            warnings: [`${existing.length} mappings may require updating.`],
          }],
        }
      }
    }
  }

  // ── 4) Add new entity/class — many phrasings ────────────────────────────
  // High-precision: "aggiungi entità/classe/tabella X [con prop, prop]"
  // Also: "chiamata/chiamato X", "voglio tracciare X", "modella X", just "X" (single noun)
  const entPatterns = [
    /(?:aggiungi|aggiungere|crea|creare|definisci|modella|introduci|inserisci|registra|add|new|create|model|define|introduce)\s+(?:una\s+|un\s+|la\s+|il\s+|the\s+|new\s+)?(?:entità|entita|classe|class|entity|tabella|table|oggetto|object|tipo|concept|concetto|nodo|node)\s+(?:chiamata\s+|chiamato\s+|denominata\s+|denominato\s+|named\s+|called\s+)?([A-Za-zà-ù][A-Za-zà-ù0-9_ ]*?)(?:\s+(?:con|with|che ha|avente|che contiene)\s+([a-zA-Zà-ù0-9_, ]+))?\s*$/i,
    /(?:voglio|vorrei|i want|want to|need to|mi serve|mi servirebbe|mi piacerebbe|dobbiamo|posso)\s+(?:.{0,40}?)(?:tracciare|mappare|gestire|monitorare|seguire|catturare|memorizzare|salvare|registrare|model(?:lare)?|track|map|manage|monitor)\s+(?:i\s+|le\s+|gli\s+|the\s+|una\s+|un\s+)?([A-Za-zà-ù][A-Za-zà-ù0-9_ ]*?)\s*$/i,
    /(?:una|un|new)\s+(?:nuova\s+|nuovo\s+|new\s+)?(?:entità|entita|classe|class|entity|tabella|table)\s+(?:chiamata\s+|chiamato\s+|named\s+|called\s+|denominata\s+|denominato\s+|per\s+(?:i|le|gli)?\s*)?([A-Za-zà-ù][A-Za-zà-ù0-9_ ]*?)(?:\s+(?:con|with)\s+([a-zA-Zà-ù0-9_, ]+))?\s*$/i,
    /(?:aggiungi|aggiungere|add|crea|creare|create|new)\s+([A-Za-zà-ù][A-Za-zà-ù0-9_ ]*?)(?:\s+(?:con|with)\s+([a-zA-Zà-ù0-9_, ]+))?\s*$/i,
  ]
  for (const re of entPatterns) {
    const m = text.match(re)
    if (m) {
      const nameRaw = (m[1] || '').trim()
      const propsRaw = ((m[2] || '')).trim()
      if (nameRaw.length < 2 || nameRaw.length > 50) continue
      // Reject if name is just a stopword/verb
      const firstTok = nameRaw.split(/\s+/)[0].toLowerCase()
      if (STOPWORDS.has(firstTok)) continue
      // Reject if name is the name of an existing relation/property (e.g. "una relazione")
      if (containsAny(firstTok, ['relazione','relation','property','proprietà'])) continue
      return buildAddClassIntent(nameRaw, propsRaw, sectorId, prefix, existing)
    }
  }

  // ── 5) Smart fallback: extract candidate noun, propose creation ──────────
  // If user mentions an existing class + a verb, try to interpret.
  const mentionedExisting = findExistingMention(lower, existing)
  if (mentionedExisting && (containsAny(lower, VERB_LINK) || lower.includes('relazione'))) {
    // Try to find a second noun to link to
    const candidates = extractCandidateNouns(text).filter(
      (c) => c.toLowerCase() !== mentionedExisting.label.toLowerCase(),
    )
    if (candidates.length > 0) {
      // Propose a new class + relation
      const otherName = normalizeEntityName(candidates[0])
      if (!existing.find((e) => e.label.toLowerCase() === otherName.toLowerCase())) {
        return buildAddClassWithLinkIntent(otherName, mentionedExisting, sectorId, prefix, existing)
      }
    }
  }

  // ── 6) Last resort: any candidate noun → propose creating it ────────────
  if (
    containsAny(lower, VERB_NEW) ||
    containsAny(lower, VERB_WANT) ||
    containsAny(lower, VERB_TRACK) ||
    containsAny(lower, NOUN_ENTITY)
  ) {
    const candidates = extractCandidateNouns(text)
    // Pick the best candidate: capitalized word, or last meaningful noun
    const best = candidates.find((c) => /^[A-ZÀ-Ù]/.test(c)) ?? candidates[candidates.length - 1]
    if (best && best.length > 2 && best.length < 30) {
      return buildAddClassIntent(best, '', sectorId, prefix, existing, /*lowConfidence*/ true)
    }
  }

  return null
}

// ── Helper builders for class-creation intents ─────────────────────────────
function buildAddClassIntent(
  nameRaw: string,
  propsRaw: string,
  sectorId: string,
  prefix: string,
  existing: { id: string; label: string }[],
  lowConfidence = false,
): ParsedIntent {
  const name = normalizeEntityName(nameRaw)
  const dup = existing.find((e) => e.label.toLowerCase() === name.toLowerCase())
  if (dup) {
    return {
      reply:
        `I was about to create **${name}** but it already exists in the ${sectorId} ontology. ` +
        'I suggest reusing the existing class instead of duplicating (ontology governance).',
      changes: [{
        id: `c-${uid()}`,
        kind: 'rename',
        summary: `Reuse existing ${name} (no duplicate)`,
        rationale: `The class ${name} is already present. Creating a duplicate would generate inconsistencies in mappings.`,
        warnings: [
          `Class "${name}" already exists — duplicate avoided.`,
          `You can add properties or relations to the existing class.`,
        ],
      }],
    }
  }
  const propNames: string[] = propsRaw
    ? propsRaw
        .split(/[,;]| e | and /)
        .map((p) => normalizeProperty(p.trim()))
        .filter((p) => p.length > 0)
        .slice(0, 8)
    : ['name', 'code', 'createdAt']
  const props: OntologyProperty[] = propNames.map((n) => ({ name: n, type: inferType(n) }))

  const maxX = existing.length > 0 ? 1300 : 100
  const yOffset = 200 + (existing.length % 3) * 300

  const replyPrefix = lowConfidence
    ? `I interpreted your message as a request to create a new class **${name}**. If that's not what you wanted, let me know. `
    : ''

  return {
    reply:
      replyPrefix +
      `I propose a new class **${name}** with ${props.length} properties: ` +
      `${props.map((p) => `\`${p.name}\``).join(', ')}. ` +
      `Verified: no duplicate concept in the ${sectorId} ontology. ` +
      'Structural change — requires data steward approval.',
    changes: [{
      id: `c-${uid()}`,
      kind: 'add_class',
      summary: `Add ${name} class`,
      rationale: `New non-duplicate entity. ${props.length} properties derived from the description. URI: ${prefix}:${name}.`,
      newNode: {
        id: name,
        label: name,
        uri: `${prefix}:${name}`,
        properties: props,
        position: { x: maxX, y: yOffset },
        db_table: name.toLowerCase() + 's',
      },
      requiresSteward: true,
    }],
  }
}

function buildAddClassWithLinkIntent(
  name: string,
  linkTo: { id: string; label: string },
  sectorId: string,
  prefix: string,
  existing: { id: string; label: string }[],
): ParsedIntent {
  const base = buildAddClassIntent(name, '', sectorId, prefix, existing)
  if (base.changes[0].kind !== 'add_class') return base
  const relLabel = `has${name}`
  base.changes.push({
    id: `c-${uid()}`,
    kind: 'add_relation',
    summary: `Relation: ${linkTo.label} → ${relLabel} → ${name}`,
    rationale: `Connects the new class ${name} to ${linkTo.label}.`,
    newEdge: { id: `e-${uid()}`, source: linkTo.id, target: name, label: relLabel },
  })
  base.reply =
    `I am creating a new class **${name}** and connecting it to **${linkTo.label}** via \`${relLabel}\`. ` +
    'Structural change — requires data steward approval.'
  return base
}

// Build initial canvas state by merging sector ontology + saved extensions
function buildInitialState(sector: { ontology: { nodes: { id: string; type: string; position: { x: number; y: number }; data: OntologyNodeData }[]; edges: { id: string; source: string; target: string; label: string; type: string; animated: boolean; style: Record<string, string | number>; labelStyle: Record<string, string | number> }[] } }, sectorId: string): { nodes: Node[]; edges: Edge[] } {
  const ext = loadExtension(sectorId)

  // Base nodes (possibly with extra properties added via builder)
  const baseNodes: Node[] = sector.ontology.nodes.map((n) => {
    const extraProps: OntologyProperty[] = ext.addedProperties
      .filter((p) => p.nodeId === n.id)
      .map((p) => typeof p.property === 'string' ? { name: p.property, type: 'string' as PropertyType } : p.property)
    return {
      id: n.id,
      type: 'builderNode',
      position: n.position,
      data: {
        ...n.data,
        properties: [...n.data.properties, ...extraProps],
        state: 'existing',
      },
    }
  })

  // Saved (approved) extension nodes
  const extNodes: Node[] = ext.nodes.map((n) => ({
    id: n.id,
    type: 'builderNode',
    position: n.position,
    data: {
      label: n.label,
      uri: n.uri,
      db_table: n.db_table ?? null,
      row_count: 0,
      properties: n.properties.map((p): OntologyProperty => typeof p === 'string' ? { name: p, type: 'string' } : p),
      state: 'existing',
    },
  }))

  const baseEdges: Edge[] = sector.ontology.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: 'smoothstep',
    animated: e.animated,
    style: e.style,
    labelStyle: e.labelStyle,
  }))

  const extEdges: Edge[] = ext.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: 'smoothstep',
    animated: true,
    style: { stroke: '#0D9488' },
    labelStyle: { fill: '#0D9488', fontSize: 11 },
  }))

  return { nodes: [...baseNodes, ...extNodes], edges: [...baseEdges, ...extEdges] }
}

// ── Main component ──────────────────────────────────────────────────────────
export default function OntologyBuilder() {
  const { sector, sectorId } = useSector()

  const initial = useMemo(() => buildInitialState(sector, sectorId), [sector, sectorId])
  const [nodes, setNodes] = useState<Node[]>(initial.nodes)
  const [edges, setEdges] = useState<Edge[]>(initial.edges)

  // Reset (reload from storage) when sector changes
  const lastSectorRef = useRef(sectorId)
  useEffect(() => {
    if (lastSectorRef.current !== sectorId) {
      lastSectorRef.current = sectorId
      const s = buildInitialState(sector, sectorId)
      setNodes(s.nodes)
      setEdges(s.edges)
      setMessages([WELCOME])
      setPending([])
    }
  }, [sectorId, sector])

  const WELCOME: ChatMessage = useMemo(
    () => ({
      id: 'm-welcome',
      role: 'assistant',
      text:
        `Hi! I am the Ontology Builder AI. I can help you modify the **${sector.name}** ontology in natural language. ` +
        'Describe a new entity, relation, or property — I propose changes and you approve.',
    }),
    [sector.name],
  )

  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME])
  const [pending, setPending] = useState<PendingChange[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)

  const intents = useMemo(
    () => buildIntents(sectorId, nodes.map((n) => (n.data as unknown as BuilderNodeData).label)),
    [sectorId, nodes],
  )

  const send = useCallback(
    (text: string) => {
      if (!text.trim()) return
      const userMsg: ChatMessage = { id: uid(), role: 'user', text }
      setMessages((m) => [...m, userMsg])
      setInput('')
      setThinking(true)

      // 1) Try canned intent (exact-ish match on quick prompts)
      const cannedMatch = intents.find((it) =>
        text.toLowerCase().trim() === it.prompt.toLowerCase().trim()
      ) ?? intents.find((it) =>
        text.toLowerCase().includes(it.prompt.toLowerCase().slice(0, 25))
      )
      // 2) Dynamic NLP parser fallback
      const existingForParser = nodes.map((n) => ({
        id: n.id,
        label: (n.data as unknown as BuilderNodeData).label,
      }))
      const parsed = cannedMatch
        ? { reply: cannedMatch.reply, changes: cannedMatch.changes }
        : parseUserPrompt(text, sectorId, existingForParser)

      window.setTimeout(() => {
        if (parsed) {
          const matched = parsed
          const changesWithStatus: PendingChange[] = matched.changes.map((c) => ({
            ...c,
            status: 'pending',
          }))
          setPending((p) => [...p, ...changesWithStatus])
          setMessages((m) => [
            ...m,
            {
              id: uid(),
              role: 'assistant',
              text: matched.reply,
              suggestions: changesWithStatus.map((c) => c.id),
            },
          ])
          // Add pending nodes/edges to canvas
          changesWithStatus.forEach((c) => {
            if (c.newNode) {
              const newNode: Node = {
                id: c.newNode.id,
                type: 'builderNode',
                position: c.newNode.position,
                data: {
                  label: c.newNode.label,
                  uri: c.newNode.uri,
                  db_table: c.newNode.db_table ?? null,
                  row_count: 0,
                  properties: c.newNode.properties,
                  state: 'pending',
                },
              }
              setNodes((nds) => [...nds, newNode])
            }
            if (c.newEdge) {
              setEdges((eds) => [
                ...eds,
                {
                  id: c.newEdge!.id,
                  source: c.newEdge!.source,
                  target: c.newEdge!.target,
                  label: c.newEdge!.label,
                  type: 'smoothstep',
                  animated: true,
                  style: { stroke: '#F59E0B', strokeDasharray: '5 5' },
                  labelStyle: { fill: '#B45309', fontSize: 11 },
                },
              ])
            }
            if (c.addPropertyTo) {
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === c.addPropertyTo!.nodeId
                    ? {
                        ...n,
                        data: {
                          ...(n.data as unknown as BuilderNodeData),
                          properties: [
                            ...(n.data as unknown as BuilderNodeData).properties,
                            c.addPropertyTo!.property,
                          ],
                          state: 'pending',
                        },
                      }
                    : n,
                ),
              )
            }
          })
        } else {
          // Try to extract a candidate noun for a helpful follow-up
          const candidates = extractCandidateNouns(text).filter((c) => c.length > 2)
          const guess = candidates[0]
          const hint = guess
            ? `Maybe you want to create a new entity called **${normalizeEntityName(guess)}**? If so, type: "add entity ${guess}".`
            : 'Try phrases like: "add Warehouse entity with code, address" or "link Customer to Product".'
          setMessages((m) => [
            ...m,
            {
              id: uid(),
              role: 'assistant',
              text:
                `I am not sure yet what you want to do. ${hint}\n\n` +
                'I understand these patterns:\n' +
                '· **Create class:** "add entity X [with prop1, prop2]"\n' +
                '· **Add property:** "add price to Product"\n' +
                '· **Link entities:** "link Customer to Order"\n' +
                '· **Rename:** "rename Order to PurchaseOrder"',
            },
          ])
        }
        setThinking(false)
      }, 650)
    },
    [intents],
  )

  const approve = useCallback((changeId: string) => {
    const change = pending.find((c) => c.id === changeId)
    if (!change) return

    // Update pending status
    setPending((p) => p.map((c) => (c.id === changeId ? { ...c, status: 'approved' } : c)))

    // Mark the specific node/edge for this change as approved (visual)
    if (change.newNode) {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === change.newNode!.id
            ? { ...n, data: { ...(n.data as unknown as BuilderNodeData), state: 'approved' } }
            : n,
        ),
      )
    }
    if (change.newEdge) {
      setEdges((eds) =>
        eds.map((e) =>
          e.id === change.newEdge!.id
            ? { ...e, style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 } }
            : e,
        ),
      )
    }
    if (change.addPropertyTo) {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === change.addPropertyTo!.nodeId
            ? { ...n, data: { ...(n.data as unknown as BuilderNodeData), state: 'existing' } }
            : n,
        ),
      )
    }

    // Persist to localStorage
    const ext = loadExtension(sectorId)
    if (change.newNode) {
      const exists = ext.nodes.some((n) => n.id === change.newNode!.id)
      if (!exists) {
        ext.nodes.push({
          id: change.newNode.id,
          label: change.newNode.label,
          uri: change.newNode.uri,
          properties: change.newNode.properties,
          position: change.newNode.position,
          db_table: change.newNode.db_table,
        })
      }
    }
    if (change.newEdge) {
      const exists = ext.edges.some((e) => e.id === change.newEdge!.id)
      if (!exists) {
        ext.edges.push({
          id: change.newEdge.id,
          source: change.newEdge.source,
          target: change.newEdge.target,
          label: change.newEdge.label,
        })
      }
    }
    if (change.addPropertyTo) {
      ext.addedProperties.push({
        nodeId: change.addPropertyTo.nodeId,
        property: change.addPropertyTo.property,
      })
    }
    saveExtension(sectorId, ext)
    if (change.newNode) {
      window.dispatchEvent(new CustomEvent('ontology-entity-added', {
        detail: { entity: change.newNode.label },
      }))
    }
  }, [pending, sectorId])

  const reject = useCallback((changeId: string) => {
    const change = pending.find((c) => c.id === changeId)
    if (!change) return

    setPending((p) => p.filter((c) => c.id !== changeId))

    if (change.newNode) {
      setNodes((nds) => nds.filter((n) => n.id !== change.newNode!.id))
      // Also remove edges that referenced this node
      setEdges((eds) => eds.filter((e) => e.source !== change.newNode!.id && e.target !== change.newNode!.id))
    }
    if (change.newEdge) {
      setEdges((eds) => eds.filter((e) => e.id !== change.newEdge!.id))
    }
    if (change.addPropertyTo) {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === change.addPropertyTo!.nodeId
            ? {
                ...n,
                data: {
                  ...(n.data as unknown as BuilderNodeData),
                  properties: (n.data as unknown as BuilderNodeData).properties.filter(
                    (p) => p.name !== change.addPropertyTo!.property.name,
                  ),
                  state: 'existing',
                },
              }
            : n,
        ),
      )
    }
  }, [pending])

  const approveAll = useCallback(() => {
    const toApprove = pending.filter((c) => c.status === 'pending')
    toApprove.forEach((c) => approve(c.id))
  }, [pending, approve])

  const clearExtensions = useCallback(async () => {
    const ok = await showConfirm(`All custom extensions for ${sector.name} will be permanently removed.`, { title: 'Reset ontology?', dangerous: true })
    if (!ok) return
    saveExtension(sectorId, { nodes: [], edges: [], addedProperties: [] })
    const s = buildInitialState(sector, sectorId)
    setNodes(s.nodes)
    setEdges(s.edges)
    setPending([])
  }, [sectorId, sector])

  // ── Editing an existing entity (canvas node click) ─────────────────────
  const [editingEntity, setEditingEntity] = useState<{
    nodeId: string
    label: string
    db_table: string | null
    properties: OntologyProperty[]
    isBaseNode: boolean
  } | null>(null)

  const onNodeClickCanvas = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const data = node.data as unknown as BuilderNodeData
      // Don't open editor for pending nodes — those go through the change card flow
      if (data.state === 'pending') return
      const isBaseNode = SECTORS[sectorId].ontology.nodes.some((n) => n.id === node.id)
      setEditingEntity({
        nodeId: node.id,
        label: data.label,
        db_table: data.db_table ?? null,
        properties: data.properties,
        isBaseNode,
      })
    },
    [sectorId],
  )

  const saveEntity = useCallback(
    (patch: { label: string; db_table: string | null; properties: OntologyProperty[] }) => {
      if (!editingEntity) return
      applyNodeChange(sectorId, editingEntity.nodeId, patch, editingEntity.isBaseNode)
      // Reload canvas from storage to reflect the change
      const s = buildInitialState(sector, sectorId)
      setNodes(s.nodes)
      setEdges(s.edges)
      setEditingEntity(null)
    },
    [editingEntity, sector, sectorId],
  )

  const deleteEntity = useCallback(async () => {
    if (!editingEntity) return
    const ok = await showConfirm(`Relations involving "${editingEntity.label}" will also be removed.`, { title: `Delete "${editingEntity.label}"?`, dangerous: true })
    if (!ok) return
    removeNode(sectorId, editingEntity.nodeId, editingEntity.isBaseNode)
    const s = buildInitialState(sector, sectorId)
    setNodes(s.nodes)
    setEdges(s.edges)
    setEditingEntity(null)
  }, [editingEntity, sector, sectorId])

  // ── Editing a pending change ───────────────────────────────────────────-
  const [editingChange, setEditingChange] = useState<PendingChange | null>(null)

  const updateChange = useCallback((updated: PendingChange) => {
    const previous = pending.find((c) => c.id === updated.id)
    if (!previous) return

    // Update the pending change itself
    setPending((p) => p.map((c) => (c.id === updated.id ? updated : c)))

    // Sync canvas: replace previous node/edge with updated values.
    if (previous.newNode && updated.newNode) {
      const prevId = previous.newNode.id
      const newId = updated.newNode.id
      setNodes((nds) =>
        nds.map((n) =>
          n.id === prevId
            ? {
                id: newId,
                type: 'builderNode',
                position: updated.newNode!.position,
                data: {
                  label: updated.newNode!.label,
                  uri: updated.newNode!.uri,
                  db_table: updated.newNode!.db_table ?? null,
                  row_count: 0,
                  properties: updated.newNode!.properties,
                  state: 'pending',
                },
              }
            : n,
        ),
      )
      // Update any edges referencing the renamed node
      if (prevId !== newId) {
        setEdges((eds) =>
          eds.map((e) => ({
            ...e,
            source: e.source === prevId ? newId : e.source,
            target: e.target === prevId ? newId : e.target,
          })),
        )
      }
    }
    if (previous.newEdge && updated.newEdge) {
      const prevId = previous.newEdge.id
      setEdges((eds) =>
        eds.map((e) =>
          e.id === prevId
            ? {
                id: updated.newEdge!.id,
                source: updated.newEdge!.source,
                target: updated.newEdge!.target,
                label: updated.newEdge!.label,
                type: 'smoothstep',
                animated: true,
                style: { stroke: '#F59E0B', strokeDasharray: '5 5' },
                labelStyle: { fill: '#B45309', fontSize: 11 },
              }
            : e,
        ),
      )
    }
    if (previous.addPropertyTo && updated.addPropertyTo) {
      // Replace old property with new one on the target node
      const prev = previous.addPropertyTo
      const next = updated.addPropertyTo
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === prev.nodeId) {
            const data = n.data as unknown as BuilderNodeData
            const filtered = data.properties.filter((p) => p.name !== prev.property.name)
            return n.id === next.nodeId
              ? { ...n, data: { ...data, properties: [...filtered, next.property], state: 'pending' } }
              : { ...n, data: { ...data, properties: filtered, state: 'existing' } }
          }
          if (n.id === next.nodeId) {
            const data = n.data as unknown as BuilderNodeData
            return { ...n, data: { ...data, properties: [...data.properties, next.property], state: 'pending' } }
          }
          return n
        }),
      )
    }
  }, [pending])

  const quickPrompts = intents.map((i) => i.prompt)
  const pendingCount = pending.filter((c) => c.status === 'pending').length

  // Count of saved extensions for the badge
  const [savedCount, setSavedCount] = useState(() => {
    const ext = loadExtension(sectorId)
    return ext.nodes.length + ext.edges.length + ext.addedProperties.length
  })
  useEffect(() => {
    const ext = loadExtension(sectorId)
    setSavedCount(ext.nodes.length + ext.edges.length + ext.addedProperties.length)
  }, [sectorId, nodes, edges])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 bg-white flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Wand2 className="w-6 h-6 text-teal-600" />
            Ontology Builder AI
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Modify the <strong className="text-teal-700">{sector.name}</strong> ontology in natural language.
            The bot proposes changes, you approve.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            {nodes.length} classes · {edges.length} relations
          </span>
          {savedCount > 0 && (
            <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2 py-1 rounded-full font-medium flex items-center gap-1">
              <Save className="w-3 h-3" />
              {savedCount} saved
            </span>
          )}
          {pendingCount > 0 && (
            <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-full font-medium flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {pendingCount} pending
            </span>
          )}
          {savedCount > 0 && (
            <button
              onClick={clearExtensions}
              className="text-xs bg-white border border-slate-200 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 text-slate-600 px-2 py-1 rounded-md font-medium flex items-center gap-1 transition-colors"
              title="Remove all saved extensions for this sector"
            >
              <Trash2 className="w-3 h-3" />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Body: 3 columns */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat */}
        <div className="w-[360px] flex-shrink-0 border-r border-slate-200 bg-white flex flex-col">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Builder Assistant</p>
              <p className="text-[10px] text-slate-400">claude-sonnet-4 · governance-aware</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m) => (
              <MessageBubble key={m.id} msg={m} pending={pending} onApprove={approve} onReject={reject} onEdit={setEditingChange} />
            ))}
            {thinking && (
              <div className="flex items-center gap-2 text-xs text-slate-400 px-2">
                <Bot className="w-3.5 h-3.5" />
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-pulse" />
                  <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-pulse [animation-delay:200ms]" />
                  <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-pulse [animation-delay:400ms]" />
                </span>
                <span>analyzing ontology...</span>
              </div>
            )}
          </div>

          {/* Quick prompts */}
          <div className="px-4 py-2 border-t border-slate-100">
            <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5">
              Suggestions
            </p>
            <div className="flex flex-wrap gap-1.5">
              {quickPrompts.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="text-[11px] bg-slate-50 hover:bg-teal-50 hover:text-teal-700 border border-slate-200 hover:border-teal-200 rounded-full px-2.5 py-1 text-slate-600 transition-colors text-left"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-slate-200">
            <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-100 focus-within:border-teal-300 border border-transparent transition-all">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send(input)}
                placeholder="Describe an entity, relation or property..."
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-slate-400"
              />
              <button
                onClick={() => send(input)}
                disabled={!input.trim()}
                className="w-7 h-7 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:bg-slate-200 text-white flex items-center justify-center transition-colors flex-shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative bg-slate-50">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClickCanvas}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#cbd5e1" gap={20} />
            <Controls className="!bg-white !border !border-slate-200 !shadow-sm" />
          </ReactFlow>

          {/* Hint top */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-white border border-slate-200 rounded-full shadow-sm px-3 py-1 text-xs text-slate-600 flex items-center gap-1.5 z-10">
            <Pencil className="w-3 h-3 text-teal-600" />
            <span>Click a node to edit it</span>
          </div>

          {/* Legend */}
          <div className="absolute bottom-4 left-4 bg-white border border-slate-200 rounded-lg shadow-sm p-2.5 text-xs flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-white border border-slate-300 rounded" />
              <span className="text-slate-600">Existing</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-amber-50 border border-amber-400 border-dashed rounded" />
              <span className="text-slate-600">Pending</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-teal-50 border border-teal-400 rounded" />
              <span className="text-slate-600">Approved</span>
            </div>
          </div>
        </div>

        {/* Pending changes panel */}
        {pending.length > 0 && (
          <div className="w-[340px] flex-shrink-0 border-l border-slate-200 bg-white flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  Proposed changes
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {pendingCount} pending · {pending.length - pendingCount} approved
                </p>
              </div>
              {pendingCount > 0 && (
                <button
                  onClick={approveAll}
                  className="text-xs bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-md px-2.5 py-1.5 transition-colors"
                >
                  Approve all
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {pending.map((c) => (
                <ChangeCard key={c.id} change={c} onApprove={approve} onReject={reject} onEdit={setEditingChange} />
              ))}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500 leading-snug">
              <p className="flex items-start gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-teal-600 flex-shrink-0 mt-0.5" />
                Structural changes require data steward approval (EU AI Act governance).
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Edit pending change modal */}
      {editingChange && (
        <EditChangeModal
          change={editingChange}
          existing={nodes.map((n) => ({ id: n.id, label: (n.data as unknown as BuilderNodeData).label }))}
          onSave={(updated) => {
            updateChange(updated)
            setEditingChange(null)
          }}
          onClose={() => setEditingChange(null)}
        />
      )}

      {/* Edit existing entity modal */}
      {editingEntity && (
        <EditEntityModal
          entity={editingEntity}
          onSave={saveEntity}
          onDelete={deleteEntity}
          onClose={() => setEditingEntity(null)}
        />
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────
function MessageBubble({
  msg,
  pending,
  onApprove,
  onReject,
  onEdit,
}: {
  msg: ChatMessage
  pending: PendingChange[]
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onEdit: (c: PendingChange) => void
}) {
  if (msg.role === 'user') {
    return (
      <div className="flex gap-2 justify-end">
        <div className="bg-teal-600 text-white rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%] text-sm">
          {msg.text}
        </div>
        <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
          <User className="w-3.5 h-3.5 text-slate-500" />
        </div>
      </div>
    )
  }

  const linkedChanges = msg.suggestions
    ? pending.filter((c) => msg.suggestions!.includes(c.id))
    : []

  return (
    <div className="flex gap-2">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center flex-shrink-0">
        <Bot className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="bg-slate-100 text-slate-800 rounded-2xl rounded-tl-sm px-3 py-2 text-sm whitespace-pre-line">
          {renderMarkdown(msg.text)}
        </div>
        {linkedChanges.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {linkedChanges.map((c) => (
              <InlineChangeChip key={c.id} change={c} onApprove={onApprove} onReject={onReject} onEdit={onEdit} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function renderMarkdown(text: string) {
  // tiny markdown: **bold** + `code`
  const parts: React.ReactNode[] = []
  let i = 0
  let buf = ''
  const flush = () => {
    if (buf) { parts.push(buf); buf = '' }
  }
  while (i < text.length) {
    if (text[i] === '*' && text[i + 1] === '*') {
      flush()
      const end = text.indexOf('**', i + 2)
      if (end === -1) { buf += text[i]; i++; continue }
      parts.push(<strong key={i} className="font-semibold text-slate-900">{text.slice(i + 2, end)}</strong>)
      i = end + 2
    } else if (text[i] === '`') {
      flush()
      const end = text.indexOf('`', i + 1)
      if (end === -1) { buf += text[i]; i++; continue }
      parts.push(<code key={i} className="text-xs font-mono bg-white px-1 py-0.5 rounded text-teal-700">{text.slice(i + 1, end)}</code>)
      i = end + 1
    } else {
      buf += text[i]
      i++
    }
  }
  flush()
  return parts
}

function InlineChangeChip({
  change,
  onApprove,
  onReject,
  onEdit,
}: {
  change: PendingChange
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onEdit: (c: PendingChange) => void
}) {
  const icon =
    change.kind === 'add_class' ? <Plus className="w-3 h-3" /> :
    change.kind === 'add_relation' ? <Link2 className="w-3 h-3" /> :
    change.kind === 'rename' ? <AlertTriangle className="w-3 h-3" /> :
    <ChevronRight className="w-3 h-3" />

  const isApproved = change.status === 'approved'

  return (
    <div className={`text-xs border rounded-lg px-2.5 py-2 ${
      isApproved ? 'bg-teal-50 border-teal-200' :
      change.warnings ? 'bg-rose-50 border-rose-200' :
      'bg-white border-slate-200'
    }`}>
      <div className="flex items-center gap-1.5">
        <span className={`flex items-center justify-center w-5 h-5 rounded ${
          isApproved ? 'bg-teal-200 text-teal-800' :
          change.warnings ? 'bg-rose-200 text-rose-800' :
          'bg-amber-100 text-amber-700'
        }`}>
          {icon}
        </span>
        <span className="font-medium text-slate-800 flex-1 min-w-0 truncate">{change.summary}</span>
        {isApproved ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />
        ) : (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => onEdit(change)}
              className="w-5 h-5 rounded bg-white hover:bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center"
              title="Edit"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={() => onReject(change.id)}
              className="w-5 h-5 rounded bg-white hover:bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center"
              title="Reject"
            >
              <XCircle className="w-3 h-3" />
            </button>
            <button
              onClick={() => onApprove(change.id)}
              className="w-5 h-5 rounded bg-teal-600 hover:bg-teal-700 text-white flex items-center justify-center"
              title="Approve"
            >
              <CheckCircle2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ChangeCard({
  change,
  onApprove,
  onReject,
  onEdit,
}: {
  change: PendingChange
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onEdit: (c: PendingChange) => void
}) {
  const isApproved = change.status === 'approved'
  const Icon =
    change.kind === 'add_class' ? Plus :
    change.kind === 'add_relation' ? Link2 :
    change.kind === 'rename' ? AlertTriangle :
    ChevronRight

  return (
    <div className={`border rounded-lg p-3 ${
      isApproved ? 'bg-teal-50/40 border-teal-200' :
      change.warnings ? 'bg-rose-50/50 border-rose-200' :
      'bg-white border-slate-200'
    }`}>
      <div className="flex items-start gap-2">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isApproved ? 'bg-teal-100 text-teal-700' :
          change.warnings ? 'bg-rose-100 text-rose-700' :
          'bg-amber-50 text-amber-700'
        }`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <p className="text-sm font-semibold text-slate-900 truncate">{change.summary}</p>
            {isApproved && (
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-slate-500 leading-snug">{change.rationale}</p>

          {change.warnings && (
            <div className="mt-2 space-y-1">
              {change.warnings.map((w, i) => (
                <div key={i} className="text-[11px] text-rose-700 bg-white border border-rose-200 rounded px-2 py-1 flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span className="leading-snug">{w}</span>
                </div>
              ))}
            </div>
          )}

          {change.requiresSteward && (
            <span className="inline-flex items-center gap-1 mt-2 text-[10px] bg-violet-50 text-violet-700 border border-violet-200 rounded px-1.5 py-0.5 font-medium">
              <ShieldCheck className="w-2.5 h-2.5" />
              Requires data steward
            </span>
          )}
        </div>
      </div>

      {!isApproved && (
        <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-100">
          <button
            onClick={() => onReject(change.id)}
            className="text-xs font-medium bg-white border border-slate-200 hover:border-slate-300 text-slate-600 rounded-md py-1.5 px-2 transition-colors flex items-center justify-center gap-1"
            title="Reject"
          >
            <XCircle className="w-3 h-3" />
          </button>
          <button
            onClick={() => onEdit(change)}
            className="flex-1 text-xs font-medium bg-white border border-slate-200 hover:border-teal-300 hover:text-teal-700 text-slate-600 rounded-md py-1.5 transition-colors flex items-center justify-center gap-1"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </button>
          <button
            onClick={() => onApprove(change.id)}
            className="flex-1 text-xs font-medium bg-teal-600 hover:bg-teal-700 text-white rounded-md py-1.5 transition-colors flex items-center justify-center gap-1"
          >
            <CheckCircle2 className="w-3 h-3" />
            Approve
          </button>
        </div>
      )}
    </div>
  )
}

// ── Edit modal ──────────────────────────────────────────────────────────────
function EditChangeModal({
  change,
  existing,
  onSave,
  onClose,
}: {
  change: PendingChange
  existing: { id: string; label: string }[]
  onSave: (updated: PendingChange) => void
  onClose: () => void
}) {
  // Local form state — initialized from the change.
  const [name, setName] = useState(change.newNode?.label ?? '')
  const [dbTable, setDbTable] = useState(change.newNode?.db_table ?? '')
  const [properties, setProperties] = useState<OntologyProperty[]>(change.newNode?.properties ?? [])
  const [newProp, setNewProp] = useState('')

  const [relSource, setRelSource] = useState(change.newEdge?.source ?? '')
  const [relTarget, setRelTarget] = useState(change.newEdge?.target ?? '')
  const [relLabel, setRelLabel] = useState(change.newEdge?.label ?? '')

  const [propNodeId, setPropNodeId] = useState(change.addPropertyTo?.nodeId ?? '')
  const [propName, setPropName] = useState(change.addPropertyTo?.property.name ?? '')

  function addProperty() {
    const n = normalizeProperty(newProp.trim())
    if (!n || properties.some((p) => p.name === n)) return
    setProperties([...properties, { name: n, type: inferType(n) }])
    setNewProp('')
  }
  function removeProperty(propName: string) {
    setProperties(properties.filter((x) => x.name !== propName))
  }

  function handleSave() {
    if (change.kind === 'add_class' && change.newNode) {
      const normalizedName = normalizeEntityName(name) || change.newNode.label
      const updated: PendingChange = {
        ...change,
        summary: `Add ${normalizedName} class`,
        newNode: {
          ...change.newNode,
          id: normalizedName,
          label: normalizedName,
          uri: change.newNode.uri.replace(/[^:]+$/, normalizedName),
          db_table: dbTable.trim() || undefined,
          properties: properties.length > 0 ? properties : [{ name: 'name', type: 'string' }],
        },
      }
      onSave(updated)
      return
    }
    if (change.kind === 'add_relation' && change.newEdge) {
      const label = relLabel.trim() || `has${existing.find((e) => e.id === relTarget)?.label ?? 'Target'}`
      const srcLabel = existing.find((e) => e.id === relSource)?.label ?? relSource
      const dstLabel = existing.find((e) => e.id === relTarget)?.label ?? relTarget
      const updated: PendingChange = {
        ...change,
        summary: `Relation: ${srcLabel} → ${label} → ${dstLabel}`,
        newEdge: {
          ...change.newEdge,
          source: relSource,
          target: relTarget,
          label,
        },
      }
      onSave(updated)
      return
    }
    if (change.kind === 'add_property' && change.addPropertyTo) {
      const pName = normalizeProperty(propName.trim()) || change.addPropertyTo.property.name
      const prop: OntologyProperty = { name: pName, type: inferType(pName) }
      const node = existing.find((e) => e.id === propNodeId)
      const updated: PendingChange = {
        ...change,
        summary: `Add ${pName} to ${node?.label ?? propNodeId}`,
        addPropertyTo: { nodeId: propNodeId, property: prop },
      }
      onSave(updated)
      return
    }
    // rename / fallback: nothing structural to edit, just save unchanged
    onSave(change)
  }

  const title =
    change.kind === 'add_class' ? 'Edit class' :
    change.kind === 'add_relation' ? 'Edit relation' :
    change.kind === 'add_property' ? 'Edit property' :
    'Edit'

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-teal-600" />
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {change.kind === 'add_class' && (
            <>
              <Field label="Class name">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none"
                  placeholder="e.g. Supplier"
                />
                <p className="text-[11px] text-slate-400 mt-1">Will be normalized to PascalCase.</p>
              </Field>

              <Field label="DB table (optional)">
                <input
                  type="text"
                  value={dbTable}
                  onChange={(e) => setDbTable(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none font-mono"
                  placeholder="e.g. suppliers"
                />
              </Field>

              <Field label={`Properties (${properties.length})`}>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {properties.length === 0 && (
                    <span className="text-xs text-slate-400 italic">No properties — add at least one.</span>
                  )}
                  {properties.map((p) => (
                    <span key={p.name} className="inline-flex items-center gap-1 text-xs bg-teal-50 text-teal-800 border border-teal-200 rounded-full px-2 py-1 font-mono">
                      {p.name}
                      <span className={`text-[9px] px-1 rounded ${TYPE_COLORS[p.type] ?? 'bg-slate-100 text-slate-500'}`}>{p.type}</span>
                      <button
                        onClick={() => removeProperty(p.name)}
                        className="text-teal-600 hover:text-teal-900"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newProp}
                    onChange={(e) => setNewProp(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addProperty())}
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none"
                    placeholder="e.g. email, price, country..."
                  />
                  <button
                    onClick={addProperty}
                    disabled={!newProp.trim()}
                    className="px-3 py-2 text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-slate-200 text-white rounded-lg font-medium transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </button>
                </div>
              </Field>
            </>
          )}

          {change.kind === 'add_relation' && (
            <>
              <Field label="Source">
                <select
                  value={relSource}
                  onChange={(e) => setRelSource(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none bg-white"
                >
                  {existing.map((e) => (
                    <option key={e.id} value={e.id}>{e.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Relation label">
                <input
                  type="text"
                  value={relLabel}
                  onChange={(e) => setRelLabel(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none font-mono"
                  placeholder="e.g. hasCustomer, suppliedBy"
                />
              </Field>
              <Field label="Target">
                <select
                  value={relTarget}
                  onChange={(e) => setRelTarget(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none bg-white"
                >
                  {existing.map((e) => (
                    <option key={e.id} value={e.id}>{e.label}</option>
                  ))}
                </select>
              </Field>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 flex items-center gap-2">
                <Link2 className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />
                <span>
                  <strong>{existing.find((e) => e.id === relSource)?.label ?? '?'}</strong>
                  {' → '}
                  <code className="bg-white px-1 py-0.5 rounded text-teal-700">{relLabel || 'has...'}</code>
                  {' → '}
                  <strong>{existing.find((e) => e.id === relTarget)?.label ?? '?'}</strong>
                </span>
              </div>
            </>
          )}

          {change.kind === 'add_property' && (
            <>
              <Field label="Target entity">
                <select
                  value={propNodeId}
                  onChange={(e) => setPropNodeId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none bg-white"
                >
                  {existing.map((e) => (
                    <option key={e.id} value={e.id}>{e.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Property name">
                <input
                  type="text"
                  value={propName}
                  onChange={(e) => setPropName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none font-mono"
                  placeholder="e.g. email, sustainabilityScore"
                />
                <p className="text-[11px] text-slate-400 mt-1">Will be normalized to camelCase.</p>
              </Field>
            </>
          )}

          {change.kind === 'rename' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Rename-type changes cannot be edited from this screen — use the chat to rename again or reject.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="text-sm bg-white border border-slate-200 hover:border-slate-300 text-slate-700 rounded-lg px-4 py-2 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="text-sm bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 font-medium transition-colors flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            Save changes
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1.5">{label}</label>
      {children}
    </div>
  )
}

// ── Edit existing entity modal ──────────────────────────────────────────────
const ALL_PROP_TYPES: PropertyType[] = ['string', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'text', 'uuid', 'fk']

function EditEntityModal({
  entity,
  onSave,
  onDelete,
  onClose,
}: {
  entity: { nodeId: string; label: string; db_table: string | null; properties: OntologyProperty[]; isBaseNode: boolean }
  onSave: (patch: { label: string; db_table: string | null; properties: OntologyProperty[] }) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [label, setLabel] = useState(entity.label)
  const [dbTable, setDbTable] = useState(entity.db_table ?? '')
  const [properties, setProperties] = useState<OntologyProperty[]>(entity.properties)
  const [newPropName, setNewPropName] = useState('')
  const [newPropPhysical, setNewPropPhysical] = useState('')
  const [newPropType, setNewPropType] = useState<PropertyType>('string')

  function addProperty() {
    const name = normalizeProperty(newPropName.trim())
    if (!name || properties.some((x) => x.name === name)) return
    const physicalName = newPropPhysical.trim() || undefined
    setProperties([...properties, { name, physicalName, type: newPropType, required: false, unique: false }])
    setNewPropName('')
    setNewPropPhysical('')
    setNewPropType('string')
  }

  function updateProperty(idx: number, patch: Partial<OntologyProperty>) {
    setProperties(properties.map((p, i) => i === idx ? { ...p, ...patch } : p))
  }

  function removeProperty(idx: number) {
    setProperties(properties.filter((_, i) => i !== idx))
  }

  function handleSave() {
    onSave({
      label: normalizeEntityName(label) || entity.label,
      db_table: dbTable.trim() || null,
      properties,
    })
  }

  const dirty =
    label !== entity.label ||
    (dbTable || null) !== (entity.db_table || null) ||
    JSON.stringify(properties) !== JSON.stringify(entity.properties)

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-teal-600" />
            <div>
              <h3 className="text-base font-semibold text-slate-900">Edit entity</h3>
              <p className="text-[11px] text-slate-400">
                {entity.isBaseNode ? 'Base class — changes are saved as override' : 'User class'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Class name">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none"
              />
            </Field>
            <Field label="DB table">
              <input
                type="text"
                value={dbTable}
                onChange={(e) => setDbTable(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none font-mono"
                placeholder="(no mapping)"
              />
            </Field>
          </div>

          <Field label={`Properties (${properties.length})`}>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_1fr_90px_28px_28px_28px] gap-x-2 px-3 py-2 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                <span>Semantic name</span>
                <span>Physical column</span>
                <span>Type</span>
                <span className="text-center">Req</span>
                <span className="text-center">Uniq</span>
                <span />
              </div>
              {/* Rows */}
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {properties.length === 0 && (
                  <p className="px-3 py-3 text-xs text-slate-400 italic text-center">No properties yet — add one below.</p>
                )}
                {properties.map((p, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_90px_28px_28px_28px] gap-x-2 px-3 py-1.5 items-center hover:bg-slate-50">
                    <input
                      value={p.name}
                      onChange={e => updateProperty(idx, { name: e.target.value })}
                      className="px-2 py-1 text-xs font-mono border border-slate-200 rounded focus:border-teal-400 outline-none w-full"
                    />
                    <input
                      value={p.physicalName ?? ''}
                      onChange={e => updateProperty(idx, { physicalName: e.target.value || undefined })}
                      placeholder="= semantic"
                      className="px-2 py-1 text-xs font-mono border border-slate-200 rounded focus:border-teal-400 outline-none w-full text-slate-500 placeholder:text-slate-300 placeholder:not-italic"
                    />
                    <select
                      value={p.type}
                      onChange={e => updateProperty(idx, { type: e.target.value as PropertyType })}
                      className="px-1.5 py-1 text-xs border border-slate-200 rounded focus:border-teal-400 outline-none bg-white w-full"
                    >
                      {ALL_PROP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input type="checkbox" checked={!!p.required} onChange={e => updateProperty(idx, { required: e.target.checked })} className="mx-auto accent-teal-600" />
                    <input type="checkbox" checked={!!p.unique} onChange={e => updateProperty(idx, { unique: e.target.checked })} className="mx-auto accent-teal-600" />
                    <button onClick={() => removeProperty(idx)} className="text-slate-300 hover:text-rose-500 transition-colors flex items-center justify-center">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              {/* Add row */}
              <div className="grid grid-cols-[1fr_1fr_90px_28px_28px_28px] gap-x-2 px-3 py-2 bg-slate-50/80 border-t border-slate-200 items-center">
                <input
                  value={newPropName}
                  onChange={e => setNewPropName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addProperty())}
                  placeholder="name…"
                  className="px-2 py-1.5 text-xs font-mono border border-slate-200 rounded focus:border-teal-400 outline-none w-full"
                />
                <input
                  value={newPropPhysical}
                  onChange={e => setNewPropPhysical(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addProperty())}
                  placeholder="physical col…"
                  className="px-2 py-1.5 text-xs font-mono border border-slate-200 rounded focus:border-teal-400 outline-none w-full text-slate-500"
                />
                <select
                  value={newPropType}
                  onChange={e => setNewPropType(e.target.value as PropertyType)}
                  className="px-1.5 py-1.5 text-xs border border-slate-200 rounded focus:border-teal-400 outline-none bg-white w-full"
                >
                  {ALL_PROP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <span />
                <span />
                <button
                  onClick={addProperty}
                  disabled={!newPropName.trim()}
                  className="text-teal-600 hover:text-teal-800 disabled:text-slate-300 transition-colors flex items-center justify-center"
                  title="Add property"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </Field>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          <button
            onClick={onDelete}
            className="text-sm bg-white border border-rose-200 hover:bg-rose-50 hover:border-rose-300 text-rose-700 rounded-lg px-3 py-2 font-medium transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('create-agent-from-entity', { detail: { entity: entity.label } }))
                onClose()
              }}
              className="text-sm bg-violet-50 border border-violet-200 hover:bg-violet-100 text-violet-700 rounded-lg px-3 py-2 font-medium transition-colors flex items-center gap-1.5"
              title="Create an agent that operates on this entity"
            >
              <Zap className="w-3.5 h-3.5" />
              Create Agent
            </button>
            <button
              onClick={onClose}
              className="text-sm bg-white border border-slate-200 hover:border-slate-300 text-slate-700 rounded-lg px-4 py-2 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty}
              className="text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-slate-200 disabled:text-slate-500 text-white rounded-lg px-4 py-2 font-medium transition-colors flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
