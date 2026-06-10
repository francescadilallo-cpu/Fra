import { useState } from 'react'
import { Bot, Workflow, Wrench, Shield, Check, X, Database, Plug, Sparkles, Loader2, CheckCircle2, XCircle, Plus, AlertTriangle } from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { SECTORS, type SectorId } from '../data/sectors'
import { UsersSection, ApiTokensSection, NotificationsSection, AuditLogSection } from './AdminSections'
import { IS_DEMO_MODE } from '../lib/demoMode'

// ── Connectors ────────────────────────────────────────────────────────────────

interface Connector {
  name: string
  cat: string
  sectors: SectorId[]
  beta?: boolean
}

const GENERIC_CONNECTORS: Connector[] = [
  { name: 'SAP S/4HANA',         cat: 'ERP',       sectors: ['manufacturing','finance'] },
  { name: 'Oracle ERP Cloud',    cat: 'ERP',       sectors: ['manufacturing','finance'] },
  { name: 'Microsoft Dynamics',  cat: 'ERP',       sectors: ['manufacturing','retail'] },
  { name: 'Salesforce',          cat: 'CRM',       sectors: ['manufacturing','retail','finance'] },
  { name: 'Shopify',             cat: 'eCommerce', sectors: ['retail'] },
  { name: 'Siemens MES',         cat: 'MES',       sectors: ['manufacturing'] },
  { name: 'Epic',                cat: 'EHR',       sectors: ['healthcare'] },
  { name: 'HL7 FHIR',            cat: 'Standard',  sectors: ['healthcare'] },
  { name: 'Temenos',             cat: 'Banking',   sectors: ['finance'] },
  { name: 'Snowflake',           cat: 'DWH',       sectors: ['manufacturing','retail','healthcare','finance'] },
  { name: 'PostgreSQL',          cat: 'Database',  sectors: ['manufacturing','retail','healthcare','finance'] },
  { name: 'Anthropic Claude',    cat: 'AI',        sectors: ['manufacturing','retail','healthcare','finance'] },
]

type TestState = 'idle' | 'testing' | 'ok' | 'error'

// ── Governance rules state ────────────────────────────────────────────────────

interface GovernanceRule {
  name: string
  enabled: boolean
  locked: boolean
  desc: string
}

const INITIAL_RULES: GovernanceRule[] = [
  { name: 'Complete audit trail of every AI decision',          enabled: true,  locked: true,  desc: 'Always on for EU AI Act Art. 12 compliance' },
  { name: 'Human-in-the-loop for high-risk decisions',          enabled: true,  locked: false, desc: 'Human approval for outputs with confidence < 80%' },
  { name: 'Data sovereignty: no data leaves the EU',            enabled: true,  locked: false, desc: 'European AWS/Azure regions only for processing' },
  { name: 'Right to explanation: every AI output has rationale',enabled: true,  locked: false, desc: 'Step-by-step reasoning available for every response' },
  { name: 'Federated learning across tenants',                  enabled: false, locked: false, desc: 'Pattern sharing without sharing data (beta)' },
]

// ── Add Source modal ──────────────────────────────────────────────────────────

interface AddSourceForm { name: string; type: string; host: string; port: string; apiKey: string }

function AddSourceModal({ onClose, onSave }: { onClose: () => void; onSave: (form: AddSourceForm) => void }) {
  const [form, setForm] = useState<AddSourceForm>({ name: '', type: 'PostgreSQL', host: '', port: '5432', apiKey: '' })
  const [saving, setSaving] = useState(false)

  function handleSave() {
    if (!form.name.trim() || !form.host.trim()) return
    setSaving(true)
    setTimeout(() => {
      onSave(form)
      onClose()
    }, 900)
  }

  const TYPES = ['PostgreSQL', 'MySQL', 'Oracle', 'SAP REST API', 'Salesforce', 'REST / OpenAPI', 'GraphQL', 'CSV / SFTP']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-teal-600" />
            <h3 className="font-semibold text-slate-900">Add Data Source</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-700 block mb-1">Source name *</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Production DB"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:border-teal-500 outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700 block mb-1">Type</label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:border-teal-500 outline-none bg-white"
            >
              {TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-700 block mb-1">Host / URL *</label>
              <input
                value={form.host}
                onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                placeholder="db.example.com"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:border-teal-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 block mb-1">Port</label>
              <input
                value={form.port}
                onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:border-teal-500 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700 block mb-1">API Key / Password</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
              placeholder="••••••••"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:border-teal-500 outline-none"
            />
          </div>
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800 transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!form.name.trim() || !form.host.trim() || saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {saving ? 'Adding…' : 'Add Source'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ConnectorCard ─────────────────────────────────────────────────────────────

function ConnectorCard({
  name, cat, connected, beta, testState, latency, onTest,
}: {
  name: string; cat: string; connected: boolean; beta?: boolean
  testState: TestState; latency: number | null; onTest: () => void
}) {
  return (
    <div className={`bg-white border rounded-xl p-4 transition-all ${
      testState === 'ok' ? 'border-teal-300 shadow-sm shadow-teal-50' :
      testState === 'error' ? 'border-red-200' :
      connected ? 'border-teal-200' : 'border-slate-200'
    }`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${
            testState === 'ok' ? 'bg-teal-50 text-teal-700' :
            testState === 'error' ? 'bg-red-50 text-red-600' :
            connected ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'
          }`}>
            {name.split(' ').map(w => w[0]).slice(0, 2).join('')}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 leading-tight">{name}</p>
            <span className="text-xs text-slate-400">{cat}</span>
          </div>
        </div>
        {beta && <span className="text-[9px] font-bold bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 leading-none">BETA</span>}
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${
            testState === 'ok' ? 'bg-teal-500' :
            testState === 'error' ? 'bg-red-500' :
            connected ? 'bg-teal-400' : 'bg-slate-300'
          }`} />
          <span className={`text-xs ${
            testState === 'ok' ? 'text-teal-700 font-medium' :
            testState === 'error' ? 'text-red-600' :
            connected ? 'text-teal-700 font-medium' : 'text-slate-400'
          }`}>
            {testState === 'ok' ? `OK · ${latency}ms` :
             testState === 'error' ? 'Timeout' :
             connected ? 'Connected' : 'Available'}
          </span>
        </div>
        <button
          onClick={onTest}
          disabled={testState === 'testing'}
          className={`text-[11px] font-medium px-2 py-1 rounded transition-colors ${
            testState === 'testing' ? 'text-slate-400 cursor-not-allowed' :
            testState === 'ok' ? 'text-teal-600 hover:bg-teal-50' :
            testState === 'error' ? 'text-red-600 hover:bg-red-50' :
            'text-slate-500 hover:bg-slate-100'
          }`}
        >
          {testState === 'testing' ? (
            <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Testing…</span>
          ) : testState === 'ok' ? (
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Re-test</span>
          ) : testState === 'error' ? (
            <span className="flex items-center gap-1"><XCircle className="w-3 h-3" />Retry</span>
          ) : (
            'Test'
          )}
        </button>
      </div>
    </div>
  )
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ on, locked, onToggle }: { on: boolean; locked: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={locked ? undefined : onToggle}
      disabled={locked}
      className={`relative w-9 h-5 rounded-full transition-colors ${on ? 'bg-teal-500' : 'bg-slate-200'} ${locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <div className={`absolute top-0.5 ${on ? 'right-0.5' : 'left-0.5'} w-4 h-4 bg-white rounded-full shadow-sm transition-all`} />
    </button>
  )
}

// ── Agent cards ───────────────────────────────────────────────────────────────

const AGENT_SECTOR: Record<SectorId, { name: string; desc: string; model: string; traffic: string }> = {
  manufacturing: { name: 'Sales Analyst',    desc: 'Queries 31,465 AW orders across ERP+CRM+HR — resolves fatturato ambiguity, ranks Jae Pak vs peers', model: 'claude-haiku-4', traffic: '89 req/day'  },
  retail:        { name: 'Cart Recovery',     desc: 'Recovers abandoned carts with personalized messages per customer', model: 'claude-haiku-4', traffic: '420 req/day' },
  healthcare:    { name: 'Care Coordinator',  desc: 'Aligns diagnosis, treatments and follow-up with clinical protocols',model: 'claude-haiku-4', traffic: '156 req/day' },
  finance:       { name: 'Risk Analyst',      desc: 'Computes risk scores by aggregating data from multiple sources',   model: 'claude-haiku-4', traffic: '210 req/day' },
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

// ── AW active sources (manufacturing only) ────────────────────────────────────
const AW_CONFIG_SOURCES = [
  { name: 'OrionSales ERP',       type: 'PostgreSQL / DuckDB', detail: '31,465 orders · 152,825 rows total',    latencyMs: 18  },
  { name: 'ClientHub CRM',        type: 'SQLite',              detail: '59,193 rows · 372 dedup removed',       latencyMs: 42  },
  { name: 'dipendenti_hr',        type: 'CSV',                 detail: '290 employees · Italian schema (IT)',   latencyMs: 5   },
  { name: 'product_catalog_pim',  type: 'JSON',                detail: '504 products · internal_id join key',  latencyMs: 3   },
]

function AWConfigSources() {
  const [tests, setTests] = useState<Record<string, TestState>>({})
  function runTest(name: string) {
    setTests(t => ({ ...t, [name]: 'testing' }))
    setTimeout(() => setTests(t => ({ ...t, [name]: 'ok' })), 700 + Math.random() * 600)
  }
  return (
    <div className="mb-5 bg-teal-50/60 border border-teal-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-teal-100">
        <Database className="w-3.5 h-3.5 text-teal-600" />
        <p className="text-xs font-bold text-teal-800 uppercase tracking-wide">Active Sources</p>
        <span className="text-[10px] font-semibold bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-2 py-0.5 ml-auto">
          4 connected
        </span>
      </div>
      <div className="divide-y divide-teal-100">
        {AW_CONFIG_SOURCES.map(src => {
          const st = tests[src.name] ?? 'idle'
          return (
            <div key={src.name} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{src.name}</p>
                <p className="text-[11px] text-slate-500">{src.detail}</p>
              </div>
              <span className="text-[10px] font-mono text-slate-400 hidden sm:block">{src.type}</span>
              {st === 'ok' && (
                <span className="text-[10px] text-teal-700 font-medium">{src.latencyMs}ms</span>
              )}
              <button
                onClick={() => runTest(src.name)}
                disabled={st === 'testing'}
                className={`text-[11px] font-medium px-2 py-1 rounded transition-colors flex items-center gap-1 ${
                  st === 'testing' ? 'text-slate-400 cursor-wait' :
                  st === 'ok'      ? 'text-teal-600 hover:bg-teal-100' :
                  'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {st === 'testing' ? <Loader2 className="w-3 h-3 animate-spin" /> :
                 st === 'ok'      ? <CheckCircle2 className="w-3 h-3" /> : null}
                {st === 'ok' ? 'OK' : st === 'testing' ? 'Testing…' : 'Test'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ConfigurationView() {
  const { sectorId, setSector } = useSector()

  // Connector test states
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})
  const [latencies, setLatencies] = useState<Record<string, number>>({})

  // Governance rules (interactive toggles)
  const [rules, setRules] = useState<GovernanceRule[]>(INITIAL_RULES)

  // Custom connectors added via modal
  const [customConnectors, setCustomConnectors] = useState<Array<{ name: string; cat: string }>>([])
  const [showAddModal, setShowAddModal] = useState(false)

  function testConnection(name: string) {
    setTestStates(prev => ({ ...prev, [name]: 'testing' }))
    const delay = 800 + Math.random() * 1200
    setTimeout(() => {
      const latency = Math.floor(15 + Math.random() * 185)
      const ok = Math.random() > 0.08 // 92% success
      setLatencies(prev => ({ ...prev, [name]: latency }))
      setTestStates(prev => ({ ...prev, [name]: ok ? 'ok' : 'error' }))
    }, delay)
  }

  function toggleRule(idx: number) {
    setRules(prev => prev.map((r, i) => i === idx ? { ...r, enabled: !r.enabled } : r))
  }

  function handleAddSource(form: { name: string; type: string }) {
    setCustomConnectors(prev => [...prev, { name: form.name, cat: form.type }])
  }

  const connectors = GENERIC_CONNECTORS.map(c => ({
    ...c,
    connected: c.sectors.includes(sectorId) || c.cat === 'AI' || c.cat === 'DWH' || c.cat === 'Database',
  }))

  const agents = [
    { name: 'Interface Agent',   icon: Bot,      desc: 'Receives natural language requests and routes them to the right specialist', model: 'claude-sonnet-4', traffic: '1.2k req/day' },
    { name: 'Operational Agent', icon: Workflow, desc: 'Coordinates multiple specialized agents for end-to-end multi-step tasks',    model: 'claude-sonnet-4', traffic: '340 req/day'  },
    { ...AGENT_SECTOR[sectorId], icon: Wrench },
    { name: 'Compliance Agent',  icon: Shield,   desc: 'Verifies every decision against EU AI Act policies before release',          model: 'claude-haiku-4',  traffic: '1.2k checks/day' },
  ]

  const activeConnectors = connectors.filter(c => c.connected).length
  const testedOk = Object.values(testStates).filter(s => s === 'ok').length

  return (
    <div className="p-8 space-y-8">
      {showAddModal && (
        <AddSourceModal
          onClose={() => setShowAddModal(false)}
          onSave={handleAddSource}
        />
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Configuration</h1>
        <p className="text-slate-500 mt-1 text-sm">
          Connectors, governance, agents and sector templates — all live and interactive.
        </p>
      </div>

      {/* Section 1: Connectors */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Plug className="w-4 h-4 text-teal-600" />
              Connector Library
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Pre-built connectors — click <strong>Test</strong> to verify latency and connectivity in real time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {testedOk > 0 && (
              <span className="text-xs bg-teal-50 text-teal-700 font-medium px-2 py-1 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />{testedOk} tested OK
              </span>
            )}
            <span className="text-xs bg-slate-100 text-slate-600 font-medium px-2 py-1 rounded-full">
              {activeConnectors} active
            </span>
          </div>
        </div>

        {IS_DEMO_MODE && sectorId === 'manufacturing' && <AWConfigSources />}

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mt-5">
          {connectors.map(c => (
            <ConnectorCard
              key={c.name}
              name={c.name}
              cat={c.cat}
              connected={c.connected}
              beta={c.beta}
              testState={testStates[c.name] ?? 'idle'}
              latency={latencies[c.name] ?? null}
              onTest={() => testConnection(c.name)}
            />
          ))}
          {customConnectors.map(c => (
            <ConnectorCard
              key={c.name}
              name={c.name}
              cat={c.cat}
              connected={false}
              testState={testStates[c.name] ?? 'idle'}
              latency={latencies[c.name] ?? null}
              onTest={() => testConnection(c.name)}
            />
          ))}
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="mt-4 flex items-center gap-2 text-sm text-teal-600 hover:text-teal-800 font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add custom data source
        </button>
      </section>

      {/* Section 2: Governance */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Shield className="w-4 h-4 text-teal-600" />
              Governance & EU AI Act Compliance
            </h2>
            <p className="text-xs text-slate-500">Rules applied automatically to every AI decision. Toggle to configure.</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            <AlertTriangle className="w-3 h-3" />
            <span>{rules.filter(r => !r.enabled && !r.locked).length} rules disabled</span>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          {rules.map((rule, i) => (
            <div
              key={rule.name}
              className={`flex items-start justify-between p-3 border rounded-lg transition-colors ${
                rule.enabled ? 'bg-slate-50/50 border-slate-200' : 'bg-orange-50/30 border-orange-200'
              }`}
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                {rule.enabled
                  ? <Check className="w-4 h-4 text-teal-600 mt-0.5 flex-shrink-0" />
                  : <X className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{rule.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{rule.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                {rule.locked && <span className="text-[10px] uppercase tracking-wide text-slate-400">Locked</span>}
                <Toggle on={rule.enabled} locked={rule.locked} onToggle={() => toggleRule(i)} />
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
        <p className="text-xs text-slate-500">
          Agents operating on the semantic layer of <strong className="text-teal-700">{SECTORS[sectorId].name}</strong>.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
          {agents.map(a => <AgentCard key={a.name} {...a} />)}
        </div>
      </section>

      {/* Section 4: Sector templates */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-1">
          <Database className="w-4 h-4 text-teal-600" />
          Sector Templates
        </h2>
        <p className="text-xs text-slate-500">
          Switch between pre-configured templates to accelerate deployment. Each template includes ontology, mappings and connectors.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-5">
          {(Object.keys(SECTORS) as SectorId[]).map(id => {
            const s = SECTORS[id]
            const isActive = id === sectorId
            const stats = {
              manufacturing: { classes: 8, mappings: 47, conns: 4 },
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
                    <p className="text-sm font-bold text-slate-700">{stats?.classes}</p>
                    <p className="text-[9px] text-slate-400 uppercase tracking-wide">classes</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-slate-700">{stats?.mappings}</p>
                    <p className="text-[9px] text-slate-400 uppercase tracking-wide">mappings</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-slate-700">{stats?.conns}</p>
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

      {/* Section 5: Users & Roles */}
      <UsersSection />

      {/* Section 6: API Tokens */}
      <ApiTokensSection />

      {/* Section 7: Notification Channels */}
      <NotificationsSection />

      {/* Section 8: Audit Log */}
      <AuditLogSection />
    </div>
  )
}
