import { useState, useEffect } from 'react'
import { GitBranch, MessageSquare, ArrowRight, CheckCircle2, Activity, Brain, Plug, Network, BookOpen, BotMessageSquare } from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { useExtendedOntology } from '../data/ontologyExtensions'
import { useAgentStore, countFindings } from '../data/agentStore'
import { semanticStatus, getLiveConfig, semanticSources, type SemanticStatus, type LiveConfig } from '../api/semantic'
import { listSources, type BackendSource } from '../api/sources'
import { IS_DEMO_MODE } from '../lib/demoMode'
import type { NavTab } from '../types'

interface Props { onNavigate: (tab: NavTab) => void }

// ── Guided journey steps (matches the nav) ────────────────────────────────────
const JOURNEY: {
  step: number
  section: string
  tab: NavTab
  icon: typeof GitBranch
  title: string
  desc: string
  aw?: string
}[] = [
  {
    step: 1, section: 'CONNECT',
    tab: 'sources',      icon: Plug,           title: 'Data Sources',
    desc: 'Connect your data sources. Configure mappings, validate quality, and ingest into the semantic layer.',
    aw: '3 AW sources active: ERP 152k rows · CRM 59k · HR+PIM 794',
  },
  {
    step: 2, section: 'BUILD',
    tab: 'ontology',     icon: GitBranch,      title: 'Ontology',
    desc: 'Define your business entities and their properties. The graph shows relationships and cardinalities.',
    aw: '8 AW entities: Customer 19,829 · SalesOrder 31,465 · Product 504…',
  },
  {
    step: 3, section: 'BUILD',
    tab: 'sembuilder',   icon: Network,        title: 'Knowledge Graph',
    desc: 'Visualize how entities connect across sources. Document cross-source bridges.',
    aw: '193,062 nodes · 313,193 edges · 3 bridges ⚡ (PLACED_BY · SOLD_BY · OF_PRODUCT)',
  },
  {
    step: 4, section: 'BUILD',
    tab: 'sembuilder',   icon: BookOpen,       title: 'Semantic Layer',
    desc: 'Define the meaning of fields. Document ambiguities, map cross-source field synonyms, and certify metrics.',
    aw: '47 semantic definitions · 2 documented ambiguities · cross-source bridges',
  },
  {
    step: 5, section: 'QUERY',
    tab: 'query',        icon: MessageSquare,  title: 'Query AI',
    desc: 'Ask questions in natural language. The engine resolves joins, ambiguities, and cross-source bridges automatically.',
    aw: '"Who is the top salesperson?" → Linda Mitchell $4.25M · ERP×HR join',
  },
  {
    step: 6, section: 'ACT',
    tab: 'agents',       icon: BotMessageSquare, title: 'Agents',
    desc: 'Automated agents running on the semantic layer: anomaly detection, trend analysis, alerts.',
    aw: '4 AW agents: Sales Performance · CRM Dedup · Revenue Disambiguator · Bridge Validator',
  },
]

export default function OverviewScreen({ onNavigate }: Props) {
  const { sectorId, sector } = useSector()
  const ontology = useExtendedOntology(sectorId)
  const agentRuns = useAgentStore(sectorId)
  const findings = countFindings(agentRuns)
  const [semStatus, setSemStatus] = useState<SemanticStatus | null>(null)
  const [liveConfig, setLiveConfig] = useState<LiveConfig | null>(null)
  const [tableCounts, setTableCounts] = useState<Record<string, number>>({})
  const [registeredSources, setRegisteredSources] = useState<BackendSource[]>([])

  useEffect(() => {
    Promise.all([
      semanticStatus().catch(() => null),
      getLiveConfig().catch(() => null),
      semanticSources().catch(() => null),
      listSources().catch(() => []),
    ]).then(([status, config, srcs, regSrcs]) => {
      if (status) setSemStatus(status)
      if (config) setLiveConfig(config)
      if (srcs) {
        const counts: Record<string, number> = {}
        srcs.forEach(s => Object.entries(s.record_counts ?? {}).forEach(([t, n]) => { counts[t] = n }))
        setTableCounts(counts)
      }
      // Exclude seeded demo sources; only count user-added ones
      setRegisteredSources((regSrcs as BackendSource[]).filter(s => !s.is_default))
    })
  }, [])

  const entityCount = semStatus?.loaded ? semStatus.entities.length : ontology.nodes.length
  const edgeCount = semStatus?.loaded ? semStatus.kg_edges : ontology.edges.length
  const kgNodes = semStatus?.kg_nodes ?? 0
  const isAW = IS_DEMO_MODE && sectorId === 'manufacturing'
  // Sector connectors are demo content; live shows only what the backend reports
  const connectors = liveConfig?.connectors ?? (IS_DEMO_MODE ? sector.connectors : [])

  // Solution-card copy must never leak AdventureWorks specifics into the live
  // (sellable) product — derive it from the user's real sources instead.
  const kgCountFragment = kgNodes > 0
    ? `${kgNodes.toLocaleString()} nodes, ${edgeCount.toLocaleString()} edges`
    : 'Build the layer to generate the graph'
  const kgGraphDesc = IS_DEMO_MODE
    ? `The semantic bridges (PLACED_BY, SOLD_BY, OF_PRODUCT) link ERP↔CRM↔HR↔PIM. ${kgCountFragment}, reliable joins.`
    : connectors.length > 1
      ? `Cross-source bridges link your connected systems (${connectors.slice(0, 4).join(' ↔ ')}). ${kgCountFragment} — reliable joins across sources.`
      : `Entities and their relationships are unified into one graph. ${kgCountFragment} — reliable joins.`
  const semDefDesc = IS_DEMO_MODE
    ? 'Every field has a formal definition. Ambiguities like "fatturato" are documented and resolved at query time by the AI engine.'
    : 'Every field has a formal definition. Ambiguous terms are documented and resolved at query time by the AI engine — so the same word never returns two different numbers.'

  // Derive journey step completion from real system state
  const semBuilt = semStatus?.loaded === true
  const agentsRan = agentRuns.length > 0
  // step 1 = sources, 2 = ontology, 3&4 = sembuilder, 5 = query, 6 = agents
  function stepDone(step: number): boolean {
    // Step 1 (sources): done if any non-default source is registered — regardless of pipeline state
    if (step === 1) return registeredSources.length > 0 || isAW || semBuilt
    if (step === 2) return semBuilt || isAW
    if (step <= 4) return semBuilt
    if (step === 5) return false  // can't auto-detect
    if (step === 6) return agentsRan
    return false
  }

  return (
    <div className="min-h-full bg-white text-slate-900 overflow-auto">

      {/* ── Status bar ─────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 text-white px-4 md:px-8 lg:px-12 py-3.5">
        <div className="max-w-5xl flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-xs font-semibold text-teal-400 uppercase tracking-wide">Platform Status</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-teal-400 rounded-full" />
            <span className="text-xs text-slate-300">Ontology</span>
            <span className="text-xs font-semibold text-white ml-1">{entityCount} entities · {edgeCount} relationships</span>
          </div>
          {(isAW || kgNodes > 0) && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-teal-400 rounded-full" />
              <span className="text-xs text-slate-300">Knowledge Graph</span>
              <span className="text-xs font-semibold text-white ml-1">
                {kgNodes > 0
                  ? `${kgNodes.toLocaleString()} nodes · ${edgeCount.toLocaleString()} edges`
                  : 'not yet built'}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${connectors.length > 0 || registeredSources.length > 0 ? 'bg-teal-400' : 'bg-slate-500'}`} />
            <span className="text-xs text-slate-300">Sources</span>
            <span className="text-xs font-semibold text-white ml-1">
              {connectors.length > 0
                ? `${connectors.slice(0, 4).map(c => c.split(' ')[0]).join(' · ')} — ${connectors.length} connected`
                : registeredSources.length > 0
                  ? `${registeredSources.slice(0, 4).map(s => s.label).join(' · ')} — ${registeredSources.length} registered`
                  : 'none connected yet'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${agentRuns.length > 0 ? 'bg-teal-400' : 'bg-slate-500'}`} />
            <span className="text-xs text-slate-300">Agents</span>
            <span className="text-xs font-semibold text-white ml-1">
              {agentRuns.length > 0
                ? `${agentRuns.length} run · ${findings.critical > 0 ? `${findings.critical} critical` : 'all clear'}`
                : 'not started yet'}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => onNavigate('query')} className="text-xs bg-teal-600 hover:bg-teal-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">
              Query AI →
            </button>
            <button onClick={() => onNavigate('process')} className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">
              Run Pipeline →
            </button>
          </div>
        </div>
      </div>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="px-4 md:px-8 lg:px-12 py-14 border-b border-slate-100">
        <div className="max-w-4xl">
          <span className="inline-block text-xs font-semibold tracking-widest text-teal-600 uppercase mb-4">
            {IS_DEMO_MODE ? `Demo — ${sector.name}` : 'Live workspace'}
          </span>
          <h1 className="text-4xl font-bold text-slate-900 leading-tight mb-3">
            Semantic<span className="text-teal-600">Intelligence</span>
          </h1>
          <p className="text-lg text-slate-500 mb-6">
            The semantic layer that transforms distributed, heterogeneous data into AI-queryable knowledge.
          </p>

          {isAW ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-8">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Demo scenario — AdventureWorks Cycles</p>
              <p className="text-sm text-slate-600 mb-3 leading-relaxed">
                A bicycle manufacturer with <strong>real data distributed across 4 systems</strong>: ERP (orders),
                CRM (accounts with duplicates), HR in CSV with Italian schema (employees), PIM JSON (products).
                The systems don't share a common language: different keys, different field names, semantic ambiguities (e.g. "fatturato").
              </p>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'ERP — OrionSales', value: `${(tableCounts.sales_order_header ?? (IS_DEMO_MODE ? 31465 : 0)).toLocaleString()} orders`,  sub: 'PostgreSQL / DuckDB',  color: 'text-blue-600 bg-blue-50 border-blue-200' },
                  { label: 'CRM — ClientHub',  value: `${((tableCounts.account ?? (IS_DEMO_MODE ? 20201 : 0)) - (semStatus?.dedup_count ?? (IS_DEMO_MODE ? 372 : 0))).toLocaleString()} clients`, sub: `SQLite (${semStatus?.dedup_count ?? (IS_DEMO_MODE ? 372 : 0)} dedup)`, color: 'text-teal-600 bg-teal-50 border-teal-200' },
                  { label: 'HR — Employees',   value: `${(tableCounts.dipendenti_hr ?? (IS_DEMO_MODE ? 290 : 0)).toLocaleString()} employees`, sub: 'CSV Italian schema',   color: 'text-violet-600 bg-violet-50 border-violet-200' },
                  { label: 'PIM — Catalog',    value: `${(tableCounts.product_catalog_pim ?? (IS_DEMO_MODE ? 504 : 0)).toLocaleString()} products`, sub: 'JSON',              color: 'text-amber-600 bg-amber-50 border-amber-200' },
                ].map(s => (
                  <div key={s.label} className={`border rounded-lg px-3 py-2.5 ${s.color}`}>
                    <p className="text-[11px] font-semibold">{s.label}</p>
                    <p className="text-base font-bold mt-0.5">{s.value}</p>
                    <p className="text-[10px] opacity-70 mt-0.5">{s.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-8">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                {IS_DEMO_MODE ? `Active sector — ${sector.name}` : 'Workspace status'}
              </p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Data Sources',    value: String(connectors.length || registeredSources.length),  sub: IS_DEMO_MODE ? sector.domain : (connectors.length > 0 ? connectors.slice(0, 3).join(' · ') : registeredSources.length > 0 ? `${registeredSources.length} registered — run pipeline` : 'Connect your first source') },
                  { label: 'Ontology Entities', value: String(entityCount),             sub: `${edgeCount} relationships` },
                  { label: 'Semantic Layer',  value: semBuilt ? 'Built' : 'Pending',    sub: semBuilt ? `${kgNodes.toLocaleString()} KG nodes` : 'Run pipeline to build' },
                ].map(s => (
                  <div key={s.label} className="border border-slate-200 rounded-lg px-3 py-2.5 bg-white">
                    <p className="text-[11px] font-semibold text-slate-500">{s.label}</p>
                    <p className="text-base font-bold text-slate-900 mt-0.5">{s.value}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 truncate">{s.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            {IS_DEMO_MODE ? (
              <button onClick={() => onNavigate('sources')} className="bg-teal-600 text-white rounded-lg px-6 py-3 text-sm font-semibold hover:bg-teal-700 transition-colors">
                Start from Connect →
              </button>
            ) : semBuilt ? (
              <button onClick={() => onNavigate('query')} className="bg-teal-600 text-white rounded-lg px-6 py-3 text-sm font-semibold hover:bg-teal-700 transition-colors">
                Query Your Data →
              </button>
            ) : (registeredSources.length > 0 || connectors.length > 0) ? (
              <button onClick={() => onNavigate('process')} className="bg-teal-600 text-white rounded-lg px-6 py-3 text-sm font-semibold hover:bg-teal-700 transition-colors">
                Run Pipeline →
              </button>
            ) : (
              <button onClick={() => onNavigate('sources')} className="bg-teal-600 text-white rounded-lg px-6 py-3 text-sm font-semibold hover:bg-teal-700 transition-colors">
                Connect First Source →
              </button>
            )}
            <button onClick={() => onNavigate('dashboard')} className="border border-slate-200 text-slate-600 rounded-lg px-6 py-3 text-sm font-semibold hover:border-teal-300 hover:text-teal-700 transition-colors">
              Go to Dashboard
            </button>
          </div>
        </div>
      </section>

      {/* ── Guided journey ─────────────────────────────────────────────────── */}
      <section className="px-4 md:px-8 lg:px-12 py-12 border-b border-slate-100 bg-slate-50">
        <div className="max-w-5xl">
          <div className="flex items-center gap-3 mb-2">
            <Brain className="w-5 h-5 text-teal-600" />
            <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">The Journey</span>
          </div>
          <h2 className="mt-1 text-2xl font-bold text-slate-900 mb-8">
            Connect → Build → Query → Act — each tab is a step in the flow
          </h2>

          <div className="grid grid-cols-3 gap-4">
            {JOURNEY.map(({ step, section, tab, icon: Icon, title, desc, aw }) => {
              const done = stepDone(step)
              return (
                <button
                  key={`${tab}-${step}`}
                  onClick={() => onNavigate(tab)}
                  className={`group text-left rounded-xl p-4 transition-all hover:shadow-sm border ${
                    done
                      ? 'bg-teal-50/40 border-teal-200 hover:border-teal-300'
                      : 'bg-white border-slate-200 hover:border-teal-300'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                        done ? 'bg-teal-100 group-hover:bg-teal-200' : 'bg-teal-50 group-hover:bg-teal-100'
                      }`}>
                        <Icon className="w-4 h-4 text-teal-600" />
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{section} {step}</span>
                    </div>
                    {done && <CheckCircle2 className="w-4 h-4 text-teal-500 flex-shrink-0" />}
                  </div>
                  <p className="text-sm font-semibold text-slate-900 mb-1 group-hover:text-teal-700 transition-colors">{title}</p>
                  <p className="text-xs text-slate-500 leading-snug mb-2">{desc}</p>
                  {isAW && aw && (
                    <p className="text-[11px] text-teal-600 font-mono bg-teal-50 rounded px-2 py-1 leading-snug">{aw}</p>
                  )}
                  <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-teal-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    Open <ArrowRight className="w-3 h-3" />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Problem → Solution ─────────────────────────────────────────────── */}
      <section className="px-4 md:px-8 lg:px-12 py-12 border-b border-slate-100">
        <div className="max-w-5xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">The Problem</span>
          <h2 className="mt-3 text-2xl font-bold text-slate-900 mb-8">
            The data is there. It just can't be understood.
          </h2>
          <div className="grid grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5 border-l-4 border-l-red-400">
              <p className="text-3xl font-extrabold text-red-500 mb-2">{connectors.length > 0 ? connectors.length : registeredSources.length > 0 ? registeredSources.length : 'N'}</p>
              <p className="text-sm font-semibold text-slate-900 mb-1">systems that don't talk to each other</p>
              <p className="text-xs text-slate-500">{liveConfig?.domain ?? (IS_DEMO_MODE ? sector.domain : 'Your data landscape')} — each with different keys, naming conventions, and schemas. No reliable join without a semantic layer.</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 border-l-4 border-l-amber-400">
              {isAW ? (
                <>
                  <p className="text-3xl font-extrabold text-amber-500 mb-2">{semStatus?.dedup_count ?? (IS_DEMO_MODE ? 372 : 0)}</p>
                  <p className="text-sm font-semibold text-slate-900 mb-1">duplicates in the CRM</p>
                  <p className="text-xs text-slate-500">Accounts with accountId &lt; 0 from a legacy migration. Without dedup, every customer analysis is overestimated.</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-extrabold text-amber-500 mb-2">?</p>
                  <p className="text-sm font-semibold text-slate-900 mb-1">silent data quality issues</p>
                  <p className="text-xs text-slate-500">Duplicates, orphaned records, and stale caches spread across systems — invisible until a query returns the wrong number.</p>
                </>
              )}
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 border-l-4 border-l-violet-400">
              {isAW ? (
                <>
                  <p className="text-3xl font-extrabold text-violet-500 mb-2">"fatturato"</p>
                  <p className="text-sm font-semibold text-slate-900 mb-1">ambiguous term</p>
                  <p className="text-xs text-slate-500">subtotal_amount = $20.1M (net) or total_due = $22.4M (with tax & freight)? AI must ask, not guess.</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-extrabold text-violet-500 mb-2">≠</p>
                  <p className="text-sm font-semibold text-slate-900 mb-1">same term, different meaning</p>
                  <p className="text-xs text-slate-500">Fields like "revenue", "patient", or "exposure" mean different things across systems. Without disambiguation, AI returns wrong answers.</p>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Solution ───────────────────────────────────────────────────────── */}
      <section className="px-4 md:px-8 lg:px-12 py-12 border-b border-slate-100 bg-slate-50">
        <div className="max-w-5xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">The Solution</span>
          <h2 className="mt-3 text-2xl font-bold text-slate-900 mb-8">
            A semantic layer that unifies, disambiguates, and empowers AI
          </h2>
          <div className="grid grid-cols-2 gap-6">
            {[
              {
                icon: Network, color: 'border-l-teal-500', bg: 'bg-teal-50',
                title: 'Cross-source Knowledge Graph',
                desc: kgGraphDesc,
              },
              {
                icon: BookOpen, color: 'border-l-violet-500', bg: 'bg-violet-50',
                title: 'Semantic Definitions',
                desc: semDefDesc,
              },
              {
                icon: MessageSquare, color: 'border-l-blue-500', bg: 'bg-blue-50',
                title: 'Natural Language Query AI',
                desc: 'Ask any question in natural language — the AI engine translates to SQL, resolves cross-source joins automatically, and disambiguates ambiguous terms.',
              },
              {
                icon: BotMessageSquare, color: 'border-l-amber-500', bg: 'bg-amber-50',
                title: 'Agents on reliable data',
                desc: 'Agents operate on a shared, verified vocabulary. No hallucinations from inconsistent data. Every decision is traceable.',
              },
            ].map(({ icon: Icon, color, bg, title, desc }) => (
              <div key={title} className={`bg-white border border-slate-200 rounded-xl p-5 border-l-4 ${color}`}>
                <div className={`w-8 h-8 ${bg} rounded-lg flex items-center justify-center mb-3`}>
                  <Icon className="w-4 h-4 text-slate-700" />
                </div>
                <h3 className="font-semibold text-slate-900 mb-2">{title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <section className="px-4 md:px-8 lg:px-12 py-16 bg-slate-900">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-white leading-snug mb-6">
            {IS_DEMO_MODE ? 'Ready to explore the demo?' : 'Ready to build your semantic layer?'}
          </h2>
          <ul className="text-sm text-slate-400 space-y-2 mb-8 text-left inline-block">
            {(IS_DEMO_MODE ? [
              `${sector.name} demo data — ${sector.funnel[0]?.count.toLocaleString('en-US') ?? '—'} records, ${connectors.length} connected systems`,
              ...(isAW ? [`Knowledge Graph with ${kgNodes > 0 ? kgNodes.toLocaleString('en-US') : '193k'} nodes and ${edgeCount > 0 ? edgeCount.toLocaleString('en-US') : '313k'} edges`] : []),
              'Natural language Query AI — ask questions in plain English',
              'Download CSV for each entity from the Data Explorer',
            ] : [
              connectors.length > 0
                ? `${connectors.length} data source${connectors.length !== 1 ? 's' : ''} connected — ${connectors.slice(0, 3).join(', ')}`
                : registeredSources.length > 0
                  ? `${registeredSources.length} data source${registeredSources.length !== 1 ? 's' : ''} registered — run pipeline to activate`
                  : 'Connect your data sources — databases, files, SaaS connectors',
              semBuilt
                ? `Semantic layer built — ${kgNodes.toLocaleString('en-US')} knowledge graph nodes`
                : 'Build the semantic layer — entities, relations, and metrics auto-extracted',
              'Natural language Query AI — ask questions in plain English',
              'Define agents to monitor data quality and business KPIs',
            ]).map(item => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-500 flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button onClick={() => onNavigate('sources')} className="bg-teal-600 text-white rounded-lg px-6 py-3 text-sm font-semibold hover:bg-teal-500 transition-colors">
              Start from Connect →
            </button>
            <button onClick={() => onNavigate('query')} className="bg-slate-700 text-slate-200 rounded-lg px-6 py-3 text-sm font-semibold hover:bg-slate-600 transition-colors">
              Query AI →
            </button>
            <button onClick={() => onNavigate('dashboard')} className="border border-slate-600 text-slate-300 rounded-lg px-6 py-3 text-sm font-semibold hover:border-teal-500 hover:text-teal-400 transition-colors">
              Dashboard
            </button>
          </div>
        </div>
      </section>

    </div>
  )
}
