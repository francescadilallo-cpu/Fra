import { GitBranch, MessageSquare, ArrowRight, CheckCircle2, Activity, Brain, Plug, Network, BookOpen, BotMessageSquare } from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { useExtendedOntology } from '../data/ontologyExtensions'
import { useAgentStore, countFindings } from '../data/agentStore'
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
    desc: 'Collega le fonti dati. Configura il mapping, valida la qualità, esegui l\'ingest nel semantic layer.',
    aw: '3 fonti AW attive: ERP 152k righe · CRM 59k · HR+PIM 794',
  },
  {
    step: 2, section: 'BUILD',
    tab: 'ontology',     icon: GitBranch,      title: 'Ontologia',
    desc: 'Definisci le entità del tuo business e le loro proprietà. Il grafo mostra relazioni e cardinalità.',
    aw: '8 entità AW: Customer 19,829 · SalesOrder 31,465 · Product 504…',
  },
  {
    step: 3, section: 'BUILD',
    tab: 'sembuilder',   icon: Network,        title: 'Knowledge Graph',
    desc: 'Visualizza come le entità si connettono attraverso le fonti. Documenta i bridge cross-source.',
    aw: '193,062 nodi · 313,193 archi · 3 bridge ⚡ (PLACED_BY · SOLD_BY · OF_PRODUCT)',
  },
  {
    step: 4, section: 'BUILD',
    tab: 'mappings',     icon: BookOpen,       title: 'Semantic Layer',
    desc: 'Definisci il significato dei campi. Documenta ambiguità ("fatturato"), traduci schema italiano HR.',
    aw: '47 definizioni semantiche · 2 ambiguità documentate · cross-source bridges',
  },
  {
    step: 5, section: 'QUERY',
    tab: 'query',        icon: MessageSquare,  title: 'Query AI',
    desc: 'Interroga il semantic layer in linguaggio naturale. Il motore risolve join cross-source e ambiguità.',
    aw: '"Chi è il top salesperson?" → Jae Pak, 67 ordini, ERP×HR join',
  },
  {
    step: 6, section: 'ACT',
    tab: 'agents',       icon: BotMessageSquare, title: 'Agents',
    desc: 'Agenti automatici che operano sul semantic layer: anomaly detection, analisi trend, alert.',
    aw: 'Configura agenti su entità AW (Customer, SalesOrder, Salesperson)',
  },
]

export default function OverviewScreen({ onNavigate }: Props) {
  const { sectorId, sector } = useSector()
  const ontology = useExtendedOntology(sectorId)
  const agentRuns = useAgentStore(sectorId)
  const findings = countFindings(agentRuns)

  const entityCount = ontology.nodes.length
  const edgeCount = ontology.edges.length
  const isAW = sectorId === 'manufacturing'

  return (
    <div className="min-h-full bg-white text-slate-900 overflow-auto">

      {/* ── Status bar ─────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 text-white px-12 py-3.5">
        <div className="max-w-5xl flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-xs font-semibold text-teal-400 uppercase tracking-wide">Platform Status</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-teal-400 rounded-full" />
            <span className="text-xs text-slate-300">Ontologia</span>
            <span className="text-xs font-semibold text-white ml-1">{entityCount} entità · {edgeCount} relazioni</span>
          </div>
          {isAW && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-teal-400 rounded-full" />
                <span className="text-xs text-slate-300">Knowledge Graph</span>
                <span className="text-xs font-semibold text-white ml-1">193,062 nodi · 313,193 archi</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-teal-400 rounded-full" />
                <span className="text-xs text-slate-300">Fonti</span>
                <span className="text-xs font-semibold text-white ml-1">ERP · CRM · HR · PIM — connesse</span>
              </div>
            </>
          )}
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${agentRuns.length > 0 ? 'bg-teal-400' : 'bg-slate-500'}`} />
            <span className="text-xs text-slate-300">Agenti</span>
            <span className="text-xs font-semibold text-white ml-1">
              {agentRuns.length > 0
                ? `${agentRuns.length} run · ${findings.critical > 0 ? `${findings.critical} critici` : 'tutto ok'}`
                : 'non ancora avviati'}
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
      <section className="px-12 py-14 border-b border-slate-100">
        <div className="max-w-4xl">
          <span className="inline-block text-xs font-semibold tracking-widest text-teal-600 uppercase mb-4">
            {isAW ? 'Demo — AdventureWorks 2014' : `Demo — ${sector.name}`}
          </span>
          <h1 className="text-4xl font-bold text-slate-900 leading-tight mb-3">
            Semantic<span className="text-teal-600">Intelligence</span>
          </h1>
          <p className="text-lg text-slate-500 mb-6">
            Il semantic layer che trasforma dati distribuiti e disomogenei in conoscenza interrogabile dall'AI.
          </p>

          {isAW ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-8">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Scenario demo — AdventureWorks Cycles</p>
              <p className="text-sm text-slate-600 mb-3 leading-relaxed">
                Azienda produttrice di biciclette con <strong>dati reali distribuiti su 4 sistemi</strong>: ERP (31,465 ordini),
                CRM (20,201 account con 372 duplicati), HR in CSV con schema italiano (290 dipendenti), PIM JSON (504 prodotti).
                I 3 sistemi non parlano la stessa lingua: chiavi diverse, nomi di campo diversi, ambiguità semantiche (es. "fatturato").
              </p>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'ERP — OrionSales', value: '31,465 ordini', sub: 'PostgreSQL / DuckDB', color: 'text-blue-600 bg-blue-50 border-blue-200' },
                  { label: 'CRM — ClientHub',  value: '19,829 clienti', sub: 'SQLite (372 dedup)', color: 'text-teal-600 bg-teal-50 border-teal-200' },
                  { label: 'HR — Dipendenti',  value: '290 dipendenti', sub: 'CSV schema italiano', color: 'text-violet-600 bg-violet-50 border-violet-200' },
                  { label: 'PIM — Catalogo',   value: '504 prodotti', sub: 'JSON', color: 'text-amber-600 bg-amber-50 border-amber-200' },
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
              <p className="text-sm text-slate-600">Settore attivo: <strong>{sector.name}</strong> — {sector.domain}</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button onClick={() => onNavigate('sources')} className="bg-teal-600 text-white rounded-lg px-6 py-3 text-sm font-semibold hover:bg-teal-700 transition-colors">
              Inizia dal Connect →
            </button>
            <button onClick={() => onNavigate('dashboard')} className="border border-slate-200 text-slate-600 rounded-lg px-6 py-3 text-sm font-semibold hover:border-teal-300 hover:text-teal-700 transition-colors">
              Vai al Dashboard
            </button>
          </div>
        </div>
      </section>

      {/* ── Guided journey ─────────────────────────────────────────────────── */}
      <section className="px-12 py-12 border-b border-slate-100 bg-slate-50">
        <div className="max-w-5xl">
          <div className="flex items-center gap-3 mb-2">
            <Brain className="w-5 h-5 text-teal-600" />
            <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">Il Percorso</span>
          </div>
          <h2 className="mt-1 text-2xl font-bold text-slate-900 mb-8">
            Connect → Build → Query → Act — ogni tab è uno step del flusso
          </h2>

          <div className="grid grid-cols-3 gap-4">
            {JOURNEY.map(({ step, section, tab, icon: Icon, title, desc, aw }) => (
              <button
                key={tab}
                onClick={() => onNavigate(tab)}
                className="group text-left bg-white border border-slate-200 hover:border-teal-300 rounded-xl p-4 transition-all hover:shadow-sm"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-teal-50 rounded-lg flex items-center justify-center group-hover:bg-teal-100 transition-colors">
                      <Icon className="w-4 h-4 text-teal-600" />
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{section} {step}</span>
                  </div>
                </div>
                <p className="text-sm font-semibold text-slate-900 mb-1 group-hover:text-teal-700 transition-colors">{title}</p>
                <p className="text-xs text-slate-500 leading-snug mb-2">{desc}</p>
                {aw && (
                  <p className="text-[11px] text-teal-600 font-mono bg-teal-50 rounded px-2 py-1 leading-snug">{aw}</p>
                )}
                <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-teal-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  Apri <ArrowRight className="w-3 h-3" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Il problema → soluzione ────────────────────────────────────────── */}
      <section className="px-12 py-12 border-b border-slate-100">
        <div className="max-w-5xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">Il Problema</span>
          <h2 className="mt-3 text-2xl font-bold text-slate-900 mb-8">
            Il dato c'è. Non si capisce.
          </h2>
          <div className="grid grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5 border-l-4 border-l-red-400">
              <p className="text-3xl font-extrabold text-red-500 mb-2">4</p>
              <p className="text-sm font-semibold text-slate-900 mb-1">sistemi che non si parlano</p>
              <p className="text-xs text-slate-500">ERP, CRM, HR, PIM — ognuno con chiavi, nomenclatura e schema diverso. Nessun join affidabile senza un layer semantico.</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 border-l-4 border-l-amber-400">
              <p className="text-3xl font-extrabold text-amber-500 mb-2">372</p>
              <p className="text-sm font-semibold text-slate-900 mb-1">duplicati nel CRM</p>
              <p className="text-xs text-slate-500">Account con accountId &lt; 0 da una migrazione legacy. Senza dedup, ogni analisi clienti sovrastima del 1.9%.</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 border-l-4 border-l-violet-400">
              <p className="text-3xl font-extrabold text-violet-500 mb-2">"fatturato"</p>
              <p className="text-sm font-semibold text-slate-900 mb-1">termine ambiguo</p>
              <p className="text-xs text-slate-500">subtotal_amount = $20.1M (imponibile) oppure total_due = $22.4M (con tasse e freight)? L'AI deve chiedere, non indovinare.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Cosa risolve questa piattaforma ────────────────────────────────── */}
      <section className="px-12 py-12 border-b border-slate-100 bg-slate-50">
        <div className="max-w-5xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">La Soluzione</span>
          <h2 className="mt-3 text-2xl font-bold text-slate-900 mb-8">
            Un semantic layer che unifica, disambigua e abilita l'AI
          </h2>
          <div className="grid grid-cols-2 gap-6">
            {[
              {
                icon: Network, color: 'border-l-teal-500', bg: 'bg-teal-50',
                title: 'Knowledge Graph cross-source',
                desc: 'I 3 bridge semantici (PLACED_BY, SOLD_BY, OF_PRODUCT) collegano ERP↔CRM↔HR↔PIM. 193k nodi, 313k archi, join affidabili.',
              },
              {
                icon: BookOpen, color: 'border-l-violet-500', bg: 'bg-violet-50',
                title: 'Definizioni semantiche',
                desc: 'Ogni campo ha una definizione formale. Le ambiguità come "fatturato" sono documentate e risolte a query time dal motore AI.',
              },
              {
                icon: MessageSquare, color: 'border-l-blue-500', bg: 'bg-blue-50',
                title: 'Query AI in linguaggio naturale',
                desc: '"Chi è il top salesperson 2014?" → Jae Pak, 67 ordini, $4.1M YTD. Join ERP×HR risolto automaticamente dal layer semantico.',
              },
              {
                icon: BotMessageSquare, color: 'border-l-amber-500', bg: 'bg-amber-50',
                title: 'Agenti su dati affidabili',
                desc: 'Gli agenti operano su un vocabolario condiviso e verificato. Nessuna allucinazione da dati incoerenti. Ogni decisione è tracciabile.',
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
      <section className="px-12 py-16 bg-slate-900">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-white leading-snug mb-6">
            Pronto a esplorare il demo?
          </h2>
          <ul className="text-sm text-slate-400 space-y-2 mb-8 text-left inline-block">
            {[
              'Dati reali AdventureWorks 2014 — 31,465 ordini, 4 sistemi',
              'Knowledge Graph con 193k nodi e 313k relazioni',
              'Query AI in italiano — "Chi è il top salesperson?"',
              'Download CSV per ogni entità dal Data Explorer',
            ].map(item => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-500 flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button onClick={() => onNavigate('sources')} className="bg-teal-600 text-white rounded-lg px-6 py-3 text-sm font-semibold hover:bg-teal-500 transition-colors">
              Inizia dal Connect →
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
