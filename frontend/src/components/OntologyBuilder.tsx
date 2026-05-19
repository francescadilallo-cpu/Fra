import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import {
  ReactFlow, Background, Controls, Handle, Position,
  type NodeProps, type Node, type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Sparkles, Send, Bot, User, CheckCircle2, XCircle, Plus, Link2,
  AlertTriangle, ShieldCheck, Wand2, Database, ChevronRight, Save, Trash2,
} from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import type { OntologyNodeData } from '../types'

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
    properties: string[]
    position: { x: number; y: number }
    db_table?: string
  }
  newEdge?: {
    id: string
    source: string
    target: string
    label: string
  }
  addPropertyTo?: { nodeId: string; property: string }
  warnings?: string[]
  requiresSteward?: boolean
}

// Persisted shape (what we save in localStorage per sector)
interface SavedExtension {
  nodes: { id: string; label: string; uri: string; properties: string[]; position: { x: number; y: number }; db_table?: string }[]
  edges: { id: string; source: string; target: string; label: string }[]
  addedProperties: { nodeId: string; property: string }[]
}

const STORAGE_KEY = (sectorId: string) => `ontology-builder-ext-${sectorId}`

function loadExtension(sectorId: string): SavedExtension {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(sectorId))
    if (!raw) return { nodes: [], edges: [], addedProperties: [] }
    const parsed = JSON.parse(raw) as SavedExtension
    return {
      nodes: parsed.nodes ?? [],
      edges: parsed.edges ?? [],
      addedProperties: parsed.addedProperties ?? [],
    }
  } catch {
    return { nodes: [], edges: [], addedProperties: [] }
  }
}

function saveExtension(sectorId: string, ext: SavedExtension) {
  try {
    localStorage.setItem(STORAGE_KEY(sectorId), JSON.stringify(ext))
  } catch {
    // quota exceeded — silent for demo
  }
}

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
        prompt: 'Aggiungi entità Fornitore con campi nome, P.IVA, paese',
        reply:
          'Propongo una nuova classe **Supplier** collegata a **Product** tramite la relazione `suppliedBy`. ' +
          'Ho verificato l\'ontologia esistente: nessun concetto duplicato. La classe sarà mappata sulla tabella `suppliers` (da creare).',
        changes: [
          {
            id: 'c-supplier',
            kind: 'add_class',
            summary: 'Aggiungi classe Supplier',
            rationale: 'Nessuna entità "Fornitore/Supplier/Vendor" esistente. Classe nuova, non duplica concetti.',
            newNode: {
              id: 'Supplier',
              label: 'Supplier',
              uri: 'mfg:Supplier',
              properties: ['name', 'vatNumber', 'country', 'reliabilityScore'],
              position: { x: 1300, y: 200 },
              db_table: 'suppliers',
            },
            requiresSteward: true,
          },
          {
            id: 'c-supplier-rel',
            kind: 'add_relation',
            summary: 'Relazione: Product → suppliedBy → Supplier',
            rationale: 'Permette di tracciare la fornitura per prodotto e abilita query "fornitori critici".',
            newEdge: { id: 'e-supplier', source: 'Product', target: 'Supplier', label: 'suppliedBy' },
          },
        ],
      },
      {
        prompt: 'Voglio tracciare i lotti di produzione',
        reply:
          'Suggerisco una classe **ProductionBatch** con relazione `producesBatch` da **Order**. ' +
          'Attenzione: "Batch" e "Lotto" sono concetti correlati ma distinti — ti propongo Batch (terminologia inglese standard nel manufacturing).',
        changes: [
          {
            id: 'c-batch',
            kind: 'add_class',
            summary: 'Aggiungi classe ProductionBatch',
            rationale: 'Concetto centrale per traceability lotti, richiesto da norme EU 178/2002 (food) e MDR (medical).',
            newNode: {
              id: 'ProductionBatch',
              label: 'ProductionBatch',
              uri: 'mfg:ProductionBatch',
              properties: ['batchNumber', 'producedAt', 'quantity', 'qualityCheck'],
              position: { x: 1300, y: 500 },
              db_table: 'production_batches',
            },
            requiresSteward: true,
          },
          {
            id: 'c-batch-rel',
            kind: 'add_relation',
            summary: 'Relazione: Order → producesBatch → ProductionBatch',
            rationale: 'Collega ogni lotto all\'ordine che lo ha generato.',
            newEdge: { id: 'e-batch', source: 'Order', target: 'ProductionBatch', label: 'producesBatch' },
          },
        ],
      },
      {
        prompt: 'Aggiungi proprietà sustainabilityScore a Product',
        reply:
          'OK, aggiungo `sustainabilityScore` (decimale 0-100) come proprietà di **Product**. ' +
          'Non richiede approvazione data steward (proprietà semplice, non struttura nuova).',
        changes: [
          {
            id: 'c-sust',
            kind: 'add_property',
            summary: 'Aggiungi sustainabilityScore a Product',
            rationale: 'Proprietà numerica, non altera la struttura dell\'ontologia.',
            addPropertyTo: { nodeId: 'Product', property: 'sustainabilityScore' },
          },
        ],
      },
      {
        prompt: 'Importa schema da Salesforce',
        reply:
          'Ho analizzato lo schema Salesforce. Ho trovato 3 oggetti rilevanti, ma **Account** corrisponde al tuo **Customer** esistente. ' +
          'Suggerisco di NON creare un duplicato — mappa Account→Customer.',
        changes: [
          {
            id: 'c-sf-warn',
            kind: 'rename',
            summary: 'Mappa Salesforce.Account → Customer (no duplicato)',
            rationale: 'Account e Customer condividono >80% degli attributi (name, country, vatNumber). Riuso > creazione.',
            warnings: [
              'Stavo per creare entità "Account" — duplica Customer esistente.',
              'Salvato 1 entità ridondante. Mapping aggiunto invece di nuova classe.',
            ],
          },
          {
            id: 'c-opportunity',
            kind: 'add_class',
            summary: 'Aggiungi classe Opportunity (CRM)',
            rationale: 'Opportunity non ha un equivalente nell\'ontologia mfg corrente. Classe nuova legittima.',
            newNode: {
              id: 'Opportunity',
              label: 'Opportunity',
              uri: 'mfg:Opportunity',
              properties: ['stage', 'amount', 'closeDate', 'probability'],
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
        prompt: 'Aggiungi entità Loyalty Program',
        reply: 'Creo **LoyaltyProgram** collegato a **Customer** via `enrolledIn`. Pattern standard nel retail.',
        changes: [
          {
            id: 'c-loy',
            kind: 'add_class',
            summary: 'Aggiungi classe LoyaltyProgram',
            rationale: 'Concetto distinto da Customer; supporta multi-tier (Silver, Gold...).',
            newNode: {
              id: 'LoyaltyProgram',
              label: 'LoyaltyProgram',
              uri: 'rtl:LoyaltyProgram',
              properties: ['programName', 'tier', 'pointsBalance', 'joinDate'],
              position: { x: 1300, y: 200 },
              db_table: 'loyalty_programs',
            },
            requiresSteward: true,
          },
          {
            id: 'c-loy-rel',
            kind: 'add_relation',
            summary: 'Relazione: Customer → enrolledIn → LoyaltyProgram',
            rationale: 'Permette query "clienti Gold con carrelli abbandonati > €100".',
            newEdge: { id: 'e-loy', source: 'Customer', target: 'LoyaltyProgram', label: 'enrolledIn' },
          },
        ],
      },
      {
        prompt: 'Voglio mappare i resi prodotto',
        reply:
          'Suggerisco **Return** collegato a **Order** via `hasReturn`. Verifico se esiste già qualcosa di simile... nessun duplicato.',
        changes: [
          {
            id: 'c-return',
            kind: 'add_class',
            summary: 'Aggiungi classe Return',
            rationale: 'Concetto core retail mancante. Necessario per analytics reverse-logistics.',
            newNode: {
              id: 'Return',
              label: 'Return',
              uri: 'rtl:Return',
              properties: ['reason', 'refundAmount', 'returnDate', 'condition'],
              position: { x: 1300, y: 500 },
              db_table: 'returns',
            },
            requiresSteward: true,
          },
        ],
      },
      {
        prompt: 'Aggiungi proprietà ESG rating a Product',
        reply: 'OK. `esgRating` come stringa (A+, A, B...) su Product. Modifica non strutturale, no steward.',
        changes: [
          {
            id: 'c-esg',
            kind: 'add_property',
            summary: 'Aggiungi esgRating a Product',
            rationale: 'Proprietà piatta, no impatto su query esistenti.',
            addPropertyTo: { nodeId: 'Product', property: 'esgRating' },
          },
        ],
      },
    ]
  }

  if (sectorId === 'healthcare') {
    return [
      {
        prompt: 'Aggiungi entità Insurance Plan',
        reply:
          'Creo **InsurancePlan** collegato a **Patient** via `coveredBy`. Allineato a HL7 FHIR `Coverage` resource.',
        changes: [
          {
            id: 'c-ins',
            kind: 'add_class',
            summary: 'Aggiungi classe InsurancePlan',
            rationale: 'Mappabile su FHIR Coverage. Distinto da Patient, no duplicati.',
            newNode: {
              id: 'InsurancePlan',
              label: 'InsurancePlan',
              uri: 'hc:InsurancePlan',
              properties: ['payer', 'policyNumber', 'coverageType', 'copay'],
              position: { x: 1300, y: 200 },
              db_table: 'insurance_plans',
            },
            requiresSteward: true,
          },
          {
            id: 'c-ins-rel',
            kind: 'add_relation',
            summary: 'Relazione: Patient → coveredBy → InsurancePlan',
            rationale: 'Permette query billing e routing trattamenti.',
            newEdge: { id: 'e-ins', source: 'Patient', target: 'InsurancePlan', label: 'coveredBy' },
          },
        ],
      },
      {
        prompt: 'Voglio tracciare allergie del paziente',
        reply: 'Suggerisco proprietà strutturata `allergies` su Patient (JSON array). FHIR-compatible.',
        changes: [
          {
            id: 'c-allergy',
            kind: 'add_property',
            summary: 'Aggiungi allergies a Patient',
            rationale: 'Proprietà strutturata, allineata a FHIR AllergyIntolerance.',
            addPropertyTo: { nodeId: 'Patient', property: 'allergies' },
          },
        ],
      },
    ]
  }

  // Finance
  return [
    {
      prompt: 'Aggiungi entità Compliance Officer',
      reply: 'Creo **ComplianceOfficer** collegato a **Transaction** via `reviewedBy` (per audit AML/KYC).',
      changes: [
        {
          id: 'c-co',
          kind: 'add_class',
          summary: 'Aggiungi classe ComplianceOfficer',
          rationale: 'Ruolo distinto, richiesto per audit AML. Non duplica Account.',
          newNode: {
            id: 'ComplianceOfficer',
            label: 'ComplianceOfficer',
            uri: 'fin:ComplianceOfficer',
            properties: ['name', 'certifications', 'jurisdiction', 'licensesValid'],
            position: { x: 1300, y: 200 },
            db_table: 'compliance_officers',
          },
          requiresSteward: true,
        },
      ],
    },
    {
      prompt: 'Aggiungi proprietà riskScore a Account',
      reply: 'OK. `riskScore` decimale 0-100. Modifica leggera, no steward.',
      changes: [
        {
          id: 'c-risk',
          kind: 'add_property',
          summary: 'Aggiungi riskScore a Account',
          rationale: 'Proprietà calcolata da AI model esistente.',
          addPropertyTo: { nodeId: 'Account', property: 'riskScore' },
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
            NUOVO
          </span>
        )}
      </div>
      <div className="px-3 py-2 space-y-0.5">
        {d.properties.slice(0, 5).map((p) => (
          <div key={p} className="text-xs text-slate-500">
            <span className="text-slate-400">·</span> {p}
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

// Dynamic NLP-style parser for arbitrary user prompts.
function parseUserPrompt(
  text: string,
  sectorId: string,
  existing: { id: string; label: string }[],
): ParsedIntent | null {
  const prefix = sectorId === 'manufacturing' ? 'mfg' : sectorId === 'retail' ? 'rtl' : sectorId === 'healthcare' ? 'hc' : 'fin'

  // ── Pattern 1: add property to entity ───────────────────────────────────
  // "aggiungi proprietà X a Y" / "aggiungi X a Y" / "Y deve avere X"
  const propPatterns = [
    /(?:aggiungi|aggiungere|add)\s+(?:proprietà|proprieta|property|campo|attributo|attribute)\s+([a-zA-Z0-9_ ]+?)\s+(?:a|to|su|on)\s+([A-Za-z0-9_]+)/i,
    /(?:aggiungi|add)\s+([a-zA-Z0-9_ ]+?)\s+(?:a|to|su)\s+([A-Za-z][A-Za-z0-9_]+)/i,
    /([A-Za-z][A-Za-z0-9_]+)\s+(?:deve avere|has|ha|with)\s+([a-zA-Z0-9_ ]+)/i,
  ]
  for (const re of propPatterns) {
    const m = text.match(re)
    if (m) {
      const propRaw = m[1].trim()
      const entityRaw = m[2].trim()
      // Verify entity exists
      const found = existing.find(
        (e) => e.label.toLowerCase() === entityRaw.toLowerCase() || e.id.toLowerCase() === entityRaw.toLowerCase(),
      )
      if (found && propRaw.length < 40) {
        const prop = normalizeProperty(propRaw)
        return {
          reply:
            `Aggiungo la proprietà \`${prop}\` a **${found.label}**. ` +
            'Modifica leggera (proprietà, non struttura): non richiede approvazione data steward.',
          changes: [{
            id: `c-${uid()}`,
            kind: 'add_property',
            summary: `Aggiungi ${prop} a ${found.label}`,
            rationale: `Proprietà piatta su ${found.label}. Non altera relazioni esistenti, no impatto su query.`,
            addPropertyTo: { nodeId: found.id, property: prop },
          }],
        }
      }
    }
  }

  // ── Pattern 2: link/connect two entities ────────────────────────────────
  // "collega X a Y" / "connetti X con Y" / "X collegato a Y" / "link X to Y"
  const relPatterns = [
    /(?:collega|connetti|link|associa|relate)\s+([A-Za-z][A-Za-z0-9_]+)\s+(?:a|con|to|and|e)\s+([A-Za-z][A-Za-z0-9_]+)/i,
    /([A-Za-z][A-Za-z0-9_]+)\s+(?:collegato|connesso|linked|related)\s+(?:a|to|con)\s+([A-Za-z][A-Za-z0-9_]+)/i,
    /(?:relazione|relation)\s+(?:tra|between)?\s*([A-Za-z][A-Za-z0-9_]+)\s+(?:e|and|a)\s+([A-Za-z][A-Za-z0-9_]+)/i,
  ]
  for (const re of relPatterns) {
    const m = text.match(re)
    if (m) {
      const srcRaw = m[1].trim()
      const dstRaw = m[2].trim()
      const src = existing.find((e) => e.label.toLowerCase() === srcRaw.toLowerCase() || e.id.toLowerCase() === srcRaw.toLowerCase())
      const dst = existing.find((e) => e.label.toLowerCase() === dstRaw.toLowerCase() || e.id.toLowerCase() === dstRaw.toLowerCase())
      if (src && dst) {
        const label = `has${dst.label}`
        return {
          reply:
            `Creo una relazione **${src.label} → ${label} → ${dst.label}**. ` +
            'Verifico l\'ontologia: nessuna relazione duplicata.',
          changes: [{
            id: `c-${uid()}`,
            kind: 'add_relation',
            summary: `Relazione: ${src.label} → ${label} → ${dst.label}`,
            rationale: `Collega le due entità esistenti. Permette query incrociate ${src.label}/${dst.label}.`,
            newEdge: { id: `e-${uid()}`, source: src.id, target: dst.id, label },
          }],
        }
      }
    }
  }

  // ── Pattern 3: rename ────────────────────────────────────────────────────
  // "rinomina X in Y" / "rename X to Y"
  const renPatterns = [
    /(?:rinomina|rename)\s+([A-Za-z][A-Za-z0-9_]+)\s+(?:in|to|a)\s+([A-Za-z][A-Za-z0-9_]+)/i,
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
            `Rinomino **${found.label}** in **${newName}**. ` +
            'Attenzione: tutti i mapping e query che referenziano la classe verranno aggiornati. Richiede data steward.',
          changes: [{
            id: `c-${uid()}`,
            kind: 'rename',
            summary: `Rinomina ${found.label} → ${newName}`,
            rationale: 'Cambio strutturale: impatta SPARQL queries, mappings DB e MCP tools. Necessario backup.',
            requiresSteward: true,
            warnings: [`${existing.length} mapping potrebbero richiedere aggiornamento.`],
          }],
        }
      }
    }
  }

  // ── Pattern 4: add new entity/class ─────────────────────────────────────
  // "aggiungi entità X" / "crea classe X" / "voglio creare X" / "voglio tracciare X" /
  // "voglio mappare X" / "add entity X" / "new class X"
  const entPatterns = [
    /(?:aggiungi|aggiungere|crea|creare|add|new)\s+(?:entità|entita|classe|class|entity|tabella|table)\s+([A-Za-zà-ù][A-Za-zà-ù0-9_ ]*?)(?:\s+con\s+([a-zA-Z0-9_, ]+))?$/i,
    /(?:voglio|vorrei|i want to|want to|need to)\s+(?:tracciare|mappare|creare|gestire|track|map|create|manage|model)\s+(?:i\s+|le\s+|gli\s+|the\s+)?([A-Za-zà-ù][A-Za-zà-ù0-9_ ]*?)$/i,
    /(?:aggiungi|aggiungere|add|new)\s+([A-Za-zà-ù][A-Za-zà-ù0-9_ ]*?)(?:\s+con\s+([a-zA-Z0-9_, ]+))?$/i,
  ]
  for (const re of entPatterns) {
    const m = text.match(re)
    if (m) {
      const nameRaw = m[1].trim()
      const propsRaw = (m[2] || '').trim()
      if (nameRaw.length < 1 || nameRaw.length > 40) continue
      const name = normalizeEntityName(nameRaw)
      // Check for duplicate
      const dup = existing.find((e) => e.label.toLowerCase() === name.toLowerCase())
      if (dup) {
        return {
          reply:
            `Stavo per creare **${name}** ma esiste già nell'ontologia ${sectorId}. ` +
            'Suggerisco di riusare la classe esistente invece di duplicare (governance ontologica).',
          changes: [{
            id: `c-${uid()}`,
            kind: 'rename',
            summary: `Riuso ${name} esistente (no duplicato)`,
            rationale: `La classe ${name} è già presente. Creare un duplicato genererebbe inconsistenze nei mapping.`,
            warnings: [
              `Classe "${name}" già esistente — duplicato evitato.`,
              `Puoi aggiungere proprietà o relazioni alla classe esistente.`,
            ],
          }],
        }
      }
      // Derive properties
      const props = propsRaw
        ? propsRaw
            .split(/[,;]| e | and /)
            .map((p) => normalizeProperty(p.trim()))
            .filter((p) => p.length > 0)
            .slice(0, 8)
        : ['name', 'code', 'createdAt']

      // Position: place to the right, below existing nodes
      const maxX = existing.length > 0 ? 1300 : 100
      const yOffset = 200 + (existing.length % 3) * 300

      const newId = name
      return {
        reply:
          `Propongo una nuova classe **${name}** con ${props.length} propriet${props.length === 1 ? 'à' : 'à'}: ` +
          `${props.map((p) => `\`${p}\``).join(', ')}. ` +
          `Verificato: nessun concetto duplicato nell'ontologia ${sectorId}. ` +
          'Cambio strutturale — richiede approvazione data steward.',
        changes: [{
          id: `c-${uid()}`,
          kind: 'add_class',
          summary: `Aggiungi classe ${name}`,
          rationale: `Nuova entità non duplicata. ${props.length} proprietà derivate dalla descrizione. URI: ${prefix}:${name}.`,
          newNode: {
            id: newId,
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
  }

  return null
}

// Build initial canvas state by merging sector ontology + saved extensions
function buildInitialState(sector: { ontology: { nodes: { id: string; type: string; position: { x: number; y: number }; data: OntologyNodeData }[]; edges: { id: string; source: string; target: string; label: string; type: string; animated: boolean; style: Record<string, string>; labelStyle: Record<string, string | number> }[] } }, sectorId: string): { nodes: Node[]; edges: Edge[] } {
  const ext = loadExtension(sectorId)

  // Base nodes (possibly with extra properties added via builder)
  const baseNodes: Node[] = sector.ontology.nodes.map((n) => {
    const extraProps = ext.addedProperties
      .filter((p) => p.nodeId === n.id)
      .map((p) => p.property)
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
      properties: n.properties,
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
        `Ciao! Sono l'Ontology Builder AI. Posso aiutarti a modificare l'ontologia **${sector.name}** in linguaggio naturale. ` +
        'Descrivimi una nuova entità, una relazione, o una proprietà — propongo i cambi e tu approvi.',
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
          setMessages((m) => [
            ...m,
            {
              id: uid(),
              role: 'assistant',
              text:
                'Mmh, non sono sicuro di aver capito. Prova con uno dei suggerimenti qui sotto, oppure descrivimi una nuova **entità**, **relazione**, o **proprietà** che vuoi aggiungere.',
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
                    (p) => p !== change.addPropertyTo!.property,
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

  const clearExtensions = useCallback(() => {
    if (!confirm(`Vuoi davvero rimuovere tutte le estensioni salvate per ${sector.name}? Questa azione non è reversibile.`)) return
    saveExtension(sectorId, { nodes: [], edges: [], addedProperties: [] })
    const s = buildInitialState(sector, sectorId)
    setNodes(s.nodes)
    setEdges(s.edges)
    setPending([])
  }, [sectorId, sector])

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
            Modifica l'ontologia <strong className="text-teal-700">{sector.name}</strong> in linguaggio naturale.
            Il bot propone i cambi, tu approvi.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            {nodes.length} classi · {edges.length} relazioni
          </span>
          {savedCount > 0 && (
            <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2 py-1 rounded-full font-medium flex items-center gap-1">
              <Save className="w-3 h-3" />
              {savedCount} salvate
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
              title="Rimuovi tutte le estensioni salvate per questo settore"
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
              <MessageBubble key={m.id} msg={m} pending={pending} onApprove={approve} onReject={reject} />
            ))}
            {thinking && (
              <div className="flex items-center gap-2 text-xs text-slate-400 px-2">
                <Bot className="w-3.5 h-3.5" />
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-pulse" />
                  <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-pulse [animation-delay:200ms]" />
                  <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-pulse [animation-delay:400ms]" />
                </span>
                <span>analizza ontologia...</span>
              </div>
            )}
          </div>

          {/* Quick prompts */}
          <div className="px-4 py-2 border-t border-slate-100">
            <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5">
              Suggerimenti
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
                placeholder="Descrivi un'entità, relazione o proprietà..."
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
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#cbd5e1" gap={20} />
            <Controls className="!bg-white !border !border-slate-200 !shadow-sm" />
          </ReactFlow>

          {/* Legend */}
          <div className="absolute bottom-4 left-4 bg-white border border-slate-200 rounded-lg shadow-sm p-2.5 text-xs flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-white border border-slate-300 rounded" />
              <span className="text-slate-600">Esistente</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-amber-50 border border-amber-400 border-dashed rounded" />
              <span className="text-slate-600">Pending</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-teal-50 border border-teal-400 rounded" />
              <span className="text-slate-600">Approvato</span>
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
                  Cambi proposti
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {pendingCount} in attesa · {pending.length - pendingCount} approvati
                </p>
              </div>
              {pendingCount > 0 && (
                <button
                  onClick={approveAll}
                  className="text-xs bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-md px-2.5 py-1.5 transition-colors"
                >
                  Approva tutti
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {pending.map((c) => (
                <ChangeCard key={c.id} change={c} onApprove={approve} onReject={reject} />
              ))}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500 leading-snug">
              <p className="flex items-start gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-teal-600 flex-shrink-0 mt-0.5" />
                Cambi strutturali richiedono approvazione data steward (governance EU AI Act).
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────
function MessageBubble({
  msg,
  pending,
  onApprove,
  onReject,
}: {
  msg: ChatMessage
  pending: PendingChange[]
  onApprove: (id: string) => void
  onReject: (id: string) => void
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
        <div className="bg-slate-100 text-slate-800 rounded-2xl rounded-tl-sm px-3 py-2 text-sm">
          {renderMarkdown(msg.text)}
        </div>
        {linkedChanges.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {linkedChanges.map((c) => (
              <InlineChangeChip key={c.id} change={c} onApprove={onApprove} onReject={onReject} />
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
}: {
  change: PendingChange
  onApprove: (id: string) => void
  onReject: (id: string) => void
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
              onClick={() => onReject(change.id)}
              className="w-5 h-5 rounded bg-white hover:bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center"
              title="Rifiuta"
            >
              <XCircle className="w-3 h-3" />
            </button>
            <button
              onClick={() => onApprove(change.id)}
              className="w-5 h-5 rounded bg-teal-600 hover:bg-teal-700 text-white flex items-center justify-center"
              title="Approva"
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
}: {
  change: PendingChange
  onApprove: (id: string) => void
  onReject: (id: string) => void
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
              Richiede data steward
            </span>
          )}
        </div>
      </div>

      {!isApproved && (
        <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-100">
          <button
            onClick={() => onReject(change.id)}
            className="flex-1 text-xs font-medium bg-white border border-slate-200 hover:border-slate-300 text-slate-600 rounded-md py-1.5 transition-colors flex items-center justify-center gap-1"
          >
            <XCircle className="w-3 h-3" />
            Rifiuta
          </button>
          <button
            onClick={() => onApprove(change.id)}
            className="flex-1 text-xs font-medium bg-teal-600 hover:bg-teal-700 text-white rounded-md py-1.5 transition-colors flex items-center justify-center gap-1"
          >
            <CheckCircle2 className="w-3 h-3" />
            Approva
          </button>
        </div>
      )}
    </div>
  )
}
