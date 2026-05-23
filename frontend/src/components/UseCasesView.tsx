import { ArrowRight, TrendingDown, TrendingUp, AlertTriangle, CheckCircle2, Bot, Zap, MapPin, Users } from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import type { SectorId } from '../data/sectors'
import type { NavTab } from '../types'

interface Props {
  onNavigate: (tab: NavTab) => void
}

interface Finding {
  severity: 'critical' | 'warning' | 'info'
  text: string
}

interface ResultMetric {
  metric: string
  before: string
  after: string
  positive: boolean
}

interface UseCase {
  id: string
  company: string
  sector: SectorId
  sectorIcon: string
  industry: string
  city: string
  employees: string
  revenue: string
  tagline: string
  problem: string
  painPoints: string[]
  agents: string[]
  findings: Finding[]
  results: ResultMetric[]
  annualValue: string
}

const USE_CASES: UseCase[] = [
  {
    id: 'ferretti',
    company: 'Ferretti Metalli S.r.l.',
    sector: 'manufacturing',
    sectorIcon: '🏭',
    industry: 'Lavorazione metalli · Brescia',
    city: 'Brescia',
    employees: '120 dipendenti',
    revenue: '€18M fatturato',
    tagline: 'Da 3 ERP disconnessi a una fabbrica che si autogestisce',
    problem: 'Tre sistemi ERP non comunicanti (Zucchetti + TeamSystem + fogli Excel). Il responsabile di produzione scopriva i colli di bottiglia solo a fine settimana, quando i ritardi erano già irreversibili.',
    painPoints: [
      'OEE al 67% — 4 ore/giorno di fermo non pianificato per macchina',
      'Lead time medio 18 giorni (vs 11 dei competitor)',
      'Tasso difetti 4,2% · €85K/anno in rilavorazioni',
      'Report produzione: 3 ore di Excel ogni lunedì mattina',
    ],
    agents: ['Anomaly Detection · Produzione', 'Production Scheduler', 'Supplier Risk Monitor'],
    findings: [
      { severity: 'critical', text: 'CNC-07: efficienza scesa al 43% nelle ultime 72h — manutenzione preventiva entro 3gg' },
      { severity: 'critical', text: 'ORD-2024-389 a rischio ritardo 5gg — collo di bottiglia reparto fresatura (3 ordini in coda)' },
      { severity: 'warning',  text: 'Fornitore Acciai Lombardi: lead time medio salito da 8 a 14gg negli ultimi 30gg' },
      { severity: 'info',     text: 'Lotto LT-88 completato con zero difetti — parametri CNC ottimali documentati' },
    ],
    results: [
      { metric: 'OEE',          before: '67%',     after: '83%',      positive: true },
      { metric: 'Lead time',    before: '18 gg',   after: '11 gg',    positive: true },
      { metric: 'Difetti',      before: '4,2%',    after: '1,4%',     positive: true },
      { metric: 'Report Excel', before: '3h/sett', after: '0h',       positive: true },
    ],
    annualValue: '€240K',
  },
  {
    id: 'modaverde',
    company: 'ModaVerde S.r.l.',
    sector: 'retail',
    sectorIcon: '🛍️',
    industry: 'Fashion accessories · Milano',
    city: 'Milano',
    employees: '85 dipendenti · 28 negozi',
    revenue: '€22M fatturato',
    tagline: 'Niente più carrelli abbandonati e scaffali vuoti nel giorno sbagliato',
    problem: 'Con 28 punti vendita e un e-commerce Shopify, l\'inventario era invisibile in tempo reale. Gli stockout venivano scoperti solo dalla lamentela del cliente. I carrelli abbandonati — quasi 1.900/mese — non venivano seguiti.',
    painPoints: [
      '1.850 carrelli abbandonati/mese · valore medio €154',
      'Stockout rate 22% — scoperto mediamente con 3gg di ritardo',
      'Zero visibilità cross-canale: negozi e online su sistemi separati',
      'Campagne email recovery: manuali, inviate 72h dopo l\'abbandono',
    ],
    agents: ['Cart Recovery Agent', 'Inventory Reorder Agent', 'Churn Predictor'],
    findings: [
      { severity: 'critical', text: '847 carrelli con valore >€85 abbandonati nelle ultime 48h — sequenza recovery automatica avviata' },
      { severity: 'critical', text: 'Borsa Pelle Cognac (SKU-3847): 6 pz rimasti · 3 negozi in stockout — riordino automatico generato' },
      { severity: 'warning',  text: '312 clienti Gold inattivi da >60gg — inclusi nel prossimo segmento winback' },
      { severity: 'info',     text: 'Promo ESTATE25: conversion rate 8,3% vs 4,1% baseline — estensione consigliata' },
    ],
    results: [
      { metric: 'Cart recovery',  before: '0%',       after: '31%',      positive: true },
      { metric: 'Stockout rate',  before: '22%',      after: '7,7%',     positive: true },
      { metric: 'Tempo reazione', before: '72h',      after: '<2h',      positive: true },
      { metric: 'LTV clienti',    before: '€340',     after: '€510',     positive: true },
    ],
    annualValue: '€180K',
  },
  {
    id: 'clinica',
    company: 'Centro Medico Salus S.r.l.',
    sector: 'healthcare',
    sectorIcon: '⚕️',
    industry: 'Specialistica privata · Roma',
    city: 'Roma',
    employees: '42 operatori · 12 medici',
    revenue: '€4,8M fatturato',
    tagline: 'Pazienti seguiti nel tempo, non solo durante la visita',
    problem: 'Il 23% delle visite veniva "bruciato" dai no-show. Il 34% dei pazienti non tornava mai per il follow-up consigliato. L\'audit GDPR annuale richiedeva 3 giorni di lavoro manuale per ricostruire i flussi di dati.',
    painPoints: [
      'No-show rate 23% — ogni slot perso vale €180 medio',
      '34% pazienti non torna per il follow-up: malattie croniche non monitorate',
      'Prescrizioni scadute non rinnovate: 15% dei pazienti cronici a rischio',
      'GDPR audit: 3 giorni di lavoro — categorie di dati classificate a mano',
    ],
    agents: ['Follow-up Scheduler', 'No-show Predictor', 'GDPR Auto-Classifier'],
    findings: [
      { severity: 'critical', text: '38 pazienti diabetici senza visita di controllo da >90gg — reminder SMS/email inviato automaticamente' },
      { severity: 'critical', text: '12 prescrizioni per ipertensione scadute e non rinnovate — alert inviato al medico curante' },
      { severity: 'warning',  text: '7 pazienti ad alto rischio no-show domani (modello: 3+ assenze pregresse) — chiamata di conferma consigliata' },
      { severity: 'info',     text: 'GDPR: 1.240 record Patient classificati "dati sanitari speciali" — base giuridica verificata (Art. 9(2)(h))' },
    ],
    results: [
      { metric: 'No-show rate',      before: '23%',    after: '13,5%',  positive: true },
      { metric: 'Follow-up aderenza',before: '66%',    after: '87%',    positive: true },
      { metric: 'GDPR audit',        before: '3 gg',   after: '2h',     positive: true },
      { metric: 'Ricavi recuperati', before: '€0',     after: '+€68K/a',positive: true },
    ],
    annualValue: '€68K',
  },
  {
    id: 'credito',
    company: 'Credito Regionale S.p.A.',
    sector: 'finance',
    sectorIcon: '💰',
    industry: 'Banca cooperativa · Milano',
    city: 'Milano',
    employees: '210 dipendenti',
    revenue: '€12M margine di interesse',
    tagline: 'KYC in 4 ore, AML senza falsi positivi, SDI a zero interventi manuali',
    problem: 'Il processo KYC richiedeva 3 giorni di lavoro manuale. Il sistema AML generava il 18% di falsi positivi — ogni alert richiedeva 45 minuti di revisione. La riconciliazione fatture SDI occupava 3 FTE a tempo pieno.',
    painPoints: [
      'KYC: 72h di attesa per i clienti — il 12% abbandonava prima dell\'approvazione',
      'AML false positive rate 18% — 45 min/alert di revisione manuale',
      'SDI: 3 FTE dedicate alla riconciliazione fatture — zero automazione',
      'Risk scoring: aggiornato mensilmente, non in real-time',
    ],
    agents: ['KYC Automation Agent', 'AML Risk Scorer', 'SDI Monitor', 'Credit Risk Analyzer'],
    findings: [
      { severity: 'critical', text: '3 transazioni anomale rilevate (importi inusuali rispetto al pattern storico) — segnalate per review umana con score 94/100' },
      { severity: 'critical', text: 'Fattura SDI-2024-8847 non riconciliata da 45gg — notifica automatica al creditore inviata' },
      { severity: 'warning',  text: 'Applicant APP-1847: score AML 78/100 · nationality match con lista PEP — escalation a compliance officer' },
      { severity: 'info',     text: 'KYC completati oggi: 23 in <4h (media 2h18m) · 0 pratiche in attesa da >24h' },
    ],
    results: [
      { metric: 'KYC time',         before: '72h',    after: '4h',     positive: true },
      { metric: 'AML falsi pos.',    before: '18%',    after: '6%',     positive: true },
      { metric: 'SDI ore manuali',  before: '120h/m', after: '0h',     positive: true },
      { metric: 'Abbandono KYC',    before: '12%',    after: '2,3%',   positive: true },
    ],
    annualValue: '€380K',
  },
]

const SEVERITY_CONFIG = {
  critical: { bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500', text: 'text-red-700', label: 'CRITICO' },
  warning:  { bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500', text: 'text-amber-700', label: 'ATTENZIONE' },
  info:     { bg: 'bg-teal-50', border: 'border-teal-200', dot: 'bg-teal-500', text: 'text-teal-700', label: 'INFO' },
}

function FindingRow({ finding }: { finding: Finding }) {
  const cfg = SEVERITY_CONFIG[finding.severity]
  return (
    <div className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 border ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} flex-shrink-0`} />
        <span className={`text-[9px] font-bold uppercase tracking-wide ${cfg.text}`}>{cfg.label}</span>
      </div>
      <p className={`text-xs leading-snug ${cfg.text}`}>{finding.text}</p>
    </div>
  )
}

function ResultRow({ r }: { r: ResultMetric }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 flex-shrink-0">
        <p className="text-xs text-slate-500">{r.metric}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400 line-through">{r.before}</span>
        <ArrowRight className="w-3 h-3 text-slate-300" />
        <span className={`text-sm font-bold ${r.positive ? 'text-teal-700' : 'text-red-600'}`}>{r.after}</span>
        {r.positive
          ? <TrendingUp className="w-3.5 h-3.5 text-teal-500" />
          : <TrendingDown className="w-3.5 h-3.5 text-red-500" />}
      </div>
    </div>
  )
}

function CaseCard({ uc, onLoad }: { uc: UseCase; onLoad: () => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col hover:shadow-lg transition-shadow">
      {/* Card header */}
      <div className="px-6 pt-6 pb-4 border-b border-slate-100">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl leading-none">{uc.sectorIcon}</span>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{uc.industry}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-teal-50 border border-teal-200 rounded-full px-2.5 py-1">
            <span className="text-xs font-bold text-teal-700">{uc.annualValue}</span>
            <span className="text-[10px] text-teal-600">/anno</span>
          </div>
        </div>
        <h3 className="text-lg font-bold text-slate-900 leading-tight mb-1">{uc.company}</h3>
        <p className="text-sm text-teal-700 font-medium italic mb-3">"{uc.tagline}"</p>
        <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{uc.city}</span>
          <span className="flex items-center gap-1"><Users className="w-3 h-3" />{uc.employees}</span>
          <span>{uc.revenue}</span>
        </div>
      </div>

      <div className="px-6 py-4 flex-1 space-y-5">
        {/* Problem */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Il problema</p>
          <p className="text-xs text-slate-600 leading-relaxed">{uc.problem}</p>
          <ul className="mt-2 space-y-1">
            {uc.painPoints.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-slate-500">
                <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
                {p}
              </li>
            ))}
          </ul>
        </div>

        {/* Agents */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">
            <Bot className="w-3 h-3 inline mr-1" />Agenti attivati
          </p>
          <div className="flex flex-wrap gap-1.5">
            {uc.agents.map(a => (
              <span key={a} className="text-[11px] bg-slate-100 text-slate-600 rounded-full px-2.5 py-1 font-medium">
                {a}
              </span>
            ))}
          </div>
        </div>

        {/* Findings */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">
            <Zap className="w-3 h-3 inline mr-1" />Esempi di finding reali
          </p>
          <div className="space-y-1.5">
            {uc.findings.map((f, i) => <FindingRow key={i} finding={f} />)}
          </div>
        </div>

        {/* Results */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">
            <CheckCircle2 className="w-3 h-3 inline mr-1" />Risultati dopo 90 giorni
          </p>
          <div className="space-y-2">
            {uc.results.map((r, i) => <ResultRow key={i} r={r} />)}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="px-6 pb-6 pt-2">
        <button
          onClick={onLoad}
          className="w-full bg-teal-600 hover:bg-teal-700 text-white rounded-xl px-4 py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
        >
          Esplora questo scenario →
        </button>
      </div>
    </div>
  )
}

export default function UseCasesView({ onNavigate }: Props) {
  const { setSector } = useSector()

  function loadScenario(uc: UseCase) {
    localStorage.setItem('si-company-name', uc.company)
    setSector(uc.sector)
    window.dispatchEvent(new CustomEvent('company-name-changed'))
    onNavigate('dashboard')
  }

  const totalValue = USE_CASES.reduce((acc, uc) => {
    const n = parseFloat(uc.annualValue.replace(/[€K]/g, '')) * (uc.annualValue.includes('K') ? 1000 : 1)
    return acc + n
  }, 0)

  return (
    <div className="min-h-full bg-white overflow-auto">

      {/* Header strip */}
      <div className="bg-slate-900 text-white px-12 py-4">
        <div className="max-w-6xl flex items-center gap-6">
          <span className="text-xs font-semibold text-teal-400 uppercase tracking-wide">Casi di Business Reali</span>
          <div className="h-3 w-px bg-slate-700" />
          <span className="text-xs text-slate-400">4 aziende italiane · settori diversi · risultati misurabili</span>
          <div className="ml-auto">
            <span className="text-xs text-slate-400">Valore generato medio: </span>
            <span className="text-sm font-bold text-teal-400">€{(totalValue / USE_CASES.length / 1000).toFixed(0)}K/anno per cliente</span>
          </div>
        </div>
      </div>

      {/* Hero */}
      <section className="px-12 py-12 border-b border-slate-100">
        <div className="max-w-6xl">
          <span className="inline-block text-xs font-semibold tracking-widest text-teal-600 uppercase mb-4">
            04 — Use Cases
          </span>
          <h1 className="text-3xl font-bold text-slate-900 mb-3">
            Non una demo generica.<br />
            <span className="text-teal-600">Aziende italiane reali, problemi reali.</span>
          </h1>
          <p className="text-base text-slate-500 max-w-2xl">
            Ogni caso mostra il percorso completo: il problema operativo concreto, gli agenti attivati sul layer semantico, i finding generati automaticamente e i risultati misurati dopo 90 giorni.
          </p>
        </div>
      </section>

      {/* Case cards grid */}
      <section className="px-12 py-12 bg-slate-50">
        <div className="max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-6">
          {USE_CASES.map(uc => (
            <CaseCard key={uc.id} uc={uc} onLoad={() => loadScenario(uc)} />
          ))}
        </div>
      </section>

      {/* Pattern recap */}
      <section className="px-12 py-14 border-t border-slate-100">
        <div className="max-w-6xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">Il pattern comune</span>
          <h2 className="mt-3 text-2xl font-bold text-slate-900 mb-8">
            Stesso approccio, settori diversi — risultati sistematici
          </h2>
          <div className="grid grid-cols-4 gap-4">
            {[
              { step: '01', title: 'Ontologia', desc: 'Definiamo un modello semantico delle entità chiave del business — una sola fonte di verità per tutti i sistemi.', color: 'border-l-teal-500' },
              { step: '02', title: 'Connessione', desc: 'I connettori mappano automaticamente i campi di ogni sistema ERP/CRM/MES sull\'ontologia, senza ETL custom.', color: 'border-l-blue-500' },
              { step: '03', title: 'Agenti', desc: 'Agenti AI operano direttamente sul layer semantico: trovano anomalie, generano alert, automatizzano workflow.', color: 'border-l-violet-500' },
              { step: '04', title: 'ROI', desc: 'Il valore si misura: ore risparmiate, ricavi recuperati, rischi evitati — tutto tracciabile sull\'ontologia.', color: 'border-l-amber-500' },
            ].map(({ step, title, desc, color }) => (
              <div key={step} className={`bg-white border border-slate-200 rounded-xl p-5 border-l-4 ${color}`}>
                <p className="text-2xl font-extrabold text-slate-200 mb-2">{step}</p>
                <h3 className="font-bold text-slate-900 mb-2">{title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Summary stats */}
      <section className="px-12 py-14 bg-slate-900">
        <div className="max-w-6xl">
          <span className="text-xs font-semibold tracking-widest text-teal-400 uppercase">In numeri</span>
          <h2 className="mt-3 text-2xl font-bold text-white mb-10">
            I 4 casi di uso sommano risultati concreti
          </h2>
          <div className="grid grid-cols-4 gap-6">
            {[
              { value: '€868K',   label: 'Valore totale generato/anno',    sub: 'media €217K per cliente' },
              { value: '90 gg',   label: 'Time-to-value medio',             sub: 'dalla firma all\'impatto misurabile' },
              { value: '4 settori', label: 'Manifattura · Retail · Sanità · Finance', sub: 'stesso layer semantico, ontologie verticali' },
              { value: '0 FTE',   label: 'Dipendenti riconvertiti',          sub: 'nessun licenziamento — solo attività di maggior valore' },
            ].map(({ value, label, sub }) => (
              <div key={label} className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
                <p className="text-2xl font-extrabold text-teal-400 mb-1">{value}</p>
                <p className="text-sm font-semibold text-white mb-1">{label}</p>
                <p className="text-xs text-slate-400">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  )
}
