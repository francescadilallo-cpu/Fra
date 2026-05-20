import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Eye, Bell, RefreshCw, ShieldCheck, Sparkles, Bot } from 'lucide-react'
import type { CustomAgentDef, AgentTemplate, CustomFinding } from '../data/customAgents'

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

  const primaryEntity = selectedEntities[0] ?? (prefillEntity || 'Records')
  const tpl = TEMPLATES.find(t => t.id === template)!

  // Auto-update name/description when template or primary entity changes
  useEffect(() => {
    if (!nameEdited) setName(tpl.autoName(primaryEntity))
    if (!descEdited) setDescription(tpl.autoDescription(primaryEntity))
    setActions(DEFAULT_ACTIONS[template])
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

  function removeFinding(i: number) {
    setFindings(prev => prev.filter((_, idx) => idx !== i))
  }

  function addAction() {
    if (!newAction.trim()) return
    setActions(prev => [...prev, newAction.trim()])
    setNewAction('')
  }

  function removeAction(i: number) {
    setActions(prev => prev.filter((_, idx) => idx !== i))
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
              <div>
                <input
                  type="text"
                  value={name}
                  onChange={e => { setName(e.target.value); setNameEdited(true) }}
                  placeholder="Agent name"
                  className="w-full px-3 py-2.5 text-sm font-medium border border-slate-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none text-slate-900 placeholder:text-slate-400"
                />
              </div>
              <div>
                <textarea
                  value={description}
                  onChange={e => { setDescription(e.target.value); setDescEdited(true) }}
                  placeholder="Describe what this agent does…"
                  rows={2}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none resize-none text-slate-700 placeholder:text-slate-400"
                />
              </div>
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
              What will this agent surface? (optional — you can add them later)
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
