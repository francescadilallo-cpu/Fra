import { useState, useEffect } from 'react'
import {
  TrendingUp, ShoppingCart, FileText, Users, Database,
  CheckCircle, Activity, Package, BotMessageSquare,
  Zap, ArrowUp, ArrowDown, Download, Sparkles, X, Layers, RefreshCw,
} from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { useAgentStore, countFindings } from '../data/agentStore'
import { useExtendedOntology } from '../data/ontologyExtensions'
import { generateHtmlReport, downloadReport } from '../data/reportGenerator'
import { semanticStatus, type SemanticStatus } from '../api/semantic'
import type { NavTab } from '../types'
import type { SectorId } from '../data/sectors'

// ── Seeded mini-series ────────────────────────────────────────────────────────

function seededSeries(seed: number, n: number, base: number, jitter: number): number[] {
  let s = seed >>> 0
  const rand = () => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0
    return s / 0x100000000
  }
  const out: number[] = []
  let v = base
  for (let i = 0; i < n; i++) {
    v += (rand() - 0.48) * jitter
    v = Math.max(base * 0.55, Math.min(base * 1.55, v))
    out.push(Math.round(v))
  }
  return out
}

// ── Sparkline SVG ─────────────────────────────────────────────────────────────

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const min = Math.min(...values)
  const max = Math.max(...values, min + 1)
  const W = 64, H = 22
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W
    const y = H - ((v - min) / (max - min)) * (H - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={W} height={H} className="overflow-visible flex-shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={parseFloat(pts.split(' ').pop()!.split(',')[0])} cy={parseFloat(pts.split(' ').pop()!.split(',')[1])} r={2.5} fill={color} />
    </svg>
  )
}

// ── Trend area chart ──────────────────────────────────────────────────────────

function TrendChart({ values, label, unit }: { values: number[]; label: string; unit: string }) {
  const W = 560, H = 80
  const pad = { l: 40, r: 12, t: 8, b: 24 }
  const iW = W - pad.l - pad.r
  const iH = H - pad.t - pad.b
  const min = Math.min(...values)
  const max = Math.max(...values, min + 1)

  const toX = (i: number) => pad.l + (i / (values.length - 1)) * iW
  const toY = (v: number) => pad.t + iH - ((v - min) / (max - min)) * iH

  const linePts = values.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
  const areaPath = [
    `M ${toX(0).toFixed(1)},${(pad.t + iH).toFixed(1)}`,
    ...values.map((v, i) => `L ${toX(i).toFixed(1)},${toY(v).toFixed(1)}`),
    `L ${toX(values.length - 1).toFixed(1)},${(pad.t + iH).toFixed(1)} Z`,
  ].join(' ')

  const WEEKS = ['W1','W2','W3','W4','W5','W6','W7','W8','W9','W10','W11','W12']

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-900 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-teal-600" />
          {label} — last 12 weeks
        </h2>
        <span className="text-xs text-slate-400">{unit}</span>
      </div>
      <div className="overflow-x-auto">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0d9488" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#0d9488" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {/* Gridlines */}
          {[0, 0.5, 1].map(f => {
            const y = pad.t + iH * (1 - f)
            const v = Math.round(min + (max - min) * f)
            return (
              <g key={f}>
                <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="#e2e8f0" strokeWidth={1} />
                <text x={pad.l - 5} y={y + 4} textAnchor="end" fontSize={9} fill="#94a3b8">
                  {v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                </text>
              </g>
            )
          })}
          {/* Area */}
          <path d={areaPath} fill="url(#areaGrad)" />
          {/* Line */}
          <polyline points={linePts} fill="none" stroke="#0d9488" strokeWidth={2} strokeLinejoin="round" />
          {/* Week labels */}
          {values.map((_, i) => i % 2 === 0 && (
            <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fontSize={8} fill="#94a3b8">
              {WEEKS[i]}
            </text>
          ))}
          {/* Last dot */}
          <circle cx={toX(values.length - 1)} cy={toY(values[values.length - 1])} r={3} fill="#0d9488" />
        </svg>
      </div>
    </div>
  )
}

// ── Sector mock data ──────────────────────────────────────────────────────────

interface RecordItem { id: number; name: string; value?: number; status: string; sub: string }
interface ActivityItem { id: number; dot: string; message: string; time: string; status: string }

const STATUS_COLORS: Record<string, string> = {
  Confirmed:       'bg-blue-50 text-blue-700 border border-blue-200',
  'In Production': 'bg-amber-50 text-amber-700 border border-amber-200',
  Shipped:         'bg-purple-50 text-purple-700 border border-purple-200',
  Delivered:       'bg-teal-50 text-teal-700 border border-teal-200',
  Cancelled:       'bg-red-50 text-red-700 border border-red-200',
  Draft:           'bg-slate-100 text-slate-600 border border-slate-200',
  Sent:            'bg-sky-50 text-sky-700 border border-sky-200',
  Accepted:        'bg-emerald-50 text-emerald-700 border border-emerald-200',
  Rejected:        'bg-rose-50 text-rose-700 border border-rose-200',
  Paid:            'bg-teal-50 text-teal-700 border border-teal-200',
  Processing:      'bg-blue-50 text-blue-700 border border-blue-200',
  Active:          'bg-teal-50 text-teal-700 border border-teal-200',
  Admitted:        'bg-amber-50 text-amber-700 border border-amber-200',
  Discharged:      'bg-slate-100 text-slate-600 border border-slate-200',
  'Follow-up':     'bg-sky-50 text-sky-700 border border-sky-200',
  Issued:          'bg-purple-50 text-purple-700 border border-purple-200',
  Critical:        'bg-red-50 text-red-700 border border-red-200',
  Approved:        'bg-emerald-50 text-emerald-700 border border-emerald-200',
  'Pending KYC':   'bg-amber-50 text-amber-700 border border-amber-200',
  'Under Review':  'bg-blue-50 text-blue-700 border border-blue-200',
  Disbursed:       'bg-teal-50 text-teal-700 border border-teal-200',
  Warning:         'bg-amber-50 text-amber-700 border border-amber-200',
  Updated:         'bg-sky-50 text-sky-700 border border-sky-200',
}

const RECORDS: Record<SectorId, RecordItem[]> = {
  manufacturing: [
    { id: 75123, name: 'Bike World',                    value: 87145,  status: 'Shipped',   sub: 'Order #75123 · Southwest' },
    { id: 75089, name: 'Action Bicycle Specialists',    value: 53209,  status: 'Delivered', sub: 'Order #75089 · Northwest' },
    { id: 75044, name: 'Riding Cycles',                 value: 46312,  status: 'Delivered', sub: 'Order #75044 · Central' },
    { id: 74998, name: 'Valley Bicycle Specialists',    value: 32890,  status: 'Shipped',   sub: 'Order #74998 · Canada' },
    { id: 74956, name: 'Eastside Department Store',     value: 28750,  status: 'Delivered', sub: 'Order #74956 · Northeast' },
  ],
  retail: [
    { id: 4820, name: 'Marco Rossi',           value: 184,     status: 'Paid',         sub: 'Order #4820' },
    { id: 4819, name: 'Giulia Ferrari',        value: 326,     status: 'Shipped',      sub: 'Order #4819' },
    { id: 4817, name: 'Luca Bianchi',          value: 95,      status: 'Processing',   sub: 'Order #4817' },
    { id: 4815, name: 'Sofia Conti',           value: 412,     status: 'Delivered',    sub: 'Order #4815' },
    { id: 4814, name: 'Andrea Marino',         value: 78,      status: 'Paid',         sub: 'Order #4814' },
  ],
  healthcare: [
    { id: 8041, name: 'Rossi Mario (M/72)',    status: 'Discharged',  sub: 'Encounter #8041 · Cardiology' },
    { id: 8040, name: 'Ferrari Anna (F/58)',   status: 'Admitted',    sub: 'Encounter #8040 · Endocrinology' },
    { id: 8038, name: 'Conti Luca (M/45)',     status: 'Follow-up',   sub: 'Encounter #8038 · Neurology' },
    { id: 8036, name: 'Bianchi Sara (F/34)',   status: 'Discharged',  sub: 'Encounter #8036 · Oncology' },
    { id: 8034, name: 'Esposito Carlo (M/61)', status: 'Admitted',    sub: 'Encounter #8034 · Cardiology' },
  ],
  finance: [
    { id: 2941, name: 'Rossi & Figli Srl',    value: 350000,  status: 'Approved',    sub: 'Loan #2941' },
    { id: 2939, name: 'Tech Startup SB Srl',  value: 500000,  status: 'Pending KYC', sub: 'Loan #2939' },
    { id: 2937, name: 'Ferrari Holding SA',   value: 1200000, status: 'Under Review',sub: 'Loan #2937' },
    { id: 2935, name: 'Bianchi Costruzioni',  value: 280000,  status: 'Approved',    sub: 'Loan #2935' },
    { id: 2933, name: 'Conti Real Estate Srl',value: 750000,  status: 'Disbursed',   sub: 'Loan #2933' },
  ],
}

const ACTIVITIES: Record<SectorId, ActivityItem[]> = {
  manufacturing: [
    { id: 1, dot: 'bg-teal-500',   message: 'Top salesperson 2014: Linda Mitchell (#276) — $4.25M YTD, Southwest', time: 'Dec 2014', status: 'Confirmed' },
    { id: 2, dot: 'bg-amber-400',  message: 'Agent: 372 duplicate CRM accounts detected (accountId < 0)',   time: '2h ago',   status: 'Warning'   },
    { id: 3, dot: 'bg-blue-500',   message: 'Order #75123 shipped — Bike World — $87,145',                 time: '4h ago',   status: 'Shipped'   },
    { id: 4, dot: 'bg-purple-500', message: 'Cross-source join resolved: customer_ref → CRM accountId',    time: '6h ago',   status: 'Active'    },
    { id: 5, dot: 'bg-red-500',    message: '"fatturato" ambiguity: subtotal $20.1M vs total_due $22.4M',  time: '1d ago',   status: 'Warning'   },
  ],
  retail: [
    { id: 1, dot: 'bg-teal-500',   message: 'Order #4820 paid — Marco Rossi — €184',               time: '1m ago',  status: 'Paid' },
    { id: 2, dot: 'bg-blue-500',   message: 'Cart recovery sent to 23 abandoned sessions',          time: '12m ago', status: 'Sent' },
    { id: 3, dot: 'bg-purple-500', message: 'Order #4819 shipped — tracking active',                time: '34m ago', status: 'Shipped' },
    { id: 4, dot: 'bg-amber-400',  message: 'Inventory alert: 12 SKUs below reorder threshold',    time: '1h ago',  status: 'Warning' },
    { id: 5, dot: 'bg-teal-500',   message: 'Promo ESTATE25 applied on 47 orders today',           time: '2h ago',  status: 'Active' },
  ],
  healthcare: [
    { id: 1, dot: 'bg-slate-400',  message: 'Patient Rossi Mario discharged — follow-up in 14d',   time: '4m ago',  status: 'Discharged' },
    { id: 2, dot: 'bg-purple-500', message: 'New prescription issued by Dr. Ferrari (Cardiology)',  time: '18m ago', status: 'Issued' },
    { id: 3, dot: 'bg-amber-400',  message: 'Agent found 34 care gaps — patients without follow-up',time: '42m ago', status: 'Warning' },
    { id: 4, dot: 'bg-amber-500',  message: 'Encounter #8040 opened — Ferrari Anna (Endocrinology)',time: '1h ago',  status: 'Admitted' },
    { id: 5, dot: 'bg-red-500',    message: '7 conflicting diagnoses flagged for clinical review',  time: '2h ago',  status: 'Critical' },
  ],
  finance: [
    { id: 1, dot: 'bg-emerald-500',message: 'Loan #2941 approved — Rossi & Figli Srl — €350k',    time: '3m ago',  status: 'Approved' },
    { id: 2, dot: 'bg-amber-400',  message: 'KYC pending: 6 applicants require document review',   time: '21m ago', status: 'Pending KYC' },
    { id: 3, dot: 'bg-blue-500',   message: 'Loan #2939 under risk assessment — score: 72/100',    time: '45m ago', status: 'Under Review' },
    { id: 4, dot: 'bg-sky-500',    message: 'Agent updated 892 risk scores from credit bureau',    time: '1h ago',  status: 'Updated' },
    { id: 5, dot: 'bg-teal-500',   message: 'Loan #2933 disbursed — €750k to Conti Real Estate',  time: '3h ago',  status: 'Disbursed' },
  ],
}

const TREND_CONFIG: Record<SectorId, { label: string; unit: string; base: number; jitter: number; seed: number }> = {
  manufacturing: { label: 'Orders per Month',   unit: 'count',  base: 2622, jitter: 350,    seed: 42   },
  retail:        { label: 'Orders Paid',         unit: 'count',  base: 320,  jitter: 60,     seed: 77   },
  healthcare:    { label: 'Encounters',          unit: 'count',  base: 280,  jitter: 40,     seed: 13   },
  finance:       { label: 'Loan Disbursements',  unit: '€k',     base: 4200, jitter: 800,    seed: 99   },
}

const DATA_SOURCES: Record<SectorId, { name: string; type: string; tables: number; rows: string }[]> = {
  manufacturing: [
    { name: 'ERP — OrionSales', type: 'PostgreSQL / DuckDB', tables: 5, rows: '153,225' },
    { name: 'CRM — ClientHub',  type: 'SQLite',              tables: 6, rows: '59,193'  },
    { name: 'HR + PIM — Files', type: 'CSV + JSON',          tables: 2, rows: '794'     },
  ],
  retail: [
    { name: 'Shopify',       type: 'eCommerce',tables: 4, rows: '20,388' },
    { name: 'Snowflake',     type: 'DWH',      tables: 6, rows: '47,204' },
    { name: 'PostgreSQL',    type: 'Database', tables: 5, rows: '12,104' },
  ],
  healthcare: [
    { name: 'Epic EHR',      type: 'EHR',      tables: 5, rows: '14,648' },
    { name: 'HL7 FHIR',      type: 'Standard', tables: 3, rows: '9,302'  },
    { name: 'PostgreSQL',    type: 'Database', tables: 4, rows: '8,812'  },
  ],
  finance: [
    { name: 'Temenos T24',   type: 'Banking',  tables: 4, rows: '23,221' },
    { name: 'Credit Bureau', type: 'API',      tables: 1, rows: '892'    },
    { name: 'PostgreSQL',    type: 'Database', tables: 6, rows: '18,401' },
  ],
}

// ── Widgets ───────────────────────────────────────────────────────────────────

function AgentIntelligence({ sectorId, onNavigate }: { sectorId: SectorId; onNavigate?: (tab: NavTab) => void }) {
  const runs = useAgentStore(sectorId)
  const counts = countFindings(runs)
  const allFindings = runs.flatMap(r => r.findings)
  const critical = allFindings.filter(f => f.severity === 'critical')
  const warnings = allFindings.filter(f => f.severity === 'warning')
  const lastRan = runs.length > 0 ? new Date(Math.max(...runs.map(r => new Date(r.ranAt).getTime()))) : null
  const relative = (d: Date) => {
    const s = Math.round((Date.now() - d.getTime()) / 1000)
    return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s/60)}m ago` : `${Math.round(s/3600)}h ago`
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-slate-900 flex items-center gap-2">
          <BotMessageSquare className="w-4 h-4 text-blue-600" />
          Agent Intelligence
        </h2>
        <button onClick={() => onNavigate?.('agents')} className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium">
          <Zap className="w-3.5 h-3.5" />{runs.length === 0 ? 'Run agents' : 'View agents'}
        </button>
      </div>
      {runs.length === 0 ? (
        <div className="text-center py-6">
          <BotMessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No agents run yet for this sector.</p>
          <button onClick={() => onNavigate?.('agents')} className="text-xs text-blue-600 hover:underline mt-1">Go to Agents →</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            {lastRan && <span>Last run: <strong className="text-slate-700">{relative(lastRan)}</strong></span>}
            <span>{runs.length} agent{runs.length !== 1 ? 's' : ''}</span>
            {counts.critical > 0 && <span className="font-semibold text-red-600">{counts.critical} critical</span>}
            {counts.warning > 0  && <span className="font-semibold text-amber-600">{counts.warning} warning</span>}
            {counts.info > 0     && <span className="text-slate-400">{counts.info} info</span>}
          </div>
          {critical.length > 0 && critical.slice(0, 2).map((f, i) => (
            <div key={i} className="flex gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-800">
              <span>🔴</span><span className="leading-snug">{f.text}</span>
            </div>
          ))}
          {critical.length === 0 && warnings.length > 0 && warnings.slice(0, 2).map((f, i) => (
            <div key={i} className="flex gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
              <span>⚠</span><span className="leading-snug">{f.text}</span>
            </div>
          ))}
          {critical.length === 0 && warnings.length === 0 && (
            <div className="flex items-center gap-2 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2 text-xs text-teal-700">
              <CheckCircle className="w-3.5 h-3.5" />All agents completed — no critical issues
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SemanticLayerStats({ onNavigate }: { sectorId: SectorId; onNavigate?: (tab: NavTab) => void }) {
  const [status, setStatus] = useState<SemanticStatus | null>(null)
  const [loading, setLoading] = useState(true)

  function load() {
    setLoading(true)
    semanticStatus()
      .then(s => { setStatus(s) })
      .catch(() => { setStatus(null) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-slate-900 flex items-center gap-2">
          <Layers className="w-4 h-4 text-teal-600" />
          Knowledge Graph
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => onNavigate?.('sembuilder')}
            className="text-xs text-teal-600 hover:text-teal-700 font-medium"
          >
            Open →
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="grid grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-slate-100 rounded-lg h-16" />
            ))}
          </div>
        </div>
      ) : !status?.loaded ? (
        <div className="rounded-lg bg-slate-50 border border-dashed border-slate-200 p-5 text-center">
          <Layers className="w-7 h-7 text-slate-300 mx-auto mb-2" />
          <p className="text-xs text-slate-500 font-medium">Not built yet</p>
          <p className="text-[11px] text-slate-400 mt-0.5 mb-3">Connect sources and build the semantic layer</p>
          <button
            onClick={() => onNavigate?.('sources')}
            className="text-xs bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            <Zap className="w-3 h-3 inline mr-1" />Build Semantic Layer
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Entities',   value: status.entities.length,             color: 'text-teal-600',   bg: 'bg-teal-50' },
              { label: 'KG Nodes',   value: status.kg_nodes.toLocaleString(),   color: 'text-blue-600',   bg: 'bg-blue-50' },
              { label: 'KG Edges',   value: status.kg_edges.toLocaleString(),   color: 'text-violet-600', bg: 'bg-violet-50' },
              { label: 'Metadata',   value: status.metadata_rows.toLocaleString(), color: 'text-amber-600', bg: 'bg-amber-50' },
            ].map(s => (
              <div key={s.label} className={`${s.bg} rounded-lg p-3 text-center`}>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wide">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-center gap-1.5 flex-wrap">
            {status.sources.slice(0, 5).map(src => (
              <span key={src} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-mono">
                {src}
              </span>
            ))}
            {status.sources.length > 5 && (
              <span className="text-[10px] text-slate-400">+{status.sources.length - 5} more</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
}

function relativeTime(d: Date): string {
  const s = Math.round((Date.now() - d.getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return d.toLocaleDateString('en-US')
}

export default function Dashboard({ onNavigate }: { onNavigate?: (tab: NavTab) => void }) {
  const { sector, sectorId } = useSector()
  const ontology = useExtendedOntology(sectorId)
  const agentRuns = useAgentStore(sectorId)

  const [reporting, setReporting] = useState(false)

  const [pipelineLastRun, setPipelineLastRun] = useState<Date | null>(() => {
    const raw = localStorage.getItem(`pipeline-last-run-${sectorId}`)
    return raw ? new Date(raw) : null
  })

  useEffect(() => {
    const refresh = () => {
      const raw = localStorage.getItem(`pipeline-last-run-${sectorId}`)
      setPipelineLastRun(raw ? new Date(raw) : null)
    }
    refresh()
    window.addEventListener('pipeline-run-updated', refresh)
    return () => window.removeEventListener('pipeline-run-updated', refresh)
  }, [sectorId])

  useEffect(() => {
    function onTrigger() { handleGenerateReport() }
    window.addEventListener('trigger-export-report', onTrigger)
    return () => window.removeEventListener('trigger-export-report', onTrigger)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorId])

  async function handleGenerateReport() {
    setReporting(true)
    await new Promise(r => setTimeout(r, 1200))
    const now = new Date()
    const html = generateHtmlReport({
      sectorId, sector,
      nodes: ontology.nodes,
      edges: ontology.edges,
      agentRuns,
      generatedAt: now,
    })
    downloadReport(html, sectorId, now)
    setReporting(false)
  }

  const funnel = sector.funnel
  const totalQuotes = funnel[0]?.count ?? 0
  const totalOrders = funnel[Math.min(3, funnel.length - 1)]?.count ?? 0
  const conversion = totalQuotes > 0 ? Math.round((totalOrders / totalQuotes) * 100) : 0
  const openValue = funnel.reduce((s, f) => s + f.value, 0)
  const hasMonetary = funnel.some(f => f.value > 0)

  const tc = TREND_CONFIG[sectorId]
  const trendSeries = seededSeries(tc.seed, 12, tc.base, tc.jitter)
  const prevVal = trendSeries[trendSeries.length - 2]
  const currVal = trendSeries[trendSeries.length - 1]
  const trendPct = Math.round(((currVal - prevVal) / Math.max(1, prevVal)) * 100)

  const kpis = [
    {
      label: sector.kpiLabels.quotes,
      value: `${totalQuotes}`,
      icon: FileText,
      color: 'text-blue-600', bg: 'bg-blue-50',
      spark: seededSeries(11, 8, totalQuotes, totalQuotes * 0.15),
      sparkColor: '#3b82f6',
      trend: +12,
    },
    {
      label: sector.kpiLabels.orders,
      value: `${totalOrders}`,
      icon: ShoppingCart,
      color: 'text-purple-600', bg: 'bg-purple-50',
      spark: seededSeries(22, 8, totalOrders, totalOrders * 0.2),
      sparkColor: '#a855f7',
      trend: +8,
    },
    {
      label: sector.kpiLabels.conversion,
      value: `${conversion}%`,
      icon: TrendingUp,
      color: 'text-teal-600', bg: 'bg-teal-50',
      spark: seededSeries(33, 8, conversion, conversion * 0.12),
      sparkColor: '#0d9488',
      trend: +3,
    },
    {
      label: sector.kpiLabels.openValue,
      value: hasMonetary ? fmt(openValue) : `${totalQuotes}`,
      icon: Users,
      color: 'text-amber-600', bg: 'bg-amber-50',
      spark: seededSeries(44, 8, openValue || totalQuotes, (openValue || totalQuotes) * 0.18),
      sparkColor: '#d97706',
      trend: -5,
    },
  ]

  const sources = DATA_SOURCES[sectorId]
  const records = RECORDS[sectorId]
  const activities = ACTIVITIES[sectorId]
  const maxCount = funnel[0]?.count ?? 1

  const companyName = typeof window !== 'undefined' ? localStorage.getItem('si-company-name') : null
  const [showWelcome, setShowWelcome] = useState(() =>
    !!companyName && localStorage.getItem('si-welcome-banner-dismissed') !== '1'
  )
  const dismissWelcome = () => {
    localStorage.setItem('si-welcome-banner-dismissed', '1')
    setShowWelcome(false)
  }

  const isAW = sectorId === 'manufacturing'

  return (
    <div className="p-8 space-y-6">
      {/* AW real-data stats strip */}
      {isAW && (
        <div className="bg-slate-900 rounded-2xl px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold text-teal-400 uppercase tracking-widest">AdventureWorks · Live Data</span>
            <span className="text-[10px] text-slate-500">Click a card to query</span>
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
            {[
              { label: 'Net Revenue 2014',    value: '$20.1M',      sub: 'subtotal_amount · excl. tax+freight', color: 'text-teal-400',   query: 'What is our total revenue — subtotal vs total due?' },
              { label: 'Gross Revenue 2014',  value: '$22.4M',      sub: 'total_due · incl. tax+freight',       color: 'text-teal-300',   query: 'What is our total revenue — subtotal vs total due?' },
              { label: 'Total Orders (ERP)',  value: '31,465',      sub: 'OrionSales PostgreSQL',               color: 'text-blue-400',   query: 'Show recent orders from ERP' },
              { label: 'Unique Customers',    value: '19,829',      sub: 'CRM after 372 dedup removed',         color: 'text-violet-400', query: 'How many unique customers after CRM deduplication?' },
              { label: 'Top Salesperson',     value: 'L. Mitchell', sub: '$4.25M YTD · ERP×HR join',           color: 'text-amber-400',  query: 'Who is the top salesperson by revenue in 2014?' },
            ].map(s => (
              <button
                key={s.label}
                onClick={() => {
                  sessionStorage.setItem('query-prefill', s.query)
                  onNavigate?.('query')
                }}
                className="border border-slate-700 hover:border-slate-500 rounded-xl px-4 py-3 text-left transition-all hover:bg-slate-800 group"
              >
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[11px] text-slate-300 font-medium mt-0.5">{s.label}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{s.sub}</p>
                <p className="text-[10px] text-slate-600 group-hover:text-slate-400 mt-1 transition-colors">Query →</p>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            ⚠️ <span className="text-amber-400 font-medium">"fatturato" disambiguation</span> — Net $20.1M (commercial) vs Gross $22.4M (billed) differ by $2.3M (tax + freight). The semantic layer resolves this at query time.
          </p>
        </div>
      )}

      {showWelcome && companyName && (
        <div className="bg-gradient-to-r from-teal-50 via-emerald-50 to-teal-50 border border-teal-200 rounded-2xl p-4 flex items-center gap-4 shadow-sm">
          <div className="w-11 h-11 rounded-xl bg-teal-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-teal-200">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900">Welcome, {companyName} 👋</p>
            <p className="text-xs text-slate-600 mt-0.5">
              Your semantic layer is ready · {ontology.nodes.length} entities · {sector.name} · 1 recommended agent pre-configured
            </p>
          </div>
          <button
            onClick={dismissWelcome}
            className="w-7 h-7 rounded-lg hover:bg-white/60 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors flex-shrink-0"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 mt-1 text-sm">{sector.name} · {sector.domain}</p>
        </div>
        <button
          onClick={handleGenerateReport}
          disabled={reporting}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors flex-shrink-0 ${
            reporting
              ? 'bg-slate-100 text-slate-400 cursor-wait'
              : 'bg-slate-900 text-white hover:bg-slate-800'
          }`}
        >
          <Download className="w-4 h-4" />
          {reporting ? 'Generating…' : 'Export Report'}
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        {kpis.map(kpi => {
          const TrendIcon = kpi.trend >= 0 ? ArrowUp : ArrowDown
          const trendColor = kpi.trend >= 0 ? 'text-teal-600' : 'text-red-500'
          return (
            <div key={kpi.label} className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div className={`${kpi.bg} rounded-lg p-2.5`}>
                  <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                </div>
                <Sparkline values={kpi.spark} color={kpi.sparkColor} />
              </div>
              <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
              <p className="text-xs text-slate-500 font-medium mt-0.5">{kpi.label}</p>
              <div className={`flex items-center gap-1 mt-2 text-xs ${trendColor}`}>
                <TrendIcon className="w-3 h-3" />
                <span>{Math.abs(kpi.trend)}% vs prev. month</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Trend chart */}
      <TrendChart values={trendSeries} label={tc.label} unit={tc.unit} />

      {/* Agent + Semantic Layer */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <AgentIntelligence sectorId={sectorId} onNavigate={onNavigate} />
        <SemanticLayerStats sectorId={sectorId} onNavigate={onNavigate} />
      </div>

      {/* Process Funnel */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-teal-600" />
            Process Funnel
          </h2>
          <span className="text-xs text-slate-500">{funnel[0]?.count.toLocaleString('en-US') ?? 0} total</span>
        </div>
        <div className="space-y-3">
          {funnel.map((s, i) => {
            const pct = (s.count / maxCount) * 100
            const opacity = 1 - (i / Math.max(1, funnel.length - 1)) * 0.5
            return (
              <div key={s.stage} className="flex items-center gap-3">
                <span className="w-44 text-xs text-slate-600 text-right flex-shrink-0">{s.stage}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: `rgba(13,148,136,${opacity})` }} />
                </div>
                <span className="w-12 text-xs font-bold text-slate-900 text-center flex-shrink-0">{s.count}</span>
                <span className="w-28 text-right text-xs text-slate-500 flex-shrink-0">{s.value > 0 ? fmt(s.value) : '—'}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Bottom row: activities | recent records | data sources */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

        {/* Recent Activity */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-teal-600" />
            Recent Activity
          </h2>
          <div className="space-y-3">
            {activities.map(a => (
              <div key={a.id} className="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${a.dot}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-700 leading-snug">{a.message}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[11px] text-slate-400">{a.time}</span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[a.status] ?? 'bg-slate-100 text-slate-600 border border-slate-200'}`}>{a.status}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Records */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-4">
            <ShoppingCart className="w-4 h-4 text-purple-600" />
            Recent Records
          </h2>
          <div className="space-y-3">
            {records.map(r => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{r.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{r.sub}</p>
                </div>
                <div className="text-right ml-3 flex-shrink-0">
                  {r.value !== undefined && <p className="text-sm font-semibold text-slate-900">{fmt(r.value)}</p>}
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium mt-0.5 ${STATUS_COLORS[r.status] ?? 'bg-slate-100 text-slate-600 border border-slate-200'}`}>{r.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Data Sources */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-teal-600" />
              Data Sources
            </h2>
            <span className="text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-2 py-0.5">{sources.length} connected</span>
          </div>
          <div className="space-y-3">
            {sources.map(s => (
              <div key={s.name} className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-teal-500" />
                    <span className="text-sm font-medium text-slate-900">{s.name}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">{s.type}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500 ml-5">
                  <span>{s.tables} tables</span>
                  <span className="font-semibold text-slate-700">{s.rows} rows</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-400">
            <Package className={`w-3.5 h-3.5 ${pipelineLastRun ? 'text-teal-500' : ''}`} />
            <span>
              Last sync:{' '}
              <strong className={pipelineLastRun ? 'text-teal-600' : 'text-slate-600'}>
                {pipelineLastRun ? relativeTime(pipelineLastRun) : `today, 0${trendPct > 0 ? '9' : '8'}:14`}
              </strong>
            </span>
            {pipelineLastRun && (
              <span className="ml-auto text-[10px] bg-teal-50 text-teal-600 border border-teal-100 rounded-full px-2 py-0.5">
                ✓ Pipeline synced
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
