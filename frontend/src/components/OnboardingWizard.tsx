import { useState } from 'react'
import { Brain, ChevronRight, ChevronLeft, X, Check, Building2, Zap, Package, GitBranch } from 'lucide-react'
import { SECTORS, type SectorId } from '../data/sectors'
import { IS_DEMO_MODE } from '../lib/demoMode'

interface Props {
  onComplete: (companyName: string, sectorId: SectorId, customEntity: string) => void
  onSkip: () => void
}

const SECTOR_CARDS = Object.values(SECTORS).map(s => ({
  id: s.id,
  emoji: s.icon,
  label: s.name,
  desc: s.domain,
}))

const CONNECTORS: Record<string, string[]> = {
  manufacturing: ['TeamSystem', 'Zucchetti', 'SAP Business One', 'PostgreSQL', 'BRT', 'GLS', 'Google Sheets', 'Fatture in Cloud'],
  retail: ['Shopify', 'WooCommerce', 'Stripe', 'Satispay', 'Salesforce', 'HubSpot', 'Google Sheets', 'Airtable'],
  healthcare: ['PostgreSQL', 'MySQL', 'Google Sheets', 'Fatture in Cloud', 'TeamSystem', 'Airtable', 'Stripe', 'Zucchetti'],
  finance: ['TeamSystem', 'Zucchetti', 'PostgreSQL', 'MySQL', 'Stripe', 'Nexi', 'Salesforce', 'Fatture in Cloud'],
}

const AGENTS: Record<string, { name: string; desc: string; emoji: string }> = {
  manufacturing: { name: 'Quote Review Agent', desc: 'Analyzes open quotes for price deviations and expiry risk', emoji: '📋' },
  retail: { name: 'Cart Recovery Agent', desc: 'Recovers abandoned carts with personalized re-engagement messages', emoji: '🛒' },
  healthcare: { name: 'Follow-up Scheduler', desc: 'Schedules post-discharge follow-ups and prioritizes urgent cases', emoji: '📅' },
  finance: { name: 'KYC Completion Agent', desc: 'Monitors incomplete KYC submissions and sends automated follow-ups', emoji: '🔍' },
}

const SECTOR_NAMES: Record<string, string> = {
  manufacturing: 'Manufacturing',
  retail: 'Retail',
  healthcare: 'Healthcare',
  finance: 'Finance',
}

// Live workspaces collapse the wizard to a single step (company name + sector);
// the five demo steps (ontology preview, connectors, …) are demo-only.
const TOTAL_STEPS = IS_DEMO_MODE ? 5 : 1

export default function OnboardingWizard({ onComplete, onSkip }: Props) {
  const [step, setStep] = useState(1)
  const [companyName, setCompanyName] = useState('')
  const [selectedSector, setSelectedSector] = useState<SectorId | null>(null)
  const [customEntity, setCustomEntity] = useState('')
  const [selectedConnectors, setSelectedConnectors] = useState<Set<string>>(new Set())

  const toggleConnector = (name: string) => {
    setSelectedConnectors(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const canAdvanceStep1 = companyName.trim().length > 0 && selectedSector !== null

  const handleComplete = () => {
    localStorage.setItem('si-onboarding-done', '1')
    onComplete(companyName.trim(), selectedSector!, customEntity.trim())
  }

  const ontologyEntities = selectedSector ? SECTORS[selectedSector].ontology.nodes : []

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="max-w-2xl w-full mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div className="flex gap-2">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(s => (
              <span
                key={s}
                className={`w-2.5 h-2.5 rounded-full transition-colors ${s === step ? 'bg-teal-600' : s < step ? 'bg-teal-300' : 'bg-gray-200'}`}
              />
            ))}
          </div>
          <button onClick={onSkip} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-2" style={{ minHeight: '380px' }}>
          {/* Step 1 — Welcome + sector */}
          {step === 1 && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col items-center gap-2 pt-2">
                <div className="bg-teal-50 rounded-full p-4">
                  <Brain size={40} className="text-teal-600" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 text-center">Welcome to DataIntelligence</h1>
                <p className="text-gray-500 text-sm text-center">AI-powered data platform for European businesses</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">Company name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  placeholder="e.g. Acme Industries Ltd"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Industry</p>
                <div className="grid grid-cols-2 gap-3">
                  {SECTOR_CARDS.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSector(s.id)}
                      className={`flex flex-col gap-0.5 text-left rounded-xl border-2 px-4 py-3 transition-all ${
                        selectedSector === s.id
                          ? 'border-teal-500 bg-teal-50'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <span className="text-xl">{s.emoji}</span>
                      <span className="text-sm font-semibold text-gray-800">{s.label}</span>
                      <span className="text-xs text-gray-500">{s.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2 — Ontology preview + customization */}
          {step === 2 && selectedSector && (
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <GitBranch size={18} className="text-teal-600" />
                  <h2 className="text-xl font-bold text-gray-900">Your ontology</h2>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Pre-built semantic layer for {SECTOR_NAMES[selectedSector]} · {ontologyEntities.length} entities ready to use
                </p>
              </div>
              <div className="flex flex-wrap gap-2 bg-gradient-to-br from-teal-50/50 to-slate-50 rounded-xl p-4 border border-gray-100">
                {ontologyEntities.map(n => (
                  <span key={n.id} className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-700 shadow-sm">
                    {n.data.label}
                  </span>
                ))}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Want to add a business-specific entity? <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={customEntity}
                  onChange={e => setCustomEntity(e.target.value)}
                  placeholder='e.g. "Plant" or "Production Line"'
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-400">You can add properties and relations later in the Builder AI section</p>
              </div>
            </div>
          )}

          {/* Step 3 — Connectors */}
          {step === 3 && selectedSector && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Connect your systems</h2>
                <p className="text-sm text-gray-500 mt-1">Select the data sources to integrate. You can add more at any time.</p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {CONNECTORS[selectedSector].map(name => (
                  <button
                    key={name}
                    onClick={() => toggleConnector(name)}
                    className={`flex flex-col items-center gap-1 rounded-xl border-2 py-3 px-2 text-center transition-all ${
                      selectedConnectors.has(name)
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <span className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                      {name[0]}
                    </span>
                    <span className="text-xs text-gray-700 leading-tight">{name}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => setStep(4)} className="text-xs text-gray-400 hover:text-gray-600 underline self-start mt-1">
                Skip
              </button>
            </div>
          )}

          {/* Step 4 — Suggested agent */}
          {step === 4 && selectedSector && (
            <div className="flex flex-col gap-5">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Your first suggested agent</h2>
                <p className="text-sm text-gray-500 mt-1">Recommended agent for {SECTOR_NAMES[selectedSector]}</p>
              </div>
              <div className="border-2 border-teal-200 rounded-xl p-5 bg-teal-50 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <span className="text-3xl">{AGENTS[selectedSector].emoji}</span>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 text-base">{AGENTS[selectedSector].name}</span>
                      <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">Template</span>
                    </div>
                    <p className="text-sm text-gray-600">{AGENTS[selectedSector].desc}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 rounded-lg px-4 py-3">
                <Zap size={14} className="text-teal-500 shrink-0" />
                <span>It will be pre-configured in the Agents section</span>
              </div>
            </div>
          )}

          {/* Step 5 — Complete */}
          {step === 5 && (
            <div className="flex flex-col items-center gap-5 pt-2">
              <div className="w-16 h-16 rounded-full bg-teal-500 flex items-center justify-center">
                <Check size={32} className="text-white" strokeWidth={3} />
              </div>
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-900">All set!</h2>
                <p className="text-gray-500 text-sm mt-1">
                  Your semantic layer is configured for <span className="font-semibold text-gray-700">{companyName}</span>
                  {customEntity && (
                    <> with custom entity <span className="font-semibold text-teal-700">{customEntity}</span></>
                  )}
                </p>
              </div>
              <div className="w-full flex flex-col gap-2 bg-gray-50 rounded-xl p-4">
                {[
                  { icon: <GitBranch size={15} className="text-teal-600" />, text: `${ontologyEntities.length}${customEntity ? '+1' : ''} entities in your ontology` },
                  { icon: <Building2 size={15} className="text-teal-600" />, text: `${selectedConnectors.size} data source${selectedConnectors.size !== 1 ? 's' : ''} ready to connect` },
                  { icon: <Zap size={15} className="text-teal-600" />, text: '1 recommended agent ready for first run' },
                  { icon: <Package size={15} className="text-teal-600" />, text: 'GDPR + EU AI Act compliance already mapped' },
                ].map(({ icon, text }, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                    {icon}
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 mt-2">
          <div>
            {step > 1 && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                <ChevronLeft size={16} />
                Back
              </button>
            )}
          </div>
          {TOTAL_STEPS > 1 && <span className="text-xs text-gray-400">Step {step} of {TOTAL_STEPS}</span>}
          <div>
            {step < TOTAL_STEPS ? (
              <button
                onClick={() => setStep(s => s + 1)}
                disabled={step === 1 && !canAdvanceStep1}
                className="flex items-center gap-1 text-sm font-semibold bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                onClick={handleComplete}
                disabled={step === 1 && !canAdvanceStep1}
                className="flex items-center gap-1 text-sm font-semibold bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {IS_DEMO_MODE ? 'Go to Dashboard' : 'Get started'}
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
