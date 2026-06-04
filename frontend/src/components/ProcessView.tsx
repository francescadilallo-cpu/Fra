import { useState, useRef, useEffect } from 'react'
import { Play, Square, CheckCircle2, Loader2, Clock, Plug, Download, GitBranch, Sparkles, Database, FileText, Send, CheckCircle, ShoppingCart, Factory, Package, AlertTriangle, Activity } from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import type { SectorId } from '../data/sectors'
import { getLiveConfig, type LiveConfig } from '../api/semantic'

// ── Pipeline types ────────────────────────────────────────────────────────────

type StepId = 'connect' | 'extract' | 'map' | 'enrich' | 'index'
type StepStatus = 'idle' | 'running' | 'done'
type RunState = 'idle' | 'running' | 'done'

interface LogEntry { id: number; time: string; text: string; type: 'info' | 'ok' | 'warn' }
interface StepDef { id: StepId; label: string; icon: typeof Plug; durationMs: number }

const PIPELINE_STEPS: StepDef[] = [
  { id: 'connect', label: 'Connect',  icon: Plug,      durationMs: 1400 },
  { id: 'extract', label: 'Extract',  icon: Download,  durationMs: 2600 },
  { id: 'map',     label: 'Map',      icon: GitBranch, durationMs: 1600 },
  { id: 'enrich',  label: 'Enrich',   icon: Sparkles,  durationMs: 2000 },
  { id: 'index',   label: 'Index',    icon: Database,  durationMs: 900  },
]
const TOTAL_MS = PIPELINE_STEPS.reduce((a, s) => a + s.durationMs, 0)
const IDLE_STATUSES: Record<StepId, StepStatus> = { connect:'idle', extract:'idle', map:'idle', enrich:'idle', index:'idle' }

// ── Sector-specific pipeline logs ─────────────────────────────────────────────

type StepLog = { text: string; type: 'info' | 'ok' | 'warn' }

const SECTOR_LOGS: Record<SectorId, Record<StepId, StepLog[]>> = {
  manufacturing: {
    connect: [
      { text: 'Initializing connection pool...', type: 'info' },
      { text: '✓ ERP OrionSales — PostgreSQL/DuckDB :5432 — 18ms', type: 'ok' },
      { text: '✓ CRM ClientHub — SQLite file loaded — 42ms', type: 'ok' },
      { text: '✓ HR dipendenti_hr.csv — 290 rows parsed', type: 'ok' },
      { text: '✓ PIM product_catalog_pim.json — 504 products parsed', type: 'ok' },
      { text: '4 sources ready', type: 'ok' },
    ],
    extract: [
      { text: 'Starting extraction job EXT-20141231-001', type: 'info' },
      { text: '→ ERP sales_order_header: 31,465 rows', type: 'info' },
      { text: '→ ERP sales_order_line: 121,317 rows', type: 'info' },
      { text: '→ ERP salesperson / territory / offer: 43 rows', type: 'info' },
      { text: '→ CRM account: 20,201 rows (372 flagged for dedup)', type: 'warn' },
      { text: '→ CRM contact / address: 38,916 rows', type: 'info' },
      { text: '→ HR + PIM: 794 rows', type: 'info' },
      { text: '✓ 212,736 rows extracted in 3.2s', type: 'ok' },
    ],
    map: [
      { text: 'Loading semantic mappings v1.0...', type: 'info' },
      { text: 'Resolving cross-source bridges...', type: 'info' },
      { text: '⚡ customer_ref → CRM.accountId — 19,829 matched (372 deduped)', type: 'ok' },
      { text: '⚡ salesperson_ref → HR.MatricolaDip — 17 matched', type: 'ok' },
      { text: '⚡ product_ref → PIM.internal_id — 504 matched', type: 'ok' },
      { text: '⚠ "fatturato" ambiguity detected — subtotal $20.1M vs total_due $22.4M', type: 'warn' },
      { text: '✓ 212,736 rows mapped — 3 bridges resolved', type: 'ok' },
    ],
    enrich: [
      { text: 'Running AI enrichment (claude-haiku-4)...', type: 'info' },
      { text: '→ CRM dedup: removing 372 accounts with accountId < 0', type: 'info' },
      { text: '✓ 19,829 unique customers retained', type: 'ok' },
      { text: '→ Building Knowledge Graph nodes and edges...', type: 'info' },
      { text: '✓ 193,062 KG nodes created', type: 'ok' },
      { text: '✓ 313,193 relationships indexed', type: 'ok' },
      { text: '→ Top rep 2014: Linda Mitchell #276 ($4.25M YTD, Southwest)', type: 'info' },
    ],
    index: [
      { text: 'Writing to semantic layer index...', type: 'info' },
      { text: '✓ 8 ontology entities registered', type: 'ok' },
      { text: '✓ 47 semantic field definitions indexed', type: 'ok' },
      { text: '✓ Query engine ready — fatturato disambiguation active', type: 'ok' },
      { text: '✓ Semantic layer ready', type: 'ok' },
    ],
  },
  retail: {
    connect: [
      { text: 'Initializing connection pool...', type: 'info' },
      { text: '✓ PostgreSQL 15.2 on :5432 — 21ms', type: 'ok' },
      { text: '✓ Shopify GraphQL API — token OK (89ms)', type: 'ok' },
      { text: '✓ Snowflake DWH — warehouse XS ready (3.1s)', type: 'ok' },
      { text: '3 sources ready', type: 'ok' },
    ],
    extract: [
      { text: 'Starting extraction job EXT-20260520-001', type: 'info' },
      { text: '→ customers: 4,291 rows (+67 delta)', type: 'info' },
      { text: '→ products: 2,104 rows (+12 delta)', type: 'info' },
      { text: '→ orders: 11,842 rows (+234 delta)', type: 'info' },
      { text: '→ inventory: 2,104 rows (+18 delta)', type: 'info' },
      { text: '→ promotions: 47 rows (+3 delta)', type: 'info' },
      { text: '✓ 20,388 rows extracted in 2.1s', type: 'ok' },
    ],
    map: [
      { text: 'Loading semantic mappings v1.9 (retail)', type: 'info' },
      { text: 'Applying 38 field-level mappings...', type: 'info' },
      { text: 'products.sku → schema:productID', type: 'info' },
      { text: 'orders.total_amount → schema:price', type: 'info' },
      { text: '✓ 20,388 rows mapped — 0 conflicts', type: 'ok' },
    ],
    enrich: [
      { text: 'Running AI enrichment (claude-haiku-4)...', type: 'info' },
      { text: '→ Basket analysis: detecting cross-sell patterns...', type: 'info' },
      { text: '✓ 847 product affinity pairs found', type: 'ok' },
      { text: '⚠ 12 inventory items below reorder threshold', type: 'warn' },
      { text: '✓ 3,912 enrichments applied', type: 'ok' },
    ],
    index: [
      { text: 'Writing to semantic layer index...', type: 'info' },
      { text: '✓ 67,204 RDF triples written', type: 'ok' },
      { text: '✓ Query cache invalidated', type: 'ok' },
      { text: '✓ Semantic layer v20260520-001 ready', type: 'ok' },
    ],
  },
  healthcare: {
    connect: [
      { text: 'Initializing connection pool...', type: 'info' },
      { text: '✓ PostgreSQL 15.2 on :5432 — 16ms', type: 'ok' },
      { text: '✓ Epic FHIR R4 endpoint — OAuth2 OK (201ms)', type: 'ok' },
      { text: '✓ HL7 FHIR message broker — connected (44ms)', type: 'ok' },
      { text: '3 sources ready', type: 'ok' },
    ],
    extract: [
      { text: 'Starting extraction job EXT-20260520-001', type: 'info' },
      { text: '→ patients: 1,204 rows (+8 delta)', type: 'info' },
      { text: '→ encounters: 3,812 rows (+45 delta)', type: 'info' },
      { text: '→ diagnoses: 5,107 rows (+32 delta)', type: 'info' },
      { text: '→ prescriptions: 2,891 rows (+67 delta)', type: 'info' },
      { text: '→ treatments: 1,634 rows (+19 delta)', type: 'info' },
      { text: '✓ 14,648 rows extracted in 2.7s', type: 'ok' },
    ],
    map: [
      { text: 'Loading semantic mappings v3.1 (healthcare / FHIR R4)', type: 'info' },
      { text: 'Applying 62 field-level mappings...', type: 'info' },
      { text: 'diagnoses.icd10 → fhir:Condition.code', type: 'info' },
      { text: 'prescriptions.dosage → fhir:Dosage', type: 'info' },
      { text: '✓ 14,648 rows mapped — 2 unmapped fields logged', type: 'ok' },
    ],
    enrich: [
      { text: 'Running AI enrichment (claude-haiku-4)...', type: 'info' },
      { text: '→ Care gap detection: patients without follow-up...', type: 'info' },
      { text: '✓ 34 care gaps identified and flagged', type: 'ok' },
      { text: '⚠ 7 patients with conflicting diagnoses — review', type: 'warn' },
      { text: '✓ 1,847 enrichments applied', type: 'ok' },
    ],
    index: [
      { text: 'Writing to semantic layer index...', type: 'info' },
      { text: '✓ 59,312 RDF triples written', type: 'ok' },
      { text: '✓ Query cache invalidated', type: 'ok' },
      { text: '✓ Semantic layer v20260520-001 ready', type: 'ok' },
    ],
  },
  finance: {
    connect: [
      { text: 'Initializing connection pool...', type: 'info' },
      { text: '✓ PostgreSQL 15.2 on :5432 — 22ms', type: 'ok' },
      { text: '✓ Temenos T24 REST API — auth OK (178ms)', type: 'ok' },
      { text: '✓ Credit Bureau API — rate limit: 500 req/min', type: 'ok' },
      { text: '3 sources ready', type: 'ok' },
    ],
    extract: [
      { text: 'Starting extraction job EXT-20260520-001', type: 'info' },
      { text: '→ applicants: 892 rows (+14 delta)', type: 'info' },
      { text: '→ loans: 2,341 rows (+28 delta)', type: 'info' },
      { text: '→ transactions: 18,204 rows (+1,247 delta)', type: 'info' },
      { text: '→ kyc_records: 892 rows (+14 delta)', type: 'info' },
      { text: '→ risk_profiles: 892 rows (+14 delta)', type: 'info' },
      { text: '✓ 23,221 rows extracted in 3.1s', type: 'ok' },
    ],
    map: [
      { text: 'Loading semantic mappings v2.7 (finance / FIBO)', type: 'info' },
      { text: 'Applying 53 field-level mappings...', type: 'info' },
      { text: 'loans.amount → fibo:PrincipalAmount', type: 'info' },
      { text: 'applicants.iban → fibo:BankAccountIdentifier', type: 'info' },
      { text: '✓ 23,221 rows mapped — 0 conflicts', type: 'ok' },
    ],
    enrich: [
      { text: 'Running AI enrichment (claude-haiku-4)...', type: 'info' },
      { text: '→ Risk scoring: recomputing profiles...', type: 'info' },
      { text: '✓ 892 risk scores updated', type: 'ok' },
      { text: '⚠ 6 applicants with incomplete KYC flagged', type: 'warn' },
      { text: '✓ 3,204 enrichments applied', type: 'ok' },
    ],
    index: [
      { text: 'Writing to semantic layer index...', type: 'info' },
      { text: '✓ 84,107 RDF triples written', type: 'ok' },
      { text: '✓ Query cache invalidated', type: 'ok' },
      { text: '✓ Semantic layer v20260520-001 ready', type: 'ok' },
    ],
  },
}

const SECTOR_SUMMARY: Record<SectorId, { rows: string; entities: number; enrichments: string; triples: string }> = {
  manufacturing: { rows: '212,736', entities: 8, enrichments: '193,062', triples: '313,193' },
  retail:        { rows: '20,388', entities: 8, enrichments: '3,912', triples: '67,204' },
  healthcare:    { rows: '14,648', entities: 8, enrichments: '1,847', triples: '59,312' },
  finance:       { rows: '23,221', entities: 8, enrichments: '3,204', triples: '84,107' },
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepIndicator({ step, status, active }: { step: StepDef; status: StepStatus; active: boolean }) {
  const Icon = step.icon
  const base = 'flex flex-col items-center gap-1.5 flex-1'
  return (
    <div className={base}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
        status === 'done'    ? 'bg-teal-500 text-white shadow-sm shadow-teal-200' :
        status === 'running' ? 'bg-teal-50 border-2 border-teal-500 text-teal-600' :
                              'bg-slate-100 border border-slate-200 text-slate-400'
      }`}>
        {status === 'done' ? (
          <CheckCircle2 className="w-5 h-5" />
        ) : status === 'running' ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Icon className="w-4 h-4" />
        )}
      </div>
      <span className={`text-[11px] font-medium transition-colors ${
        status === 'done' ? 'text-teal-600' :
        status === 'running' ? 'text-teal-700' :
        'text-slate-400'
      } ${active ? 'font-semibold' : ''}`}>{step.label}</span>
    </div>
  )
}

function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <div className="flex gap-2 font-mono text-[11px] leading-relaxed">
      <span className="text-slate-500 flex-shrink-0">{entry.time}</span>
      <span className={
        entry.type === 'ok'   ? 'text-teal-400' :
        entry.type === 'warn' ? 'text-amber-400' :
                                'text-slate-300'
      }>{entry.text}</span>
    </div>
  )
}

// ── Stage style palette ───────────────────────────────────────────────────────

const STAGE_STYLES = [
  { icon: FileText,    color: 'text-slate-700', bg: 'bg-slate-50',  border: 'border-slate-200' },
  { icon: Send,        color: 'text-blue-700',  bg: 'bg-blue-50',   border: 'border-blue-200' },
  { icon: Factory,     color: 'text-amber-700', bg: 'bg-amber-50',  border: 'border-amber-200' },
  { icon: CheckCircle, color: 'text-teal-700',  bg: 'bg-teal-50',   border: 'border-teal-200' },
  { icon: ShoppingCart,color: 'text-purple-700',bg: 'bg-purple-50', border: 'border-purple-200' },
  { icon: Package,     color: 'text-green-700', bg: 'bg-green-50',  border: 'border-green-200' },
]

const STAGE_COLORS: Record<string, string> = {
  'Stage 2': 'bg-blue-50 text-blue-700 border border-blue-200',
  'Stage 3': 'bg-amber-50 text-amber-700 border border-amber-200',
  'Stage 4': 'bg-teal-50 text-teal-700 border border-teal-200',
}

const AVG_DAYS = ['0.5 d', '2.1 d', '5.8 d', '3.2 d']

// Real AW orders — keyed by sector so other sectors keep generic data
const ACTIVE_CASES_BY_SECTOR: Record<SectorId, { id: number; name: string; value: number; stage: string; daysInStage: number; territory?: string }[]> = {
  manufacturing: [
    { id: 75123, name: 'Bike World Inc.',               value: 87145,  stage: 'Confirmed',  daysInStage: 3,  territory: 'Southwest'  },
    { id: 75124, name: 'Action Bicycle Specialists',    value: 53209,  stage: 'Confirmed',  daysInStage: 3,  territory: 'Northwest'  },
    { id: 75120, name: 'Eastside Department Store',     value: 2049,   stage: 'Processing', daysInStage: 1,  territory: 'Canada'     },
    { id: 75119, name: 'Valley Bicycle Specialists',    value: 2039,   stage: 'Processing', daysInStage: 1,  territory: 'Australia'  },
    { id: 75122, name: 'Riding Cycles',                 value: 1898,   stage: 'Shipped',    daysInStage: 5,  territory: 'Germany'    },
  ],
  retail: [
    { id: 4820, name: 'Marco Rossi',     value: 184,    stage: 'Stage 2', daysInStage: 2  },
    { id: 4819, name: 'Giulia Ferrari',  value: 326,    stage: 'Stage 2', daysInStage: 1  },
    { id: 4817, name: 'Luca Bianchi',    value: 95,     stage: 'Stage 3', daysInStage: 6  },
    { id: 4815, name: 'Sofia Conti',     value: 412,    stage: 'Stage 3', daysInStage: 11 },
    { id: 4814, name: 'Andrea Marino',   value: 78,     stage: 'Stage 4', daysInStage: 2  },
  ],
  healthcare: [
    { id: 8041, name: 'Rossi Mario (M/72)',    value: 0,   stage: 'Stage 2', daysInStage: 2  },
    { id: 8040, name: 'Ferrari Anna (F/58)',   value: 0,   stage: 'Stage 3', daysInStage: 6  },
    { id: 8038, name: 'Conti Luca (M/45)',     value: 0,   stage: 'Stage 3', daysInStage: 11 },
    { id: 8036, name: 'Bianchi Sara (F/34)',   value: 0,   stage: 'Stage 4', daysInStage: 2  },
    { id: 8034, name: 'Esposito Carlo (M/61)', value: 0,   stage: 'Stage 2', daysInStage: 1  },
  ],
  finance: [
    { id: 2941, name: 'Rossi & Figli Srl',     value: 350000,  stage: 'Stage 2', daysInStage: 2  },
    { id: 2939, name: 'Tech Startup SB Srl',   value: 500000,  stage: 'Stage 2', daysInStage: 1  },
    { id: 2937, name: 'Ferrari Holding SA',    value: 1200000, stage: 'Stage 3', daysInStage: 6  },
    { id: 2935, name: 'Bianchi Costruzioni',   value: 280000,  stage: 'Stage 3', daysInStage: 11 },
    { id: 2933, name: 'Conti Real Estate Srl', value: 750000,  stage: 'Stage 4', daysInStage: 2  },
  ],
}

const STAGE_COLORS_AW: Record<string, string> = {
  'Confirmed':   'bg-blue-50 text-blue-700 border border-blue-200',
  'Processing':  'bg-amber-50 text-amber-700 border border-amber-200',
  'Shipped':     'bg-purple-50 text-purple-700 border border-purple-200',
  'Delivered':   'bg-teal-50 text-teal-700 border border-teal-200',
}

function fmt(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProcessView() {
  const { sectorId, sector } = useSector()

  const [liveConfig, setLiveConfig] = useState<LiveConfig | null>(null)
  useEffect(() => {
    getLiveConfig().then(setLiveConfig).catch(() => {})
  }, [])

  // Pipeline state
  const [runState, setRunState] = useState<RunState>('idle')
  const [statuses, setStatuses] = useState<Record<StepId, StepStatus>>(IDLE_STATUSES)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [lastRunDuration, setLastRunDuration] = useState<number | null>(null)
  const [lastRunAt, setLastRunAt] = useState<string | null>(null)

  const timeoutsRef = useRef<number[]>([])
  const intervalRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Stop pipeline when sector changes
  useEffect(() => {
    stopPipeline()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach(clearTimeout)
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  useEffect(() => {
    function onTrigger() { runPipeline() }
    window.addEventListener('trigger-pipeline-run', onTrigger)
    return () => window.removeEventListener('trigger-pipeline-run', onTrigger)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopPipeline() {
    timeoutsRef.current.forEach(clearTimeout)
    timeoutsRef.current = []
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    setRunState('idle')
    setStatuses(IDLE_STATUSES)
    setElapsed(0)
  }

  function runPipeline() {
    stopPipeline()
    setLogs([])
    setRunState('running')
    startTimeRef.current = Date.now()

    // Progress ticker
    intervalRef.current = window.setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current)
    }, 80)

    const sectorLogs = SECTOR_LOGS[sectorId]
    let offset = 0

    for (const step of PIPELINE_STEPS) {
      const stepOffset = offset
      const stepLogs = sectorLogs[step.id]
      const logInterval = step.durationMs / (stepLogs.length + 1)

      // Start step
      timeoutsRef.current.push(window.setTimeout(() => {
        setStatuses(prev => ({ ...prev, [step.id]: 'running' }))
      }, stepOffset))

      // Emit log lines
      stepLogs.forEach((log, i) => {
        timeoutsRef.current.push(window.setTimeout(() => {
          const time = new Date().toLocaleTimeString('en-US', { hour12: false })
          setLogs(prev => [...prev, { id: Date.now() + i, time, text: log.text, type: log.type }])
        }, stepOffset + Math.floor((i + 1) * logInterval)))
      })

      // End step
      timeoutsRef.current.push(window.setTimeout(() => {
        setStatuses(prev => ({ ...prev, [step.id]: 'done' }))
      }, stepOffset + step.durationMs - 60))

      offset += step.durationMs
    }

    // Pipeline done
    timeoutsRef.current.push(window.setTimeout(() => {
      const duration = Date.now() - startTimeRef.current
      setLastRunDuration(duration)
      setLastRunAt(new Date().toLocaleTimeString('en-US', { hour12: false }))
      setRunState('done')
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      setElapsed(TOTAL_MS)
      localStorage.setItem(`pipeline-last-run-${sectorId}`, new Date().toISOString())
      window.dispatchEvent(new CustomEvent('pipeline-run-updated'))
    }, offset))
  }

  const progressPct = Math.min(100, Math.round((elapsed / TOTAL_MS) * 100))
  const activeStepIdx = PIPELINE_STEPS.findIndex(s => statuses[s.id] === 'running')
  const summary = SECTOR_SUMMARY[sectorId]
  const funnel = liveConfig?.funnel ?? sector.funnel
  const processStages = (liveConfig?.process_stages?.length ? liveConfig.process_stages : sector.processStages)
  const maxCount = funnel[0]?.count ?? 1

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Process</h1>
        <p className="text-slate-500 mt-1 text-sm">{sector.name} · {sector.domain}</p>
      </div>

      {/* ── Pipeline executor ─────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <Activity className={`w-4 h-4 ${runState === 'running' ? 'text-teal-500 animate-pulse' : 'text-slate-400'}`} />
            <h2 className="font-semibold text-slate-900">Semantic Layer Pipeline</h2>
            {lastRunAt && runState !== 'running' && (
              <span className="text-[11px] text-slate-400">· Last run at {lastRunAt} ({((lastRunDuration ?? 0) / 1000).toFixed(1)}s)</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {runState === 'running' ? (
              <button
                onClick={stopPipeline}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
                Stop
              </button>
            ) : (
              <button
                onClick={runPipeline}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                {runState === 'done' ? 'Re-run Pipeline' : 'Run Pipeline'}
              </button>
            )}
          </div>
        </div>

        {/* Step indicators + progress */}
        <div className="px-6 py-5">
          <div className="flex items-start gap-0">
            {PIPELINE_STEPS.map((step, i) => (
              <div key={step.id} className="flex items-center flex-1">
                <StepIndicator step={step} status={statuses[step.id]} active={i === activeStepIdx} />
                {i < PIPELINE_STEPS.length - 1 && (
                  <div className={`h-px flex-shrink-0 w-4 mb-5 transition-colors ${
                    statuses[PIPELINE_STEPS[i + 1].id] !== 'idle' || statuses[step.id] === 'done'
                      ? 'bg-teal-300'
                      : 'bg-slate-200'
                  }`} />
                )}
              </div>
            ))}
          </div>

          {/* Progress bar */}
          {runState !== 'idle' && (
            <div className="mt-4">
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal-500 rounded-full transition-all duration-100"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[11px] text-slate-400">
                  {runState === 'running'
                    ? activeStepIdx >= 0 ? `Step ${activeStepIdx + 1}/5: ${PIPELINE_STEPS[activeStepIdx].label}…` : 'Finishing…'
                    : '✓ Pipeline complete'}
                </span>
                <span className="text-[11px] text-slate-400">{progressPct}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Live log panel */}
        {(runState !== 'idle' || logs.length > 0) && (
          <div className="mx-6 mb-5 bg-slate-900 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700">
              <div className={`w-2 h-2 rounded-full ${runState === 'running' ? 'bg-teal-400 animate-pulse' : 'bg-slate-500'}`} />
              <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Live logs</span>
            </div>
            <div className="p-3 h-44 overflow-y-auto space-y-0.5">
              {logs.map(entry => <LogLine key={entry.id} entry={entry} />)}
              {runState === 'running' && logs.length === 0 && (
                <span className="text-slate-500 text-[11px] font-mono">Waiting for first output…</span>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* Completion summary */}
        {runState === 'done' && (
          <div className="mx-6 mb-5 grid grid-cols-4 gap-3">
            {[
              { label: 'Rows Extracted',   value: summary.rows,                   sub: `${(liveConfig?.connectors ?? sector.connectors).length} sources connected` },
              { label: 'Entities Mapped',  value: String(summary.entities),        sub: `${summary.entities} ontology classes` },
              { label: 'KG Nodes Created', value: summary.enrichments,             sub: 'instances in Knowledge Graph' },
              { label: 'KG Edges Indexed', value: summary.triples,                 sub: '3 cross-source bridges' },
            ].map(({ label, value, sub }) => (
              <div key={label} className="bg-teal-50 border border-teal-100 rounded-lg px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-teal-700">{value}</p>
                <p className="text-[10px] text-teal-600 uppercase tracking-wide mt-0.5">{label}</p>
                <p className="text-[10px] text-teal-500 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Lifecycle stages ──────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="font-semibold text-slate-900 mb-6">Lifecycle</h2>
        <div className="flex items-start gap-2 overflow-x-auto pb-2">
          {processStages.map((stage, i) => {
            const style = STAGE_STYLES[i % STAGE_STYLES.length]
            const Icon = style.icon
            const funnelItem = funnel[Math.min(i, funnel.length - 1)]
            return (
              <div key={stage.key} className="flex items-start gap-2 flex-shrink-0">
                <div className={`rounded-xl border ${style.border} ${style.bg} p-4 w-40 text-center`}>
                  <div className="flex justify-center mb-2">
                    <Icon className={`w-6 h-6 ${style.color}`} />
                  </div>
                  <p className={`text-sm font-bold ${style.color}`}>{stage.label}</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{funnelItem?.count.toLocaleString('en-US') ?? 0}</p>
                  {funnelItem?.value ? (
                    <p className="text-xs text-slate-500 mt-0.5">{fmt(funnelItem.value)}</p>
                  ) : (
                    <p className="text-xs text-slate-400 mt-0.5">—</p>
                  )}
                  <div className="mt-2 flex items-center justify-center gap-1 text-xs text-slate-500">
                    <Clock className="w-3 h-3" />
                    <span>{AVG_DAYS[i % AVG_DAYS.length]}</span>
                  </div>
                </div>
                {i < processStages.length - 1 && (
                  <div className="mt-10 text-slate-300 text-xl font-light flex-shrink-0">→</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Conversion funnel ─────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="font-semibold text-slate-900 mb-5">Conversion Funnel</h2>
        <div className="space-y-3">
          {funnel.map((item, i) => {
            const pct = Math.round((item.count / maxCount) * 100)
            const opacity = 1 - i * 0.1
            return (
              <div key={item.stage} className="flex items-center gap-4">
                <span className="text-sm text-slate-600 w-44 flex-shrink-0">{item.stage}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
                  <div
                    className="h-full rounded-full flex items-center px-3 transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: `rgba(13,148,136,${opacity})` }}
                  >
                    <span className="text-xs font-semibold text-white">{item.count.toLocaleString('en-US')}</span>
                  </div>
                </div>
                <span className="text-sm text-slate-500 w-28 text-right flex-shrink-0">
                  {item.value > 0 ? fmt(item.value) : '—'}
                </span>
                <span className="text-xs text-slate-400 w-10 text-right flex-shrink-0">{pct}%</span>
              </div>
            )
          })}
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-4 text-xs text-slate-500">
          <span>Conversion rate: <strong className="text-teal-600">{Math.round((funnel[funnel.length - 1]?.count / Math.max(1, funnel[0]?.count)) * 100)}%</strong></span>
          <span>Stages: <strong className="text-teal-600">{funnel.length}</strong></span>
          {runState === 'done' && (
            <span className="flex items-center gap-1 text-teal-600">
              <CheckCircle2 className="w-3 h-3" />
              Synced from semantic layer
            </span>
          )}
        </div>
      </div>

      {/* ── Active records ────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-900">
            {sectorId === 'manufacturing' ? 'Recent Orders — ERP OrionSales' : 'Active Cases'}
          </h2>
          {sectorId === 'manufacturing' && (
            <span className="text-xs text-slate-400 font-mono">31,465 total orders · showing latest 5</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-200">
                <th className="text-left pb-2 font-medium">Order ID</th>
                <th className="text-left pb-2 font-medium">Customer</th>
                {sectorId === 'manufacturing' && <th className="text-left pb-2 font-medium">Territory</th>}
                <th className="text-left pb-2 font-medium">Status</th>
                <th className="text-right pb-2 font-medium">Value (subtotal)</th>
                <th className="text-right pb-2 font-medium">Days open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ACTIVE_CASES_BY_SECTOR[sectorId].map(c => {
                const stageColor = sectorId === 'manufacturing'
                  ? (STAGE_COLORS_AW[c.stage] ?? 'bg-slate-100 text-slate-600 border border-slate-200')
                  : (STAGE_COLORS[c.stage] ?? 'bg-slate-100 text-slate-600 border border-slate-200')
                return (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 text-slate-400 font-mono text-xs">#{c.id}</td>
                    <td className="py-3 text-slate-900 font-medium">{c.name}</td>
                    {sectorId === 'manufacturing' && (
                      <td className="py-3 text-xs text-slate-500">{c.territory ?? '—'}</td>
                    )}
                    <td className="py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${stageColor}`}>
                        {c.stage}
                      </span>
                    </td>
                    <td className="py-3 text-right text-slate-900 font-mono">{c.value > 0 ? fmt(c.value) : '—'}</td>
                    <td className={`py-3 text-right font-semibold ${c.daysInStage > 8 ? 'text-amber-600' : 'text-slate-600'}`}>
                      {c.daysInStage} d
                      {c.daysInStage > 8 && <AlertTriangle className="w-3 h-3 inline ml-1 text-amber-500" />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {sectorId === 'manufacturing' && (
          <p className="mt-3 text-[11px] text-slate-400 border-t border-slate-100 pt-3">
            Orders #75123 and #75124 are large confirmed orders (Dec 2014) pending shipment — combined value $140K.
            Status sourced from ERP OrionSales · Joined with CRM for customer names via <span className="font-mono text-teal-600">customer_ref ↔ accountId</span>.
          </p>
        )}
      </div>
    </div>
  )
}
