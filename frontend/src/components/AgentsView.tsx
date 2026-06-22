import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Play, Zap, Bot, Workflow as WorkflowIcon,
  TrendingUp, ShieldCheck, Package, Users, BarChart3,
  Activity, RefreshCw, Eye, FileText, Heart, CreditCard, CheckCircle2,
  Bell, Sparkles, Plus, Trash2, Clock, Download, Loader2,
  Globe, Copy, Link2, ChevronDown, ChevronRight,
} from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { SECTORS } from '../data/sectors'
import type { SectorId } from '../data/sectors'
import { saveAgentRun } from '../data/agentStore'
import { IS_DEMO_MODE } from '../lib/demoMode'
import { getAuthToken } from '../api/client'
import { executeAgentCommand, approveAgentAction, listAgentActions, getWebhookLog, startWorkflowRun, getWorkflowRun, listWorkflowRuns } from '../api/agents'
import type { AgentAction, WebhookLogEntry, WorkflowRun, WorkflowRunSummary, WorkflowStepInput } from '../api/agents'
import { getLiveConfig, backendErrorMessage, type LiveConfig } from '../api/semantic'
import { loadExtension } from '../data/ontologyExtensions'
import { useCustomAgents, addCustomAgentPersisted, removeCustomAgentPersisted, updateCustomAgentPersisted, getTrigger, type CustomAgentDef, type AgentTemplate, type AgentTrigger, type ScheduleInterval, type EventTriggerKind } from '../data/customAgents'
import { WORKFLOWS, WorkflowCard, type WorkflowDef, type StepStatus } from './AgentWorkflows'
import AgentBuilder from './AgentBuilder'
import { showConfirm } from './ConfirmDialog'
import { toast } from './Toast'

// ── Toast system ─────────────────────────────────────────────────────────────

// ── Action results map ────────────────────────────────────────────────────────
const AW_ACTION_RESULTS: Record<string, string> = {
  'Send performance report':          'YTD report sent to Linda Mitchell, Rachel Reiter + 12 reps — ERP × HR data combined',
  'Flag underperforming reps':        '3 reps below Q4 target flagged — Alberts ($1.45M), Mensa-Bonsu ($1.83M), Ito ($559K)',
  'Rebalance territory assignments':  'Territory rebalance proposal sent to Sales Manager — Southwest quota raised +15%',
  'Remove 372 duplicate accounts':    '372 accounts with accountId < 0 removed from ClientHub — Knowledge Graph updated',
  'Re-run bridge matching':           'ERP↔CRM bridge re-run: 18,484 / 19,829 accounts matched via customer_ref ↔ accountId',
  'Export dedup report':              'Dedup report: 20,201 raw → 19,829 clean · 372 removed · 1,345 CRM-only prospects',
  'Set subtotal as default metric':   'Semantic layer updated: "revenue" → subtotal_amount ($20.1M) by default',
  'Create revenue alias in ontology': 'Aliases created: "commercial revenue" → subtotal_amount · "billed revenue" → total_due',
  'Alert analysts of ambiguity':      '4 dashboard owners notified — "fatturato" disambiguation documented in semantic layer',
  'Repair orphan product links':      '47 SalesOrderLine rows with no PIM match flagged — product_ref ↔ internal_id gap report sent',
  'Re-sync HR↔ERP salesperson map':   'matricolaDip ↔ salesPersonId bridge re-validated: 14/14 sales reps matched',
  'Publish bridge health report':     'Bridge health report published — 3 bridges validated, 99.7% match rate overall',
}

const ACTION_RESULTS: Record<string, string> = {
  ...(IS_DEMO_MODE ? AW_ACTION_RESULTS : {}),
  // Retail — Cart Recovery
  'Send email campaign':         '187 recovery emails queued — estimated delivery in 2 min',
  'Push SMS for Gold tier':      '34 SMS sent to Gold-tier customers — avg response rate 24%',
  'Flag OOS items for buyer':    '12 out-of-stock items flagged in buyer queue',
  // Retail — Stock Replenishment
  'Confirm POs with buyers':     '3 purchase orders confirmed — total value €18,400',
  'Alert store managers':        '12 store manager alerts sent via Slack',
  'Update forecast model':       'Forecast model updated with winter seasonal uplift +20%',
  // Retail — Churn Detector
  'Activate email re-engagement':'Re-engagement sequence activated for 34 customers — 7-day drip',
  'Assign VIP to account manager':'8 Gold-tier customers assigned to account managers',
  'Export list to CRM':          '34 contacts exported to Salesforce — tag: churn-risk-Q4',
  // Retail — Promo Optimizer
  'Scale PROMO-20':              'PROMO-20 expanded to all Gold customers — 1,204 recipients',
  'Pause 3 underperformers':     '3 promotions paused — PROMO-07, PROMO-12, PROMO-19',
  'Test new threshold at €50':   'A/B test created: free-shipping €50 vs €30 — 2,000 sample size',
  // Healthcare — Follow-up Scheduler
  'Confirm with clinicians':     '28 appointment requests sent to 6 clinicians',
  'Send patient SMS reminders':  '28 SMS reminders sent — opt-out rate 0%',
  'Update EMR':                  '28 appointments recorded in Epic EMR',
  // Healthcare — Drug Interaction
  'Notify pharmacists':          '2 pharmacist alerts sent — response expected within 1h',
  'Alert prescribers for 2 cases':'2 prescribers notified via secure messaging',
  'Log to EMR audit trail':      '47 prescription scans logged to Epic audit trail',
  // Healthcare — Insurance Pre-auth
  'Follow up Generali on 3 pending':'Follow-up submitted to Generali — reference #GEN-2024-891',
  'Notify patients of approvals':'12 patient notifications sent — appointments confirmed',
  'Escalate if no response by 5pm':'Escalation rule set — Generali deadline: today 17:00',
  // Healthcare — No-show Predictor
  'Confirm waitlist bookings':   '5 waitlist patients confirmed for early slots',
  'Send day-before reminders for high-risk': '8 high-risk reminder SMS scheduled for tomorrow 08:00',
  'Update scheduling policy':    'Overbooking policy proposal sent to scheduling committee',
  // Finance — KYC
  'Escalate 3 to compliance officer': '3 cases escalated to Marco Bianchi (Compliance) — priority: HIGH',
  'Send reminder batch':         '15 KYC reminders sent — email + SMS',
  'Flag expired docs to ops':    '8 expired document alerts sent to operations team',
  // Finance — Risk Scoring
  'Notify relationship managers':'19 relationship managers notified of score changes',
  'Trigger covenant review for 3 critical': 'Covenant review triggered for 3 loans — legal notified',
  'Update loan pricing':         '12 loan pricing updates queued for credit committee approval',
  // Finance — Overdue Payment
  'Legal handoff for 3 NPLs':    '3 NPL files transferred to legal — Studio Legale Ferretti',
  'Confirm soft reminders sent': '9 soft reminder SMS/emails confirmed delivered',
  'Process 2 payment plan requests': '2 payment plan proposals generated — pending borrower signature',
  // Finance — AML
  'Submit STR to UIF':           'Suspicious Transaction Report submitted to UIF — protocol #STR-2024-0847',
  'Freeze account BA-0291 pending review': 'Account BA-0291 frozen — customer notification sent per AMLD6',
  'Notify compliance officer':   'Compliance officer Marco Bianchi notified — case #AML-2024-0291',
  // Finance — SDI Monitor
  'Correct and reissue 3 invoices': '3 invoices corrected and reissued via SDI — 3/3 accepted (Delivery Receipt)',
  'Notify customers of undelivered invoices': '7 customers notified by email with instructions for receiving the electronic invoice',
  'Export SDI report': 'SDI report exported as XML — 384 invoices, 374 reconciled, 3 rejected, 7 undelivered',
}

// ── Custom agent → AgentDef conversion ───────────────────────────────────────

const TEMPLATE_ICONS: Record<AgentTemplate, typeof Bot> = {
  monitor:    Eye,
  alert:      Bell,
  reconciler: RefreshCw,
  validator:  ShieldCheck,
  enricher:   Sparkles,
}

const TEMPLATE_LOG_STEPS: Record<AgentTemplate, (entities: string[]) => string[]> = {
  monitor: (entities) => [
    ...entities.map((e, i) => `READ ${e} → ${200 + i * 140} records loaded`),
    'Computing statistical baselines and z-scores…',
    'Detecting anomalies and outliers…',
    'WRITE anomaly report → data model',
  ],
  alert: (entities) => [
    ...entities.map((e, i) => `READ ${e} → ${150 + i * 90} records loaded`),
    'Evaluating alert threshold conditions…',
    'Preparing notifications for triggered rules…',
    'WRITE alert log → data model',
  ],
  reconciler: (entities) => [
    ...entities.map((e, i) => `READ ${e} → ${280 + i * 120} records loaded`),
    'Cross-referencing keys across entity sets…',
    'Identifying mismatches and orphan records…',
    'WRITE reconciliation report → data model',
  ],
  validator: (entities) => [
    ...entities.map((e, i) => `READ ${e} → ${310 + i * 100} records loaded`),
    'Checking completeness and required fields…',
    'Validating data types and constraint rules…',
    'WRITE validation summary → data model',
  ],
  enricher: (entities) => [
    ...entities.map((e, i) => `READ ${e} → ${190 + i * 110} records loaded`),
    'Fetching external enrichment data…',
    'Augmenting records with derived attributes…',
    'WRITE enriched records → data model',
  ],
}

// ── Types ────────────────────────────────────────────────────────────────────
type AgentStatus = 'idle' | 'queued' | 'running' | 'completed' | 'error'

interface AgentMetric { label: string; value: string; delta?: string; up?: boolean }
interface AgentFinding { severity: 'info' | 'warning' | 'critical'; text: string }

interface AgentDef {
  id: string
  name: string
  description: string
  icon: typeof Bot
  accessedEntities: string[]
  durationMs: number
  logSteps: string[]
  metrics: AgentMetric[]
  findings: AgentFinding[]
  actions: string[]
}

interface AgentRunState {
  status: AgentStatus
  progress: number
  logLines: string[]
}

interface LogEntry {
  ts: string
  agentId: string
  agentName: string
  text: string
  kind: 'read' | 'process' | 'write' | 'done' | 'start'
}

function customToAgentDef(c: CustomAgentDef, rowCounts: Record<string, number> = {}): AgentDef {
  const entities = c.entities.length > 0 ? c.entities : ['Records']
  const primary = entities[0]
  const logSteps = TEMPLATE_LOG_STEPS[c.template](entities)
  // Use real row count for the primary entity when available; fall back to demo-style estimates
  const primaryCount = rowCounts[primary]
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k`.replace('.0k', 'k') : String(n)
  const n = primaryCount ?? null
  const metrics: AgentMetric[] = ({
    monitor:    () => [{ label: `${primary} analyzed`, value: n ? fmt(n) : '—' }, { label: 'Anomalies detected', value: n ? String(Math.max(1, Math.round(n * 0.006))) : '—', delta: 'needs review', up: true }, { label: 'Healthy records', value: n ? `${(100 - Math.round(n * 0.006) / n * 100).toFixed(1)}%` : '—', up: false }],
    alert:      () => [{ label: 'Records checked', value: n ? fmt(n) : '—' }, { label: 'Alerts triggered', value: n ? String(Math.max(1, Math.round(n * 0.005))) : '—', delta: 'above threshold', up: true }, { label: 'Notifications sent', value: n ? String(Math.max(1, Math.round(n * 0.005))) : '—' }],
    reconciler: () => [{ label: `${primary} records`, value: n ? fmt(n) : '—' }, { label: 'Discrepancies', value: n ? String(Math.max(1, Math.round(n * 0.019))) : '—', delta: `${n ? (Math.round(n * 0.019) / n * 100).toFixed(1) : '1.9'}% rate`, up: true }, { label: 'Match rate', value: n ? `${(100 - Math.round(n * 0.019) / n * 100).toFixed(1)}%` : '—' }],
    validator:  () => [{ label: `${primary} validated`, value: n ? fmt(n) : '—' }, { label: 'Invalid records', value: n ? String(Math.max(1, Math.round(n * 0.011))) : '—', delta: `${n ? (Math.round(n * 0.011) / n * 100).toFixed(1) : '1.1'}% fail`, up: true }, { label: 'Missing fields', value: n ? String(Math.max(1, Math.round(n * 0.006))) : '—' }],
    enricher:   () => [{ label: `${primary} processed`, value: n ? fmt(n) : '—' }, { label: 'Enriched', value: n ? fmt(Math.round(n * 0.97)) : '—', delta: '97% match', up: false }, { label: 'API calls', value: n ? fmt(Math.round(n * 0.97)) : '—' }],
  } as Record<string, () => AgentMetric[]>)[c.template]?.() ?? []
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    icon: TEMPLATE_ICONS[c.template] ?? Bot,
    accessedEntities: entities,
    durationMs: 2400 + entities.length * 350,
    logSteps,
    metrics,
    findings: c.findings,
    actions: c.actions,
  }
}

// ── Agent definitions per sector ─────────────────────────────────────────────

const AGENTS: Record<SectorId, AgentDef[]> = {
  manufacturing: [
    {
      id: 'sales-performance',
      name: 'Sales Performance Agent',
      description: 'Analyzes YTD sales across all reps using ERP × HR cross-source data, flags quota gaps and territory imbalances.',
      icon: TrendingUp,
      accessedEntities: ['Salesperson', 'Employee', 'SalesOrder', 'Territory'],
      durationMs: 3600,
      logSteps: [
        'READ erp:SalesPerson → 14 sales reps loaded (OrionSales)',
        'READ hr:dipendenti_hr → 290 employees, Italian schema',
        'JOIN via salesPersonId ↔ matricolaDip — 14/14 matched',
        'READ erp:SalesOrder → 31,465 orders, computing YTD per rep…',
        'READ erp:SalesTerritory → 10 territories, quota mapping',
        'Detecting quota gaps and outlier bonuses…',
        'WRITE performance report → semantic layer',
      ],
      metrics: [
        { label: 'Reps analyzed',        value: '14' },
        { label: 'Top: Linda Mitchell',  value: '$4.25M YTD', delta: '#1', up: true },
        { label: 'Highest bonus',        value: '$6,700 (Jae Pak)', delta: '1.0% commission', up: true },
        { label: 'Reps below Q4 quota',  value: '3', delta: 'needs review', up: false },
      ],
      findings: [
        { severity: 'info',    text: 'Linda Mitchell ($4.25M) and Rachel Reiter ($4.12M) top the leaderboard — both above $250K quota' },
        { severity: 'warning', text: 'Jae Pak has the highest bonus ($6,700) despite ranking 8th in revenue — commission model review suggested' },
        { severity: 'warning', text: 'Shu Ito ($559K) is well below peers — territory Southeast has lowest order count (1,833)' },
        { severity: 'info',    text: 'ERP↔HR bridge fully resolved: 14/14 reps matched via matricolaDip ↔ salesPersonId' },
      ],
      actions: ['Send performance report', 'Flag underperforming reps', 'Rebalance territory assignments'],
    },
    {
      id: 'crm-dedup',
      name: 'CRM Data Quality Agent',
      description: 'Detects and removes legacy duplicate accounts in ClientHub CRM (accountId < 0), then re-validates the ERP↔CRM identity bridge.',
      icon: ShieldCheck,
      accessedEntities: ['Customer', 'SalesOrder'],
      durationMs: 2800,
      logSteps: [
        'READ crm:ClientHub_accounts → 20,201 accounts loaded (SQLite)',
        'Scanning for accountId < 0 — legacy migration pattern…',
        'Found 372 duplicate accounts — marking for removal',
        'READ erp:SalesOrder → 31,465 orders, extracting customer_ref',
        'Running ERP↔CRM bridge: customer_ref ↔ accountId…',
        'Cross-referencing 19,829 clean accounts against ERP…',
        'WRITE dedup results + bridge map → semantic layer',
      ],
      metrics: [
        { label: 'Raw CRM accounts',      value: '20,201' },
        { label: 'Duplicates detected',   value: '372',    delta: 'accountId < 0', up: false },
        { label: 'Clean unique accounts', value: '19,829', delta: 'in Knowledge Graph', up: true },
        { label: 'ERP↔CRM bridge match',  value: '18,484', delta: '93.2% of clean', up: true },
      ],
      findings: [
        { severity: 'critical', text: '372 accounts with accountId < 0 confirmed as legacy migration duplicates — ready for removal' },
        { severity: 'warning',  text: '1,345 CRM accounts have no ERP order history — likely prospects never converted' },
        { severity: 'info',     text: '18,484 accounts successfully bridged to ERP via customer_ref ↔ accountId' },
        { severity: 'info',     text: 'Knowledge Graph retains 19,829 clean nodes after dedup' },
      ],
      actions: ['Remove 372 duplicate accounts', 'Re-run bridge matching', 'Export dedup report'],
    },
    {
      id: 'revenue-disambiguator',
      name: 'Revenue Disambiguation Agent',
      description: 'Detects the "fatturato" ambiguity (subtotal_amount vs total_due) and enforces the correct semantic alias at query time.',
      icon: BarChart3,
      accessedEntities: ['SalesOrder'],
      durationMs: 2200,
      logSteps: [
        'READ erp:SalesOrder → subtotalAmount, totalDue columns loaded',
        'Computing SUM(subtotalAmount) for 2014…   → $20,127,070',
        'Computing SUM(totalDue) for 2014…         → $22,410,568',
        'Delta analysis: tax + freight = $2,283,498 (11.3%)…',
        'Scanning ontology for "revenue" / "fatturato" definitions…',
        'Ambiguity confirmed — two valid interpretations exist',
        'WRITE disambiguation rule → semantic layer',
      ],
      metrics: [
        { label: 'Net revenue (subtotal)', value: '$20.1M',  delta: 'excl. tax+freight', up: false },
        { label: 'Gross revenue (total_due)', value: '$22.4M', delta: 'billed to customer', up: false },
        { label: 'Delta (tax + freight)', value: '$2.3M',   delta: '11.3% of net', up: false },
        { label: 'Ontology aliases created', value: '2',    delta: 'net + gross', up: true },
      ],
      findings: [
        { severity: 'critical', text: '"Revenue" / "fatturato" resolves to two different columns — subtotal_amount vs total_due ($2.3M gap)' },
        { severity: 'warning',  text: 'Any dashboard using "revenue" without explicit alias may show inconsistent figures' },
        { severity: 'info',     text: 'Recommendation: use subtotal_amount for commercial metrics, total_due for billing/finance' },
        { severity: 'info',     text: 'Query AI now asks for disambiguation context before returning revenue figures' },
      ],
      actions: ['Set subtotal as default metric', 'Create revenue alias in ontology', 'Alert analysts of ambiguity'],
    },
    {
      id: 'bridge-validator',
      name: 'Cross-source Bridge Validator',
      description: 'Validates all identity bridges across ERP × CRM × HR × PIM and reports match rates, orphan records, and schema mismatches.',
      icon: Activity,
      accessedEntities: ['SalesOrder', 'Customer', 'Salesperson', 'Employee', 'Product'],
      durationMs: 4100,
      logSteps: [
        'READ erp:SalesOrder → customer_ref, salesperson_ref, product_ref extracted',
        'READ crm:ClientHub → accountId → bridge 1: customer_ref ↔ accountId',
        'READ hr:dipendenti_hr → matricolaDip → bridge 2: salesperson_ref ↔ matricolaDip',
        'READ pim:product_catalog → internal_id → bridge 3: product_ref ↔ internal_id',
        'Computing match rates for all 3 bridges…',
        'Scanning for orphan records and type mismatches…',
        'WRITE bridge health report → semantic layer',
      ],
      metrics: [
        { label: 'Bridges validated',       value: '3' },
        { label: 'ERP↔CRM match rate',      value: '93.2%', delta: '18,484 / 19,829', up: true },
        { label: 'ERP↔HR match rate',       value: '100%',  delta: '14/14 reps',      up: true },
        { label: 'ERP↔PIM orphan lines',    value: '47',    delta: 'no PIM match',    up: false },
      ],
      findings: [
        { severity: 'info',    text: 'Bridge 2 (ERP↔HR): 14/14 salesperson records matched — fully healthy' },
        { severity: 'info',    text: 'Bridge 1 (ERP↔CRM): 18,484 matches — 1,345 CRM-only accounts (prospects) expected' },
        { severity: 'warning', text: 'Bridge 3 (ERP↔PIM): 47 SalesOrderLine rows reference a product_ref not found in PIM catalog' },
        { severity: 'info',    text: 'Overall Knowledge Graph integrity: 193,062 nodes · 313,193 edges · 99.7% bridge health' },
      ],
      actions: ['Repair orphan product links', 'Re-sync HR↔ERP salesperson map', 'Publish bridge health report'],
    },
  ],

  retail: [
    {
      id: 'cart-recovery',
      name: 'Cart Recovery Agent',
      description: 'Re-engages customers who abandoned carts in the last 24h with personalized messages.',
      icon: Package,
      accessedEntities: ['Cart', 'Customer', 'Product'],
      durationMs: 3100,
      logSteps: [
        'READ rtl:Cart → 1,850 carts, filtering abandoned (> 2h)…',
        'READ rtl:Customer → loyalty tier and email loaded',
        'READ rtl:Product → stock availability verified',
        'Scoring recovery probability per cart…',
        'Generating personalized re-engagement messages…',
        'WRITE campaign records → semantic layer',
      ],
      metrics: [
        { label: 'Abandoned carts', value: '312' },
        { label: 'Recovery campaigns sent', value: '187' },
        { label: 'Estimated recovery', value: '€8,240', delta: '+18% vs last week', up: true },
        { label: 'Gold-tier priority carts', value: '34' },
      ],
      findings: [
        { severity: 'info', text: '34 Gold-tier customers with carts > €150 — high priority for personal follow-up' },
        { severity: 'warning', text: '12 carts contain items now out of stock — suggest substitutes' },
        { severity: 'info', text: 'Best send time for this cohort: Tue 19:00–21:00 (based on historical open rates)' },
      ],
      actions: ['Send email campaign', 'Push SMS for Gold tier', 'Flag OOS items for buyer'],
    },
    {
      id: 'stock-replenishment',
      name: 'Stock Replenishment Agent',
      description: 'Monitors inventory levels and auto-triggers purchase orders below reorder points.',
      icon: RefreshCw,
      accessedEntities: ['Inventory', 'Product', 'Store'],
      durationMs: 2600,
      logSteps: [
        'READ rtl:Inventory → 2,840 SKU/location records loaded',
        'READ rtl:Product → reorder points fetched',
        'READ rtl:Store → store-level demand forecast applied',
        'Computing days-of-cover for each SKU…',
        'Creating purchase orders for critical SKUs…',
        'WRITE POs and alerts → semantic layer',
      ],
      metrics: [
        { label: 'SKUs monitored', value: '2,840' },
        { label: 'Below reorder point', value: '12', delta: 'action needed', up: true },
        { label: 'Purchase orders created', value: '3' },
        { label: 'Est. stockout prevented', value: '€22k revenue' },
      ],
      findings: [
        { severity: 'critical', text: '3 bestseller SKUs (SKU-771, SKU-902, SKU-1204) have < 2 days cover' },
        { severity: 'warning', text: '9 SKUs between 3-7 days cover — watch list' },
        { severity: 'info', text: 'Seasonal uplift detected for winter category — suggest +20% safety stock' },
      ],
      actions: ['Confirm POs with buyers', 'Alert store managers', 'Update forecast model'],
    },
    {
      id: 'churn-detector',
      name: 'Churn Risk Detector',
      description: 'Identifies customers showing early churn signals and activates retention sequences.',
      icon: Users,
      accessedEntities: ['Customer', 'Order', 'Cart'],
      durationMs: 3800,
      logSteps: [
        'READ rtl:Customer → 4,520 customer profiles loaded',
        'READ rtl:Order → purchase history (last 180d) fetched',
        'READ rtl:Cart → browse behavior analyzed',
        'Computing recency-frequency-monetary (RFM) scores…',
        'Running churn propensity model…',
        'WRITE churn risk scores → semantic layer',
      ],
      metrics: [
        { label: 'Customers analyzed', value: '4,520' },
        { label: 'High churn risk', value: '34', delta: '+8 vs last month', up: true },
        { label: 'Re-engagement sequences activated', value: '34' },
        { label: 'Projected retention value', value: '€67k' },
      ],
      findings: [
        { severity: 'warning', text: '34 previously active customers with 0 purchases in last 90 days' },
        { severity: 'info', text: '8 of those are Gold-tier — VIP re-engagement recommended' },
        { severity: 'info', text: 'Top churn reason (model): price sensitivity — suggest targeted discount' },
      ],
      actions: ['Activate email re-engagement', 'Assign VIP to account manager', 'Export list to CRM'],
    },
    {
      id: 'promo-optimizer',
      name: 'Promotion Optimizer',
      description: 'Runs A/B analysis on active promotions and scales top performers automatically.',
      icon: TrendingUp,
      accessedEntities: ['Promotion', 'Order', 'Customer'],
      durationMs: 2900,
      logSteps: [
        'READ rtl:Promotion → 32 active promotions loaded',
        'READ rtl:Order → conversion data last 14 days',
        'READ rtl:Customer → segment breakdown fetched',
        'Running statistical significance tests…',
        'Scaling winning promotions to broader audience…',
        'WRITE updated promo configs → semantic layer',
      ],
      metrics: [
        { label: 'Promotions analyzed', value: '32' },
        { label: 'Statistically significant winners', value: '4' },
        { label: 'Best uplift (PROMO-20)', value: '+18% CVR', delta: 'vs control', up: true },
        { label: 'Revenue uplift projected', value: '+€14,200' },
      ],
      findings: [
        { severity: 'info', text: 'PROMO-20 ("20% off winter") is top performer — expanding to all Gold customers' },
        { severity: 'warning', text: '3 promotions underperforming control — recommend pausing' },
        { severity: 'info', text: 'Free-shipping threshold at €50 shows higher CVR than €30 threshold' },
      ],
      actions: ['Scale PROMO-20', 'Pause 3 underperformers', 'Test new threshold at €50'],
    },
  ],

  healthcare: [
    {
      id: 'followup-scheduler',
      name: 'Follow-up Scheduler',
      description: 'Schedules post-discharge follow-ups and escalates urgent cases to the right clinician.',
      icon: Heart,
      accessedEntities: ['Patient', 'Encounter', 'Doctor'],
      durationMs: 3200,
      logSteps: [
        'READ hc:Patient → 1,240 patient records loaded',
        'READ hc:Encounter → recent discharges (last 7d) fetched',
        'READ hc:Doctor → availability calendars loaded',
        'Prioritizing by clinical risk score…',
        'Scheduling follow-ups, assigning to doctors…',
        'WRITE appointments → semantic layer',
      ],
      metrics: [
        { label: 'Patients reviewed', value: '1,240' },
        { label: 'Follow-ups scheduled', value: '28' },
        { label: 'Urgent escalations', value: '4', delta: 'to senior clinician', up: false },
        { label: 'Avg scheduling time saved', value: '12 min/patient' },
      ],
      findings: [
        { severity: 'critical', text: '4 post-cardiac patients without follow-up > 5 days — escalated to Dr. Ferretti' },
        { severity: 'warning', text: '8 diabetic patients missed last follow-up — rescheduled with reminder' },
        { severity: 'info', text: '16 routine follow-ups auto-scheduled within patient preferred time windows' },
      ],
      actions: ['Confirm with clinicians', 'Send patient SMS reminders', 'Update EMR'],
    },
    {
      id: 'drug-interaction',
      name: 'Drug Interaction Checker',
      description: 'Scans all new prescriptions against patient medication history for safety conflicts.',
      icon: ShieldCheck,
      accessedEntities: ['Prescription', 'Medication', 'Patient'],
      durationMs: 2400,
      logSteps: [
        'READ hc:Prescription → new prescriptions (last 24h) loaded',
        'READ hc:Medication → interaction database queried',
        'READ hc:Patient → current medication lists fetched',
        'Running drug-drug interaction analysis (DrugBank v5)…',
        'Flagging contraindications for pharmacist review…',
        'WRITE interaction alerts → semantic layer',
      ],
      metrics: [
        { label: 'Prescriptions scanned', value: '47' },
        { label: 'Critical interactions', value: '0', delta: 'all clear', up: false },
        { label: 'Mild interactions flagged', value: '2', delta: 'for review', up: false },
        { label: 'Avg scan time', value: '< 1s / Rx' },
      ],
      findings: [
        { severity: 'info', text: 'Patient P-0892: warfarin + ibuprofen — mild bleeding risk, pharmacist notified' },
        { severity: 'info', text: 'Patient P-1134: metformin dosage > weight-based limit — flagged for prescriber' },
        { severity: 'info', text: '45 prescriptions cleared with no interactions detected' },
      ],
      actions: ['Notify pharmacists', 'Alert prescribers for 2 cases', 'Log to EMR audit trail'],
    },
    {
      id: 'insurance-preauth',
      name: 'Insurance Pre-authorizer',
      description: 'Automatically submits treatment pre-authorization requests to insurers and tracks responses.',
      icon: FileText,
      accessedEntities: ['Patient', 'InsurancePlan', 'Treatment'],
      durationMs: 3600,
      logSteps: [
        'READ hc:Treatment → treatments requiring auth (last 48h) loaded',
        'READ hc:InsurancePlan → payer rules and limits fetched',
        'READ hc:Patient → insurance IDs and coverage verified',
        'Generating HL7 FHIR pre-auth request payloads…',
        'Submitting to 4 payer APIs in parallel…',
        'WRITE auth status → semantic layer',
      ],
      metrics: [
        { label: 'Pre-auth requests submitted', value: '15' },
        { label: 'Approved', value: '12', delta: '80% rate', up: true },
        { label: 'Pending', value: '3', delta: '< 48h SLA' },
        { label: 'Time saved vs manual', value: '4.5 hrs' },
      ],
      findings: [
        { severity: 'warning', text: '3 requests pending from Generali — SLA 48h expires tomorrow' },
        { severity: 'info', text: '12 treatments cleared — patients notified and appointments confirmed' },
        { severity: 'info', text: 'Average approval time: 6.2 hours (vs 2.1 days manual)' },
      ],
      actions: ['Follow up Generali on 3 pending', 'Notify patients of approvals', 'Escalate if no response by 5pm'],
    },
    {
      id: 'noshow-predictor',
      name: 'No-show Predictor',
      description: 'Predicts appointment no-shows and fills cancellations from the waitlist automatically.',
      icon: Eye,
      accessedEntities: ['Patient', 'Encounter', 'Doctor'],
      durationMs: 2700,
      logSteps: [
        'READ hc:Encounter → appointments next 7 days loaded',
        'READ hc:Patient → historical no-show rates fetched',
        'READ hc:Doctor → slot availability checked',
        'Running no-show probability model (XGBoost)…',
        'Matching waitlist patients to predicted free slots…',
        'WRITE predicted slots and waitlist offers → semantic layer',
      ],
      metrics: [
        { label: 'Appointments analyzed', value: '84' },
        { label: 'Predicted no-shows', value: '8', delta: '9.5% rate', up: false },
        { label: 'Waitlist offers sent', value: '8' },
        { label: 'Slot utilization target', value: '96%', delta: '+4%', up: true },
      ],
      findings: [
        { severity: 'info', text: '8 appointments flagged high no-show probability (> 70%) — waitlist notified' },
        { severity: 'info', text: '5 waitlist patients accepted early slot offers' },
        { severity: 'info', text: 'Monday 9-11am consistently highest no-show window — suggest overbooking policy' },
      ],
      actions: ['Confirm waitlist bookings', 'Send day-before reminders for high-risk', 'Update scheduling policy'],
    },
  ],

  finance: [
    {
      id: 'kyc-agent',
      name: 'KYC Completion Agent',
      description: 'Tracks incomplete KYC submissions and automatically follows up to unblock loan approvals.',
      icon: ShieldCheck,
      accessedEntities: ['Applicant', 'KYCRecord'],
      durationMs: 2900,
      logSteps: [
        'READ fin:Applicant → 320 applicants loaded',
        'READ fin:KYCRecord → completion status checked',
        'Filtering incomplete submissions (status ≠ verified)…',
        'Prioritizing by loan amount and days pending…',
        'Generating follow-up emails and SMS drafts…',
        'WRITE follow-up logs → semantic layer',
      ],
      metrics: [
        { label: 'Applicants monitored', value: '320' },
        { label: 'Incomplete KYC', value: '23', delta: '7.2% of total', up: false },
        { label: 'Reminders sent', value: '15' },
        { label: 'Escalated (> 5 days)', value: '8', delta: 'to compliance', up: false },
      ],
      findings: [
        { severity: 'critical', text: '3 high-value applications (> €500k) blocked on KYC > 5 days — escalated' },
        { severity: 'warning', text: '8 applicants have expired ID documents — re-submission required' },
        { severity: 'info', text: '15 sent automated reminder; 7 responded within 2h historically' },
      ],
      actions: ['Escalate 3 to compliance officer', 'Send reminder batch', 'Flag expired docs to ops'],
    },
    {
      id: 'risk-scoring',
      name: 'Risk Scoring Agent',
      description: 'Refreshes credit risk profiles using latest transaction data and external bureau feeds.',
      icon: BarChart3,
      accessedEntities: ['Applicant', 'Transaction', 'RiskProfile'],
      durationMs: 4000,
      logSteps: [
        'READ fin:Applicant → 320 applicant profiles loaded',
        'READ fin:Transaction → last 90d activity fetched',
        'READ fin:RiskProfile → current scores loaded',
        'Pulling Cerved bureau updates (batch API)…',
        'Recalculating PD/LGD using Basel III model…',
        'WRITE updated risk scores → semantic layer',
      ],
      metrics: [
        { label: 'Profiles refreshed', value: '145' },
        { label: 'Score improved', value: '62', delta: '+avg 8 pts', up: true },
        { label: 'Score degraded', value: '19', delta: '-avg 14 pts', up: false },
        { label: 'Reclassified high-risk', value: '3', delta: 'immediate review', up: false },
      ],
      findings: [
        { severity: 'critical', text: '3 applicants reclassified from B to C risk — loan conditions to be renegotiated' },
        { severity: 'warning', text: '19 profiles show deteriorating PD trend over 3 consecutive months' },
        { severity: 'info', text: '62 profiles improved — 12 now eligible for better rate tier' },
      ],
      actions: ['Notify relationship managers', 'Trigger covenant review for 3 critical', 'Update loan pricing'],
    },
    {
      id: 'payment-alert',
      name: 'Overdue Payment Agent',
      description: 'Detects overdue loan installments and initiates graduated recovery communications.',
      icon: CreditCard,
      accessedEntities: ['Loan', 'Payment', 'Applicant'],
      durationMs: 2500,
      logSteps: [
        'READ fin:Loan → 132 active loans loaded',
        'READ fin:Payment → installment due dates checked',
        'READ fin:Applicant → contact details fetched',
        'Identifying overdue installments (> 1 day past due)…',
        'Applying graduated recovery protocol (DPD buckets)…',
        'WRITE recovery actions → semantic layer',
      ],
      metrics: [
        { label: 'Loans monitored', value: '132' },
        { label: 'Overdue installments', value: '12', delta: '9.1% rate', up: false },
        { label: 'Recovery initiated', value: '€47,200' },
        { label: 'DPD 1-30 (soft reminder)', value: '9 loans' },
      ],
      findings: [
        { severity: 'critical', text: '3 loans DPD > 90 — NPL classification threshold reached, legal notified' },
        { severity: 'warning', text: '9 loans DPD 1–30 — automated soft reminder sent' },
        { severity: 'info', text: '2 borrowers requested payment plan — routed to relationship manager' },
      ],
      actions: ['Legal handoff for 3 NPLs', 'Confirm soft reminders sent', 'Process 2 payment plan requests'],
    },
    {
      id: 'aml-monitor',
      name: 'AML Transaction Monitor',
      description: 'Scans transactions for suspicious patterns using rule-based and ML models (AMLD6).',
      icon: Eye,
      accessedEntities: ['Transaction', 'Applicant', 'BankAccount'],
      durationMs: 3700,
      logSteps: [
        'READ fin:Transaction → 8,420 transactions (last 24h) loaded',
        'READ fin:Applicant → KYC risk levels fetched',
        'READ fin:BankAccount → account behavior baseline computed',
        'Running rule-based AML checks (FATF 40 recommendations)…',
        'Running ML anomaly detection model (isolation forest)…',
        'WRITE STR drafts → semantic layer + compliance queue',
      ],
      metrics: [
        { label: 'Transactions scanned', value: '8,420' },
        { label: 'Rule-based alerts', value: '6', delta: 'reviewed', up: false },
        { label: 'ML anomaly flags', value: '2', delta: 'suspicious', up: false },
        { label: 'STR filed', value: '1', delta: 'to UIF', up: false },
      ],
      findings: [
        { severity: 'critical', text: 'Account BA-0291: 3 rapid cash deposits < €10k each (structuring pattern) — STR filed' },
        { severity: 'warning', text: '1 transaction to high-risk jurisdiction (FATF grey list) — pending review' },
        { severity: 'info', text: '6 rule alerts cleared after manual review — no further action' },
      ],
      actions: ['Submit STR to UIF', 'Freeze account BA-0291 pending review', 'Notify compliance officer'],
    },
    {
      id: 'sdi-monitor',
      name: 'SDI Invoice Monitor',
      description: 'Monitors the status of electronic invoices on SDI and detects delivery and reconciliation anomalies.',
      icon: FileText,
      accessedEntities: ['FatturaElettronica', 'Applicant', 'Transaction'],
      durationMs: 2800,
      logSteps: [
        'READ fin:FatturaElettronica → 384 invoices (last 30d) loaded',
        'READ SDI API → statuses updated: delivered, rejected, undelivered',
        'READ fin:Applicant → supplier registry verified (VAT no., tax code)',
        'Detecting rejected invoices or error code 00400…',
        'Reconciling against accounting movements and receipts…',
        'WRITE anomaly report → semantic layer',
      ],
      metrics: [
        { label: 'Invoices monitored', value: '384' },
        { label: 'Rejected by SDI', value: '3', delta: 'to be corrected', up: true },
        { label: 'Undelivered', value: '7', delta: '>10 days', up: true },
        { label: 'Reconciled OK', value: '374', delta: '97.4%', up: false },
      ],
      findings: [
        { severity: 'critical', text: '3 invoices rejected by SDI (code 00400) — incorrect supplier data, missing VAT number' },
        { severity: 'warning', text: '7 invoices in "undelivered" status for over 10 days — recipient has no active PEC mailbox' },
        { severity: 'info', text: '374 invoices correctly reconciled with accounting movements' },
      ],
      actions: ['Correct and reissue 3 invoices', 'Notify customers of undelivered invoices', 'Export SDI report'],
    },
  ],
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<AgentStatus, string> = {
  idle:      'bg-slate-100 text-slate-500',
  queued:    'bg-amber-100 text-amber-700',
  running:   'bg-blue-100 text-blue-700',
  completed: 'bg-teal-100 text-teal-700',
  error:     'bg-red-100 text-red-700',
}
const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'IDLE', queued: 'QUEUED', running: 'RUNNING', completed: 'DONE', error: 'ERROR',
}
const SEVERITY_STYLES: Record<AgentFinding['severity'], string> = {
  info:     'bg-blue-50 border-blue-200 text-blue-800',
  warning:  'bg-amber-50 border-amber-200 text-amber-800',
  critical: 'bg-red-50 border-red-200 text-red-800',
}
const SEVERITY_ICONS: Record<AgentFinding['severity'], string> = {
  info: 'ℹ', warning: '⚠', critical: '🔴',
}

function nowTs() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── Action buttons (with per-button loading + done state) ────────────────────
function ActionButtons({ actions, onAction }: { actions: string[]; onAction: (label: string) => void }) {
  const [done, setDone] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<string | null>(null)

  const handleClick = (a: string) => {
    if (done.has(a) || loading) return
    setLoading(a)
    setTimeout(() => {
      setLoading(null)
      setDone(prev => new Set([...prev, a]))
      onAction(a)
    }, 600)
  }

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">Suggested actions</p>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((a) => {
          const isDone = done.has(a)
          const isLoading = loading === a
          return (
            <button
              key={a}
              onClick={() => handleClick(a)}
              disabled={!!loading || isDone}
              className={`flex items-center gap-1 text-xs rounded-lg px-2.5 py-1 transition-all border ${
                isDone
                  ? 'bg-teal-50 border-teal-300 text-teal-700 cursor-default'
                  : isLoading
                    ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-wait'
                    : 'bg-white border-slate-200 hover:border-teal-300 hover:text-teal-700 text-slate-600'
              }`}
            >
              {isDone && <CheckCircle2 className="w-3 h-3" />}
              {isLoading ? '…' : a}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Trigger badge ─────────────────────────────────────────────────────────────
function TriggerBadge({ trigger }: { trigger: AgentTrigger }) {
  if (trigger.kind === 'manual') return null
  if (trigger.kind === 'schedule') {
    const label: Record<ScheduleInterval, string> = {
      '5min': 'Every 5 min', 'hourly': 'Hourly', 'daily': 'Daily', 'weekly': 'Weekly',
    }
    return (
      <span className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded-full">
        <Clock className="w-3 h-3" />
        {label[trigger.interval]}
      </span>
    )
  }
  const label: Record<EventTriggerKind, string> = {
    'new-entity': 'On new entity', 'pipeline-complete': 'On pipeline', 'critical-finding': 'On critical finding',
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] bg-violet-50 text-violet-600 border border-violet-200 px-1.5 py-0.5 rounded-full">
      <Zap className="w-3 h-3" />
      {label[trigger.on]}
    </span>
  )
}

// ── Agent Card ────────────────────────────────────────────────────────────────
function AgentCard({
  def,
  state,
  onRun,
  expanded,
  onToggle,
  onAction,
  onDelete,
  triggerBadge,
}: {
  def: AgentDef
  state: AgentRunState
  onRun: () => void
  expanded: boolean
  onToggle: () => void
  onAction: (label: string) => void
  onDelete?: () => void
  triggerBadge?: React.ReactNode
}) {
  const Icon = def.icon
  const isRunning = state.status === 'running'
  const isDone = state.status === 'completed'

  return (
    <div className={`bg-white border rounded-xl transition-all ${
      isRunning ? 'border-blue-300 shadow-md shadow-blue-50' :
      isDone    ? 'border-teal-300' :
      'border-slate-200 hover:border-slate-300'
    }`}>
      {/* Header */}
      <div className="px-5 py-4 flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isRunning ? 'bg-blue-100' : isDone ? 'bg-teal-50' : 'bg-slate-100'
        }`}>
          <Icon className={`w-4.5 h-4.5 ${isRunning ? 'text-blue-600' : isDone ? 'text-teal-600' : 'text-slate-500'}`} style={{width:'18px',height:'18px'}} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-900">{def.name}</p>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded leading-none ${STATUS_COLORS[state.status]} ${
              isRunning ? 'animate-pulse' : ''
            }`}>
              {STATUS_LABELS[state.status]}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 leading-snug">{def.description}</p>
          {/* Accessed entities */}
          <div className="flex flex-wrap gap-1 mt-2">
            {def.accessedEntities.map(e => (
              <span key={e} className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                {e}
              </span>
            ))}
          </div>
          {triggerBadge && <div className="mt-1.5">{triggerBadge}</div>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isDone && (
            <button
              onClick={onToggle}
              className="text-xs text-slate-400 hover:text-slate-700 transition-colors px-2 py-1 rounded hover:bg-slate-50"
            >
              {expanded ? 'Hide' : 'Results'}
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="w-7 h-7 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-400 flex items-center justify-center transition-colors"
              title="Remove agent"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onRun}
            disabled={isRunning || state.status === 'queued'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              isRunning || state.status === 'queued'
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-teal-600 text-white hover:bg-teal-700'
            }`}
          >
            <Play className="w-3 h-3" />
            Run
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {(isRunning || state.status === 'queued') && (
        <div className="px-5 pb-3">
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${state.progress}%` }}
            />
          </div>
          {state.logLines.length > 0 && (
            <p className="text-[10px] text-slate-400 mt-1.5 font-mono truncate">
              {state.logLines[state.logLines.length - 1]}
            </p>
          )}
        </div>
      )}

      {/* Results (expanded) */}
      {isDone && expanded && (
        <div className="border-t border-slate-100 px-5 py-4 space-y-3">
          {/* Metrics */}
          <div className="grid grid-cols-2 gap-2">
            {def.metrics.map((m, i) => (
              <div key={i} className="bg-slate-50 rounded-lg px-3 py-2">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">{m.label}</p>
                <p className="text-sm font-bold text-slate-900 mt-0.5">{m.value}</p>
                {m.delta && (
                  <p className={`text-[10px] mt-0.5 ${m.up ? 'text-amber-600' : 'text-teal-600'}`}>{m.delta}</p>
                )}
              </div>
            ))}
          </div>
          {/* Findings */}
          <div className="space-y-1.5">
            {def.findings.map((f, i) => (
              <div key={i} className={`text-xs rounded-lg px-3 py-2 border flex items-start gap-2 ${SEVERITY_STYLES[f.severity]}`}>
                <span className="flex-shrink-0 mt-px text-sm leading-none">{SEVERITY_ICONS[f.severity]}</span>
                <span className="leading-snug">{f.text}</span>
              </div>
            ))}
          </div>
          {/* Suggested actions */}
          <ActionButtons actions={def.actions} onAction={onAction} />
        </div>
      )}
    </div>
  )
}

// ── Role detection ────────────────────────────────────────────────────────────
function getRole(): 'admin' | 'user' {
  const token = getAuthToken()
  if (!token) return 'user'
  try {
    const b64 = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/')
    if (!b64) return 'user'
    const payload = JSON.parse(atob(b64)) as Record<string, unknown>
    return payload.role === 'admin' ? 'admin' : 'user'
  } catch { return 'user' }
}

// ── Executive Actions Panel ──────────────────────────────────────────────────
function ExecutiveActionsPanel() {
  const [command, setCommand] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actions, setActions] = useState<AgentAction[]>([])
  const [approvingId, setApprovingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await listAgentActions()
      setActions([...data].reverse())
    } catch { /* backend may not be live */ }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 15_000)
    return () => clearInterval(id)
  }, [refresh])

  const handleSubmit = useCallback(async () => {
    const cmd = command.trim()
    if (!cmd || submitting) return
    setSubmitting(true)
    try {
      await executeAgentCommand(cmd)
      setCommand('')
      toast('Command submitted — awaiting approval', 'success')
      await refresh()
    } catch (e) {
      toast(backendErrorMessage(e) || 'Command rejected — check syntax or business rules', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [command, submitting, refresh])

  const handleApprove = useCallback(async (id: string, approve: boolean) => {
    setApprovingId(id)
    try {
      const result = await approveAgentAction(id, approve)
      if (approve) {
        const r = result.resync_result
        toast(
          result.status === 'SYNCED'
            ? `Approved · ${r?.nodes_patched ?? 0} records updated · ${r?.duration_ms ?? 0}ms`
            : result.status === 'SYNC_FAILED'
              ? 'Executed but re-sync failed — check audit log'
              : 'Approved and executed',
          result.status === 'SYNC_FAILED' ? 'error' : 'success',
        )
      } else {
        toast('Action rejected', 'success')
      }
      await refresh()
    } catch { toast('Approval failed', 'error') }
    finally { setApprovingId(null) }
  }, [refresh])

  const pending = actions.filter(a => a.status === 'PENDING_HUMAN_APPROVAL')
  const recent = actions.filter(a => a.status !== 'PENDING_HUMAN_APPROVAL').slice(0, 6)

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4 text-amber-500" />
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Executive Actions</h2>
        <span className="text-xs text-slate-400">· human-in-the-loop write-backs with cascade re-sync</span>
        {pending.length > 0 && (
          <span className="ml-auto text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full animate-pulse">
            {pending.length} pending approval
          </span>
        )}
      </div>

      {/* Command input */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-3">
        <p className="text-[10px] text-slate-400 mb-2 font-mono">
          E.g. "Update [entity] field to [value]" · "Mark [entity] ID as [status]" · "Assign [entity] to [user]"
        </p>
        <div className="flex gap-2">
          <input
            value={command}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
            placeholder="Enter executive command…"
            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 transition-colors"
          />
          <button
            onClick={handleSubmit}
            disabled={!command.trim() || submitting}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              !command.trim() || submitting
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-amber-500 text-white hover:bg-amber-600'
            }`}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit'}
          </button>
        </div>
      </div>

      {/* Pending approvals */}
      {pending.length > 0 && (
        <div className="space-y-2 mb-3">
          <p className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold">Awaiting approval</p>
          {pending.map(a => (
            <div key={a.action_id} className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-slate-700 leading-snug">{a.command}</p>
                <p className="text-[10px] text-slate-400 mt-1">
                  {String(a.proposed_action?.action_type ?? '')} · by {a.requested_by}
                  {a.validation_checks.length > 0 && (
                    <span className="ml-1 text-teal-600">· {a.validation_checks.length} checks passed</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => handleApprove(a.action_id, false)}
                  disabled={approvingId === a.action_id}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                >
                  Reject
                </button>
                <button
                  onClick={() => handleApprove(a.action_id, true)}
                  disabled={approvingId === a.action_id}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-40"
                >
                  {approvingId === a.action_id ? '…' : 'Approve'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent completed */}
      {recent.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Recent</p>
          {recent.map(a => {
            const isSynced = a.status === 'SYNCED'
            const isFailed = a.status === 'FAILED' || a.status === 'SYNC_FAILED'
            return (
              <div key={a.action_id} className={`border rounded-lg px-3 py-2 flex items-center gap-2 ${
                isSynced ? 'bg-teal-50 border-teal-200' :
                isFailed ? 'bg-red-50 border-red-200' :
                'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-slate-700 truncate">{a.command}</p>
                  {isSynced && a.resync_result && (
                    <p className="text-[10px] text-teal-600 mt-0.5">
                      {a.resync_result.nodes_patched} records · {a.resync_result.cache_keys_invalidated} cache keys · {a.resync_result.duration_ms}ms
                    </p>
                  )}
                  {isFailed && (
                    <p className="text-[10px] text-red-500 mt-0.5">
                      {a.resync_result?.errors?.join(', ') ?? 'Execution failed'}
                    </p>
                  )}
                </div>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded leading-none flex-shrink-0 ${
                  isSynced ? 'bg-teal-100 text-teal-700' :
                  isFailed ? 'bg-red-100 text-red-700' :
                  'bg-slate-200 text-slate-500'
                }`}>
                  {a.status}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {pending.length === 0 && recent.length === 0 && (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl px-4 py-6 text-center">
          <p className="text-xs text-slate-400">No executive actions yet. Submit a command above to start.</p>
        </div>
      )}
    </section>
  )
}

// ── Workflow builder modal ─────────────────────────────────────────────────────

interface StepDraft { id: string; label: string; query: string }

function WorkflowBuilderModal({ onClose, onSubmit }: {
  onClose: () => void
  onSubmit: (name: string, steps: StepDraft[]) => void
}) {
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<StepDraft[]>([
    { id: '1', label: '', query: '' },
    { id: '2', label: '', query: '' },
  ])

  function addStep() {
    setSteps(prev => [...prev, { id: String(Date.now()), label: '', query: '' }])
  }
  function removeStep(id: string) {
    setSteps(prev => prev.filter(s => s.id !== id))
  }
  function updateStep(id: string, field: 'label' | 'query', value: string) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s))
  }

  const valid = name.trim().length > 0 && steps.length > 0 && steps.every(s => s.query.trim())

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <WorkflowIcon className="w-4 h-4 text-teal-600" />
            Create Workflow
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <Plus className="w-4 h-4 rotate-45" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Workflow name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Daily Data Quality Check"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:border-teal-500 outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-700">Steps (sequential)</label>
              {steps.length < 10 && (
                <button onClick={addStep} className="text-xs text-teal-600 hover:text-teal-800 font-medium flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add step
                </button>
              )}
            </div>
            <div className="space-y-3">
              {steps.map((step, i) => (
                <div key={step.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Step {i + 1}</span>
                    {steps.length > 1 && (
                      <button onClick={() => removeStep(step.id)} className="text-slate-300 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <input
                    value={step.label}
                    onChange={e => updateStep(step.id, 'label', e.target.value)}
                    placeholder={`Step ${i + 1} label (optional)`}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:border-teal-400 outline-none text-slate-700"
                  />
                  <textarea
                    value={step.query}
                    onChange={e => updateStep(step.id, 'query', e.target.value)}
                    placeholder="Natural language question, e.g. 'Show total revenue by product category'"
                    rows={2}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:border-teal-400 outline-none resize-none text-slate-700"
                  />
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-2">
              Each step receives the previous step's result as context — use this for drill-down analysis.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800 transition-colors">Cancel</button>
          <button
            onClick={() => { if (valid) { onSubmit(name.trim(), steps); onClose() } }}
            disabled={!valid}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Run Workflow
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Workflow run result card ────────────────────────────────────────────────────

function WorkflowRunCard({ run, onExpand, expanded }: {
  run: WorkflowRunSummary | WorkflowRun
  onExpand: () => void
  expanded: boolean
}) {
  const isSummary = !('steps' in run && typeof run.steps === 'object' && !Array.isArray(run.steps))
  const fullRun = !isSummary ? (run as WorkflowRun) : null
  const summary = run as WorkflowRunSummary
  const statusColor = {
    queued: 'bg-slate-100 text-slate-600',
    running: 'bg-blue-100 text-blue-700',
    completed: 'bg-teal-100 text-teal-700',
    error: 'bg-red-100 text-red-700',
  }[run.status]

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <button
        onClick={onExpand}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 truncate">{run.name}</span>
            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${statusColor} ${run.status === 'running' ? 'animate-pulse' : ''}`}>
              {run.status}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {new Date(run.started_at).toLocaleString()} ·{' '}
            {summary.steps_done ?? 0}/{summary.step_count} steps done
            {(summary.steps_error ?? 0) > 0 && (
              <span className="text-red-500 ml-1">· {summary.steps_error} errors</span>
            )}
          </p>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
      </button>

      {expanded && fullRun && (
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {Object.values(fullRun.steps).map(step => (
            <div key={step.step_id} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                {step.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" />}
                {step.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-teal-500 flex-shrink-0" />}
                {step.status === 'error' && <Activity className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                {step.status === 'queued' && <Clock className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />}
                <span className="text-xs font-semibold text-slate-700">{step.label || step.step_id}</span>
                {step.latency_ms != null && (
                  <span className="text-[10px] text-slate-400 ml-auto">{step.latency_ms.toFixed(0)}ms</span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 font-mono truncate mb-1">{step.query}</p>
              {step.result && (
                <p className="text-xs text-slate-700 bg-slate-50 rounded px-2 py-1.5 leading-relaxed line-clamp-3">
                  {step.result}
                </p>
              )}
              {step.error && (
                <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">{step.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Integration code snippets ─────────────────────────────────────────────────

function IntegrationSnippets({ snippets, copiedKey, onCopy }: {
  snippets: Record<string, string>
  copiedKey: string | null
  onCopy: (text: string, key: string) => void
}) {
  const tabs = Object.keys(snippets)
  const [activeTab, setActiveTab] = useState(tabs[0])
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="flex border-b border-slate-100 bg-slate-50">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === tab
                ? 'text-teal-700 border-b-2 border-teal-500 bg-white'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
        <button
          onClick={() => onCopy(snippets[activeTab], `snippet-${activeTab}`)}
          className="ml-auto px-3 flex items-center gap-1.5 text-xs text-slate-400 hover:text-teal-600 transition-colors"
          title="Copy snippet"
        >
          {copiedKey === `snippet-${activeTab}`
            ? <><CheckCircle2 className="w-3 h-3 text-teal-500" /> Copied</>
            : <><Copy className="w-3 h-3" /> Copy</>}
        </button>
      </div>
      <pre className="bg-slate-900 text-slate-200 text-[11px] font-mono p-4 overflow-x-auto leading-relaxed max-h-56 overflow-y-auto">
        {snippets[activeTab]}
      </pre>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AgentsView() {
  const { sectorId } = useSector()
  // Built-in agents carry curated AdventureWorks results — demo only.
  // Live workspaces build their own agents on their real ontology.
  const agents = IS_DEMO_MODE ? AGENTS[sectorId] : []
  const isAdmin = !IS_DEMO_MODE && getRole() === 'admin'

  // ── Custom agents ──────────────────────────────────────────────────────────
  const customAgentsDefs = useCustomAgents(sectorId)
  const [liveConfig, setLiveConfig] = useState<LiveConfig | null>(null)
  useEffect(() => { if (!IS_DEMO_MODE) getLiveConfig().then(setLiveConfig).catch(() => {}) }, [])

  // ── Workflow orchestration (live mode) ────────────────────────────────────
  const [showWorkflowBuilder, setShowWorkflowBuilder] = useState(false)
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunSummary[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [activeRun, setActiveRun] = useState<WorkflowRun | null>(null)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  useEffect(() => {
    if (IS_DEMO_MODE) return
    listWorkflowRuns().then(setWorkflowRuns).catch(() => {})
  }, [])

  // Poll active run until done
  useEffect(() => {
    if (!activeRunId) return
    const id = setInterval(async () => {
      try {
        const run = await getWorkflowRun(activeRunId)
        setActiveRun(run)
        const stepStatuses = Object.values(run.steps).map(s => s.status)
        const allDone = stepStatuses.every(s => s === 'completed' || s === 'error')
        if (allDone || run.status === 'completed' || run.status === 'error') {
          clearInterval(id)
          setActiveRunId(null)
          listWorkflowRuns().then(setWorkflowRuns).catch(() => {})
        }
      } catch { /* ignore */ }
    }, 1500)
    return () => clearInterval(id)
  }, [activeRunId])

  async function handleRunWorkflow(name: string, steps: StepDraft[]) {
    try {
      const stepInputs: WorkflowStepInput[] = steps.map((s, i) => ({
        step_id: s.id,
        label: s.label || `Step ${i + 1}`,
        query: s.query,
        depends_on: i > 0 ? [steps[i - 1].id] : [],
      }))
      const { run_id } = await startWorkflowRun(name, stepInputs)
      setActiveRunId(run_id)
      setExpandedRunId(run_id)
      const initial = await getWorkflowRun(run_id)
      setActiveRun(initial)
      const summary: WorkflowRunSummary = {
        run_id,
        name,
        status: 'running',
        started_at: new Date().toISOString(),
        completed_at: null,
        step_count: steps.length,
        steps_done: 0,
        steps_error: 0,
      }
      setWorkflowRuns(prev => [summary, ...prev])
    } catch (e) {
      toast(`Workflow failed to start: ${String(e)}`, 'success')
    }
  }

  // ── Webhook / integrations panel ──────────────────────────────────────────
  const [webhookLog, setWebhookLog] = useState<WebhookLogEntry[]>([])
  const [showIntegrations, setShowIntegrations] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  useEffect(() => {
    if (!showIntegrations || IS_DEMO_MODE) return
    getWebhookLog().then(setWebhookLog).catch(() => {})
    const id = setInterval(() => getWebhookLog().then(setWebhookLog).catch(() => {}), 10_000)
    return () => clearInterval(id)
  }, [showIntegrations])

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
  }
  useEffect(() => {
    if (IS_DEMO_MODE) return
    const refresh = () => getLiveConfig().then(setLiveConfig).catch(() => {})
    window.addEventListener('pipeline-run-updated', refresh)
    return () => window.removeEventListener('pipeline-run-updated', refresh)
  }, [])
  const liveRowCounts = useMemo<Record<string, number>>(() => {
    if (!liveConfig) return {}
    return Object.fromEntries(liveConfig.ontology.nodes.map(n => [n.data.label, n.data.row_count]))
  }, [liveConfig])
  const customAgents = useMemo(() => customAgentsDefs.map(c => customToAgentDef(c, liveRowCounts)), [customAgentsDefs, liveRowCounts])

  const availableEntities = useMemo(() => {
    const base = IS_DEMO_MODE
      ? SECTORS[sectorId].ontology.nodes.map(n => n.data.label)
      : (liveConfig?.ontology.nodes ?? []).map(n => n.data.label)
    try {
      const ext = loadExtension(sectorId)
      return [...new Set([...base, ...ext.nodes.map(n => n.label)])]
    } catch { return base }
  }, [sectorId, liveConfig])

  // ── Builder modal ──────────────────────────────────────────────────────────
  const [showBuilder, setShowBuilder] = useState(false)
  const [builderPrefill, setBuilderPrefill] = useState<string | undefined>()
  const [builderPrefillTemplate, setBuilderPrefillTemplate] = useState<AgentTemplate | undefined>()

  // ── Core state ─────────────────────────────────────────────────────────────
  const [states, setStates] = useState<Record<string, AgentRunState>>(() =>
    Object.fromEntries(agents.map(a => [a.id, { status: 'idle' as AgentStatus, progress: 0, logLines: [] }]))
  )
  const [log, setLog] = useState<LogEntry[]>(() => {
    if (!IS_DEMO_MODE || sectorId !== 'manufacturing') return []
    const t = (minsAgo: number) => {
      const d = new Date(Date.now() - minsAgo * 60_000)
      return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`
    }
    return [
      { ts: t(12), agentId: 'sales-performance',   agentName: 'Sales Performance',    text: 'READ erp:SalesPerson → 14 reps loaded (OrionSales)', kind: 'read' as const },
      { ts: t(12), agentId: 'sales-performance',   agentName: 'Sales Performance',    text: 'JOIN salesPersonId ↔ matricolaDip — 14/14 matched (100%)', kind: 'process' as const },
      { ts: t(11), agentId: 'sales-performance',   agentName: 'Sales Performance',    text: 'WRITE performance report → semantic layer', kind: 'write' as const },
      { ts: t(10), agentId: 'crm-dedup',            agentName: 'CRM Data Quality',     text: 'READ crm:ClientHub_accounts → 20,201 records loaded', kind: 'read' as const },
      { ts: t(10), agentId: 'crm-dedup',            agentName: 'CRM Data Quality',     text: '372 duplicates detected (accountId < 0) — ready for removal', kind: 'process' as const },
      { ts: t(9),  agentId: 'crm-dedup',            agentName: 'CRM Data Quality',     text: 'WRITE dedup results + bridge map → semantic layer', kind: 'write' as const },
      { ts: t(8),  agentId: 'revenue-disambiguator', agentName: 'Revenue Disambiguator', text: 'READ erp:SalesOrder → subtotalAmount=$20.1M, totalDue=$22.4M', kind: 'read' as const },
      { ts: t(8),  agentId: 'revenue-disambiguator', agentName: 'Revenue Disambiguator', text: '⚠ "fatturato" ambiguity flagged — $2.3M delta (11.3% tax+freight)', kind: 'process' as const },
      { ts: t(6),  agentId: 'bridge-validator',     agentName: 'Bridge Validator',     text: 'PLACED_BY: 18,484 / 19,829 matched (93.2%) — 1,345 unmatched', kind: 'process' as const },
      { ts: t(6),  agentId: 'bridge-validator',     agentName: 'Bridge Validator',     text: 'SOLD_BY: 14/14 reps matched (100%) ✓', kind: 'done' as const },
      { ts: t(6),  agentId: 'bridge-validator',     agentName: 'Bridge Validator',     text: '⚠ 47 PIM products not found in any ERP order line', kind: 'process' as const },
      { ts: t(5),  agentId: 'bridge-validator',     agentName: 'Bridge Validator',     text: 'WRITE bridge health report → semantic layer', kind: 'write' as const },
    ]
  })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const logRef = useRef<HTMLDivElement>(null)
  const statesRef = useRef(states)
  statesRef.current = states
  const customAgentsDefsRef = useRef(customAgentsDefs)
  customAgentsDefsRef.current = customAgentsDefs
  const liveRowCountsRef = useRef(liveRowCounts)
  liveRowCountsRef.current = liveRowCounts

  const addToast = useCallback((message: string) => { toast(message, 'success') }, [])

  // Init states for newly-added custom agents
  useEffect(() => {
    setStates(prev => {
      const next = { ...prev }
      customAgents.forEach(a => {
        if (!next[a.id]) next[a.id] = { status: 'idle', progress: 0, logLines: [] }
      })
      return next
    })
  }, [customAgents])

  // Listen for "Create Agent from entity" (from OntologyBuilder)
  useEffect(() => {
    const storedPrefill = sessionStorage.getItem('agent-builder-prefill')
    if (storedPrefill) {
      sessionStorage.removeItem('agent-builder-prefill')
      setBuilderPrefill(storedPrefill)
      setShowBuilder(true)
    }
    const handler = (e: Event) => {
      const entity = (e as CustomEvent<{ entity: string }>).detail?.entity
      sessionStorage.removeItem('agent-builder-prefill')
      setBuilderPrefill(entity)
      setShowBuilder(true)
    }
    window.addEventListener('create-agent-from-entity', handler)
    return () => window.removeEventListener('create-agent-from-entity', handler)
  }, [])

  const handleSaveCustomAgent = useCallback((agent: CustomAgentDef) => {
    const withSector = { ...agent, sectorId }
    addCustomAgentPersisted(sectorId, withSector)
    setShowBuilder(false)
    setBuilderPrefill(undefined)
    addToast(`Agent "${agent.name}" created — see My Agents below`)
  }, [sectorId, addToast])

  const handleAction = useCallback((label: string) => {
    const result = ACTION_RESULTS[label] ?? 'Action completed successfully'
    addToast(result)
  }, [addToast])

  // Listen for "run-all-agents" from command palette
  useEffect(() => {
    const handler = () => runAll()
    window.addEventListener('run-all-agents', handler)
    return () => window.removeEventListener('run-all-agents', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reset when sector changes
  useEffect(() => {
    const newAgents = IS_DEMO_MODE ? AGENTS[sectorId] : []
    setStates(Object.fromEntries(newAgents.map(a => [a.id, { status: 'idle' as AgentStatus, progress: 0, logLines: [] }])))
    setLog([])
    setExpanded({})
    setRunningWorkflows(new Set())
  }, [sectorId])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  const appendLog = useCallback((agentId: string, agentName: string, text: string, kind: LogEntry['kind']) => {
    setLog(prev => [...prev.slice(-200), { ts: nowTs(), agentId, agentName, text, kind }])
  }, [])

  const simulateAgent = useCallback((def: AgentDef, onComplete?: () => void) => {
    const stepCount = def.logSteps.length
    const stepInterval = def.durationMs / (stepCount + 2)
    let step = 0

    setStates(prev => ({
      ...prev,
      [def.id]: { status: 'running', progress: 5, logLines: [] },
    }))
    appendLog(def.id, def.name, 'Agent started — connecting to your data model', 'start')

    const tick = setInterval(() => {
      step++
      const progress = Math.min(95, Math.round((step / (stepCount + 1)) * 100))

      if (step <= stepCount) {
        const line = def.logSteps[step - 1]
        setStates(prev => ({
          ...prev,
          [def.id]: { ...prev[def.id], progress, logLines: [...prev[def.id].logLines, line] },
        }))
        const kind: LogEntry['kind'] = line.startsWith('READ') ? 'read' : line.startsWith('WRITE') ? 'write' : 'process'
        appendLog(def.id, def.name, line, kind)
      } else {
        // Done
        clearInterval(tick)
        setStates(prev => ({
          ...prev,
          [def.id]: { status: 'completed', progress: 100, logLines: prev[def.id].logLines },
        }))
        appendLog(def.id, def.name, def.metrics.length > 0 ? `✓ Completed — ${def.metrics[0].value} ${def.metrics[0].label}` : '✓ Completed', 'done')
        setExpanded(prev => ({ ...prev, [def.id]: true }))
        const critCount = def.findings.filter(f => f.severity === 'critical').length
        toast(
          critCount > 0
            ? `${def.name} — ${critCount} critical finding${critCount > 1 ? 's' : ''}`
            : `${def.name} completed · ${def.findings.length} finding${def.findings.length !== 1 ? 's' : ''}`,
          critCount > 0 ? 'error' : 'success',
        )
        // Persist findings to shared store for Dashboard
        saveAgentRun(sectorId, {
          agentId: def.id,
          agentName: def.name,
          ranAt: new Date().toISOString(),
          metrics: def.metrics.map(m => ({ label: m.label, value: m.value })),
          findings: def.findings,
        })
        // Dispatch critical-finding event so event-triggered custom agents can react
        if (def.findings.some(f => f.severity === 'critical')) {
          const isBuiltIn = Object.values(AGENTS).flat().some(a => a.id === def.id)
          if (isBuiltIn) {
            setTimeout(() => window.dispatchEvent(new CustomEvent('critical-finding', { detail: { agentId: def.id } })), 800)
          }
        }
        onComplete?.()
      }
    }, stepInterval)
  }, [appendLog, sectorId])

  // Background scheduler: auto-run schedule-triggered custom agents (demo-accelerated intervals)
  useEffect(() => {
    const DEMO_MS: Record<ScheduleInterval, number> = {
      '5min': 20_000, 'hourly': 45_000, 'daily': 90_000, 'weekly': 180_000,
    }
    const tick = setInterval(() => {
      const now = Date.now()
      customAgentsDefsRef.current.forEach(cd => {
        const trigger = getTrigger(cd)
        if (trigger.kind !== 'schedule') return
        const lastRun = cd.lastRunAt ? new Date(cd.lastRunAt).getTime() : 0
        if (now - lastRun < DEMO_MS[trigger.interval]) return
        if (statesRef.current[cd.id]?.status === 'running' || statesRef.current[cd.id]?.status === 'queued') return
        const def = customToAgentDef(cd, liveRowCountsRef.current)
        updateCustomAgentPersisted(sectorId, cd.id, { lastRunAt: new Date().toISOString() })
        simulateAgent(def, () => addToast(`⏰ Scheduled run: "${cd.name}"`))
      })
    }, 5_000)
    return () => clearInterval(tick)
  }, [sectorId, simulateAgent, addToast])

  // Event-driven trigger: auto-run event-triggered custom agents
  useEffect(() => {
    const fireEventAgents = (eventKind: EventTriggerKind) => {
      customAgentsDefsRef.current.forEach(cd => {
        const trigger = getTrigger(cd)
        if (trigger.kind !== 'event' || trigger.on !== eventKind) return
        if (statesRef.current[cd.id]?.status === 'running' || statesRef.current[cd.id]?.status === 'queued') return
        const def = customToAgentDef(cd, liveRowCountsRef.current)
        updateCustomAgentPersisted(sectorId, cd.id, { lastRunAt: new Date().toISOString() })
        simulateAgent(def, () => addToast(`⚡ Event triggered: "${cd.name}"`))
      })
    }
    const onEntityAdded = () => fireEventAgents('new-entity')
    const onPipelineComplete = () => fireEventAgents('pipeline-complete')
    const onCriticalFinding = () => fireEventAgents('critical-finding')
    window.addEventListener('ontology-entity-added', onEntityAdded)
    window.addEventListener('pipeline-run-updated', onPipelineComplete)
    window.addEventListener('critical-finding', onCriticalFinding)
    return () => {
      window.removeEventListener('ontology-entity-added', onEntityAdded)
      window.removeEventListener('pipeline-run-updated', onPipelineComplete)
      window.removeEventListener('critical-finding', onCriticalFinding)
    }
  }, [sectorId, simulateAgent, addToast])

  const runAgent = useCallback((def: AgentDef) => {
    simulateAgent(def)
  }, [simulateAgent])

  const [runningWorkflows, setRunningWorkflows] = useState<Set<string>>(new Set())
  // Workflows chain built-in demo agents — demo only
  const workflows = IS_DEMO_MODE ? (WORKFLOWS[sectorId] ?? []) : []

  const runWorkflow = useCallback((wf: WorkflowDef) => {
    const currentAgents = IS_DEMO_MODE ? AGENTS[sectorId] : []
    const stepDefs = wf.steps
      .map(s => ({ step: s, def: currentAgents.find(a => a.id === s.agentId) }))
      .filter((x): x is { step: typeof wf.steps[number]; def: AgentDef } => !!x.def)

    if (stepDefs.length === 0) return

    setRunningWorkflows(prev => new Set(prev).add(wf.id))

    // Mark all as queued upfront for visual feedback
    setStates(prev => {
      const next = { ...prev }
      stepDefs.forEach(({ def }) => {
        next[def.id] = { status: 'queued', progress: 0, logLines: [] }
      })
      return next
    })
    setLog([])
    appendLog('workflow', wf.name, `▶ Workflow "${wf.name}" started — ${stepDefs.length} agents`, 'start')

    const completed = new Set<string>()
    const inProgress = new Set<string>()

    const finalize = () => {
      setRunningWorkflows(prev => {
        const next = new Set(prev)
        next.delete(wf.id)
        return next
      })
      appendLog('workflow', wf.name, `✓ Workflow "${wf.name}" completed`, 'done')
      addToast(`Workflow "${wf.name}" completed · ${stepDefs.length} agents ran`)
    }

    const tryAdvance = () => {
      stepDefs.forEach(({ step, def }) => {
        if (completed.has(step.agentId) || inProgress.has(step.agentId)) return
        const ready = step.dependsOn.every(d => completed.has(d))
        if (ready) {
          inProgress.add(step.agentId)
          simulateAgent(def, () => {
            inProgress.delete(step.agentId)
            completed.add(step.agentId)
            if (completed.size === stepDefs.length) finalize()
            else tryAdvance()
          })
        }
      })
    }
    tryAdvance()
  }, [sectorId, simulateAgent, appendLog, addToast])

  const agentLookup = Object.fromEntries(
    agents.map(a => [a.id, { id: a.id, name: a.name, icon: a.icon }])
  )
  const getStatus = (agentId: string): StepStatus =>
    (states[agentId]?.status ?? 'idle') as StepStatus

  const runAll = useCallback(() => {
    const builtin = IS_DEMO_MODE ? AGENTS[sectorId] : []
    const currentAgents = [...builtin, ...customAgentsDefsRef.current.map(c => customToAgentDef(c, liveRowCounts))]
    // Mark all as queued
    setStates(prev => {
      const next = { ...prev }
      currentAgents.forEach(a => {
        if (next[a.id]?.status !== 'running') {
          next[a.id] = { status: 'queued', progress: 0, logLines: [] }
        }
      })
      return next
    })
    setLog([])
    // Stagger start
    currentAgents.forEach((def, i) => {
      setTimeout(() => simulateAgent(def), i * 600)
    })
  }, [sectorId, simulateAgent])

  const allAgents = useMemo(() => [...agents, ...customAgents], [agents, customAgents])
  const completedCount = allAgents.filter(a => states[a.id]?.status === 'completed').length
  const runningCount = allAgents.filter(a => states[a.id]?.status === 'running').length
  const completedAgents = allAgents.filter(a => states[a.id]?.status === 'completed')
  const totalFindings = completedAgents.flatMap(a => a.findings).length
  const criticalFindings = completedAgents.flatMap(a => a.findings).filter(f => f.severity === 'critical').length

  const exportFindingsCSV = useCallback(() => {
    const rows: string[] = ['Agent,Run At,Severity,Finding']
    const now = new Date().toISOString()
    completedAgents.forEach(a => {
      a.findings.forEach(f => {
        const escaped = f.text.replace(/"/g, '""')
        rows.push(`"${a.name}","${now}","${f.severity}","${escaped}"`)
      })
    })
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `agent-findings-${sectorId}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }, [completedAgents, sectorId])

  const LOG_COLORS: Record<LogEntry['kind'], string> = {
    start:   'text-blue-600',
    read:    'text-teal-600',
    process: 'text-slate-500',
    write:   'text-violet-600',
    done:    'text-green-600',
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {showWorkflowBuilder && (
        <WorkflowBuilderModal
          onClose={() => setShowWorkflowBuilder(false)}
          onSubmit={handleRunWorkflow}
        />
      )}
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 flex-shrink-0 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">Agent Orchestration</h1>
            {runningCount > 0 && (
              <span className="flex items-center gap-1 text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-1 rounded-full animate-pulse">
                <Zap className="w-3 h-3" />
                {runningCount} running
              </span>
            )}
          </div>
          <p className="text-slate-500 mt-1 text-sm">
            {allAgents.length === 0 && !IS_DEMO_MODE
              ? 'Build agents to automate monitoring, alerts, reconciliation, and data quality checks'
              : 'Operational agents active · executing in parallel'}
            {completedCount > 0 && (
              <span className="ml-2 text-slate-400">
                · {completedCount}/{allAgents.length} completed · {totalFindings} findings
                {criticalFindings > 0 && (
                  <span className="ml-1 text-red-500 font-medium">{criticalFindings} critical</span>
                )}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!IS_DEMO_MODE && (
            <button
              onClick={() => setShowWorkflowBuilder(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-violet-200 text-violet-700 hover:bg-violet-50 transition-colors"
            >
              <WorkflowIcon className="w-4 h-4" />
              Create Workflow
            </button>
          )}
          {totalFindings > 0 && (
            <button
              onClick={exportFindingsCSV}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              title="Export all findings as CSV"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          )}
          <button
            onClick={() => { setBuilderPrefill(undefined); setBuilderPrefillTemplate(undefined); setShowBuilder(true) }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-teal-200 text-teal-700 hover:bg-teal-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Agent
          </button>
          <button
            onClick={runAll}
            disabled={runningCount > 0}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              runningCount > 0
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-teal-600 text-white hover:bg-teal-700 shadow-sm'
            }`}
          >
            {runningCount > 0
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Zap className="w-4 h-4" />}
            {runningCount > 0 ? `Running ${runningCount}…` : 'Run All Agents'}
          </button>
        </div>
      </div>

      {/* Body: workflows + grid + log */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto px-8 py-6 space-y-6">
          {/* Workflows section */}
          {workflows.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <WorkflowIcon className="w-4 h-4 text-slate-500" />
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Workflows</h2>
                <span className="text-xs text-slate-400">· orchestrated agent chains</span>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {workflows.map(wf => (
                  <WorkflowCard
                    key={wf.id}
                    wf={wf}
                    agentLookup={agentLookup}
                    getStatus={getStatus}
                    onRun={() => runWorkflow(wf)}
                    running={runningWorkflows.has(wf.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Agent grid (built-in demo agents) */}
          {agents.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Bot className="w-4 h-4 text-slate-500" />
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Agents</h2>
                <span className="text-xs text-slate-400">· {agents.length} available · run individually or via workflow</span>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {agents.map(def => (
                  <AgentCard
                    key={def.id}
                    def={def}
                    state={states[def.id] ?? { status: 'idle', progress: 0, logLines: [] }}
                    onRun={() => runAgent(def)}
                    expanded={!!expanded[def.id]}
                    onToggle={() => setExpanded(prev => ({ ...prev, [def.id]: !prev[def.id] }))}
                    onAction={handleAction}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Custom agents (user-defined) */}
          {customAgents.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-violet-500" />
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">My Agents</h2>
                <span className="text-xs text-slate-400">· built on your data model · {customAgents.length} defined</span>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {customAgents.map(def => {
                  const cd = customAgentsDefs.find(c => c.id === def.id)
                  return (
                    <AgentCard
                      key={def.id}
                      def={def}
                      state={states[def.id] ?? { status: 'idle', progress: 0, logLines: [] }}
                      onRun={() => runAgent(def)}
                      expanded={!!expanded[def.id]}
                      onToggle={() => setExpanded(prev => ({ ...prev, [def.id]: !prev[def.id] }))}
                      onAction={handleAction}
                      triggerBadge={cd ? <TriggerBadge trigger={getTrigger(cd)} /> : undefined}
                      onDelete={async () => {
                        if (cd) {
                          const ok = await showConfirm(`"${cd.name}" will be permanently removed.`, { title: 'Remove agent?', dangerous: true })
                          if (ok) removeCustomAgentPersisted(sectorId, def.id)
                        }
                      }}
                    />
                  )
                })}
              </div>
            </section>
          )}

          {/* Executive Actions (admin + live mode only) */}
          {isAdmin && <ExecutiveActionsPanel />}

          {/* Empty state for custom agents */}
          {customAgents.length === 0 && (
            <section>
              {IS_DEMO_MODE ? (
                <button
                  onClick={() => { setBuilderPrefill(undefined); setBuilderPrefillTemplate(undefined); setShowBuilder(true) }}
                  className="w-full border-2 border-dashed border-slate-200 hover:border-teal-300 hover:bg-teal-50/30 rounded-xl py-8 flex flex-col items-center gap-3 transition-all group"
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-teal-100 flex items-center justify-center transition-colors">
                    <Plus className="w-5 h-5 text-slate-400 group-hover:text-teal-600" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-600 group-hover:text-teal-700">Create your first agent</p>
                    <p className="text-xs text-slate-400 mt-1">Build executive agents on your ontology entities</p>
                  </div>
                </button>
              ) : (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-4 h-4 text-violet-500" />
                    <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">My Agents</h2>
                    <span className="text-xs text-slate-400">· choose a template to get started</span>
                  </div>
                  <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 mb-3">
                    {([
                      { id: 'monitor',    Icon: Eye,        name: 'Monitor',     tagline: 'Watches for anomalies and trends in your data' },
                      { id: 'alert',      Icon: Bell,       name: 'Alert',       tagline: 'Fires when metrics breach defined thresholds' },
                      { id: 'reconciler', Icon: RefreshCw,  name: 'Reconciler',  tagline: 'Finds discrepancies across connected systems' },
                      { id: 'validator',  Icon: ShieldCheck,name: 'Validator',   tagline: 'Checks record quality, completeness, and constraints' },
                      { id: 'enricher',   Icon: Sparkles,   name: 'Enricher',    tagline: 'Augments records with external or derived data' },
                    ] as const).map(({ id, Icon, name, tagline }) => (
                      <button
                        key={id}
                        onClick={() => { setBuilderPrefillTemplate(id); setBuilderPrefill(undefined); setShowBuilder(true) }}
                        className="text-left p-4 border-2 border-dashed border-slate-200 hover:border-teal-300 hover:bg-teal-50/30 rounded-xl transition-all group"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-7 h-7 rounded-lg bg-slate-100 group-hover:bg-teal-100 flex items-center justify-center transition-colors flex-shrink-0">
                            <Icon className="w-3.5 h-3.5 text-slate-500 group-hover:text-teal-600" style={{ width: '14px', height: '14px' }} />
                          </div>
                          <p className="text-sm font-semibold text-slate-700 group-hover:text-teal-700">{name}</p>
                        </div>
                        <p className="text-xs text-slate-400 leading-snug">{tagline}</p>
                      </button>
                    ))}
                    <button
                      onClick={() => { setBuilderPrefillTemplate(undefined); setBuilderPrefill(undefined); setShowBuilder(true) }}
                      className="p-4 border-2 border-dashed border-slate-200 hover:border-teal-300 hover:bg-teal-50/30 rounded-xl transition-all group flex flex-col items-center justify-center gap-2"
                    >
                      <div className="w-7 h-7 rounded-lg bg-slate-100 group-hover:bg-teal-100 flex items-center justify-center transition-colors">
                        <Plus className="w-3.5 h-3.5 text-slate-400 group-hover:text-teal-600" />
                      </div>
                      <p className="text-xs font-medium text-slate-500 group-hover:text-teal-700">Custom</p>
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>


        {/* Agent builder modal */}
        {showBuilder && (
          <AgentBuilder
            onClose={() => { setShowBuilder(false); setBuilderPrefill(undefined); setBuilderPrefillTemplate(undefined) }}
            onSave={handleSaveCustomAgent}
            availableEntities={availableEntities}
            prefillEntity={builderPrefill}
            prefillTemplate={builderPrefillTemplate}
          />
        )}

        {/* Activity log (always visible at bottom) */}
        <div className="flex-shrink-0 border-t border-slate-200 bg-slate-950 h-44">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-teal-400" />
              <span className="text-xs font-mono text-slate-400">Agent Activity Log</span>
            </div>
            <button
              onClick={() => setLog([])}
              className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
            >
              clear
            </button>
          </div>
          <div ref={logRef} className="h-32 overflow-y-auto px-4 py-2 space-y-0.5">
            {log.length === 0 ? (
              <p className="text-xs text-slate-600 font-mono mt-2">Waiting for agents to start…</p>
            ) : (
              log.map((entry, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px] font-mono">
                  <span className="text-slate-600 flex-shrink-0">{entry.ts}</span>
                  <span className="text-slate-500 flex-shrink-0">[{entry.agentName}]</span>
                  <span className={LOG_COLORS[entry.kind]}>{entry.text}</span>
                </div>
              ))
            )}
          </div>

          {/* Workflow Runs (live mode) */}
          {!IS_DEMO_MODE && (workflowRuns.length > 0 || activeRun) && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <WorkflowIcon className="w-4 h-4 text-violet-500" />
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Workflow Runs</h2>
                {activeRunId && (
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded animate-pulse">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" /> live
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {activeRun && (
                  <WorkflowRunCard
                    run={activeRun}
                    onExpand={() => setExpandedRunId(v => v === activeRun.run_id ? null : activeRun.run_id)}
                    expanded={expandedRunId === activeRun.run_id}
                  />
                )}
                {workflowRuns
                  .filter(r => r.run_id !== activeRun?.run_id)
                  .slice(0, 5)
                  .map(r => (
                    <WorkflowRunCard
                      key={r.run_id}
                      run={r}
                      onExpand={async () => {
                        if (expandedRunId === r.run_id) { setExpandedRunId(null); return }
                        setExpandedRunId(r.run_id)
                        try {
                          const full = await getWorkflowRun(r.run_id)
                          setActiveRun(full)
                        } catch { /* ignore */ }
                      }}
                      expanded={expandedRunId === r.run_id}
                    />
                  ))}
              </div>
            </section>
          )}

          {/* External Integrations */}
          {!IS_DEMO_MODE && (() => {
            const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'
            const webhookUrl = `${BASE}/api/webhooks/query`
            const toolsUrl = `${BASE}/api/agents/tools`
            const pythonSnippet = `import requests

headers = {"Authorization": "Bearer YOUR_API_TOKEN"}

# Ask a question
res = requests.post(
    "${webhookUrl}",
    json={"question": "What is total revenue this year?"},
    headers=headers,
)
print(res.json()["answer"])

# Follow-up in the same session
res2 = requests.post(
    "${webhookUrl}",
    json={"question": "Break it down by product category",
          "session_id": res.json().get("session_id", "my-session")},
    headers=headers,
)
print(res2.json()["answer"])`
            const claudeSnippet = `import anthropic, requests

headers = {"Authorization": "Bearer YOUR_API_TOKEN"}
tools = requests.get("${toolsUrl}", headers=headers).json()

client = anthropic.Anthropic()
response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    tools=tools,
    messages=[{"role": "user",
               "content": "What were the top 5 customers by revenue?"}],
)
print(response.content)`
            const snippets: Record<string, string> = { Python: pythonSnippet, 'Claude Agent': claudeSnippet }
            return (
              <section className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                <button
                  onClick={() => setShowIntegrations(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Globe className="w-4 h-4 text-teal-600" />
                    <div className="text-left">
                      <p className="text-sm font-semibold text-slate-800">External Integrations</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Webhook endpoint · OpenAI/Anthropic tool manifest · code snippets
                      </p>
                    </div>
                  </div>
                  {showIntegrations
                    ? <ChevronDown className="w-4 h-4 text-slate-400" />
                    : <ChevronRight className="w-4 h-4 text-slate-400" />}
                </button>

                {showIntegrations && (
                  <div className="border-t border-slate-100 px-5 py-4 space-y-5">
                    {/* Endpoints */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[
                        { label: 'Webhook query endpoint', method: 'POST', url: webhookUrl, key: 'wh' },
                        { label: 'Tool manifest (OpenAI/Anthropic)', method: 'GET', url: toolsUrl, key: 'tm' },
                      ].map(ep => (
                        <div key={ep.key} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <p className="text-xs font-semibold text-slate-700">{ep.label}</p>
                            <button
                              onClick={() => copyText(ep.url, ep.key)}
                              className="text-slate-400 hover:text-teal-600 transition-colors flex-shrink-0"
                              title="Copy URL"
                            >
                              {copiedKey === ep.key
                                ? <CheckCircle2 className="w-3.5 h-3.5 text-teal-500" />
                                : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold font-mono bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded flex-shrink-0">
                              {ep.method}
                            </span>
                            <code className="text-[11px] font-mono text-slate-600 truncate">{ep.url}</code>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Code snippets */}
                    <IntegrationSnippets snippets={snippets} copiedKey={copiedKey} onCopy={copyText} />

                    {/* Recent webhook calls */}
                    {webhookLog.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
                          <Link2 className="w-3 h-3" /> Recent calls ({webhookLog.length})
                        </p>
                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                          {webhookLog.slice(0, 8).map((entry, i) => (
                            <div key={i} className="flex items-center gap-3 px-3 py-2 border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                              <span className="text-[10px] font-mono text-slate-400 flex-shrink-0 w-20">
                                {new Date(entry.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                              <span className="text-[10px] text-slate-400 flex-shrink-0 w-24 truncate">{entry.caller}</span>
                              <span className="text-xs text-slate-700 truncate">{entry.question}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {!IS_DEMO_MODE && webhookLog.length === 0 && (
                      <p className="text-xs text-slate-400 italic">No webhook calls yet — calls from external agents will appear here.</p>
                    )}
                  </div>
                )}
              </section>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
