import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Play, Zap, Bot, Workflow as WorkflowIcon,
  TrendingUp, ShieldCheck, Package, Truck, Users, BarChart3,
  Activity, RefreshCw, Eye, FileText, Heart, CreditCard, CheckCircle2,
} from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import type { SectorId } from '../data/sectors'
import { saveAgentRun } from '../data/agentStore'
import { WORKFLOWS, WorkflowCard, type WorkflowDef, type StepStatus } from './AgentWorkflows'

// ── Toast system ─────────────────────────────────────────────────────────────
interface Toast { id: string; message: string }

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="flex items-start gap-3 bg-slate-900 text-white text-sm rounded-xl px-4 py-3 shadow-xl max-w-sm pointer-events-auto"
          style={{ animation: 'slideInRight 0.2s ease-out' }}
        >
          <CheckCircle2 className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
          <span className="leading-snug">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="ml-1 text-slate-500 hover:text-white flex-shrink-0">×</button>
        </div>
      ))}
    </div>
  )
}

// ── Action results map ────────────────────────────────────────────────────────
const ACTION_RESULTS: Record<string, string> = {
  // Manufacturing — Quote Review
  'Send expiry reminders':       '3 reminder emails sent — Acciaierie Lombarde, TechFab SRL, Metalwork SpA',
  'Flag for sales review':       '2 quotes added to sales review queue',
  'Update pricing rules':        'Pricing rule updated: SKU-091 margin floor raised +3%',
  // Manufacturing — Production Scheduler
  'Apply optimized schedule':    'Schedule applied to 28 work orders — ERP updated via SAP connector',
  'Notify production floor':     'Notifications sent to 6 operators via WhatsApp Business',
  'Update ERP':                  'SAP S/4HANA synchronised — 28 work orders updated',
  // Manufacturing — Supplier Monitor
  'Qualify backup supplier':     'RFQ sent to 3 alternative suppliers for component C-88',
  'Increase safety stock C-88':  'Safety stock C-88 raised to 500 units — reorder triggered',
  'Schedule supplier review':    'Supplier review scheduled with Metalfer SRL — next Tuesday 10:00',
  // Manufacturing — Delivery Alert
  'Send proactive update to customers': '2 customer notifications sent — ORD-0094, ORD-0101',
  'Escalate ORD-0094':           'ORD-0094 escalated to sales manager — priority flag set',
  'Update delivery dates in ERP':'2 delivery dates updated in SAP S/4HANA',
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

// ── Agent definitions per sector ─────────────────────────────────────────────
const AGENTS: Record<SectorId, AgentDef[]> = {
  manufacturing: [
    {
      id: 'quote-review',
      name: 'Quote Review Agent',
      description: 'Analyzes open quotes for price deviations, expiry risk, and margin anomalies.',
      icon: FileText,
      accessedEntities: ['Quote', 'Customer', 'Product'],
      durationMs: 3400,
      logSteps: [
        'READ mfg:Quote → 50 records loaded',
        'READ mfg:Customer → 20 customers cross-referenced',
        'READ mfg:Product → unit prices verified',
        'Running margin anomaly detection…',
        'Flagging quotes expiring in < 7 days…',
        'WRITE 3 anomaly flags → semantic layer',
      ],
      metrics: [
        { label: 'Quotes analyzed', value: '50' },
        { label: 'Expiring ≤ 7 days', value: '3', delta: 'urgent', up: true },
        { label: 'Below margin threshold', value: '2', delta: '-12% avg', up: true },
        { label: 'Avg quote value', value: '€36,400' },
      ],
      findings: [
        { severity: 'critical', text: 'Quote QT-0042 (€82k) expires in 2 days — no follow-up scheduled' },
        { severity: 'warning', text: '2 quotes priced 12% below standard margin (Product SKU-091, SKU-134)' },
        { severity: 'info', text: 'Customer Acciaierie Lombarde has 3 open quotes > 30 days' },
      ],
      actions: ['Send expiry reminders', 'Flag for sales review', 'Update pricing rules'],
    },
    {
      id: 'production-scheduler',
      name: 'Production Scheduler',
      description: 'Optimizes work order sequencing across machines to maximize throughput.',
      icon: Activity,
      accessedEntities: ['WorkOrder', 'Machine', 'Order'],
      durationMs: 4200,
      logSteps: [
        'READ mfg:WorkOrder → 28 active work orders loaded',
        'READ mfg:Machine → 18 machines, status check',
        'READ mfg:Order → delivery deadlines fetched',
        'Running constraint-based scheduling optimization…',
        'Calculating critical path for 6 overdue orders…',
        'WRITE optimized schedule → semantic layer',
      ],
      metrics: [
        { label: 'Work orders scheduled', value: '28' },
        { label: 'Throughput gain', value: '+8%', delta: 'vs current', up: true },
        { label: 'Machine utilization', value: '84%', delta: '+6%', up: true },
        { label: 'At-risk deliveries resolved', value: '4 / 6' },
      ],
      findings: [
        { severity: 'warning', text: 'Machine MCC-04 scheduled for maintenance on Thu — 3 WOs need reassignment' },
        { severity: 'info', text: 'Rescheduling WO-2281 saves 1.5 days on Order ORD-0094' },
        { severity: 'info', text: 'Peak load detected Wed afternoon — suggest shifting WO-2275 to Tue' },
      ],
      actions: ['Apply optimized schedule', 'Notify production floor', 'Update ERP'],
    },
    {
      id: 'supplier-monitor',
      name: 'Supplier Risk Monitor',
      description: 'Monitors supplier reliability scores and flags supply chain disruption risks.',
      icon: ShieldCheck,
      accessedEntities: ['Supplier', 'BillOfMaterial', 'Product'],
      durationMs: 2800,
      logSteps: [
        'READ mfg:Supplier → 45 suppliers loaded',
        'READ mfg:BillOfMaterial → 120 BOM entries',
        'READ mfg:Product → critical components identified',
        'Computing supplier reliability delta (last 90d)…',
        'Cross-referencing lead times vs open orders…',
        'WRITE risk scores → semantic layer',
      ],
      metrics: [
        { label: 'Suppliers monitored', value: '45' },
        { label: 'Below threshold (< 3.5★)', value: '1', delta: 'critical', up: true },
        { label: 'Avg lead time', value: '14 days', delta: '+2 vs Q3', up: true },
        { label: 'At-risk components', value: '4' },
      ],
      findings: [
        { severity: 'critical', text: 'Supplier "Metalfer SRL" rated 3.1 — sole source for component C-88 (high demand)' },
        { severity: 'warning', text: 'Lead time for 4 components increased 20% since last quarter' },
        { severity: 'info', text: '3 suppliers eligible for preferred-tier upgrade based on recent performance' },
      ],
      actions: ['Qualify backup supplier', 'Increase safety stock C-88', 'Schedule supplier review'],
    },
    {
      id: 'delivery-alert',
      name: 'Delivery Alert Agent',
      description: 'Predicts delivery delays and proactively notifies customers at risk.',
      icon: Truck,
      accessedEntities: ['Order', 'WorkOrder', 'Customer'],
      durationMs: 2200,
      logSteps: [
        'READ mfg:Order → 13 active orders fetched',
        'READ mfg:WorkOrder → production status checked',
        'READ mfg:Customer → contact info loaded',
        'Running delay probability model…',
        'Generating customer notifications for at-risk orders…',
        'WRITE alert status → semantic layer',
      ],
      metrics: [
        { label: 'Orders monitored', value: '13' },
        { label: 'At risk of delay', value: '2', delta: '15% probability', up: false },
        { label: 'On-time rate', value: '85%', delta: '-3% vs target', up: false },
        { label: 'Notifications sent', value: '2' },
      ],
      findings: [
        { severity: 'warning', text: 'Order ORD-0094 (due Fri): WO still in progress — 1 day buffer only' },
        { severity: 'warning', text: 'Order ORD-0101 depends on delayed component from Metalfer SRL' },
        { severity: 'info', text: '11 orders on track for on-time delivery' },
      ],
      actions: ['Send proactive update to customers', 'Escalate ORD-0094', 'Update delivery dates in ERP'],
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

// ── Agent Card ────────────────────────────────────────────────────────────────
function AgentCard({
  def,
  state,
  onRun,
  expanded,
  onToggle,
  onAction,
}: {
  def: AgentDef
  state: AgentRunState
  onRun: () => void
  expanded: boolean
  onToggle: () => void
  onAction: (label: string) => void
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

// ── Main component ────────────────────────────────────────────────────────────
export default function AgentsView() {
  const { sectorId } = useSector()
  const agents = AGENTS[sectorId]

  const [states, setStates] = useState<Record<string, AgentRunState>>(() =>
    Object.fromEntries(agents.map(a => [a.id, { status: 'idle' as AgentStatus, progress: 0, logLines: [] }]))
  )
  const [log, setLog] = useState<LogEntry[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [toasts, setToasts] = useState<Toast[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  const addToast = useCallback((message: string) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }, [])

  const handleAction = useCallback((label: string) => {
    const result = ACTION_RESULTS[label] ?? 'Action completed successfully'
    addToast(result)
  }, [addToast])

  // Reset when sector changes
  useEffect(() => {
    const newAgents = AGENTS[sectorId]
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
    appendLog(def.id, def.name, 'Agent started — connecting to semantic layer', 'start')

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
        appendLog(def.id, def.name, `✓ Completed — ${def.metrics[0].value} ${def.metrics[0].label}`, 'done')
        setExpanded(prev => ({ ...prev, [def.id]: true }))
        // Persist findings to shared store for Dashboard
        saveAgentRun(sectorId, {
          agentId: def.id,
          agentName: def.name,
          ranAt: new Date().toISOString(),
          metrics: def.metrics.map(m => ({ label: m.label, value: m.value })),
          findings: def.findings,
        })
        onComplete?.()
      }
    }, stepInterval)
  }, [appendLog, sectorId])

  const runAgent = useCallback((def: AgentDef) => {
    simulateAgent(def)
  }, [simulateAgent])

  const [runningWorkflows, setRunningWorkflows] = useState<Set<string>>(new Set())
  const workflows = WORKFLOWS[sectorId] ?? []

  const runWorkflow = useCallback((wf: WorkflowDef) => {
    const currentAgents = AGENTS[sectorId]
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
    const currentAgents = AGENTS[sectorId]
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

  const completedCount = agents.filter(a => states[a.id]?.status === 'completed').length
  const runningCount = agents.filter(a => states[a.id]?.status === 'running').length
  const totalFindings = agents
    .filter(a => states[a.id]?.status === 'completed')
    .flatMap(a => a.findings).length
  const criticalFindings = agents
    .filter(a => states[a.id]?.status === 'completed')
    .flatMap(a => a.findings)
    .filter(f => f.severity === 'critical').length

  const LOG_COLORS: Record<LogEntry['kind'], string> = {
    start:   'text-blue-600',
    read:    'text-teal-600',
    process: 'text-slate-500',
    write:   'text-violet-600',
    done:    'text-green-600',
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
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
            Operational agents connected to the semantic layer · executing in parallel
            {completedCount > 0 && (
              <span className="ml-2 text-slate-400">
                · {completedCount}/{agents.length} completed · {totalFindings} findings
                {criticalFindings > 0 && (
                  <span className="ml-1 text-red-500 font-medium">{criticalFindings} critical</span>
                )}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={runAll}
          disabled={runningCount > 0}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors flex-shrink-0 ${
            runningCount > 0
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-teal-600 text-white hover:bg-teal-700 shadow-sm'
          }`}
        >
          <Zap className="w-4 h-4" />
          Run All Agents
        </button>
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

          {/* Agent grid */}
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
        </div>

        <ToastContainer toasts={toasts} onDismiss={id => setToasts(prev => prev.filter(t => t.id !== id))} />

        {/* Activity log (always visible at bottom) */}
        <div className="flex-shrink-0 border-t border-slate-200 bg-slate-950 h-44">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-teal-400" />
              <span className="text-xs font-mono text-slate-400">Semantic Layer Activity Log</span>
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
        </div>
      </div>
    </div>
  )
}
