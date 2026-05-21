import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Eye, Bell, RefreshCw, ShieldCheck, Sparkles, Bot, Hand, Clock, Zap } from 'lucide-react'
import type {
  CustomAgentDef, AgentTemplate, CustomFinding, AgentTrigger,
  ScheduleInterval, EventTriggerKind,
} from '../data/customAgents'

// ── Template definitions ──────────────────────────────────────────────────────

interface TemplateMeta {
  id: AgentTemplate
  name: string
  icon: typeof Eye
  tagline: string
  autoName: (entity: string) => string
  autoDescription: (entity: string) => string
}

const TEMPLATES: TemplateMeta[] = [
  {
    id: 'monitor',
    name: 'Monitor',
    icon: Eye,
    tagline: 'Watches for anomalies and trends',
    autoName: (e) => `${e} Monitor`,
    autoDescription: (e) => `Continuously monitors ${e} records for anomalies, statistical deviations, and emerging patterns`,
  },
  {
    id: 'alert',
    name: 'Alert',
    icon: Bell,
    tagline: 'Fires on threshold violations',
    autoName: (e) => `${e} Alert Agent`,
    autoDescription: (e) => `Sends real-time alerts when ${e} metrics breach defined thresholds or business rules`,
  },
  {
    id: 'reconciler',
    name: 'Reconciler',
    icon: RefreshCw,
    tagline: 'Finds cross-entity discrepancies',
    autoName: (e) => `${e} Reconciler`,
    autoDescription: (e) => `Reconciles ${e} data across connected systems and flags mismatches or duplicates`,
  },
  {
    id: 'validator',
    name: 'Validator',
    icon: ShieldCheck,
    tagline: 'Checks quality and completeness',
    autoName: (e) => `${e} Validator`,
    autoDescription: (e) => `Validates ${e} records for data quality, completeness, and constraint compliance`,
  },
  {
    id: 'enricher',
    name: 'Enricher',
    icon: Sparkles,
    tagline: 'Augments with external data',
    autoName: (e) => `${e} Enricher`,
    autoDescription: (e) => `Enriches ${e} records with external sources and computed derived attributes`,
  },
]

const DEFAULT_ACTIONS: Record<AgentTemplate, string[]> = {
  monitor:    ['Review anomaly report', 'Adjust monitoring thresholds', 'Export findings to CRM'],
  alert:      ['Acknowledge alerts', 'Escalate to manager', 'Pause alert rule'],
  reconciler: ['Resolve discrepancies', 'Merge duplicate records', 'Export reconciliation report'],
  validator:  ['Fix invalid records', 'Send data quality report', 'Update validation rules'],
  enricher:   ['Approve enrichment', 'Review unmatched records', 'Refresh enrichment cache'],
}

// ── NL parser ─────────────────────────────────────────────────────────────────

const TEMPLATE_KEYWORDS: Record<AgentTemplate, RegExp> = {
  alert:      /\b(avvis|alert|notifi|allerta|attenzion|emergenz|urgent|allarme|warn)/i,
  validator:  /\b(valid|verifica\b|controll[oa].*qualit|completezz|qualit[aà].*dat|integrit[aà])/i,
  reconciler: /\b(riconcil|reconcil|confront|allinea|incoer|discrepa|mismatch|duplicat|disallin)/i,
  enricher:   /\b(arricch|enrich|aggiung.*dat|integr.*esterni|extern.*data|augment|inserisc.*dato)/i,
  monitor:    /\b(monitor|controll|sorvegli|osserva|tien.*occhio|traccia|watch|track|segui)/i,
}

const ITALIAN_ENTITY_ALIASES: Record<string, string[]> = {
  cliente: ['Customer'], clienti: ['Customer'],
  fornitore: ['Supplier'], fornitori: ['Supplier'],
  prodotto: ['Product'], prodotti: ['Product'],
  articolo: ['Product'], articoli: ['Product'],
  ordine: ['Order'], ordini: ['Order'],
  fattura: ['Invoice'], fatture: ['Invoice'],
  pagamento: ['Payment'], pagamenti: ['Payment'],
  paziente: ['Patient'], pazienti: ['Patient'],
  medico: ['Doctor'], medici: ['Doctor'],
  carrello: ['Cart'], carrelli: ['Cart'],
  transazione: ['Transaction'], transazioni: ['Transaction'],
  conto: ['Account', 'BankAccount'], conti: ['Account', 'BankAccount'],
  prestito: ['Loan'], prestiti: ['Loan'],
  rischio: ['RiskProfile'],
  promozione: ['Promotion'], promozioni: ['Promotion'],
  ricetta: ['Prescription'], ricette: ['Prescription'],
  prescrizione: ['Prescription'], prescrizioni: ['Prescription'],
  farmaco: ['Medication'], farmaci: ['Medication'],
  visita: ['Encounter'], visite: ['Encounter'],
  appuntamento: ['Encounter'], appuntamenti: ['Encounter'],
  ordine_lavoro: ['WorkOrder'],
  macchin: ['Machine'],
  lotto: ['Batch'], lotti: ['Batch'],
  inventario: ['Inventory'],
  magazzino: ['Inventory', 'Warehouse'],
  applicant: ['Applicant'], richiedente: ['Applicant'], richiedenti: ['Applicant'],
}

interface ParsedAgent {
  template: AgentTemplate
  name: string
  description: string
  entities: string[]
  findings: CustomFinding[]
  actions: string[]
}

function parseAgentDescription(text: string, availableEntities: string[]): ParsedAgent {
  const lower = text.toLowerCase()

  // Template detection — alert wins over monitor when both keywords present
  let template: AgentTemplate = 'monitor'
  const order: AgentTemplate[] = ['alert', 'validator', 'reconciler', 'enricher', 'monitor']
  for (const t of order) {
    if (TEMPLATE_KEYWORDS[t].test(lower)) { template = t; break }
  }

  // Entity detection (English direct match + Italian aliases)
  const detected = new Set<string>()
  for (const entity of availableEntities) {
    const re = new RegExp(`\\b${entity}\\b`, 'i')
    if (re.test(text)) detected.add(entity)
  }
  for (const [italian, mapped] of Object.entries(ITALIAN_ENTITY_ALIASES)) {
    if (lower.includes(italian)) {
      for (const e of mapped) {
        if (availableEntities.includes(e)) detected.add(e)
      }
    }
  }
  const entities = [...detected]

  // Condition / finding extraction
  const findings: CustomFinding[] = []
  const condPatterns: RegExp[] = [
    /(?:quando|se|when|if)\s+([^,;.\n]+?)(?:[,;.\n]|$)/i,
    /(?:supera|superi|più di|piu di|over|above|greater than|maggiore di)\s+([^,;.\n]+?)(?:[,;.\n]|$)/i,
    /([a-zà-ù_]+\s*[<>=]+\s*[\d.,€$%]+\S*)/i,
  ]
  for (const re of condPatterns) {
    const m = text.match(re)
    if (m && m[1]) {
      const sev: CustomFinding['severity'] =
        /critic|urgent|emerg|grave|imminent/.test(lower) ? 'critical' :
        /avvis|alert|warning|attenzion|sospett/.test(lower) ? 'warning' : 'info'
      findings.push({ severity: sev, text: m[1].trim() })
      break
    }
  }

  // Action extraction
  const actions: string[] = []
  if (/\bemail|mail\b|posta/.test(lower)) actions.push('Send email notification')
  if (/\bsms|whatsapp|messaggio|push notif/.test(lower)) actions.push('Send SMS notification')
  if (/escala|manager|responsabile|supervisore/.test(lower)) actions.push('Escalate to manager')
  if (/blocca|sospend|congela|freeze|block transaction/.test(lower)) actions.push('Block transaction')
  if (/report|esport|export/.test(lower)) actions.push('Export report')
  if (/erp|sap|gestionale/.test(lower)) actions.push('Update ERP')
  if (/\bcrm\b|salesforce|hubspot/.test(lower)) actions.push('Sync to CRM')
  if (/compliance|uif|str|aml/.test(lower)) actions.push('Notify compliance officer')

  const primaryEntity = entities[0] ?? 'Records'
  const templateName = template[0].toUpperCase() + template.slice(1)
  const name = `${primaryEntity} ${templateName}`
  const tplDescription = TEMPLATES.find(t => t.id === template)!.autoDescription(primaryEntity)

  return {
    template,
    name,
    description: tplDescription,
    entities,
    findings,
    actions: actions.length > 0 ? actions : DEFAULT_ACTIONS[template],
  }
}

// ── Trigger meta ─────────────────────────────────────────────────────────────

const SCHEDULE_LABELS: Record<ScheduleInterval, string> = {
  '5min':   'Every 5 minutes',
  hourly:   'Every hour',
  daily:    'Daily',
  weekly:   'Weekly',
}

const EVENT_LABELS: Record<EventTriggerKind, string> = {
  'new-entity':        'When a new ontology entity is added',
  'pipeline-complete': 'When the data pipeline completes',
  'critical-finding':  'When another agent finds something critical',
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
  onSave: (agent: CustomAgentDef) => void
  availableEntities: string[]
  prefillEntity?: string
}

export default function AgentBuilder({ onClose, onSave, availableEntities, prefillEntity }: Props) {
  const [template, setTemplate] = useState<AgentTemplate>('monitor')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedEntities, setSelectedEntities] = useState<string[]>(prefillEntity ? [prefillEntity] : [])
  const [findings, setFindings] = useState<CustomFinding[]>([])
  const [actions, setActions] = useState<string[]>(DEFAULT_ACTIONS.monitor)
  const [newAction, setNewAction] = useState('')
  const [newFindingText, setNewFindingText] = useState('')
  const [newFindingSeverity, setNewFindingSeverity] = useState<CustomFinding['severity']>('info')
  const [nameEdited, setNameEdited] = useState(false)
  const [descEdited, setDescEdited] = useState(false)
  const [trigger, setTrigger] = useState<AgentTrigger>({ kind: 'manual' })

  // NL panel state
  const [nlText, setNlText] = useState('')
  const [parseToast, setParseToast] = useState<string | null>(null)

  const primaryEntity = selectedEntities[0] ?? (prefillEntity || 'Records')
  const tpl = TEMPLATES.find(t => t.id === template)!

  useEffect(() => {
    if (!nameEdited) setName(tpl.autoName(primaryEntity))
    if (!descEdited) setDescription(tpl.autoDescription(primaryEntity))
    setActions(prev => prev.length > 0 ? prev : DEFAULT_ACTIONS[template])
  }, [template, primaryEntity]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleEntity(entity: string) {
    setSelectedEntities(prev =>
      prev.includes(entity) ? prev.filter(e => e !== entity) : [...prev, entity],
    )
  }

  function addFinding() {
    if (!newFindingText.trim()) return
    setFindings(prev => [...prev, { severity: newFindingSeverity, text: newFindingText.trim() }])
    setNewFindingText('')
    setNewFindingSeverity('info')
  }
  function removeFinding(i: number) { setFindings(prev => prev.filter((_, idx) => idx !== i)) }
  function addAction() {
    if (!newAction.trim()) return
    setActions(prev => [...prev, newAction.trim()])
    setNewAction('')
  }
  function removeAction(i: number) { setActions(prev => prev.filter((_, idx) => idx !== i)) }

  function handleParseNL() {
    if (!nlText.trim()) return
    const parsed = parseAgentDescription(nlText, availableEntities)
    setTemplate(parsed.template)
    setName(parsed.name)
    setDescription(parsed.description)
    setNameEdited(true)
    setDescEdited(true)
    if (parsed.entities.length > 0) setSelectedEntities(parsed.entities)
    if (parsed.findings.length > 0) setFindings(prev => [...prev, ...parsed.findings])
    if (parsed.actions.length > 0) setActions(parsed.actions)
    setParseToast(
      `Parsed → ${parsed.template} · ${parsed.entities.length} ${parsed.entities.length === 1 ? 'entity' : 'entities'} · ${parsed.findings.length} ${parsed.findings.length === 1 ? 'finding' : 'findings'} · ${parsed.actions.length} actions`,
    )
    window.setTimeout(() => setParseToast(null), 3500)
  }

  function handleSave() {
    if (!name.trim() || selectedEntities.length === 0) return
    const agent: CustomAgentDef = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sectorId: '',
      name: name.trim(),
      description: description.trim(),
      template,
      entities: selectedEntities,
      findings,
      actions,
      createdAt: new Date().toISOString(),
      trigger,
    }
    onSave(agent)
  }

  const canSave = name.trim().length > 0 && selectedEntities.length > 0

  const SEVERITY_STYLE: Record<CustomFinding['severity'], string> = {
    info:     'bg-blue-50 border-blue-200 text-blue-700',
    warning:  'bg-amber-50 border-amber-200 text-amber-700',
    critical: 'bg-red-50 border-red-200 text-red-700',
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-50 ring-1 ring-teal-200 flex items-center justify-center">
              <Bot className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Create New Agent</h2>
              <p className="text-xs text-slate-500">Define an executive agent on your semantic layer</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Natural language panel */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-violet-500" />
              <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Describe in plain language
              </h3>
              <span className="text-[10px] text-slate-400">· or fill the form manually</span>
            </div>
            <div className="bg-gradient-to-br from-violet-50/70 to-blue-50/50 border border-violet-200 rounded-xl p-3">
              <textarea
                value={nlText}
                onChange={e => setNlText(e.target.value)}
                placeholder={`e.g. "voglio un agente che mi avvisi quando un cliente Gold abbandona un carrello > €100 e mandi una email"`}
                rows={2}
                className="w-full bg-white/80 border border-violet-200 rounded-lg px-3 py-2 text-sm placeholder:text-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-violet-100 resize-none"
              />
              <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
                <p className="text-[10px] text-slate-500 italic flex-1 min-w-0">
                  Examples: "monitora i fornitori con rating &lt; 3" · "valida le fatture e manda report mensile"
                </p>
                <button
                  onClick={handleParseNL}
                  disabled={!nlText.trim()}
                  className="text-xs bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg px-3 py-1.5 font-medium transition-colors flex items-center gap-1.5 flex-shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Auto-fill form
                </button>
              </div>
              {parseToast && (
                <div className="mt-2 text-[11px] bg-white border border-violet-200 text-violet-700 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" />
                  {parseToast}
                </div>
              )}
            </div>
          </section>

          {/* Template */}
          <section>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">
              Agent template
            </label>
            <div className="grid grid-cols-5 gap-2">
              {TEMPLATES.map(t => {
                const Icon = t.icon
                const active = template === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setTemplate(t.id)}
                    className={`flex flex-col items-center gap-2 px-2 py-3 rounded-xl border text-center transition-all ${
                      active
                        ? 'bg-teal-50 border-teal-400 ring-2 ring-teal-100'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      active ? 'bg-teal-100' : 'bg-slate-100'
                    }`}>
                      <Icon className={`w-4 h-4 ${active ? 'text-teal-700' : 'text-slate-500'}`} />
                    </div>
                    <p className={`text-xs font-semibold leading-none ${active ? 'text-teal-700' : 'text-slate-700'}`}>
                      {t.name}
                    </p>
                    <p className="text-[10px] text-slate-400 leading-tight">{t.tagline}</p>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Identity */}
          <section>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">
              Identity
            </label>
            <div className="space-y-3">
              <input
                type="text"
                value={name}
                onChange={e => { setName(e.target.value); setNameEdited(true) }}
                placeholder="Agent name"
                className="w-full px-3 py-2.5 text-sm font-medium border border-slate-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none text-slate-900 placeholder:text-slate-400"
              />
              <textarea
                value={description}
                onChange={e => { setDescription(e.target.value); setDescEdited(true) }}
                placeholder="Describe what this agent does…"
                rows={2}
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none resize-none text-slate-700 placeholder:text-slate-400"
              />
            </div>
          </section>

          {/* Entity access */}
          <section>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
              Reads from (select entities)
            </label>
            <p className="text-xs text-slate-400 mb-3">
              Which ontology entities will this agent access?
            </p>
            {availableEntities.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No entities in the ontology yet — add them in Ontology Builder first.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {availableEntities.map(entity => {
                  const selected = selectedEntities.includes(entity)
                  return (
                    <button
                      key={entity}
                      onClick={() => toggleEntity(entity)}
                      className={`text-xs font-mono px-2.5 py-1.5 rounded-lg border transition-all ${
                        selected
                          ? 'bg-teal-600 border-teal-600 text-white'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-teal-300 hover:text-teal-700'
                      }`}
                    >
                      {entity}
                    </button>
                  )
                })}
              </div>
            )}
            {selectedEntities.length > 0 && (
              <p className="text-[11px] text-teal-600 mt-2">
                {selectedEntities.length} {selectedEntities.length === 1 ? 'entity' : 'entities'} selected
              </p>
            )}
          </section>

          {/* Findings */}
          <section>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
              Findings
            </label>
            <p className="text-xs text-slate-400 mb-3">
              What will this agent surface? (optional)
            </p>
            <div className="space-y-2">
              {findings.map((f, i) => (
                <div key={i} className={`flex items-center gap-2 text-xs border rounded-lg px-2.5 py-2 ${SEVERITY_STYLE[f.severity]}`}>
                  <span className="capitalize font-medium flex-shrink-0 w-14">{f.severity}</span>
                  <span className="flex-1 leading-snug">{f.text}</span>
                  <button onClick={() => removeFinding(i)} className="flex-shrink-0 opacity-60 hover:opacity-100">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <select
                value={newFindingSeverity}
                onChange={e => setNewFindingSeverity(e.target.value as CustomFinding['severity'])}
                className="text-xs border border-slate-200 rounded-lg px-2 py-2 outline-none bg-white text-slate-600 focus:border-teal-400"
              >
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="critical">critical</option>
              </select>
              <input
                type="text"
                value={newFindingText}
                onChange={e => setNewFindingText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addFinding())}
                placeholder="Describe a finding this agent will surface…"
                className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 placeholder:text-slate-400"
              />
              <button
                onClick={addFinding}
                disabled={!newFindingText.trim()}
                className="flex-shrink-0 px-3 py-2 text-xs bg-slate-100 hover:bg-teal-50 hover:text-teal-700 disabled:opacity-40 border border-slate-200 rounded-lg transition-colors flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          </section>

          {/* Actions */}
          <section>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
              Actions
            </label>
            <p className="text-xs text-slate-400 mb-3">
              What can a user trigger after the agent runs?
            </p>
            <div className="space-y-1.5">
              {actions.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700">
                    {a}
                  </div>
                  <button
                    onClick={() => removeAction(i)}
                    className="flex-shrink-0 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={newAction}
                onChange={e => setNewAction(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addAction())}
                placeholder="e.g. Send email report, Escalate to manager…"
                className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 placeholder:text-slate-400"
              />
              <button
                onClick={addAction}
                disabled={!newAction.trim()}
                className="flex-shrink-0 px-3 py-2 text-xs bg-slate-100 hover:bg-teal-50 hover:text-teal-700 disabled:opacity-40 border border-slate-200 rounded-lg transition-colors flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          </section>

          {/* Trigger */}
          <section>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
              Trigger
            </label>
            <p className="text-xs text-slate-400 mb-3">
              How should this agent run?
            </p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {([
                { kind: 'manual', icon: Hand, name: 'Manual', tag: 'Run on demand' },
                { kind: 'schedule', icon: Clock, name: 'Schedule', tag: 'Auto-run on interval' },
                { kind: 'event', icon: Zap, name: 'Event', tag: 'On data change' },
              ] as const).map(opt => {
                const Icon = opt.icon
                const active = trigger.kind === opt.kind
                return (
                  <button
                    key={opt.kind}
                    onClick={() => {
                      if (opt.kind === 'manual') setTrigger({ kind: 'manual' })
                      else if (opt.kind === 'schedule') setTrigger({ kind: 'schedule', interval: 'daily' })
                      else setTrigger({ kind: 'event', on: 'new-entity' })
                    }}
                    className={`flex flex-col items-center gap-2 px-2 py-3 rounded-xl border text-center transition-all ${
                      active
                        ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-100'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${active ? 'bg-amber-100' : 'bg-slate-100'}`}>
                      <Icon className={`w-4 h-4 ${active ? 'text-amber-700' : 'text-slate-500'}`} />
                    </div>
                    <p className={`text-xs font-semibold leading-none ${active ? 'text-amber-700' : 'text-slate-700'}`}>{opt.name}</p>
                    <p className="text-[10px] text-slate-400 leading-tight">{opt.tag}</p>
                  </button>
                )
              })}
            </div>
            {trigger.kind === 'schedule' && (
              <div className="bg-amber-50/40 border border-amber-200 rounded-lg px-3 py-2.5 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-700 flex-shrink-0" />
                <span className="text-xs text-slate-600">Run:</span>
                <select
                  value={trigger.interval}
                  onChange={e => setTrigger({ kind: 'schedule', interval: e.target.value as ScheduleInterval })}
                  className="text-xs border border-amber-200 rounded-md px-2 py-1 outline-none bg-white text-slate-700 focus:border-amber-400"
                >
                  {(Object.keys(SCHEDULE_LABELS) as ScheduleInterval[]).map(k => (
                    <option key={k} value={k}>{SCHEDULE_LABELS[k]}</option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-400 ml-auto italic">(accelerated in demo)</span>
              </div>
            )}
            {trigger.kind === 'event' && (
              <div className="bg-amber-50/40 border border-amber-200 rounded-lg px-3 py-2.5 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-700 flex-shrink-0" />
                <span className="text-xs text-slate-600 flex-shrink-0">Trigger:</span>
                <select
                  value={trigger.on}
                  onChange={e => setTrigger({ kind: 'event', on: e.target.value as EventTriggerKind })}
                  className="text-xs border border-amber-200 rounded-md px-2 py-1 outline-none bg-white text-slate-700 focus:border-amber-400 flex-1"
                >
                  {(Object.keys(EVENT_LABELS) as EventTriggerKind[]).map(k => (
                    <option key={k} value={k}>{EVENT_LABELS[k]}</option>
                  ))}
                </select>
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between flex-shrink-0">
          <p className="text-xs text-slate-400">
            {!canSave && (
              selectedEntities.length === 0
                ? 'Select at least one entity to continue'
                : 'Enter an agent name to continue'
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-sm bg-white border border-slate-200 hover:border-slate-300 text-slate-700 rounded-xl px-4 py-2 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl px-5 py-2 font-medium transition-colors flex items-center gap-2"
            >
              <Bot className="w-4 h-4" />
              Create Agent
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
