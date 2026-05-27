import { Fragment } from 'react'
import { ArrowRight, Play, Clock, CheckCircle2, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { SectorId } from '../data/sectors'

// ── Types ────────────────────────────────────────────────────────────────────
export interface WorkflowStep {
  agentId: string
  dependsOn: string[]
}

export interface WorkflowDef {
  id: string
  name: string
  description: string
  trigger: string
  steps: WorkflowStep[]
}

export type StepStatus = 'idle' | 'queued' | 'running' | 'completed' | 'error'

interface AgentLookup {
  id: string
  name: string
  icon: LucideIcon
}

// ── Workflow definitions per sector ──────────────────────────────────────────
export const WORKFLOWS: Record<SectorId, WorkflowDef[]> = {
  manufacturing: [
    {
      id: 'aw-data-quality',
      name: 'AW Data Quality Pipeline',
      description: 'CRM deduplication → cross-source bridge validation. Ensures clean identity resolution before any analytics run.',
      trigger: 'Recommended · on data ingestion',
      steps: [
        { agentId: 'crm-dedup',        dependsOn: [] },
        { agentId: 'bridge-validator', dependsOn: ['crm-dedup'] },
      ],
    },
    {
      id: 'aw-sales-intelligence',
      name: 'AW Sales Intelligence',
      description: 'Revenue disambiguation → cross-source sales ranking. ERP × HR join resolves top performer by salesYTD.',
      trigger: 'Recommended · daily 07:00',
      steps: [
        { agentId: 'revenue-disambiguator', dependsOn: [] },
        { agentId: 'sales-performance',     dependsOn: ['revenue-disambiguator'] },
      ],
    },
  ],
  retail: [
    {
      id: 'rtl-commerce-day',
      name: 'Commerce Daily Loop',
      description: 'Stock health + cart recovery, then promo optimization on engagement signal.',
      trigger: 'Recommended · every 4h',
      steps: [
        { agentId: 'stock-replenishment', dependsOn: [] },
        { agentId: 'cart-recovery',       dependsOn: [] },
        { agentId: 'promo-optimizer',     dependsOn: ['cart-recovery'] },
      ],
    },
    {
      id: 'rtl-lifecycle',
      name: 'Customer Lifecycle',
      description: 'Detect cart abandonment → score churn risk on same cohort.',
      trigger: 'On cart abandon event',
      steps: [
        { agentId: 'cart-recovery',  dependsOn: [] },
        { agentId: 'churn-detector', dependsOn: ['cart-recovery'] },
      ],
    },
  ],
  healthcare: [
    {
      id: 'hc-safety-sweep',
      name: 'Clinical Safety Sweep',
      description: 'Drug interaction + no-show screening → reschedule follow-ups for high-risk.',
      trigger: 'Recommended · daily 06:00',
      steps: [
        { agentId: 'drug-interaction',     dependsOn: [] },
        { agentId: 'no-show-predictor',    dependsOn: [] },
        { agentId: 'follow-up-scheduler',  dependsOn: ['no-show-predictor'] },
      ],
    },
    {
      id: 'hc-revenue',
      name: 'Revenue Cycle',
      description: 'Pre-auth approvals → schedule confirmed encounters.',
      trigger: 'On new prescription',
      steps: [
        { agentId: 'insurance-preauth',    dependsOn: [] },
        { agentId: 'follow-up-scheduler',  dependsOn: ['insurance-preauth'] },
      ],
    },
  ],
  finance: [
    {
      id: 'fin-compliance',
      name: 'Compliance Sweep',
      description: 'KYC refresh → AML screening + risk re-scoring in parallel.',
      trigger: 'Recommended · weekly Mon 07:00',
      steps: [
        { agentId: 'kyc',          dependsOn: [] },
        { agentId: 'aml',          dependsOn: ['kyc'] },
        { agentId: 'risk-scoring', dependsOn: ['kyc'] },
      ],
    },
    {
      id: 'fin-collections',
      name: 'Collections & Risk',
      description: 'Overdue payment detection → re-score risk for affected loans.',
      trigger: 'On payment overdue 30d',
      steps: [
        { agentId: 'overdue-payment', dependsOn: [] },
        { agentId: 'risk-scoring',    dependsOn: ['overdue-payment'] },
      ],
    },
  ],
}

// ── Layout helpers ────────────────────────────────────────────────────────────
export function computeLayers(steps: WorkflowStep[]): WorkflowStep[][] {
  const layers: WorkflowStep[][] = []
  const placed = new Set<string>()
  let safety = 0
  while (placed.size < steps.length && safety++ < 100) {
    const layer = steps.filter(s =>
      !placed.has(s.agentId) && s.dependsOn.every(d => placed.has(d))
    )
    if (layer.length === 0) break
    layers.push(layer)
    layer.forEach(s => placed.add(s.agentId))
  }
  return layers
}

// ── Node + Arrow primitives ───────────────────────────────────────────────────
function StatusDot({ status }: { status: StepStatus }) {
  if (status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-teal-500 flex-shrink-0" />
  if (status === 'running')   return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" />
  if (status === 'queued')    return <Clock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
  return <span className="w-2 h-2 rounded-full bg-slate-300 flex-shrink-0" />
}

function StepNode({ agent, status }: { agent: AgentLookup; status: StepStatus }) {
  const Icon = agent.icon
  const isRunning = status === 'running'
  const isDone = status === 'completed'
  const isQueued = status === 'queued'
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border min-w-[180px] transition-all ${
      isRunning ? 'bg-blue-50 border-blue-300 shadow-sm shadow-blue-100' :
      isDone    ? 'bg-teal-50 border-teal-300' :
      isQueued  ? 'bg-slate-50 border-slate-200 border-dashed' :
      'bg-white border-slate-200'
    }`}>
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${
        isRunning ? 'text-blue-600' : isDone ? 'text-teal-600' : 'text-slate-400'
      }`} />
      <span className={`text-xs flex-1 truncate ${
        isRunning ? 'text-blue-700 font-medium' : isDone ? 'text-teal-700 font-medium' : 'text-slate-600'
      }`}>{agent.name}</span>
      <StatusDot status={status} />
    </div>
  )
}

function Arrow({ active, complete }: { active: boolean; complete: boolean }) {
  return (
    <div className="flex items-center px-1.5 flex-shrink-0" aria-hidden>
      <ArrowRight className={`w-4 h-4 transition-colors ${
        complete ? 'text-teal-500' : active ? 'text-blue-500 animate-pulse' : 'text-slate-300'
      }`} />
    </div>
  )
}

// ── DAG renderer ─────────────────────────────────────────────────────────────
interface DAGProps {
  steps: WorkflowStep[]
  agentLookup: Record<string, AgentLookup>
  getStatus: (agentId: string) => StepStatus
}

export function WorkflowDAG({ steps, agentLookup, getStatus }: DAGProps) {
  const layers = computeLayers(steps)
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
      {layers.map((layer, li) => {
        const nextLayer = layers[li + 1]
        const layerComplete = layer.every(s => getStatus(s.agentId) === 'completed')
        const nextHasActive = nextLayer?.some(s => {
          const st = getStatus(s.agentId)
          return st === 'running' || st === 'queued'
        })
        const arrowComplete = layerComplete && (!nextLayer || nextLayer.every(s => getStatus(s.agentId) === 'completed'))
        const arrowActive = layerComplete && !!nextHasActive
        return (
          <Fragment key={li}>
            <div className="flex flex-col justify-center gap-2 flex-shrink-0">
              {layer.map(step => {
                const agent = agentLookup[step.agentId]
                if (!agent) return null
                return (
                  <StepNode
                    key={step.agentId}
                    agent={agent}
                    status={getStatus(step.agentId)}
                  />
                )
              })}
            </div>
            {li < layers.length - 1 && <Arrow active={arrowActive} complete={arrowComplete} />}
          </Fragment>
        )
      })}
    </div>
  )
}

// ── Workflow card ─────────────────────────────────────────────────────────────
export interface WorkflowCardProps {
  wf: WorkflowDef
  agentLookup: Record<string, AgentLookup>
  getStatus: (agentId: string) => StepStatus
  onRun: () => void
  running: boolean
}

export function WorkflowCard({ wf, agentLookup, getStatus, onRun, running }: WorkflowCardProps) {
  const stepStatuses = wf.steps.map(s => getStatus(s.agentId))
  const completed = stepStatuses.filter(s => s === 'completed').length
  const total = wf.steps.length
  const done = completed === total && total > 0 && !running
  const inProgress = running || stepStatuses.some(s => s === 'running' || s === 'queued')

  return (
    <div className={`bg-white border rounded-xl p-4 transition-all ${
      inProgress ? 'border-blue-300 shadow-sm shadow-blue-100/50' :
      done       ? 'border-teal-300' :
      'border-slate-200 hover:border-slate-300'
    }`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-900">{wf.name}</h3>
            <span className="text-[9px] font-mono uppercase tracking-wide bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
              {wf.steps.length} steps
            </span>
            {inProgress && (
              <span className="text-[9px] font-bold uppercase tracking-wide bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded animate-pulse">
                RUNNING
              </span>
            )}
            {done && (
              <span className="text-[9px] font-bold uppercase tracking-wide bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded">
                DONE
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1 leading-snug">{wf.description}</p>
          <div className="flex items-center gap-1 mt-2 text-[10px] text-slate-400">
            <Clock className="w-3 h-3" />
            <span>{wf.trigger}</span>
            {completed > 0 && (
              <>
                <span className="text-slate-300 mx-1">·</span>
                <span className="text-slate-500 font-medium">{completed}/{total} completed</span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={onRun}
          disabled={running}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 ${
            running
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-slate-900 text-white hover:bg-slate-800'
          }`}
        >
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          Run
        </button>
      </div>

      <WorkflowDAG steps={wf.steps} agentLookup={agentLookup} getStatus={getStatus} />
    </div>
  )
}
