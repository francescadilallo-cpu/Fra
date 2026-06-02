import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, ChevronDown, ChevronRight, Bot, User, Lightbulb, GitBranch, BarChart2, Clock, X, AlertTriangle, Sparkles, ListChecks, Key, CheckCircle2, Zap, ExternalLink, Copy, Trash2, TrendingUp, PieChart, ArrowUpDown, ArrowUp, ArrowDown, Download, Star, Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { executeQuery } from '../data/queryEngine'
import type { EngineResult, ChartData } from '../data/queryEngine'
import {
  executeLLMQuery, getStoredCredentials, saveCredentials, clearCredentials,
  PROVIDERS, type LLMProvider,
} from '../data/llmQueryEngine'
import { ask, adaptAskResult, checkBackend, backendErrorMessage } from '../api/semantic'
import { listSavedQueries, saveQueryRemote, deleteSavedQueryRemote } from '../api/queries'
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
  retryQuery?: string
}

// ── Query history helpers ──────────────────────────────────────────────────────

const HISTORY_MAX = 10
const FAVORITES_MAX = 20

function loadHistory(sectorId: string): string[] {
  try {
    const raw = localStorage.getItem(`query-history-${sectorId}`)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch { return [] }
}

function saveToHistory(sectorId: string, query: string, current: string[]): string[] {
  const next = [query, ...current.filter(q => q !== query)].slice(0, HISTORY_MAX)
  try {
    localStorage.setItem(`query-history-${sectorId}`, JSON.stringify(next))
  } catch { /* private browsing / quota */ }
  return next
}

function loadFavorites(sectorId: string): string[] {
  try {
    const raw = localStorage.getItem(`query-favorites-${sectorId}`)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch { return [] }
}

function saveFavoritesLocal(sectorId: string, favs: string[]) {
  try { localStorage.setItem(`query-favorites-${sectorId}`, JSON.stringify(favs)) } catch { /* quota */ }
}

function stableQueryId(sectorId: string, query: string): string {
  let h = 5381
  for (let i = 0; i < query.length; i++) h = ((h << 5) + h) ^ query.charCodeAt(i)
  return `${sectorId}:${(h >>> 0).toString(36)}`
}

function toggleFavorite(sectorId: string, query: string, current: string[]): string[] {
  const adding = !current.includes(query)
  const next = adding
    ? [query, ...current].slice(0, FAVORITES_MAX)
    : current.filter(q => q !== query)
  saveFavoritesLocal(sectorId, next)
  if (adding) {
    saveQueryRemote(sectorId, query, stableQueryId(sectorId, query)).catch(() => {})
  } else {
    deleteSavedQueryRemote(stableQueryId(sectorId, query)).catch(() => {})
  }
  return next
}

// ── Sector-aware suggested questions ─────────────────────────────────────────

const SECTOR_QUESTIONS: Record<string, string[]> = {
  manufacturing: [
    'Who is the top salesperson by revenue in 2014?',
    'What is our total revenue — subtotal vs total due?',
    'What is the online vs in-store channel split?',
    'Show gross margin by product category',
    'Which products generated the most revenue?',
    'Show headcount and salary by department',
    'How many unique customers after CRM deduplication?',
    'Show orders by territory ranked by sales YTD',
    'Show quarterly revenue breakdown',
    'What is our YoY revenue comparison — 2011 vs 2014?',
  ],
  retail: [
    'Show the top products by revenue',
    'Which promotions are currently active?',
    'What is the total amount of paid orders?',
    'Show gold loyalty customers',
    'Show low stock inventory alerts',
    'What is the average order value by channel?',
    'Which categories have the highest return rate?',
    'Show customer acquisition trend by month',
    'What is the cart abandonment rate?',
    'Show revenue breakdown by store location',
  ],
  healthcare: [
    'Show active patients by condition',
    'How many encounters per doctor this month?',
    'Which treatments have no outcome recorded?',
    'Show prescriptions by doctor',
    'What is the average length of stay by ward?',
    'Show readmission rate for the last 90 days',
    'Which patients have upcoming appointments?',
    'Show medication adherence rate by condition',
    'How many patients are waiting for a specialist?',
    'Show staff-to-patient ratio by department',
  ],
  finance: [
    'Show loan portfolio by status',
    'What is the risk score distribution?',
    'Which payments are overdue?',
    'Show pending KYC applications',
    'What is the default rate by loan category?',
    'Show total assets under management',
    'Which clients have the highest credit exposure?',
    'Show monthly new loan originations',
    'What is the average approval time for applications?',
    'Show fraud alerts opened in the last 30 days',
  ],
}

// ── Chart value formatter ─────────────────────────────────────────────────────

function fmtVal(v: number, unit?: string): string {
  const u = unit ?? ''
  const prefix = u === '$' || u === '€'
  const sym = prefix ? u : ''
  const suffix = prefix ? '' : u
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M${suffix}`
  if (abs >= 10_000)    return `${sym}${(v / 1_000).toFixed(0)}K${suffix}`
  if (abs >= 1_000)     return `${sym}${(v / 1_000).toFixed(1)}K${suffix}`
  if (u === '%')        return `${v.toFixed(1)}%`
  return `${sym}${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}${suffix}`
}

// ── Inline SVG bar chart ───────────────────────────────────────────────────────

function InlineBarChart({ chart }: { chart: ChartData }) {
  const W = 480
  const H = 180
  const pad = { top: 20, right: 12, bottom: 52, left: 58 }
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom

  const max = Math.max(...chart.values, 1)
  const barW = Math.max(12, Math.floor(innerW / chart.labels.length) - 8)

  return (
    <div className="mt-3 bg-white border border-slate-200 rounded-xl p-3 overflow-x-auto">
      <div className="flex items-center gap-1.5 mb-2">
        <BarChart2 className="w-3.5 h-3.5 text-teal-500" />
        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{chart.title}</span>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = pad.top + innerH * (1 - frac)
          return (
            <g key={frac}>
              <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize={9} fill="#94a3b8">
                {fmtVal(max * frac, chart.unit)}
              </text>
            </g>
          )
        })}
        {chart.labels.map((lbl, i) => {
          const bH = Math.max(2, (chart.values[i] / max) * innerH)
          const x = pad.left + i * (innerW / chart.labels.length) + (innerW / chart.labels.length - barW) / 2
          const y = pad.top + innerH - bH
          const isTop = i === 0
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={bH} rx={3} fill={isTop ? '#0d9488' : '#99f6e4'} />
              <text x={x + barW / 2} y={pad.top + innerH + 14} textAnchor="middle" fontSize={9} fill="#64748b">
                {lbl.length > 12 ? lbl.slice(0, 11) + '…' : lbl}
              </text>
              {bH > 16 && (
                <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={8} fill="#0f766e" fontWeight={600}>
                  {fmtVal(chart.values[i], chart.unit)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Inline SVG line chart ─────────────────────────────────────────────────────

function InlineLineChart({ chart }: { chart: ChartData }) {
  const W = 480
  const H = 180
  const pad = { top: 20, right: 20, bottom: 52, left: 58 }
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom

  const max = Math.max(...chart.values, 1)
  const min = Math.min(...chart.values, 0)
  const range = max - min || 1

  const pts = chart.values.map((v, i) => ({
    x: pad.left + (i / Math.max(chart.labels.length - 1, 1)) * innerW,
    y: pad.top + innerH - ((v - min) / range) * innerH,
    v,
  }))

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const area = `${path} L${pts[pts.length - 1].x},${pad.top + innerH} L${pts[0].x},${pad.top + innerH} Z`

  return (
    <div className="mt-3 bg-white border border-slate-200 rounded-xl p-3 overflow-x-auto">
      <div className="flex items-center gap-1.5 mb-2">
        <TrendingUp className="w-3.5 h-3.5 text-teal-500" />
        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{chart.title}</span>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = pad.top + innerH * (1 - frac)
          return (
            <g key={frac}>
              <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize={9} fill="#94a3b8">
                {fmtVal(min + range * frac, chart.unit)}
              </text>
            </g>
          )
        })}
        <path d={area} fill="#ccfbf1" opacity={0.5} />
        <path d={path} fill="none" stroke="#0d9488" strokeWidth={2} strokeLinejoin="round" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={4} fill="#0d9488" />
            <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize={8} fill="#0f766e" fontWeight={600}>
              {fmtVal(p.v, chart.unit)}
            </text>
            <text x={p.x} y={pad.top + innerH + 14} textAnchor="middle" fontSize={9} fill="#64748b">
              {chart.labels[i].length > 6 ? chart.labels[i].slice(0, 6) + '…' : chart.labels[i]}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ── Inline SVG pie/donut chart ────────────────────────────────────────────────

const PIE_COLORS = ['#0d9488', '#7c3aed', '#2563eb', '#d97706', '#dc2626', '#059669', '#db2777', '#0891b2']

function InlinePieChart({ chart }: { chart: ChartData }) {
  const total = chart.values.reduce((a, b) => a + b, 0)
  if (!total) return null

  const cx = 80; const cy = 80; const R = 68; const r = 38

  let cum = -Math.PI / 2
  const slices = chart.values.map((val, i) => {
    const angle = (val / total) * 2 * Math.PI
    const s = cum; const e = cum + angle; cum += angle
    const large = angle > Math.PI ? 1 : 0
    const x1 = cx + R * Math.cos(s); const y1 = cy + R * Math.sin(s)
    const x2 = cx + R * Math.cos(e); const y2 = cy + R * Math.sin(e)
    const x3 = cx + r * Math.cos(e); const y3 = cy + r * Math.sin(e)
    const x4 = cx + r * Math.cos(s); const y4 = cy + r * Math.sin(s)
    return {
      path: `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${r} ${r} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`,
      color: PIE_COLORS[i % PIE_COLORS.length], val, label: chart.labels[i],
      pct: ((val / total) * 100).toFixed(0),
    }
  })

  return (
    <div className="mt-3 bg-white border border-slate-200 rounded-xl p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <PieChart className="w-3.5 h-3.5 text-teal-500" />
        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{chart.title}</span>
      </div>
      <div className="flex items-center gap-4">
        <svg width={160} height={160} viewBox="0 0 160 160" className="flex-shrink-0">
          {slices.map((s, i) => (
            <path key={i} d={s.path} fill={s.color} stroke="white" strokeWidth={1.5} />
          ))}
          <text x={cx} y={cy - 5} textAnchor="middle" fontSize={9} fill="#64748b">{chart.unit ?? 'Total'}</text>
          <text x={cx} y={cy + 9} textAnchor="middle" fontSize={11} fill="#0f172a" fontWeight={700}>
            {fmtVal(total, chart.unit)}
          </text>
        </svg>
        <div className="flex-1 space-y-1.5 min-w-0">
          {slices.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: s.color }} />
              <span className="text-slate-600 flex-1 min-w-0 truncate">{s.label}</span>
              <span className="font-mono text-slate-700 font-medium">{fmtVal(s.val, chart.unit)}</span>
              <span className="text-slate-400 w-8 text-right">{s.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Result table ───────────────────────────────────────────────────────────────

const CURRENCY_COLS = /revenue|amount|total|price|cost|salary|value|ltv|fee|pay|stipendio|income|profit|margin|spend|budget|exposure/i
const PERCENT_COLS  = /pct|percent|rate|ratio|margin_pct|avg_pd|pct_of/i
const TABLE_PAGE = 10

function fmtCell(col: string, v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') {
    if (PERCENT_COLS.test(col)) return `${v.toFixed(1)}%`
    if (CURRENCY_COLS.test(col)) {
      if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
      if (Math.abs(v) >= 1_000)     return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
      return `$${v.toFixed(2)}`
    }
    return v.toLocaleString('en-US')
  }
  return String(v)
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [showAll, setShowAll] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!rows.length) return <p className="text-sm text-slate-500 italic">No results found.</p>
  const columns = Object.keys(rows[0])

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const sorted = sortCol
    ? [...rows].sort((a, b) => {
        const va = a[sortCol]; const vb = b[sortCol]
        const num = typeof va === 'number' && typeof vb === 'number'
        const cmp = num ? (va as number) - (vb as number) : String(va ?? '').localeCompare(String(vb ?? ''))
        return sortDir === 'asc' ? cmp : -cmp
      })
    : rows

  const visible = showAll ? sorted : sorted.slice(0, TABLE_PAGE)

  function exportCsv() {
    const header = columns.join(',')
    const body = sorted.map(row => columns.map(c => {
      const v = row[c]
      const s = v === null || v === undefined ? '' : String(v)
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')).join('\n')
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'query-results.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function copyCsv() {
    const header = columns.join('\t')
    const body = sorted.map(row => columns.map(c => row[c] ?? '').join('\t')).join('\n')
    navigator.clipboard.writeText(`${header}\n${body}`).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    }).catch(() => { /* clipboard access denied */ })
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-400">{rows.length} rows · {columns.length} cols</span>
        <div className="flex items-center gap-1">
          <button onClick={copyCsv} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-500 transition-colors">
            {copied ? <CheckCircle2 className="w-3 h-3 text-teal-500" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={exportCsv} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-500 transition-colors">
            <Download className="w-3 h-3" />
            CSV
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100">
              {columns.map((col) => (
                <th
                  key={col}
                  onClick={() => toggleSort(col)}
                  className="px-3 py-2 text-left text-slate-500 font-medium whitespace-nowrap cursor-pointer hover:bg-slate-200 transition-colors select-none"
                >
                  <span className="flex items-center gap-1">
                    {col}
                    {sortCol === col
                      ? sortDir === 'asc'
                        ? <ArrowUp className="w-3 h-3 text-teal-600" />
                        : <ArrowDown className="w-3 h-3 text-teal-600" />
                      : <ArrowUpDown className="w-3 h-3 text-slate-300" />
                    }
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={i} className="border-t border-slate-200 hover:bg-slate-50 transition-colors">
                {columns.map((col) => (
                  <td key={col} className={`px-3 py-2 whitespace-nowrap ${
                    row[col] === null || row[col] === undefined
                      ? 'text-slate-300 italic'
                      : CURRENCY_COLS.test(col) && typeof row[col] === 'number'
                        ? 'text-teal-700 font-medium tabular-nums'
                        : 'text-slate-700'
                  }`}>
                    {row[col] === null || row[col] === undefined
                      ? 'null'
                      : fmtCell(col, row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!showAll && rows.length > TABLE_PAGE && (
        <button
          onClick={() => setShowAll(true)}
          className="text-[10px] text-teal-600 hover:text-teal-800 font-medium transition-colors"
        >
          Show all {rows.length} rows ↓
        </button>
      )}
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
        The term <span className="font-mono bg-white border border-amber-200 rounded px-1 text-amber-700">fatturato</span> / "revenue" maps to two different metrics in the data model. Choose which definition applies to your analysis:
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onChoose('Show net revenue by territory')}
          className="bg-white border-2 border-teal-200 hover:border-teal-500 rounded-xl p-4 text-left transition-all group shadow-sm hover:shadow-md"
        >
          <p className="text-xs font-semibold text-slate-800">Net Revenue</p>
          <p className="text-[10px] font-mono text-slate-500 mt-0.5">subtotal_amount</p>
          <p className="text-[10px] text-slate-400 mt-1">Excl. tax &amp; freight · commercial "fatturato"</p>
          <p className="text-[10px] text-teal-600 font-medium mt-2">Use this →</p>
        </button>
        <button
          onClick={() => onChoose('Show gross revenue billed amount by territory')}
          className="bg-white border-2 border-blue-200 hover:border-blue-500 rounded-xl p-4 text-left transition-all group shadow-sm hover:shadow-md"
        >
          <p className="text-xs font-semibold text-slate-800">Gross Revenue</p>
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
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(sql).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => { /* clipboard access denied */ })
  }

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
        <div className="relative mt-2">
          <pre className="text-xs bg-slate-900 border border-slate-700 rounded-lg p-3 pr-10 text-teal-400 overflow-x-auto">
            {sql}
          </pre>
          <button
            onClick={handleCopy}
            title="Copy SQL"
            className="absolute top-2 right-2 p-1 rounded text-slate-500 hover:text-teal-400 transition-colors"
          >
            {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message, onFollowUp, onRetry, isFavorite, onToggleFavorite }: {
  message: Message
  onFollowUp?: (q: string) => void
  onRetry?: (q: string) => void
  isFavorite?: boolean
  onToggleFavorite?: (q: string) => void
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end gap-3 items-start group">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onToggleFavorite && (
            <button
              onClick={() => onToggleFavorite(message.content)}
              title={isFavorite ? 'Remove from favorites' : 'Save to favorites'}
              className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <Star className={`w-3.5 h-3.5 ${isFavorite ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}`} />
            </button>
          )}
        </div>
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
        <div className="max-w-[85%] bg-red-500/10 border border-red-500/20 rounded-2xl rounded-tl-sm px-4 py-3 space-y-2">
          <p className="text-sm text-red-400">{message.content}</p>
          {message.retryQuery && onRetry && (
            <button
              onClick={() => onRetry(message.retryQuery!)}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          )}
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

        {/* Summary — render **bold** as <strong> without dangerouslySetInnerHTML */}
        <div className="bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
          <p className="text-sm text-slate-700">
            {r.summary.split(/(\*\*.*?\*\*)/).map((part, i) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={i}>{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        </div>

        {/* Disambiguation card */}
        {r.isDisambiguation && onFollowUp && (
          <DisambiguationCard onChoose={onFollowUp} />
        )}

        {/* Inline chart */}
        {r.chartData && (
          r.chartData.type === 'line' ? <InlineLineChart chart={r.chartData} />
          : r.chartData.type === 'pie' ? <InlinePieChart chart={r.chartData} />
          : <InlineBarChart chart={r.chartData} />
        )}

        {/* Results table */}
        {(r.rows ?? []).length > 0 && (
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

// ── API key panel ──────────────────────────────────────────────────────────────

function ApiKeyPanel({ onClose }: { onClose: () => void }) {
  const stored = getStoredCredentials()
  const [provider, setProvider] = useState<LLMProvider>(stored.provider)
  const [draft, setDraft] = useState(stored.key)
  const [saved, setSaved] = useState(false)

  const cfg = PROVIDERS.find(p => p.id === provider)!

  function handleSave() {
    saveCredentials(draft.trim(), provider)
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 700)
  }

  function handleClear() {
    clearCredentials()
    setDraft('')
    setSaved(false)
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="w-3.5 h-3.5 text-teal-400" />
          <span className="text-xs font-semibold text-white">LLM Provider</span>
          <span className="text-[10px] text-slate-400">— chiave salvata solo nel browser</span>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white"><X className="w-3.5 h-3.5" /></button>
      </div>

      {/* Provider selector */}
      <div className="grid grid-cols-3 gap-2">
        {PROVIDERS.map(p => (
          <button
            key={p.id}
            onClick={() => { setProvider(p.id); setDraft('') }}
            className={`rounded-lg px-3 py-2.5 text-left border transition-all ${
              provider === p.id
                ? 'bg-teal-600 border-teal-500 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            <p className="text-xs font-semibold">{p.label}</p>
            <p className={`text-[10px] mt-0.5 ${provider === p.id ? 'text-teal-200' : p.free ? 'text-teal-400' : 'text-slate-500'}`}>
              {p.badge}
            </p>
          </button>
        ))}
      </div>

      {/* Get key link */}
      <a
        href={cfg.keyUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-[11px] text-teal-400 hover:text-teal-300 transition-colors"
      >
        <ExternalLink className="w-3 h-3" />
        {cfg.hint} — ottieni la chiave gratuita →
      </a>

      {/* Key input */}
      <div className="flex gap-2">
        <input
          type="password"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && draft.trim() && handleSave()}
          placeholder={cfg.keyPlaceholder}
          className="flex-1 bg-slate-800 border border-slate-600 focus:border-teal-500 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 outline-none font-mono"
        />
        <button
          onClick={handleSave}
          disabled={!draft.trim()}
          className="px-3 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 flex-shrink-0"
        >
          {saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : 'Salva'}
        </button>
        {stored.key && (
          <button onClick={handleClear} className="px-2 text-slate-500 hover:text-red-400 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
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
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites(sectorId))
  const [showApiPanel, setShowApiPanel] = useState(false)
  const [creds, setCreds] = useState(getStoredCredentials)
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null)
  const [useBackend, setUseBackend] = useState(true)
  const queryCount = messages.filter(m => m.role === 'user').length
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const isLLMActive = !!creds.key
  const canUseBackend = backendOnline === true

  const checkBackendOnce = useCallback(async () => {
    const ok = await checkBackend()
    setBackendOnline(ok)
    setUseBackend(ok)
  }, [])

  useEffect(() => { checkBackendOnce() }, [checkBackendOnce])

  // Refresh creds from localStorage when panel closes
  function handleApiPanelClose() {
    setShowApiPanel(false)
    setCreds(getStoredCredentials())
  }

  useEffect(() => {
    setMessages([])
    setHistory(loadHistory(sectorId))
    const local = loadFavorites(sectorId)
    setFavorites(local)
    // Sync favorites from backend; merge remote-only entries into localStorage
    listSavedQueries(sectorId).then(remote => {
      const remoteQueries = remote.map(r => r.query)
      const merged = [...new Set([...local, ...remoteQueries])].slice(0, FAVORITES_MAX)
      if (merged.length !== local.length) {
        saveFavoritesLocal(sectorId, merged)
        setFavorites(merged)
      }
    }).catch(() => {})
    // Check for pre-fill from dashboard navigation
    const prefill = sessionStorage.getItem('query-prefill')
    if (prefill) {
      sessionStorage.removeItem('query-prefill')
      const tid = setTimeout(() => sendMessage(prefill), 100)
      return () => clearTimeout(tid)
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

    const resolve = async () => {
      let result: EngineResult

      if (canUseBackend && useBackend) {
        // Backend path — real data, server-side query execution
        try {
          const raw = await ask(question, sectorId)
          result = adaptAskResult(raw)
        } catch (backendErr) {
          // Backend failed mid-query — surface the error with detail
          throw new Error(`Backend: ${backendErrorMessage(backendErr)}`)
        }
      } else if (isLLMActive) {
        // Browser LLM path — direct provider call (Groq/Gemini/Claude)
        result = await executeLLMQuery(question, creds.key, creds.provider)
      } else {
        // Pattern engine path — local, no API needed
        await new Promise(r => setTimeout(r, 420))
        result = executeQuery(question, ontology.nodes, sectorId)
      }

      const entities = ontology.nodes
        .filter(n => n.data.db_table && result.sql?.toLowerCase().includes(n.data.db_table.toLowerCase()))
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
    }

    resolve().catch((e: unknown) => {
      const errMsg = e instanceof Error ? e.message : 'Unknown error'
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'error',
          content: `Error: ${errMsg}`,
          retryQuery: question,
          timestamp: new Date(),
        },
      ])
    }).finally(() => {
      setLoading(false)
      inputRef.current?.focus()
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const submit = (e.key === 'Enter' && !e.shiftKey) || (e.key === 'Enter' && !e.shiftKey && (e.metaKey || e.ctrlKey))
    if (submit) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 flex-shrink-0 bg-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Query AI</h1>
            <p className="text-slate-400 mt-1 text-sm">
              {sector.name} · Ask questions in natural language — powered by the semantic layer
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Backend status indicator — shown for all sectors */}
            <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
              backendOnline === null ? 'bg-slate-50 border-slate-200 text-slate-400' :
              backendOnline ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-amber-50 border-amber-200 text-amber-700'
            }`}>
              {backendOnline === null
                ? <><Loader2 className="w-3 h-3 animate-spin" />Connecting…</>
                : backendOnline
                  ? <><button onClick={() => setUseBackend(v => !v)} className="flex items-center gap-1.5">
                      {useBackend ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3 opacity-60" />}
                      {useBackend ? 'Backend AI' : 'Backend off'}
                    </button></>
                  : <><WifiOff className="w-3 h-3" />Demo mode</>
              }
            </div>
            {queryCount > 0 && (
              <button
                onClick={() => setMessages([])}
                title="Clear conversation"
                className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs text-slate-400 hover:text-slate-600 border border-slate-200 hover:border-slate-300 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            )}
            {(!canUseBackend || !useBackend) && (
              <button
                onClick={() => setShowApiPanel(v => !v)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all flex-shrink-0 ${
                  isLLMActive
                    ? 'bg-teal-50 border-teal-300 text-teal-700 hover:bg-teal-100'
                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                {isLLMActive
                  ? <><Zap className="w-3.5 h-3.5 text-teal-500" />{PROVIDERS.find(p => p.id === creds.provider)?.label ?? 'LLM'} active</>
                  : <><Key className="w-3.5 h-3.5" />Add API Key</>}
              </button>
            )}
          </div>
        </div>
        {showApiPanel && (
          <div className="mt-3">
            <ApiKeyPanel onClose={handleApiPanelClose} />
          </div>
        )}
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

            {/* Offline hint — backend confirmed offline and no LLM key configured */}
            {backendOnline === false && !isLLMActive && (
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-left w-full max-w-lg">
                <WifiOff className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-amber-800">Demo mode — results are simulated</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Backend is offline. Responses use a local pattern engine with demo data, not your real data.{' '}
                    <button onClick={() => setShowApiPanel(true)} className="underline font-medium">Add an API key</button>
                    {' '}or start the backend for real results.
                  </p>
                </div>
              </div>
            )}

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

            {/* Saved favorites */}
            {favorites.length > 0 && (
              <div className="space-y-2 w-full max-w-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    <span>Saved queries</span>
                  </div>
                  <button
                    onClick={() => {
                      const toDelete = [...favorites]
                      localStorage.removeItem(`query-favorites-${sectorId}`)
                      setFavorites([])
                      toDelete.forEach(q => deleteSavedQueryRemote(stableQueryId(sectorId, q)).catch(() => {}))
                    }}
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Clear
                  </button>
                </div>
                {favorites.slice(0, 5).map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    disabled={loading}
                    className="w-full text-left bg-amber-50 hover:bg-amber-100 border border-amber-200 hover:border-amber-300 rounded-xl px-4 py-2.5 text-sm text-slate-600 hover:text-slate-900 transition-all flex items-center gap-2.5"
                  >
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400 flex-shrink-0" />
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
          <MessageBubble
            key={msg.id}
            message={msg}
            onFollowUp={sendMessage}
            onRetry={sendMessage}
            isFavorite={msg.role === 'user' ? favorites.includes(msg.content) : undefined}
            onToggleFavorite={msg.role === 'user' ? (q) => setFavorites(toggleFavorite(sectorId, q, favorites)) : undefined}
          />
        ))}

        {loading && (
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0 border border-slate-200">
              <Bot className="w-4 h-4 text-teal-400" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
                <span>{isLLMActive ? `Asking ${PROVIDERS.find(p => p.id === creds.provider)?.label ?? 'LLM'}…` : 'Querying semantic layer…'}</span>
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
        <p className="text-xs text-slate-400 mt-2">Enter to send · Shift+Enter for new line · ⌘+Enter to force send</p>
      </div>
    </div>
  )
}
