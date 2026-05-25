import { useState } from 'react'
import { Database, GitBranch, AlertTriangle, CheckCircle, Info, Plus, Zap, X, Network, MessageSquare } from 'lucide-react'

// ── AdventureWorks Knowledge Graph — static data ───────────────────────────────

const KG_STATS = [
  { label: 'KG Nodes',          value: '193,062', sub: 'entity instances' },
  { label: 'KG Edges',          value: '313,193', sub: 'relationships' },
  { label: 'Sources Integrated',value: '4',        sub: 'ERP · CRM · HR · PIM' },
  { label: 'Dedup Removed',     value: '372',      sub: 'CRM duplicate accounts' },
]

const AW_SOURCES = [
  {
    id: 'erp',
    name: 'ERP — OrionSales',
    type: 'PostgreSQL / DuckDB',
    icon: '🏭',
    colorBorder: 'border-blue-200',
    colorBg: 'bg-blue-50',
    colorText: 'text-blue-700',
    colorDot: 'bg-blue-500',
    entities: [
      { name: 'SalesOrder',     rows: 31465  },
      { name: 'SalesOrderLine', rows: 121317 },
      { name: 'Salesperson',    rows: 17     },
      { name: 'Territory',      rows: 10     },
      { name: 'Offer',          rows: 16     },
    ],
    total: 152825,
  },
  {
    id: 'crm',
    name: 'CRM — ClientHub',
    type: 'SQLite',
    icon: '🤝',
    colorBorder: 'border-teal-200',
    colorBg: 'bg-teal-50',
    colorText: 'text-teal-700',
    colorDot: 'bg-teal-500',
    entities: [
      { name: 'Customer (account)', rows: 20201 },
      { name: 'Contact',            rows: 19302 },
      { name: 'Address',            rows: 19614 },
      { name: 'StateProvince',      rows: 70    },
      { name: 'Country',            rows: 6     },
    ],
    total: 59193,
    warning: '372 duplicate accounts (accountId < 0)',
  },
  {
    id: 'hr',
    name: 'HR — Employees',
    type: 'CSV',
    icon: '👥',
    colorBorder: 'border-violet-200',
    colorBg: 'bg-violet-50',
    colorText: 'text-violet-700',
    colorDot: 'bg-violet-500',
    entities: [
      { name: 'Employee (dipendenti_hr)', rows: 290 },
    ],
    total: 290,
    warning: 'Italian schema: matricolaDip, cognome, nome, ruolo',
  },
  {
    id: 'pim',
    name: 'PIM — Catalog',
    type: 'JSON',
    icon: '📦',
    colorBorder: 'border-amber-200',
    colorBg: 'bg-amber-50',
    colorText: 'text-amber-700',
    colorDot: 'bg-amber-500',
    entities: [
      { name: 'Product (product_catalog)', rows: 504 },
    ],
    total: 504,
  },
]

const AW_BRIDGES = [
  {
    id: 1,
    label: 'PLACED_BY',
    fromSource: 'ERP — OrionSales',
    fromField: 'customer_ref : integer',
    fromEntity: 'SalesOrder',
    toSource: 'CRM — ClientHub',
    toField: 'accountId : integer',
    toEntity: 'Customer',
    cardinality: 'N:1',
    status: 'active' as const,
    matchRate: 93.2,
    matchDetail: '18,484 / 19,829 accounts matched · 1,345 CRM-only prospects',
    note: '19,829 unique customers after dedup (372 neg-ID removed)',
  },
  {
    id: 2,
    label: 'SOLD_BY',
    fromSource: 'ERP — OrionSales',
    fromField: 'salesperson_ref : integer',
    fromEntity: 'SalesOrder',
    toSource: 'HR — Employees',
    toField: 'matricolaDip : integer',
    toEntity: 'Employee',
    cardinality: 'N:1',
    status: 'active' as const,
    matchRate: 100,
    matchDetail: '14/14 sales reps fully matched · Italian schema mapped',
    note: '14 salespersons mapped ERP ↔ HR — 100% match rate',
  },
  {
    id: 3,
    label: 'OF_PRODUCT',
    fromSource: 'ERP — OrionSales',
    fromField: 'product_ref : integer',
    fromEntity: 'SalesOrderLine',
    toSource: 'PIM — Catalog',
    toField: 'internal_id : integer',
    toEntity: 'Product',
    cardinality: 'N:1',
    status: 'active' as const,
    matchRate: 99.6,
    matchDetail: '47 SalesOrderLine rows unmatched · 121,270 / 121,317 matched',
    note: '504 products enriched with PIM metadata (category, listPrice, color)',
  },
]

const QUERY_EXAMPLES = [
  {
    question: 'Who is the top salesperson?',
    bridges: ['SOLD_BY'],
    sql: 'SELECT e.cognome, sp.salesYTD FROM SalesPerson sp JOIN dipendenti_hr e ON sp.salesPersonId = e.matricolaDip ORDER BY salesYTD DESC',
    result: 'Linda Mitchell · $4.25M YTD',
  },
  {
    question: 'What is the revenue by territory?',
    bridges: ['PLACED_BY'],
    sql: 'SELECT t.name, SUM(o.subtotalAmount) FROM SalesOrder o JOIN Territory t ON o.territoryId = t.territoryId GROUP BY t.name',
    result: 'Southwest $10.5M · Northwest $7.9M · Canada $6.8M',
  },
  {
    question: 'Which products generated the most revenue?',
    bridges: ['OF_PRODUCT'],
    sql: 'SELECT p.name, SUM(sol.lineTotal) FROM SalesOrderLine sol JOIN product_catalog p ON sol.productId = p.internal_id GROUP BY p.name',
    result: 'Mountain-200 Black $261K · Road-150 Red $106K',
  },
]

const QUALITY_ISSUES = [
  {
    severity: 'warning' as const,
    entity: 'Customer (CRM)',
    issue: '372 accounts with accountId < 0 — duplicates from legacy migration',
    resolution: 'Removed from KG; 19,829 unique accounts retained',
  },
  {
    severity: 'info' as const,
    entity: 'Employee (HR)',
    issue: 'Italian schema field names: matricolaDip, cognome, nome, dataNascita, ruolo',
    resolution: 'Mapped in semantic layer → Employee.employeeId, lastName, firstName…',
  },
  {
    severity: 'warning' as const,
    entity: 'SalesOrder (ERP)',
    issue: '"fatturato" (revenue) is ambiguous: subtotal_amount ($20.1M) vs total_due ($22.4M, includes tax+freight)',
    resolution: 'Requires explicit disambiguation at query time',
  },
]

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 text-center">
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-xs font-semibold text-slate-600 mt-1">{label}</p>
      <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>
    </div>
  )
}

function SourceCard({ source }: { source: typeof AW_SOURCES[0] }) {
  const total = source.total.toLocaleString('en-US')
  return (
    <div className={`border ${source.colorBorder} rounded-xl p-4 bg-white`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">{source.icon}</span>
            <span className="font-semibold text-slate-900 text-sm">{source.name}</span>
          </div>
          <span className={`mt-1 inline-block text-[10px] font-mono px-2 py-0.5 rounded-full ${source.colorBg} ${source.colorText} font-medium`}>
            {source.type}
          </span>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-slate-800">{total}</p>
          <p className="text-[11px] text-slate-400">total rows</p>
        </div>
      </div>
      <div className="space-y-1.5">
        {source.entities.map(e => (
          <div key={e.name} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${source.colorDot}`} />
              <span className="text-slate-600 font-mono">{e.name}</span>
            </div>
            <span className="text-slate-400">{e.rows.toLocaleString('en-US')}</span>
          </div>
        ))}
      </div>
      {source.warning && (
        <div className="mt-3 flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          {source.warning}
        </div>
      )}
    </div>
  )
}

function BridgeRow({ bridge }: { bridge: typeof AW_BRIDGES[0] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-3 flex-wrap">
        {/* From */}
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">From</p>
          <p className="text-xs font-semibold text-slate-700">{bridge.fromSource}</p>
          <p className="text-[11px] text-slate-500 font-mono">{bridge.fromEntity}.{bridge.fromField}</p>
        </div>
        {/* Arrow */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0">
          <span className="text-[10px] font-bold text-teal-600 bg-teal-50 border border-teal-200 rounded-full px-2.5 py-1 whitespace-nowrap">
            ⚡ {bridge.label}
          </span>
          <span className="text-[10px] text-slate-400">{bridge.cardinality}</span>
        </div>
        {/* To */}
        <div className="flex-1 min-w-0 text-right">
          <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">To</p>
          <p className="text-xs font-semibold text-slate-700">{bridge.toSource}</p>
          <p className="text-[11px] text-slate-500 font-mono">{bridge.toEntity}.{bridge.toField}</p>
        </div>
        {/* Status + match rate */}
        <div className="flex-shrink-0 flex flex-col items-end gap-1">
          <CheckCircle className="w-4 h-4 text-teal-500" />
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
            bridge.matchRate === 100 ? 'bg-teal-100 text-teal-700' :
            bridge.matchRate >= 95  ? 'bg-blue-100 text-blue-700' :
                                       'bg-amber-100 text-amber-700'
          }`}>{bridge.matchRate}%</span>
        </div>
      </div>
      <div className="mt-2.5 border-t border-slate-100 pt-2.5 space-y-1">
        <p className="text-[11px] text-slate-500">{bridge.note}</p>
        <p className="text-[10px] text-slate-400 font-mono">{bridge.matchDetail}</p>
      </div>
    </div>
  )
}

// ── Builder (custom bridges) ───────────────────────────────────────────────────

interface CustomBridge { from: string; to: string; label: string }

function KGBuilder({ bridges, onAdd, onRemove }: {
  bridges: CustomBridge[]
  onAdd: (b: CustomBridge) => void
  onRemove: (i: number) => void
}) {
  const [form, setForm] = useState({ from: '', to: '', label: '' })
  const allEntities = AW_SOURCES.flatMap(s => s.entities.map(e => `${s.name} · ${e.name}`))

  function submit() {
    if (!form.from || !form.to || !form.label) return
    onAdd({ ...form })
    setForm({ from: '', to: '', label: '' })
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h3 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
        <Plus className="w-4 h-4 text-teal-600" />
        Add Custom Relationship
      </h3>
      <p className="text-xs text-slate-500 mb-4">Define a new cross-source bridge or custom relationship in the Knowledge Graph.</p>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-[11px] font-medium text-slate-600 mb-1 block">From entity</label>
          <select
            value={form.from}
            onChange={e => setForm(f => ({ ...f, from: e.target.value }))}
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-slate-50 focus:border-teal-400 outline-none"
          >
            <option value="">Select entity…</option>
            {allEntities.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-600 mb-1 block">Relationship label</label>
          <input
            value={form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
            placeholder="e.g. MANAGED_BY"
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-slate-50 focus:border-teal-400 outline-none font-mono"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-600 mb-1 block">To entity</label>
          <select
            value={form.to}
            onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-slate-50 focus:border-teal-400 outline-none"
          >
            <option value="">Select entity…</option>
            {allEntities.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
      </div>
      <button
        onClick={submit}
        disabled={!form.from || !form.to || !form.label}
        className="text-xs bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
      >
        Add to Knowledge Graph
      </button>

      {bridges.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Custom bridges</p>
          {bridges.map((b, i) => (
            <div key={i} className="flex items-center gap-2 text-xs bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
              <span className="text-slate-600 font-mono truncate flex-1">{b.from}</span>
              <span className="text-violet-600 font-bold whitespace-nowrap">— {b.label} →</span>
              <span className="text-slate-600 font-mono truncate flex-1 text-right">{b.to}</span>
              <button onClick={() => onRemove(i)} className="text-slate-400 hover:text-red-500 transition-colors flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function SemanticLayerView() {
  const [customBridges, setCustomBridges] = useState<CustomBridge[]>([])

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 bg-white flex-shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Network className="w-5 h-5 text-teal-600" />
              <h1 className="text-2xl font-bold text-slate-900">Knowledge Graph</h1>
            </div>
            <p className="text-slate-400 text-sm">
              AdventureWorks · 4 integrated sources · {(193062 + customBridges.length).toLocaleString('en-US')} nodes · 313,193 edges
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs bg-teal-50 border border-teal-200 text-teal-700 rounded-full px-3 py-1.5 font-medium">
            <Zap className="w-3.5 h-3.5" />
            3 cross-source bridges active
          </div>
        </div>
      </div>

      <div className="flex-1 px-8 py-6 space-y-8">

        {/* KG Stats */}
        <div className="grid grid-cols-4 gap-4">
          {KG_STATS.map(s => <StatCard key={s.label} {...s} />)}
        </div>

        {/* Source Architecture */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Database className="w-4 h-4 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Source Architecture</h2>
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {AW_SOURCES.map(s => <SourceCard key={s.id} source={s} />)}
          </div>
        </section>

        {/* Cross-source Bridges */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <GitBranch className="w-4 h-4 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Cross-source Bridges</h2>
            <span className="text-xs text-slate-400">— joins across systems via semantic keys</span>
          </div>
          <div className="space-y-3">
            {AW_BRIDGES.map(b => <BridgeRow key={b.id} bridge={b} />)}
          </div>
        </section>

        {/* Data Quality */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Data Quality</h2>
          </div>
          <div className="space-y-2">
            {QUALITY_ISSUES.map((issue, i) => {
              const isWarning = issue.severity === 'warning'
              return (
                <div
                  key={i}
                  className={`border rounded-xl p-4 ${isWarning ? 'bg-amber-50 border-amber-200' : 'bg-sky-50 border-sky-200'}`}
                >
                  <div className="flex items-start gap-3">
                    {isWarning
                      ? <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                      : <Info className="w-4 h-4 text-sky-500 mt-0.5 flex-shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-semibold text-slate-700">{issue.entity}</span>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${isWarning ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>
                          {issue.severity}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700">{issue.issue}</p>
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-teal-500" />
                        {issue.resolution}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Cross-source Query Examples */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Cross-source Query Examples</h2>
            <span className="text-xs text-slate-400">— what the bridges unlock in Query AI</span>
          </div>
          <div className="space-y-3">
            {QUERY_EXAMPLES.map((ex, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-start gap-3 mb-3">
                  <MessageSquare className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">"{ex.question}"</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {ex.bridges.map(b => (
                        <span key={b} className="text-[10px] font-bold text-teal-600 bg-teal-50 border border-teal-200 rounded-full px-2 py-0.5">⚡ {b}</span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-0.5">Result</p>
                    <p className="text-xs font-semibold text-teal-700">{ex.result}</p>
                  </div>
                </div>
                <pre className="text-[10px] font-mono bg-slate-900 text-teal-300 rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre leading-relaxed">{ex.sql}</pre>
              </div>
            ))}
          </div>
        </section>

        {/* Builder */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Plus className="w-4 h-4 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Knowledge Graph Builder</h2>
          </div>
          <KGBuilder
            bridges={customBridges}
            onAdd={b => setCustomBridges(prev => [...prev, b])}
            onRemove={i => setCustomBridges(prev => prev.filter((_, idx) => idx !== i))}
          />
        </section>

        {/* 25 Golden Questions */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="w-4 h-4 text-slate-500" />
            <h2 className="font-semibold text-slate-900">25 Golden Questions — Evaluation Test Set</h2>
            <span className="text-[10px] font-bold bg-slate-100 text-slate-500 rounded-full px-2 py-0.5 ml-1">pytest harness</span>
          </div>
          {[
            { label: '🟢 Livello 1 — Single source', questions: [
              { id:'Q1',  q:'Quanti dipendenti lavorano nel reparto "Engineering"?',                      src:'HR' },
              { id:'Q2',  q:'Qual è il prezzo di listino della mountain bike "Mountain-200 Black, 38"?',  src:'PIM' },
              { id:'Q3',  q:'Quanti ordini abbiamo nel sistema?',                                         src:'ERP' },
              { id:'Q4',  q:'Elenco delle aziende clienti (B2B) attive.',                                 src:'CRM' },
              { id:'Q5',  q:'Qual è la retribuzione oraria media nel reparto Production?',                src:'HR' },
            ]},
            { label: '🟡 Livello 2 — Cross-fonte semplice', questions: [
              { id:'Q6',  q:'Chi è il venditore che ha gestito più ordini nel 2014?',                     src:'ERP + HR' },
              { id:'Q7',  q:'Qual è il fatturato totale per territorio nel 2014?',                        src:'ERP' },
              { id:'Q8',  q:'Qual è il cliente che ha speso di più in assoluto?',                         src:'ERP + CRM' },
              { id:'Q9',  q:'Top 5 prodotti più venduti per quantità.',                                   src:'ERP + PIM' },
              { id:'Q10', q:'In quale stato/provincia abita il cliente con maggior numero di ordini?',    src:'ERP + CRM' },
              { id:'Q11', q:'Quanti dipendenti ci sono per gruppo di reparto?',                           src:'HR' },
              { id:'Q12', q:'Quanti prodotti sono "make only" (prodotti internamente)?',                  src:'PIM' },
              { id:'Q13', q:'Quali clienti hanno indirizzo in California?',                               src:'CRM' },
            ]},
            { label: '🟠 Livello 3 — Multi-fonte + filtri contestuali', questions: [
              { id:'Q14', q:'Top 3 venditori per fatturato 2014 con il loro reparto.',                    src:'ERP + HR' },
              { id:'Q15', q:'Per ogni venditore, qual è il margine commerciale 2014?',                    src:'ERP + PIM' },
              { id:'Q16', q:'Qual è il fatturato medio per cliente B2B vs B2C?',                         src:'ERP + CRM' },
              { id:'Q17', q:'Per ogni territorio, fatturato vs quota assegnata al venditore.',            src:'ERP' },
              { id:'Q18', q:'Qual è la categoria prodotti con il margine % più alto?',                    src:'ERP + PIM' },
              { id:'Q19', q:'Quanti ordini hanno applicato uno sconto da offerta speciale?',              src:'ERP' },
              { id:'Q20', q:'Quanti clienti unici abbiamo, considerando i duplicati?',                   src:'CRM' },
            ]},
            { label: '🔴 Livello 4 — Ambiguità & governance', questions: [
              { id:'Q21', q:'Qual è il "fatturato" del 2014?',                                           src:'ERP — ambiguo' },
              { id:'Q22', q:'Mostrami il dipendente "Mary".',                                            src:'HR + CRM — ambiguo' },
              { id:'Q23', q:'Da quale fonte arriva il dato del fatturato cliente XYZ, e quando è stato aggiornato?', src:'Metadata' },
              { id:'Q24', q:'Cliente "Adventure Works Cycles" — ha più di un account?',                  src:'CRM — dedup' },
              { id:'Q25', q:'Calcola il fatturato annualizzato del top venditore italiano.',              src:'Dato non disponibile' },
            ]},
          ].map(group => (
            <div key={group.label} className="mb-5">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">{group.label}</p>
              <div className="space-y-1.5">
                {group.questions.map(q => (
                  <div key={q.id} className="flex items-start gap-3 bg-white border border-slate-200 rounded-lg px-3 py-2 hover:border-slate-300 transition-colors">
                    <span className="font-mono text-[10px] font-bold text-slate-400 shrink-0 mt-0.5 w-7">{q.id}</span>
                    <span className="text-sm text-slate-700 flex-1">{q.q}</span>
                    <span className="text-[10px] text-slate-400 shrink-0 mt-0.5">{q.src}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

      </div>
    </div>
  )
}
