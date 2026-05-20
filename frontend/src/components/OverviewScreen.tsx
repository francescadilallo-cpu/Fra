import { GitBranch, Bot, Table2, MessageSquare, Workflow, Settings, ArrowRight, CheckCircle2, Activity, Brain, Wand2 } from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { useExtendedOntology } from '../data/ontologyExtensions'
import { useAgentStore, countFindings } from '../data/agentStore'
import type { NavTab } from '../types'

interface Props {
  onNavigate: (tab: NavTab) => void
}

const CAPABILITIES: {
  tab: NavTab
  icon: typeof GitBranch
  title: string
  desc: string
  badge?: string
}[] = [
  { tab: 'ontology',  icon: GitBranch,    title: 'Ontology Graph',    desc: 'Visualize entities, relations, and typed properties as an interactive knowledge graph.' },
  { tab: 'builder',   icon: Wand2,         title: 'Builder AI',        desc: 'Describe new entities in natural language — the AI extends the ontology automatically.', badge: 'AI' },
  { tab: 'agents',    icon: Bot,           title: 'Agent Orchestration', desc: 'Parallel agents run anomaly detection, trend analysis and risk assessment — with real findings.' },
  { tab: 'data',      icon: Table2,        title: 'Data Explorer',     desc: 'Browse realistic mock data for every entity. Sortable, filterable, paginated.' },
  { tab: 'query',     icon: MessageSquare, title: 'Query AI',          desc: 'Ask questions in natural language — the engine generates SQL, queries mock data, renders charts.', badge: 'AI' },
  { tab: 'process',   icon: Workflow,      title: 'Pipeline Executor', desc: 'Run the live ETL pipeline: Connect → Extract → Map → Enrich → Index. Watch it in real time.' },
  { tab: 'mappings',  icon: Table2,        title: 'Mappings',          desc: 'Inspect and edit how every ERP field maps to an ontology concept. Inline editing.' },
  { tab: 'config',    icon: Settings,      title: 'Configuration',     desc: 'Test connector latency, toggle governance rules, add custom data sources.' },
]

export default function OverviewScreen({ onNavigate }: Props) {
  const { sectorId, sector } = useSector()
  const ontology = useExtendedOntology(sectorId)
  const agentRuns = useAgentStore(sectorId)
  const findings = countFindings(agentRuns)

  const entityCount = ontology.nodes.length
  const propCount = ontology.nodes.reduce((a, n) => a + n.data.properties.length, 0)
  const edgeCount = ontology.edges.length

  return (
    <div className="min-h-full bg-white text-slate-900 overflow-auto">

      {/* ── Live platform status strip ────────────────────────────────────── */}
      <div className="bg-slate-900 text-white px-12 py-4">
        <div className="max-w-5xl flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-xs font-semibold text-teal-400 uppercase tracking-wide">Live Platform</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-teal-400 rounded-full" />
            <span className="text-xs text-slate-300">Semantic Layer</span>
            <span className="text-xs font-semibold text-white ml-1">{entityCount} entities · {propCount} props · {edgeCount} relations</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${agentRuns.length > 0 ? 'bg-teal-400' : 'bg-slate-500'}`} />
            <span className="text-xs text-slate-300">Agents</span>
            <span className="text-xs font-semibold text-white ml-1">
              {agentRuns.length > 0
                ? `${agentRuns.length} run · ${findings.critical > 0 ? `${findings.critical} critical` : 'all clear'}`
                : 'not yet run'}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-amber-400 rounded-full" />
            <span className="text-xs text-slate-300">Sector</span>
            <span className="text-xs font-semibold text-white ml-1">{sector.name}</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => onNavigate('process')}
              className="text-xs bg-teal-600 hover:bg-teal-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
            >
              Run Pipeline →
            </button>
            <button
              onClick={() => onNavigate('query')}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
            >
              Ask AI →
            </button>
          </div>
        </div>
      </div>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="px-12 py-16 border-b border-slate-100">
        <div className="max-w-3xl">
          <span className="inline-block text-xs font-semibold tracking-widest text-teal-600 uppercase mb-6">
            Pitch · 2026
          </span>
          <h1 className="text-4xl font-bold text-slate-900 leading-tight mb-3">
            Semantic<span className="text-teal-600">Intelligence</span>
          </h1>
          <p className="text-lg text-slate-500 mb-8">
            The Missing Infrastructure Layer for Enterprise AI
          </p>
          <blockquote className="border-l-2 border-teal-500 pl-4 mb-10">
            <p className="italic text-slate-600 text-base leading-relaxed">
              "We build the foundation that turns European mid-market companies into true Agentic
              Organizations — where AI agents operate on trusted, shared knowledge and every
              decision is traceable, compliant, and fast."
            </p>
          </blockquote>
          <div className="flex items-center gap-3">
            <button onClick={() => onNavigate('dashboard')} className="bg-teal-600 text-white rounded-lg px-6 py-3 text-sm font-semibold hover:bg-teal-700 transition-colors">
              Explore the Demo →
            </button>
            <button onClick={() => onNavigate('ontology')} className="border border-slate-200 text-slate-600 rounded-lg px-6 py-3 text-sm font-semibold hover:border-teal-300 hover:text-teal-700 transition-colors">
              View Knowledge Graph
            </button>
          </div>
        </div>
      </section>

      {/* ── Platform capabilities grid ─────────────────────────────────────── */}
      <section className="px-12 py-14 border-b border-slate-100 bg-slate-50">
        <div className="max-w-5xl">
          <div className="flex items-center gap-3 mb-2">
            <Brain className="w-5 h-5 text-teal-600" />
            <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">Platform Demo</span>
          </div>
          <h2 className="mt-1 text-2xl font-bold text-slate-900 mb-8">
            Everything is live and interactive — explore each module
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {CAPABILITIES.map(({ tab, icon: Icon, title, desc, badge }) => (
              <button
                key={tab}
                onClick={() => onNavigate(tab)}
                className="group text-left bg-white border border-slate-200 hover:border-teal-300 rounded-xl p-4 transition-all hover:shadow-sm"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-9 h-9 bg-teal-50 rounded-lg flex items-center justify-center group-hover:bg-teal-100 transition-colors">
                    <Icon className="w-4 h-4 text-teal-600" />
                  </div>
                  {badge && (
                    <span className="text-[9px] font-bold bg-teal-600 text-white rounded px-1.5 py-0.5 leading-none">{badge}</span>
                  )}
                </div>
                <p className="text-sm font-semibold text-slate-900 mb-1 group-hover:text-teal-700 transition-colors">{title}</p>
                <p className="text-xs text-slate-500 leading-snug">{desc}</p>
                <div className="mt-3 flex items-center gap-1 text-[11px] font-medium text-teal-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  Explore <ArrowRight className="w-3 h-3" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── The problem ───────────────────────────────────────────────────── */}
      <section className="px-12 py-14 border-b border-slate-100">
        <div className="max-w-5xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">01 — THE PROBLEM</span>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 mb-10">
            <span className="font-extrabold">95%</span> of enterprise AI initiatives fail
          </h2>
          <div className="grid grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-red-500">
              <p className="text-4xl font-extrabold text-red-500 mb-2">95%</p>
              <p className="text-sm font-semibold text-slate-900 mb-1">of enterprise AI initiatives generate no value</p>
              <p className="text-xs text-slate-500 mb-3">Only 5% of custom AI solutions reach production scale</p>
              <p className="text-xs text-slate-400 italic">Source: MIT / World Economic Forum</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-amber-500">
              <p className="text-4xl font-extrabold text-amber-500 mb-2">42%</p>
              <p className="text-sm font-semibold text-slate-900 mb-1">of companies abandoned AI projects in 2025</p>
              <p className="text-xs text-slate-500 mb-3">Up from 17% the year before</p>
              <p className="text-xs text-slate-400 italic">Source: S&amp;P Global</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-teal-500">
              <p className="text-4xl font-extrabold text-teal-600 mb-2">2-4 y</p>
              <p className="text-sm font-semibold text-slate-900 mb-1">average time to see ROI (expected: 7-12 months)</p>
              <p className="text-xs text-slate-500 mb-3">Only 6% of EU executives see returns within 12 months</p>
              <p className="text-xs text-slate-400 italic">Source: Deloitte EU</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Root causes ───────────────────────────────────────────────────── */}
      <section className="px-12 py-12 border-b border-slate-100 bg-slate-50">
        <div className="max-w-5xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">01 — THE PROBLEM</span>
          <h2 className="mt-3 text-2xl font-bold text-slate-900 mb-8">
            Companies are racing toward AI <span className="font-extrabold">and getting nothing in return</span>
          </h2>
          <div className="grid grid-cols-3 gap-6">
            {[
              { icon: '🗄️', title: 'Fragmented Data', color: 'border-l-red-400', desc: 'ERP, CRM, MES, Excel sheets — each with its own language. No reliable AI output.' },
              { icon: '🍝', title: 'Spaghetti AI',    color: 'border-l-amber-400', desc: 'Each business function launches its own AI project with different logic, vendors, and metrics.' },
              { icon: '🤖', title: 'Hallucinating Agents', color: 'border-l-orange-400', desc: 'Agents on undefined data produce unverifiable outputs. Companies lose trust.' },
            ].map(({ icon, title, color, desc }) => (
              <div key={title} className={`bg-white border border-slate-200 rounded-xl p-6 border-l-4 ${color}`}>
                <div className="text-2xl mb-3">{icon}</div>
                <h3 className="font-semibold text-slate-900 mb-2">{title}</h3>
                <p className="text-sm text-slate-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Solution ──────────────────────────────────────────────────────── */}
      <section className="px-12 py-14 border-b border-slate-100">
        <div className="max-w-5xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">02 — THE SOLUTION</span>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 mb-10">
            The answer is not more AI. <span className="font-extrabold">It is the foundation beneath it.</span>
          </h2>
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-teal-500">
              <h3 className="font-semibold text-slate-900 text-lg mb-2">The Semantic Foundation</h3>
              <p className="text-sm text-slate-500 mb-5">A formal semantic model of the business, structured into two interconnected layers.</p>
              <div className="space-y-3">
                <div className="bg-teal-50 rounded-lg px-4 py-3">
                  <p className="text-sm font-semibold text-teal-800">Ontological Layer</p>
                  <p className="text-xs text-teal-700 mt-0.5">Defines entities, relations and rules across all systems</p>
                </div>
                <div className="bg-teal-50 rounded-lg px-4 py-3">
                  <p className="text-sm font-semibold text-teal-800">Executive Layer</p>
                  <p className="text-xs text-teal-700 mt-0.5">Translates agent decisions into real actions on the systems</p>
                </div>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-amber-400">
              <h3 className="font-semibold text-slate-900 text-lg mb-2">Agentic Orchestration</h3>
              <p className="text-sm text-slate-500 mb-5">Built on the semantic foundation, AI agents share context, hand off tasks and generate value across the organization.</p>
              <div className="space-y-3">
                <div className="bg-amber-50 rounded-lg px-4 py-3">
                  <p className="text-sm font-semibold text-amber-800">MCP-compatible API layer</p>
                </div>
                <div className="bg-amber-50 rounded-lg px-4 py-3">
                  <p className="text-sm font-semibold text-amber-800">Verified common vocabulary</p>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-8 text-center text-sm text-slate-500 italic">
            Most companies build AI agents on sand. We help you build them on rock.
          </p>
        </div>
      </section>

      {/* ── Market ────────────────────────────────────────────────────────── */}
      <section className="px-12 py-14 border-b border-slate-100 bg-slate-50">
        <div className="max-w-5xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">04 — MARKET OPPORTUNITY</span>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 mb-10">
            A <span className="font-extrabold">$7.7B</span> market growing at 23% — <span className="font-extrabold">with a gap in the EU mid-market</span>
          </h2>
          <div className="space-y-4">
            {[
              { value: '$2.71B',      label: 'Market size 2025',  sub: 'growing to $7.73B by 2030' },
              { value: '23.3%',       label: 'CAGR 2025-2030',    sub: 'services segment: 27.8% CAGR' },
              { value: 'EU Mid-Market', label: 'White Space',     sub: 'No player combines formal ontology + AI-assisted deployment + agentic layer for the EU mid-market. This is our structural entry point.' },
            ].map(({ value, label, sub }) => (
              <div key={label} className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-6 border-l-4 border-l-teal-500">
                <p className="text-2xl font-bold text-teal-600 w-32 flex-shrink-0 leading-tight">{value}</p>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{label}</p>
                  <p className="text-xs text-slate-500">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section className="px-12 py-20 bg-slate-900">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white leading-snug mb-8">
            We build the semantic layer<br />every AI-powered company<br />
            <span className="font-extrabold text-teal-400">in Europe needs</span>
          </h2>
          <ul className="text-sm text-slate-400 space-y-2 mb-10 text-left inline-block">
            {[
              '$7.7B market · 23% CAGR · underserved EU mid-market',
              'Zero direct competitors in our exact positioning',
              'Revenue from day one via consulting model',
              'EU AI Act creates immediate regulatory tailwind',
            ].map(item => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-500 flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => onNavigate('dashboard')} className="bg-teal-600 text-white rounded-lg px-6 py-3 text-sm font-semibold hover:bg-teal-500 transition-colors">
              Explore the Demo →
            </button>
            <button onClick={() => onNavigate('process')} className="border border-slate-600 text-slate-300 rounded-lg px-6 py-3 text-sm font-semibold hover:border-teal-500 hover:text-teal-400 transition-colors">
              Run Pipeline
            </button>
          </div>
        </div>
      </section>

    </div>
  )
}
