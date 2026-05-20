import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, ChevronDown, ChevronRight, Bot, User, Lightbulb } from 'lucide-react'
import { runQuery } from '../api/client'
import type { QueryResult } from '../types'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
  result?: QueryResult
  timestamp: Date
}

// ── Suggested questions ────────────────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  'Which customers have accepted quotes?',
  'Show the 5 products with the highest unit price',
  'What is the total value of orders in production?',
]

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
                    <span className="text-slate-600 italic">null</span>
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

// ── SQL collapsible ────────────────────────────────────────────────────────────

function SqlBlock({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>Generated SQL</span>
      </button>
      {open && (
        <pre className="mt-2 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 text-teal-600 overflow-x-auto">
          {sql}
        </pre>
      )}
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
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

  const r = message.result!
  return (
    <div className="flex gap-3 items-start">
      <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 border border-slate-200">
        <Bot className="w-4 h-4 text-teal-400" />
      </div>
      <div className="flex-1 max-w-[85%] bg-slate-50 border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 space-y-3">
        {/* Interpreted as */}
        <div>
          <span className="text-xs text-slate-500 uppercase tracking-wide">Interpretation</span>
          <p className="text-sm text-slate-600 mt-0.5 italic">{r.interpreted_as}</p>
        </div>

        {/* Summary */}
        <div className="bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
          <p className="text-sm text-slate-700">{r.summary}</p>
        </div>

        {/* Results table */}
        {r.results.length > 0 && (
          <div>
            <span className="text-xs text-slate-500 uppercase tracking-wide">
              Results ({r.results.length})
            </span>
            <div className="mt-1.5">
              <ResultTable rows={r.results} />
            </div>
          </div>
        )}

        {/* SQL */}
        <SqlBlock sql={r.sql_query} />

        <p className="text-xs text-slate-600">
          {message.timestamp.toLocaleTimeString('en-US')}
        </p>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function QueryInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (question: string) => {
    if (!question.trim() || loading) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const result = await runQuery(question)
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.summary,
        result,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : 'Unknown error'
      // Try to extract FastAPI error detail
      const axiosErr = e as { response?: { data?: { detail?: string } } }
      const detail = axiosErr?.response?.data?.detail ?? errMsg
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'error',
          content: `Error: ${detail}`,
          timestamp: new Date(),
        },
      ])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
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
      <div className="px-8 py-5 border-b border-slate-200 flex-shrink-0">
        <h1 className="text-2xl font-bold text-slate-900">Query AI</h1>
        <p className="text-slate-400 mt-1 text-sm">
          Ask questions in natural language about your ERP data
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
                Ask questions about your data in English. The AI will generate SQL queries and respond clearly.
              </p>
            </div>

            {/* Suggested questions */}
            <div className="space-y-2 w-full max-w-lg">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Lightbulb className="w-3.5 h-3.5" />
                <span>Suggested questions</span>
              </div>
              {SUGGESTED_QUESTIONS.map((q) => (
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
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {loading && (
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0 border border-slate-200">
              <Bot className="w-4 h-4 text-teal-400" />
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-8 py-4 border-t border-slate-200 flex-shrink-0">
        {/* Suggested chips when messages exist */}
        {messages.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {SUGGESTED_QUESTIONS.map((q) => (
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
            placeholder="Ask something about your data... e.g.: 'Which customers have accepted quotes this month?'"
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
        <p className="text-xs text-slate-600 mt-2">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
