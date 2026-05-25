import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, ChevronDown, ChevronRight, Bot, User, Lightbulb, GitBranch, BarChart2, Clock, X, AlertTriangle, Sparkles, ListChecks } from 'lucide-react'
import { executeQuery } from '../data/queryEngine'
import type { EngineResult, ChartData } from '../data/queryEngine'
import { useSector } from '../contexts/SectorContext'
import { useExtendedOntology } from '../data/ontologyExtensions'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
  engineResult?: EngineResult
  entities?: string[]
  timestamp: Date
}

// ── Query history helpers ──────────────────────────────────────────────────────

const HISTORY_MAX = 10

function loadHistory(sectorId: string): string[] {
  try {
    const raw = localStorage.getItem(`query-history-${sectorId}`)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch { return [] }
}

function saveToHistory(sectorId: string, query: string, current: string[]): string[] {
  const next = [query, ...current.filter(q => q !== query)].slice(0, HISTORY_MAX)
  localStorage.setItem(`query-history-${sectorId}`, JSON.stringify(next))
  return next
}

// ── Sector-aware suggested questions ─────────────────────────────────────────

const SECTOR_QUESTIONS: Record<string, string[]> = {
  manufacturing: [
    'Who is the top salesperson by revenue in 2014?',
    'What is our total revenue — subtotal vs total due?',
    'How many unique customers after CRM deduplication?',
    'Show orders by territory ranked by sales YTD',
    'Which products generated the most revenue?',
  ],
  retail: [
    'Show the top 10 products by stock level',
    'Which promotions are active?',
    'What is the total amount of paid orders?',
    'Show gold loyalty customers',
  ],
  healthcare: [
    'Show prescriptions issued recently',
    'How many encounters per doctor?',
    'Which treatments have no outcome recorded?',
    'Show active patients',
  ],
  finance: [
    'Show the top 10 loans by amount',
    'What is the average risk score?',
    'Which payments are overdue?',
    'Show pending loan applications',
  ],
}

// ── Inline SVG bar chart ───────────────────────────────────────────────────────

function InlineBarChart({ chart }: { chart: ChartData }) {
  const W = 480
  const H = 180
  const pad = { top: 16, right: 12, bottom: 48, left: 52 }
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom

  const max = Math.max(...chart.values, 1)
  const barW = Math.max(12, Math.floor(innerW / chart.labels.length) - 6)

  return (
    <div className="mt-3 bg-white border border-slate-200 rounded-xl p-3 overflow-x-auto">
      <div className="flex items-center gap-1.5 mb-2">
        <BarChart2 className="w-3.5 h-3.5 text-teal-500" />
        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{chart.title}</span>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {/* Y gridlines + labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = pad.top + innerH * (1 - frac)
          const val = max * frac
          const label = chart.unit === '€'
            ? `${chart.unit}${val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val.toFixed(0)}`
            : `${val.toFixed(0)}${chart.unit ?? ''}`
          return (
            <g key={frac}>
              <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize={9} fill="#94a3b8">{label}</text>
            </g>
          )
        })}

        {/* Bars */}
        {chart.labels.map((lbl, i) => {
          const bH = (chart.values[i] / max) * innerH
          const x = pad.left + i * (innerW / chart.labels.length) + (innerW / chart.labels.length - barW) / 2
          const y = pad.top + innerH - bH
          const isTop = i === 0

          return (
            <g key={i}>
              <rect
                x={x} y={y} width={barW} height={bH}
                rx={3}
                fill={isTop ? '#0d9488' : '#99f6e4'}
              />
              {/* X label */}
              <text
                x={x + barW / 2}
                y={pad.top + innerH + 14}
                textAnchor="middle"
                fontSize={9}
                fill="#64748b"
              >
                {lbl.length > 10 ? lbl.slice(0, 10) + '…' : lbl}
              </text>
              {/* Value on top */}
              {bH > 14 && (
                <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={8} fill="#0f766e" fontWeight={600}>
                  {chart.unit === '€' && chart.values[i] >= 1000
                    ? `€${(chart.values[i] / 1000).toFixed(0)}k`
                    : `${chart.values[i].toFixed(0)}${chart.unit ?? ''}`}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Result table ───────────────────────────────────────────────────────────────

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="text-sm text-slate-500 italic">No results found.</p>

  const columns = Object.keys(rows[0])

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-100">
            {columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left text-slate-400 font-medium whitespace-nowrap">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-200 hover:bg-slate-50 transition-colors">
              {columns.map((col) => (
                <td key={col} className="px-3 py-2 text-slate-700 whitespace-nowrap">
                  {row[col] === null || row[col] === undefined ? (
                    <span className="text-slate-400 italic">null</span>
                  ) : typeof row[col] === 'number' ? (
                    (row[col] as number).toLocaleString('en-US')
                  ) : (
                    String(row[col])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Disambiguation card ────────────────────────────────────────────────────────

function DisambiguationCard({ onChoose }: { onChoose: (q: string) => void }) {
  return (
    <div className="mt-1 bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
        <span className="text-sm font-semibold text-amber-800">Disambiguation required — which "revenue" do you mean?</span>
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">
        The term <span className="font-mono bg-white border border-amber-200 rounded px-1 text-amber-700">fatturato</span> / "revenue" maps to two different database fields in AdventureWorks. Choose which one applies to your analysis:
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onChoose('Show net revenue subtotalAmount by territory')}
          className="bg-white border-2 border-teal-200 hover:border-teal-500 rounded-xl p-4 text-left transition-all group shadow-sm hover:shadow-md"
        >
          <p className="text-2xl font-bold text-teal-600 group-hover:text-teal-700">$20.1M</p>
          <p className="text-xs font-semibold text-slate-800 mt-1.5">Net Revenue</p>
          <p className="text-[10px] font-mono text-slate-500 mt-0.5">subtotal_amount</p>
          <p className="text-[10px] text-slate-400 mt-1">Excl. tax &amp; freight · commercial "fatturato"</p>
          <p className="text-[10px] text-teal-600 font-medium mt-2">Use this →</p>
        </button>
        <button
          onClick={() => onChoose('Show gross revenue totalDue billed amount by territory')}
          className="bg-white border-2 border-blue-200 hover:border-blue-500 rounded-xl p-4 text-left transition-all group shadow-sm hover:shadow-md"
        >
          <p className="text-2xl font-bold text-blue-600 group-hover:text-blue-700">$22.4M</p>
          <p className="text-xs font-semibold text-slate-800 mt-1.5">Gross Revenue</p>
          <p className="text-[10px] font-mono text-slate-500 mt-0.5">total_due</p>
          <p className="text-[10px] text-slate-400 mt-1">Incl. tax &amp; freight · billing amount</p>
          <p className="text-[10px] text-blue-600 font-medium mt-2">Use this →</p>
        </button>
      </div>
      <p className="text-[10px] text-slate-400 italic">
        ⚡ Selecting an option will run a follow-up query using that field definition.
      </p>
    </div>
  )
}

// ── Resolution steps trace ─────────────────────────────────────────────────────

function StepsTrace({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <ListChecks className="w-3 h-3" />
        <span>Semantic layer resolution</span>
      </button>
      {open && (
        <ol className="mt-2 space-y-1 pl-1">
          {steps.map((s, i) => (
            <li key={i} className="text-[11px] text-slate-500 leading-snug flex gap-2">
              <span className="text-teal-500 font-mono font-bold flex-shrink-0">{i + 1}.</span>
              <span>{s.replace(/^[①②③④⑤]\s*/, '')}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// ── SQL collapsible ────────────────────────────────────────────────────────────

function SqlBlock({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>Generated SQL</span>
      </button>
      {open && (
        <pre className="mt-2 text-xs bg-slate-900 border border-slate-700 rounded-lg p-3 text-teal-400 overflow-x-auto">
          {sql}
        </pre>
      )}
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message, onFollowUp }: { message: Message; onFollowUp?: (q: string) => void }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end gap-3 items-start">
        <div className="max-w-[70%] bg-teal-600 rounded-2xl rounded-tr-sm px-4 py-3">
          <p className="text-sm text-white">{message.content}</p>
        </div>
        <div className="w-8 h-8 bg-teal-500/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
          <User className="w-4 h-4 text-teal-400" />
        </div>
      </div>
    )
  }

  if (message.role === 'error') {
    return (
      <div className="flex gap-3 items-start">
        <div className="w-8 h-8 bg-red-500/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot className="w-4 h-4 text-red-400" />
        </div>
        <div className="max-w-[85%] bg-red-500/10 border border-red-500/20 rounded-2xl rounded-tl-sm px-4 py-3">
          <p className="text-sm text-red-400">{message.content}</p>
        </div>
      </div>
    )
  }

  const r = message.engineResult!
  return (
    <div className="flex gap-3 items-start">
      <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 border border-slate-200">
        <Bot className="w-4 h-4 text-teal-400" />
      </div>
      <div className="flex-1 max-w-[85%] bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 space-y-3 shadow-sm">

        {/* Source badges + interpretation row */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <span className="text-[10px] text-slate-400 uppercase tracking-wide">Query</span>
            <p className="text-[11px] text-slate-500 mt-0.5 font-mono leading-snug">{r.interpreted_as}</p>
          </div>
          {r.sources && r.sources.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap flex-shrink-0">
              {r.sources.map(s => (
                <span key={s.id} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>
                  {s.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Summary */}
        <div className="bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
          <p className="text-sm text-slate-700" dangerouslySetInnerHTML={{
            __html: r.summary.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          }} />
        </div>

        {/* Disambiguation card */}
        {r.isDisambiguation && onFollowUp && (
          <DisambiguationCard onChoose={onFollowUp} />
        )}

        {/* Inline chart */}
        {r.chartData && <InlineBarChart chart={r.chartData} />}

        {/* Results table */}
        {r.rows.length > 0 && (
          <div>
            <span className="text-[10px] text-slate-400 uppercase tracking-wide">
              Results ({r.rows.length} rows)
            </span>
            <div className="mt-1.5">
              <ResultTable rows={r.rows} />
            </div>
          </div>
        )}

        {/* Steps trace + SQL in a compact row */}
        <div className="flex flex-col gap-1.5">
          {r.steps && <StepsTrace steps={r.steps} />}
          <SqlBlock sql={r.sql} />
        </div>

        {/* Ontology entities used */}
        {message.entities && message.entities.length > 0 && !r.sources && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <GitBranch className="w-3 h-3 text-teal-500 flex-shrink-0" />
            <span className="text-[10px] text-slate-400 uppercase tracking-wide">Via semantic layer:</span>
            {message.entities.map(e => (
              <span key={e} className="text-[10px] font-mono bg-teal-50 border border-teal-200 text-teal-700 px-1.5 py-0.5 rounded">
                {e}
              </span>
            ))}
          </div>
        )}

        {/* Follow-up suggestions */}
        {r.followUps && r.followUps.length > 0 && onFollowUp && (
          <div className="border-t border-slate-100 pt-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 uppercase tracking-wide">
              <Sparkles className="w-3 h-3" />
              <span>Follow-up questions</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {r.followUps.map(q => (
                <button
                  key={q}
                  onClick={() => onFollowUp(q)}
                  className="text-[11px] bg-slate-50 hover:bg-teal-50 border border-slate-200 hover:border-teal-300 rounded-full px-3 py-1 text-slate-600 hover:text-teal-700 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px] text-slate-300">
          {message.timestamp.toLocaleTimeString('en-US')}
        </p>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function QueryInterface() {
  const { sectorId, sector } = useSector()
  const ontology = useExtendedOntology(sectorId)
  const suggestedQuestions = SECTOR_QUESTIONS[sectorId] ?? SECTOR_QUESTIONS.manufacturing

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<string[]>(() => loadHistory(sectorId))
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setMessages([])
    setHistory(loadHistory(sectorId))
    // Check for pre-fill from dashboard navigation
    const prefill = sessionStorage.getItem('query-prefill')
    if (prefill) {
      sessionStorage.removeItem('query-prefill')
      setTimeout(() => sendMessage(prefill), 100)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = (question: string) => {
    if (!question.trim() || loading) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMsg])
    setHistory(prev => saveToHistory(sectorId, question, prev))
    setInput('')
    setLoading(true)

    // Brief timeout for UX — engine is synchronous
    setTimeout(() => {
      try {
        const result = executeQuery(question, ontology.nodes, sectorId)
        const entities = ontology.nodes
          .filter(n => n.data.db_table && result.sql.toLowerCase().includes(n.data.db_table.toLowerCase()))
          .map(n => n.data.label)

        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result.summary,
          engineResult: result,
          entities,
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, assistantMsg])
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : 'Unknown error'
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'error',
            content: `Error: ${errMsg}`,
            timestamp: new Date(),
          },
        ])
      } finally {
        setLoading(false)
        inputRef.current?.focus()
      }
    }, 420)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 flex-shrink-0 bg-white">
        <h1 className="text-2xl font-bold text-slate-900">Query AI</h1>
        <p className="text-slate-400 mt-1 text-sm">
          {sector.name} · Ask questions in natural language — powered by the semantic layer
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-6 pb-20">
            <div className="w-16 h-16 bg-teal-500/10 rounded-2xl flex items-center justify-center border border-teal-500/20">
              <Bot className="w-8 h-8 text-teal-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">AI Data Assistant</h3>
              <p className="text-slate-400 mt-1 text-sm max-w-md">
                Ask questions about your data in natural language. The engine queries the semantic layer and returns real results with charts.
              </p>
            </div>

            {/* Recent history */}
            {history.length > 0 && (
              <div className="space-y-2 w-full max-w-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Recent queries</span>
                  </div>
                  <button
                    onClick={() => {
                      localStorage.removeItem(`query-history-${sectorId}`)
                      setHistory([])
                    }}
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Clear
                  </button>
                </div>
                {history.slice(0, 5).map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    disabled={loading}
                    className="w-full text-left bg-white hover:bg-teal-50 border border-slate-200 hover:border-teal-300 rounded-xl px-4 py-2.5 text-sm text-slate-500 hover:text-slate-900 transition-all flex items-center gap-2.5"
                  >
                    <Clock className="w-3 h-3 text-slate-300 flex-shrink-0" />
                    <span className="truncate">{q}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Suggested questions */}
            <div className="space-y-2 w-full max-w-lg">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Lightbulb className="w-3.5 h-3.5" />
                <span>Suggested questions for {sector.name}</span>
              </div>
              {suggestedQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  disabled={loading}
                  className="w-full text-left bg-slate-50 hover:bg-white border border-slate-200 hover:border-teal-300 rounded-xl px-4 py-3 text-sm text-slate-600 hover:text-slate-900 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} onFollowUp={sendMessage} />
        ))}

        {loading && (
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0 border border-slate-200">
              <Bot className="w-4 h-4 text-teal-400" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
                <span>Querying semantic layer…</span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-8 py-4 border-t border-slate-200 flex-shrink-0 bg-white">
        {/* Suggested chips when messages exist */}
        {messages.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {suggestedQuestions.map((q) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                disabled={loading}
                className="text-xs bg-slate-50 hover:bg-white border border-slate-200 hover:border-teal-300 rounded-full px-3 py-1 text-slate-500 hover:text-slate-800 transition-all disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-3 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask something about ${sector.name} data…`}
            rows={2}
            disabled={loading}
            className="flex-1 bg-slate-50 border border-slate-200 focus:border-teal-500 rounded-xl px-4 py-3 text-sm text-slate-900 placeholder-slate-400 resize-none outline-none transition-colors disabled:opacity-50"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="btn-primary h-10 w-10 flex items-center justify-center flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
