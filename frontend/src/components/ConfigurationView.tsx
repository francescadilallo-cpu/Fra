import { Bot, Workflow, Wrench, Shield, Check, X, Database, Plug, Sparkles } from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { SECTORS, type SectorId } from '../data/sectors'

const GENERIC_CONNECTORS = [
  { name: 'SAP S/4HANA',         cat: 'ERP',       sectors: ['manufacturing','finance'] as SectorId[] },
  { name: 'Oracle ERP Cloud',    cat: 'ERP',       sectors: ['manufacturing','finance'] as SectorId[] },
  { name: 'Microsoft Dynamics',  cat: 'ERP',       sectors: ['manufacturing','retail'] as SectorId[] },
  { name: 'Salesforce',          cat: 'CRM',       sectors: ['manufacturing','retail','finance'] as SectorId[] },
  { name: 'Shopify',             cat: 'eCommerce', sectors: ['retail'] as SectorId[] },
  { name: 'Siemens MES',         cat: 'MES',       sectors: ['manufacturing'] as SectorId[] },
  { name: 'Epic',                cat: 'EHR',       sectors: ['healthcare'] as SectorId[] },
  { name: 'HL7 FHIR',            cat: 'Standard',  sectors: ['healthcare'] as SectorId[] },
  { name: 'Temenos',             cat: 'Banking',   sectors: ['finance'] as SectorId[] },
  { name: 'Snowflake',           cat: 'DWH',       sectors: ['manufacturing','retail','healthcare','finance'] as SectorId[] },
  { name: 'PostgreSQL',          cat: 'Database',  sectors: ['manufacturing','retail','healthcare','finance'] as SectorId[] },
  { name: 'Anthropic Claude',    cat: 'AI',        sectors: ['manufacturing','retail','healthcare','finance'] as SectorId[], beta: false },
]

const GOVERNANCE_RULES = [
  { name: 'Complete audit trail of every AI decision',         enabled: true, locked: true,  desc: 'Always on for EU AI Act Art. 12 compliance' },
  { name: 'Human-in-the-loop for high-risk decisions',          enabled: true, locked: false, desc: 'Human approval for outputs with confidence < 80%' },
  { name: 'Data sovereignty: no data leaves the EU',            enabled: true, locked: false, desc: 'European AWS/Azure regions only for processing' },
  { name: 'Right to explanation: every AI output has rationale',enabled: true, locked: false, desc: 'Step-by-step reasoning available for every response' },
  { name: 'Federated learning across tenants',                  enabled: false,locked: false, desc: 'Pattern sharing without sharing data (beta)' },
]

function ConnectorCard({ name, cat, connected, beta }: { name: string; cat: string; connected: boolean; beta?: boolean }) {
  return (
    <div className={`bg-white border rounded-xl p-4 transition-colors ${connected ? 'border-teal-200' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${connected ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
            {name.split(' ').map(w => w[0]).slice(0, 2).join('')}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 leading-tight">{name}</p>
            <span className="text-xs text-slate-400">{cat}</span>
          </div>
        </div>
        {beta && <span className="text-[9px] font-bold bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 leading-none">BETA</span>}
      </div>
      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-100">
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-teal-500' : 'bg-slate-300'}`} />
        <span className={`text-xs ${connected ? 'text-teal-700 font-medium' : 'text-slate-400'}`}>
          {connected ? 'Connected' : 'Available'}
        </span>
      </div>
    </div>
  )
}

function Toggle({ on, locked }: { on: boolean; locked: boolean }) {
  return (
    <div className={`relative w-9 h-5 rounded-full transition-colors ${on ? 'bg-teal-500' : 'bg-slate-200'} ${locked ? 'opacity-70' : ''}`}>
      <div className={`absolute top-0.5 ${on ? 'right-0.5' : 'left-0.5'} w-4 h-4 bg-white rounded-full shadow-sm transition-all`} />
    </div>
  )
}

const AGENT_BASE = [
  { name: 'Interface Agent',   icon: MessageIcon,   desc: 'Receives natural language requests and routes them to the right specialist', model: 'claude-sonnet-4', traffic: '1.2k req/day' },
  { name: 'Operational Agent', icon: Workflow,      desc: 'Coordinates multiple specialized agents for end-to-end multi-step tasks',    model: 'claude-sonnet-4', traffic: '340 req/day'  },
]

const AGENT_SECTOR: Record<SectorId, { name: string; desc: string; model: string; traffic: string }> = {
  manufacturing: { name: 'Order Specialist',     desc: 'Manages the quote→order→production cycle on the mfg: ontology',         model: 'claude-haiku-4', traffic: '89 req/day'  },
  retail:        { name: 'Cart Recovery',        desc: 'Recovers abandoned carts with personalized messages per customer',      model: 'claude-haiku-4', traffic: '420 req/day' },
  healthcare:    { name: 'Care Coordinator',     desc: 'Aligns diagnosis, treatments and follow-up with clinical protocols',    model: 'claude-haiku-4', traffic: '156 req/day' },
  finance:       { name: 'Risk Analyst',         desc: 'Computes risk scores by aggregating data from multiple sources',        model: 'claude-haiku-4', traffic: '210 req/day' },
}

function MessageIcon({ className }: { className?: string }) {
  return <Bot className={className} />
}

function AgentCard({ name, icon: Icon, desc, model, traffic }: { name: string; icon: typeof Bot; desc: string; model: string; traffic: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 hover:border-teal-200 transition-colors">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-teal-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">{name}</p>
          <p className="text-xs text-slate-500 mt-1 leading-snug">{desc}</p>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{model}</span>
            <span className="text-[10px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded">{traffic}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ConfigurationView() {
  const { sectorId, setSector } = useSector()

  const connectors = GENERIC_CONNECTORS.map(c => ({ ...c, connected: c.sectors.includes(sectorId) || c.cat === 'AI' || c.cat === 'DWH' || c.cat === 'Database' }))

  const agents = [
    { ...AGENT_BASE[0], icon: Bot },
    { ...AGENT_BASE[1], icon: Workflow },
    { ...AGENT_SECTOR[sectorId], icon: Wrench },
    { name: 'Compliance Agent', icon: Shield, desc: 'Verifies every decision against EU AI Act policies before release', model: 'claude-haiku-4', traffic: '1.2k checks/day' },
  ]

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Configuration</h1>
        <p className="text-slate-500 mt-1 text-sm">Customize the semantic layer for your company — connectors, governance, agents and sector templates.</p>
      </div>

      {/* Section 1: Connectors */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Plug className="w-4 h-4 text-teal-600" />
              Connector Library
            </h2>
            <p className="text-xs text-slate-500 mt-1">Pre-built connectors for enterprise systems — connect once, the semantic layer maps the rest.</p>
          </div>
          <span className="text-xs bg-teal-50 text-teal-700 font-medium px-2 py-1 rounded-full">
            {connectors.filter(c => c.connected).length} active
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mt-5">
          {connectors.map(c => (
            <ConnectorCard key={c.name} name={c.name} cat={c.cat} connected={c.connected} beta={c.beta} />
          ))}
        </div>
      </section>

      {/* Section 2: Governance */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-1">
          <Shield className="w-4 h-4 text-teal-600" />
          Governance & EU AI Act Compliance
        </h2>
        <p className="text-xs text-slate-500">Automatic rules applied to every AI decision to be compliant by-design.</p>
        <div className="mt-5 space-y-2">
          {GOVERNANCE_RULES.map(rule => (
            <div key={rule.name} className="flex items-start justify-between p-3 border border-slate-200 rounded-lg bg-slate-50/50">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                {rule.enabled
                  ? <Check className="w-4 h-4 text-teal-600 mt-0.5 flex-shrink-0" />
                  : <X className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{rule.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{rule.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                {rule.locked && <span className="text-[10px] uppercase tracking-wide text-slate-400">Locked</span>}
                <Toggle on={rule.enabled} locked={rule.locked} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 3: Agents */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-1">
          <Bot className="w-4 h-4 text-teal-600" />
          Configured AI Agents
        </h2>
        <p className="text-xs text-slate-500">Agents operating on the semantic layer of the <strong className="text-teal-700">{SECTORS[sectorId].name}</strong> sector.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
          {agents.map(a => (
            <AgentCard key={a.name} {...a} />
          ))}
        </div>
      </section>

      {/* Section 4: Sector templates */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-1">
          <Database className="w-4 h-4 text-teal-600" />
          Sector Templates
        </h2>
        <p className="text-xs text-slate-500">Switch between pre-configured templates to accelerate deployment. Each template includes ontology, mappings and connectors.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-5">
          {(Object.keys(SECTORS) as SectorId[]).map(id => {
            const s = SECTORS[id]
            const isActive = id === sectorId
            const stats = {
              manufacturing: { classes: 12, mappings: 47, conns: 5 },
              retail:        { classes:  9, mappings: 38, conns: 5 },
              healthcare:    { classes: 14, mappings: 62, conns: 5 },
              finance:       { classes: 11, mappings: 53, conns: 5 },
            }[id]
            return (
              <button
                key={id}
                onClick={() => setSector(id)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  isActive ? 'bg-teal-50 border-teal-300 ring-2 ring-teal-100' : 'bg-white border-slate-200 hover:border-teal-200'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="text-2xl leading-none">{s.icon}</span>
                  {isActive && <span className="text-[10px] font-bold bg-teal-600 text-white rounded px-1.5 py-0.5 leading-none">ACTIVE</span>}
                </div>
                <p className={`text-sm font-semibold ${isActive ? 'text-teal-800' : 'text-slate-900'}`}>{s.name}</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-snug">{s.domain}</p>
                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-3 gap-1.5">
                  <div className="text-center">
                    <p className="text-sm font-bold text-slate-700">{stats.classes}</p>
                    <p className="text-[9px] text-slate-400 uppercase tracking-wide">classes</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-slate-700">{stats.mappings}</p>
                    <p className="text-[9px] text-slate-400 uppercase tracking-wide">mappings</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-slate-700">{stats.conns}</p>
                    <p className="text-[9px] text-slate-400 uppercase tracking-wide">conn.</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span>Want a template for your sector? Contact us — we develop new templates in 2-3 weeks.</span>
        </div>
      </section>
    </div>
  )
}
