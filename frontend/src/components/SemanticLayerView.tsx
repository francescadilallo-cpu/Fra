import { useState, useEffect } from 'react'
import { Brain, Database, GitBranch, BarChart3, Layers, Terminal, CheckCircle, Clock, AlertCircle, Play, Loader2 } from 'lucide-react'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

interface SemanticStatus {
  loaded: boolean
  entities: number
  kg_nodes: number
  kg_edges: number
  metadata_rows: number
  sources: { name: string; rows: number; status: string }[]
  dedup_count: number
}

interface SemanticResult {
  question: string
  intent: string
  answer: unknown
  sql?: string
  sources_touched: string[]
  provenance: Record<string, unknown>
  disambiguation_required?: boolean
  candidates?: string[]
  latency_ms: number
}

const MOCK_STATUS: SemanticStatus = {
  loaded: true,
  entities: 8,
  kg_nodes: 193062,
  kg_edges: 313193,
  metadata_rows: 8,
  dedup_count: 372,
  sources: [
    { name: 'erp',    rows: 152825, status: 'ok' },
    { name: 'crm',    rows: 79820,  status: 'ok' },
    { name: 'hr_pim', rows: 794,    status: 'ok' },
  ],
}

const MOCK_RESULTS: Record<string, SemanticResult> = {
  'Qual è il fatturato 2014?': {
    question: 'Qual è il fatturato 2014?',
    intent: 'ambiguous: fatturato',
    answer: null,
    sources_touched: [],
    provenance: {},
    disambiguation_required: true,
    candidates: ['revenue (~subtotal_amount) → $20,057,928', 'revenue_with_tax (~total_due) → $22,419,498'],
    latency_ms: 0,
  },
  'Chi è il venditore con più ordini nel 2014?': {
    question: 'Chi è il venditore con più ordini nel 2014?',
    intent: 'entity=Salesperson, filter year=2014, limit=1',
    answer: { salesperson_ref: 289, order_count: 67, full_name: 'Jae Pak', department: 'Sales' },
    sql: "SELECT salesperson_ref, COUNT(*) as n FROM sales_order_header WHERE strftime('%Y', order_date)='2014' GROUP BY salesperson_ref ORDER BY n DESC LIMIT 1",
    sources_touched: ['erp', 'hr_pim'],
    provenance: { erp: 'sales_order_header', hr_pim: 'dipendenti_hr.csv' },
    latency_ms: 81,
  },
  'Top 5 prodotti più venduti per quantità': {
    question: 'Top 5 prodotti più venduti per quantità',
    intent: 'entity=Product, limit=5',
    answer: [
      { displayName: 'Water Bottle - 30 oz.', qty_total: 4688 },
      { displayName: 'Sport-100 Helmet, Blue', qty_total: 3382 },
      { displayName: 'Patch Kit/8 Patches', qty_total: 3382 },
      { displayName: 'Mountain Tire Tube', qty_total: 3354 },
      { displayName: 'Road Tire Tube', qty_total: 3338 },
    ],
    sources_touched: ['erp', 'hr_pim'],
    provenance: { erp: 'sales_order_line', hr_pim: 'product_catalog_pim.json' },
    latency_ms: 194,
  },
  'Elenco delle aziende clienti B2B attive': {
    question: 'Elenco delle aziende clienti B2B attive',
    intent: 'entity=Customer, filter account_type=B2B',
    answer: '710 aziende B2B attive trovate nel CRM (deduplicate, accountId > 0)',
    sources_touched: ['crm'],
    provenance: { crm: 'account WHERE accountType=B2B AND isActive=1' },
    latency_ms: 6,
  },
  'Qual è il cliente che ha speso di più in assoluto?': {
    question: 'Qual è il cliente che ha speso di più in assoluto?',
    intent: 'metric=revenue_with_tax, entity=Customer, limit=1',
    answer: { customer_ref: 29736, total_spent: 469823.25, display_name: 'Lindsey' },
    sources_touched: ['erp', 'crm'],
    provenance: { erp: 'SUM(total_due) GROUP BY customer_ref', crm: 'account lookup' },
    latency_ms: 25,
  },
}

const COMPONENTS = [
  { key: 'connectors', label: 'Connectors', icon: Database, desc: 'ERP (DuckDB), CRM (SQLite), HR + PIM (Files)' },
  { key: 'ontology',   label: 'Ontology',   icon: GitBranch, desc: 'Pydantic v2 + RDFLib — Customer, Product, SalesOrder…' },
  { key: 'kg',         label: 'Knowledge Graph', icon: Brain, desc: 'NetworkX MultiDiGraph — cross-source identity resolution' },
  { key: 'metadata',   label: 'Metadata Catalog', icon: BarChart3, desc: 'SQLAlchemy — lineage, null rates, freshness, provenance' },
  { key: 'semantic',   label: 'Semantic Layer', icon: Layers, desc: 'NL → Intent → QueryPlan → Result + AmbiguityError' },
]

const SAMPLE_QUESTIONS = [
  'Qual è il fatturato 2014?',
  'Chi è il venditore con più ordini nel 2014?',
  'Top 5 prodotti più venduti per quantità',
  'Elenco delle aziende clienti B2B attive',
  'Qual è il cliente che ha speso di più in assoluto?',
]

export default function SemanticLayerView() {
  const [status, setStatus] = useState<SemanticStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<SemanticResult | null>(null)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { fetchStatus() }, [])

  async function fetchStatus() {
    if (USE_MOCK) { setStatus(MOCK_STATUS); return }
    setLoading(true)
    try {
      const r = await axios.get(`${API}/api/semantic/status`)
      setStatus(r.data)
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }

  async function ask(q: string) {
    if (USE_MOCK) {
      setAsking(true)
      setError(null)
      setResult(null)
      await new Promise(r => setTimeout(r, 400))
      const mock = MOCK_RESULTS[q] ?? {
        question: q,
        intent: 'rule-based match',
        answer: 'Demo: questa risposta verrebbe calcolata dal backend Python in tempo reale.',
        sources_touched: ['erp'],
        provenance: {},
        latency_ms: 12,
      }
      setResult(mock)
      setAsking(false)
      return
    }
    setAsking(true)
    setError(null)
    setResult(null)
    try {
      const r = await axios.post(`${API}/api/semantic/ask`, { question: q })
      setResult(r.data)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Errore nella richiesta'
      setError(msg)
    } finally {
      setAsking(false)
    }
  }

  const isBackendUp = status !== null

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Layers className="w-6 h-6 text-violet-400" />
            Semantic Layer
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Python backend — ontology + knowledge graph + metadata catalog + NL query
          </p>
        </div>
        <button
          onClick={fetchStatus}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      {/* Status grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {COMPONENTS.map(c => (
          <div key={c.key} className="bg-slate-800 rounded-xl p-4 border border-slate-700 flex flex-col gap-2">
            <c.icon className={`w-5 h-5 ${isBackendUp ? 'text-emerald-400' : 'text-slate-500'}`} />
            <div>
              <div className="text-white text-sm font-medium">{c.label}</div>
              <div className="text-slate-500 text-xs mt-0.5">{c.desc}</div>
            </div>
            {isBackendUp
              ? <CheckCircle className="w-4 h-4 text-emerald-400 mt-auto" />
              : <Clock className="w-4 h-4 text-amber-400 mt-auto" />}
          </div>
        ))}
      </div>

      {/* KG Stats */}
      {isBackendUp && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'KG Nodes',  value: status!.kg_nodes.toLocaleString() },
            { label: 'KG Edges',  value: status!.kg_edges.toLocaleString() },
            { label: 'Entities',  value: status!.entities.toLocaleString() },
            { label: 'Dedup\'d',  value: status!.dedup_count.toLocaleString() },
          ].map(s => (
            <div key={s.label} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <div className="text-slate-400 text-xs">{s.label}</div>
              <div className="text-white text-2xl font-bold mt-1">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Not loaded notice */}
      {!isBackendUp && !loading && (
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-amber-300 font-medium text-sm">Backend Python non ancora caricato</div>
            <div className="text-amber-400/70 text-xs mt-1">
              Avvia il sistema con: <code className="bg-slate-800 px-1 rounded">python -m fra.cli load --scenario test_scenario/</code>
            </div>
          </div>
        </div>
      )}

      {/* Query interface */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
        <h2 className="text-white font-semibold flex items-center gap-2">
          <Terminal className="w-4 h-4 text-violet-400" />
          Query Semantica
        </h2>

        <div className="flex gap-2">
          <input
            className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500"
            placeholder="Es. Qual è il fatturato 2014?"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && question.trim() && ask(question.trim())}
          />
          <button
            onClick={() => question.trim() && ask(question.trim())}
            disabled={asking || !question.trim()}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium transition-colors flex items-center gap-2"
          >
            {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Ask
          </button>
        </div>

        {/* Sample questions */}
        <div className="flex flex-wrap gap-2">
          {SAMPLE_QUESTIONS.map(q => (
            <button
              key={q}
              onClick={() => { setQuestion(q); ask(q) }}
              className="text-xs px-3 py-1 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-3">
            {result.disambiguation_required && (
              <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3">
                <div className="text-amber-300 text-sm font-medium">Disambiguazione richiesta</div>
                {result.candidates && (
                  <ul className="mt-1 space-y-1">
                    {result.candidates.map((c, i) => (
                      <li key={i} className="text-amber-400/80 text-xs">• {c}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="bg-slate-900 rounded-lg p-4 space-y-2">
              <div className="text-slate-400 text-xs">Risposta</div>
              <div className="text-white text-sm font-medium">
                {typeof result.answer === 'object'
                  ? <pre className="text-xs text-slate-300 overflow-x-auto">{JSON.stringify(result.answer, null, 2)}</pre>
                  : String(result.answer)}
              </div>
            </div>

            {result.sql && (
              <div className="bg-slate-900 rounded-lg p-3">
                <div className="text-slate-500 text-xs mb-1">SQL generato</div>
                <pre className="text-emerald-400 text-xs overflow-x-auto">{result.sql}</pre>
              </div>
            )}

            <div className="flex flex-wrap gap-2 text-xs">
              <span className="bg-slate-700 rounded px-2 py-1 text-slate-400">
                Fonti: {result.sources_touched.join(', ') || '—'}
              </span>
              <span className="bg-slate-700 rounded px-2 py-1 text-slate-400">
                {result.latency_ms}ms
              </span>
            </div>

            {Object.keys(result.provenance).length > 0 && (
              <details className="text-xs">
                <summary className="text-slate-500 cursor-pointer hover:text-slate-400">Provenance metadata</summary>
                <pre className="mt-2 bg-slate-900 rounded p-3 text-slate-400 overflow-x-auto">
                  {JSON.stringify(result.provenance, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>

      {/* CLI reference */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h2 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-slate-400" />
          CLI Reference
        </h2>
        <div className="space-y-2 font-mono text-xs">
          {[
            ['load', 'python -m fra.cli load --scenario test_scenario/'],
            ['ask',  'python -m fra.cli ask "Qual è il fatturato 2014?"'],
            ['report', 'python -m fra.cli report'],
            ['test', 'pytest tests/test_golden_questions.py -q'],
          ].map(([label, cmd]) => (
            <div key={label} className="flex items-center gap-3">
              <span className="text-violet-400 w-14 shrink-0">{label}</span>
              <code className="text-slate-300 bg-slate-900 px-2 py-1 rounded">{cmd}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
