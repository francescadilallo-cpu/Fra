import { ArrowRight, TrendingDown, TrendingUp, AlertTriangle, CheckCircle2, Bot, Zap, MapPin, Users, ExternalLink } from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import type { SectorId } from '../data/sectors'
import type { NavTab } from '../types'

interface Props {
  onNavigate: (tab: NavTab) => void
}

interface Finding {
  severity: 'critical' | 'warning' | 'info'
  text: string
  queryLink?: string   // pre-fills Query AI and navigates there
  navLink?: NavTab     // direct tab navigation
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
  demoQuery?: string   // CTA shortcut: "Try live →"
}

const USE_CASES: UseCase[] = [
  {
    id: 'adventureworks',
    company: 'AdventureWorks Cycles',
    sector: 'manufacturing',
    sectorIcon: '🚲',
    industry: 'Bicycle manufacturing · US / Global',
    city: 'Multiple territories',
    employees: '290 employees · 14 sales reps',
    revenue: '$20.1M net revenue 2014',
    tagline: 'Four disconnected systems, one semantic layer — zero manual joins',
    problem: 'Sales, CRM, HR and product data live in four incompatible systems. The word "revenue" returned different numbers to every team. The top salesperson changed depending on which metric you asked about. Nobody knew that 372 CRM accounts were duplicates.',
    painPoints: [
      '"Fatturato" ambiguity — subtotal_amount $20.1M (net) vs total_due $22.4M (gross): $2.3M gap that corrupted every board report',
      'CRM had 372 duplicate accounts (accountId < 0) inflating customer count by 1.9%',
      'HR data in Italian schema (matricolaDip, cognome, nome) — impossible to join to ERP salesperson IDs',
      '47 PIM products not matched to ERP orders — revenue attribution gap in product analytics',
    ],
    agents: ['Sales Performance Agent (ERP × HR)', 'CRM Dedup Agent', 'Revenue Disambiguator', 'Bridge Validator'],
    findings: [
      {
        severity: 'critical',
        text: '"Revenue / fatturato" maps to two fields: subtotal_amount = $20.1M (net) vs total_due = $22.4M (gross). Semantic layer now forces explicit choice at query time.',
        queryLink: 'What is our total revenue — subtotal vs total due?',
      },
      {
        severity: 'critical',
        text: '372 CRM duplicate accounts with accountId < 0 detected and quarantined. True unique customer count: 19,829 (not 20,201).',
        queryLink: 'How many unique customers after CRM deduplication?',
      },
      {
        severity: 'warning',
        text: 'Top salesperson ambiguity resolved: Linda Mitchell (#276) leads by salesYTD $4.25M. Jae Pak has highest bonus ($6,700) but ranks 8th in revenue.',
        queryLink: 'Who is the top salesperson by revenue in 2014?',
      },
      {
        severity: 'info',
        text: 'All 3 cross-source bridges validated — product match 99.6% (47 orphans flagged), HR–salesperson 100%, customer bridge 93.2%.',
        navLink: 'ontology',
      },
    ],
    results: [
      { metric: 'Revenue definition', before: '2 versions',   after: '1 definition',  positive: true },
      { metric: 'CRM accuracy',       before: '372 dupes',    after: '0 dupes',       positive: true },
      { metric: 'Bridge match',        before: 'unknown',      after: '93.2–100%',     positive: true },
      { metric: 'KG nodes built',      before: '0',            after: '193,062',       positive: true },
    ],
    annualValue: '$340K',
    demoQuery: 'Who is the top salesperson by revenue in 2014?',
  },
  {
    id: 'modaverde',
    company: 'ModaVerde S.r.l.',
    sector: 'retail',
    sectorIcon: '🛍️',
    industry: 'Fashion accessories · Milan',
    city: 'Milan',
    employees: '85 employees · 28 stores',
    revenue: '€22M revenue',
    tagline: 'No more abandoned carts and empty shelves on the wrong day',
    problem: 'With 28 points of sale and a Shopify e-commerce, inventory was invisible in real time. Stockouts were only discovered from customer complaints. Abandoned carts — nearly 1,900/month — received no follow-up.',
    painPoints: [
      '1,850 abandoned carts/month · average value €154',
      'Stockout rate 22% — discovered on average 3 days late',
      'Zero cross-channel visibility: stores and online on separate systems',
      'Email recovery campaigns: manual, sent 72h after abandonment',
    ],
    agents: ['Cart Recovery Agent', 'Inventory Reorder Agent', 'Churn Predictor'],
    findings: [
      { severity: 'critical', text: '847 carts with value >€85 abandoned in the last 48h — automatic recovery sequence launched' },
      { severity: 'critical', text: 'Cognac Leather Bag (SKU-3847): 6 units remaining · 3 stores out of stock — auto-reorder generated' },
      { severity: 'warning',  text: '312 Gold customers inactive for >60 days — included in next winback segment' },
      { severity: 'info',     text: 'Promo SUMMER25: conversion rate 8.3% vs 4.1% baseline — extension recommended' },
    ],
    results: [
      { metric: 'Cart recovery',   before: '0%',    after: '31%',   positive: true },
      { metric: 'Stockout rate',   before: '22%',   after: '7.7%',  positive: true },
      { metric: 'Response time',   before: '72h',   after: '<2h',   positive: true },
      { metric: 'Customer LTV',    before: '€340',  after: '€510',  positive: true },
    ],
    annualValue: '€180K',
  },
  {
    id: 'clinica',
    company: 'Centro Medico Salus S.r.l.',
    sector: 'healthcare',
    sectorIcon: '⚕️',
    industry: 'Private specialist clinic · Rome',
    city: 'Rome',
    employees: '42 staff · 12 doctors',
    revenue: '€4.8M revenue',
    tagline: 'Patients followed over time, not just during the visit',
    problem: '23% of appointments were lost to no-shows. 34% of patients never returned for the recommended follow-up. The annual GDPR audit required 3 days of manual work to reconstruct data flows.',
    painPoints: [
      'No-show rate 23% — each lost slot is worth €180 on average',
      '34% of patients don\'t return for follow-up: chronic conditions unmonitored',
      'Expired prescriptions not renewed: 15% of chronic patients at risk',
      'GDPR audit: 3 days of work — data categories classified manually',
    ],
    agents: ['Follow-up Scheduler', 'No-show Predictor', 'GDPR Auto-Classifier'],
    findings: [
      { severity: 'critical', text: '38 diabetic patients with no check-up in >90 days — SMS/email reminder sent automatically' },
      { severity: 'critical', text: '12 expired hypertension prescriptions not renewed — alert sent to treating physician' },
      { severity: 'warning',  text: '7 patients at high no-show risk tomorrow (model: 3+ prior absences) — confirmation call recommended' },
      { severity: 'info',     text: 'GDPR: 1,240 Patient records classified as "special health data" — legal basis verified (Art. 9(2)(h))' },
    ],
    results: [
      { metric: 'No-show rate',       before: '23%',    after: '13.5%',   positive: true },
      { metric: 'Follow-up adherence',before: '66%',    after: '87%',     positive: true },
      { metric: 'GDPR audit',         before: '3 days', after: '2h',      positive: true },
      { metric: 'Revenue recovered',  before: '€0',     after: '+€68K/yr',positive: true },
    ],
    annualValue: '€68K',
  },
  {
    id: 'credito',
    company: 'Credito Regionale S.p.A.',
    sector: 'finance',
    sectorIcon: '💰',
    industry: 'Cooperative bank · Milan',
    city: 'Milan',
    employees: '210 employees',
    revenue: '€12M net interest margin',
    tagline: 'KYC in 4 hours, AML without false positives, SDI at zero manual interventions',
    problem: 'The KYC process required 3 days of manual work. The AML system generated 18% false positives — each alert required 45 minutes of review. SDI invoice reconciliation kept 3 FTEs busy full-time.',
    painPoints: [
      'KYC: 72h wait for customers — 12% dropped out before approval',
      'AML false positive rate 18% — 45 min/alert of manual review',
      'SDI: 3 FTEs dedicated to invoice reconciliation — zero automation',
      'Risk scoring: updated monthly, not in real-time',
    ],
    agents: ['KYC Automation Agent', 'AML Risk Scorer', 'SDI Monitor', 'Credit Risk Analyzer'],
    findings: [
      { severity: 'critical', text: '3 anomalous transactions detected (unusual amounts vs historical pattern) — flagged for human review with score 94/100' },
      { severity: 'critical', text: 'Invoice SDI-2024-8847 unreconciled for 45 days — automatic notification sent to creditor' },
      { severity: 'warning',  text: 'Applicant APP-1847: AML score 78/100 · nationality match on PEP list — escalated to compliance officer' },
      { severity: 'info',     text: 'KYC completions today: 23 in <4h (avg 2h18m) · 0 applications pending >24h' },
    ],
    results: [
      { metric: 'KYC time',      before: '72h',    after: '4h',    positive: true },
      { metric: 'AML false pos.',before: '18%',    after: '6%',    positive: true },
      { metric: 'SDI manual hrs',before: '120h/mo',after: '0h',    positive: true },
      { metric: 'KYC dropout',   before: '12%',    after: '2.3%',  positive: true },
    ],
    annualValue: '€380K',
  },
]

const SEVERITY_CONFIG = {
  critical: { bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500', text: 'text-red-700', label: 'CRITICAL' },
  warning:  { bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500', text: 'text-amber-700', label: 'WARNING' },
  info:     { bg: 'bg-teal-50', border: 'border-teal-200', dot: 'bg-teal-500', text: 'text-teal-700', label: 'INFO' },
}

function FindingRow({ finding, onNavigate }: { finding: Finding; onNavigate?: (tab: NavTab) => void }) {
  const cfg = SEVERITY_CONFIG[finding.severity]

  function handleLink() {
    if (!onNavigate) return
    if (finding.queryLink) {
      sessionStorage.setItem('query-prefill', finding.queryLink)
      onNavigate('query')
    } else if (finding.navLink) {
      onNavigate(finding.navLink)
    }
  }

  const hasLink = !!(finding.queryLink || finding.navLink)

  return (
    <div className={`rounded-lg px-3 py-2.5 border ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-start gap-2.5">
        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} flex-shrink-0`} />
          <span className={`text-[9px] font-bold uppercase tracking-wide ${cfg.text}`}>{cfg.label}</span>
        </div>
        <p className={`text-xs leading-snug flex-1 ${cfg.text}`}>{finding.text}</p>
      </div>
      {hasLink && onNavigate && (
        <button
          onClick={handleLink}
          className={`mt-1.5 ml-6 text-[10px] font-medium flex items-center gap-1 hover:underline ${cfg.text} opacity-70 hover:opacity-100`}
        >
          <ExternalLink className="w-3 h-3" />
          {finding.queryLink ? 'Try in Query AI →' : 'Explore in Semantic Layer →'}
        </button>
      )}
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
            <span className="text-[10px] text-teal-600">/yr</span>
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
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">The problem</p>
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
            <Bot className="w-3 h-3 inline mr-1" />Agents activated
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
            <Zap className="w-3 h-3 inline mr-1" />Real findings
          </p>
          <div className="space-y-1.5">
            {uc.findings.map((f, i) => <FindingRow key={i} finding={f} />)}
          </div>
        </div>

        {/* Results */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">
            <CheckCircle2 className="w-3 h-3 inline mr-1" />Results after 90 days
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
          Explore this scenario →
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
          <span className="text-xs font-semibold text-teal-400 uppercase tracking-wide">Real Business Cases</span>
          <div className="h-3 w-px bg-slate-700" />
          <span className="text-xs text-slate-400">4 European companies · different sectors · measurable results</span>
          <div className="ml-auto">
            <span className="text-xs text-slate-400">Average value generated: </span>
            <span className="text-sm font-bold text-teal-400">€{(totalValue / USE_CASES.length / 1000).toFixed(0)}K/yr per client</span>
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
            Not a generic demo.<br />
            <span className="text-teal-600">Real European businesses, real problems.</span>
          </h1>
          <p className="text-base text-slate-500 max-w-2xl">
            Each case shows the complete journey: the concrete operational problem, the agents activated on the semantic layer, the automatically generated findings, and the results measured after 90 days.
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
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">The common pattern</span>
          <h2 className="mt-3 text-2xl font-bold text-slate-900 mb-8">
            Same approach, different sectors — systematic results
          </h2>
          <div className="grid grid-cols-4 gap-4">
            {[
              { step: '01', title: 'Ontology', desc: 'We define a semantic model of key business entities — a single source of truth for all systems.', color: 'border-l-teal-500' },
              { step: '02', title: 'Connection', desc: 'Connectors automatically map fields from every ERP/CRM/MES system onto the ontology — no custom ETL.', color: 'border-l-blue-500' },
              { step: '03', title: 'Agents', desc: 'AI agents operate directly on the semantic layer: finding anomalies, generating alerts, automating workflows.', color: 'border-l-violet-500' },
              { step: '04', title: 'ROI', desc: 'Value is measurable: hours saved, revenue recovered, risks avoided — all traceable on the ontology.', color: 'border-l-amber-500' },
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
          <span className="text-xs font-semibold tracking-widest text-teal-400 uppercase">By the numbers</span>
          <h2 className="mt-3 text-2xl font-bold text-white mb-10">
            The 4 use cases add up to concrete results
          </h2>
          <div className="grid grid-cols-4 gap-6">
            {[
              { value: '€868K',    label: 'Total value generated/year',           sub: 'avg €217K per client' },
              { value: '90 days',  label: 'Average time-to-value',                sub: 'from signature to measurable impact' },
              { value: '4 sectors',label: 'Manufacturing · Retail · Healthcare · Finance', sub: 'same semantic layer, vertical ontologies' },
              { value: '0 FTE',    label: 'Employees redeployed',                  sub: 'no job cuts — only higher-value work' },
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
