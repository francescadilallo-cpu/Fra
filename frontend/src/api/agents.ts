import axios from 'axios'
import { getAuthToken, handle401 } from './client'
import type { CustomAgentDef, AgentTemplate, AgentTrigger, CustomFinding } from '../data/customAgents'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

const http = axios.create({ baseURL: BASE_URL, timeout: 15_000 })

http.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) { config.headers = config.headers ?? {}; config.headers.Authorization = `Bearer ${token}` }
  return config
})

http.interceptors.response.use(
  r => r,
  (error: unknown) => {
    const e = error as { response?: { status?: number } }
    handle401(e.response?.status)
    return Promise.reject(error)
  },
)

// ── camelCase ↔ snake_case adapters ─────────────────────────────────────────

function toBackend(agent: CustomAgentDef): Record<string, unknown> {
  return {
    id: agent.id,
    sector_id: agent.sectorId,
    name: agent.name,
    description: agent.description ?? '',
    template: agent.template ?? 'monitor',
    entities: agent.entities ?? [],
    findings: agent.findings ?? [],
    actions: agent.actions ?? [],
    trigger: agent.trigger ?? { kind: 'manual' },
    created_at: agent.createdAt,
    last_run_at: agent.lastRunAt ?? null,
  }
}

function fromBackend(d: Record<string, unknown>): CustomAgentDef {
  return {
    id: d.id as string,
    sectorId: d.sector_id as string,
    name: d.name as string,
    description: (d.description as string) ?? '',
    template: (d.template as AgentTemplate) ?? 'monitor',
    entities: (d.entities as string[]) ?? [],
    findings: (d.findings as CustomFinding[]) ?? [],
    actions: (d.actions as string[]) ?? [],
    createdAt: d.created_at as string,
    trigger: (d.trigger as AgentTrigger) ?? { kind: 'manual' },
    lastRunAt: (d.last_run_at as string | undefined) ?? undefined,
  }
}

// ── Executive action types ───────────────────────────────────────────────────

export interface AgentActionResyncResult {
  nodes_patched: number
  cache_keys_invalidated: number
  duration_ms: number
  errors: string[]
  completed_at: string
}

export interface AgentAction {
  action_id: string
  status: string
  command: string
  requested_by: string
  requested_role: string
  validation_checks: string[]
  manager_note: string | null
  created_at: string
  updated_at: string
  proposed_action: Record<string, unknown>
  resync_result: AgentActionResyncResult | null
}

// ── Executive API ─────────────────────────────────────────────────────────────

export const executeAgentCommand = (command: string): Promise<AgentAction> =>
  http.post<AgentAction>('/api/agent/execute', { command }).then(r => r.data)

export const approveAgentAction = (
  actionId: string,
  approve: boolean,
  managerNote?: string,
): Promise<AgentAction> =>
  http.post<AgentAction>(`/api/agent/approve/${encodeURIComponent(actionId)}`, {
    approve,
    manager_note: managerNote ?? null,
  }).then(r => r.data)

export const listAgentActions = (statusFilter?: string): Promise<AgentAction[]> =>
  http.get<AgentAction[]>('/api/agent/list', {
    params: statusFilter ? { status: statusFilter } : undefined,
  }).then(r => r.data)

// ── Custom agent API functions ────────────────────────────────────────────────

export const listAgents = (sectorId: string): Promise<CustomAgentDef[]> =>
  http.get<Record<string, unknown>[]>('/api/agents/custom', { params: { sector_id: sectorId } })
    .then(r => r.data.map(fromBackend))

export const createAgent = (agent: CustomAgentDef): Promise<CustomAgentDef> =>
  http.post<Record<string, unknown>>('/api/agents/custom', toBackend(agent))
    .then(r => fromBackend(r.data))

export const updateAgent = (id: string, agent: CustomAgentDef): Promise<CustomAgentDef> =>
  http.put<Record<string, unknown>>(`/api/agents/custom/${encodeURIComponent(id)}`, toBackend(agent))
    .then(r => fromBackend(r.data))

export const deleteAgentRemote = (id: string): Promise<void> =>
  http.delete(`/api/agents/custom/${encodeURIComponent(id)}`).then(() => undefined)

// ── Server-side agent runs ────────────────────────────────────────────────────
// Scheduled live agents execute in the backend (real read-only checks on the
// unified data), even with the browser closed. These call/read those runs.

export interface AgentServerRun {
  id: string
  agent_id: string
  sector_id: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'completed' | 'failed'
  triggered_by: string
  findings: CustomFinding[]
  stats: { row_counts?: Record<string, number> }
}

export const runAgentServer = (id: string): Promise<AgentServerRun> =>
  http.post<AgentServerRun>(`/api/agents/custom/${encodeURIComponent(id)}/run`)
    .then(r => r.data)

export const listAgentServerRuns = (id: string, limit = 20): Promise<AgentServerRun[]> =>
  http.get<AgentServerRun[]>(`/api/agents/custom/${encodeURIComponent(id)}/runs`, {
    params: { limit },
  }).then(r => r.data)

// ── External agent integration ─────────────────────────────────────────────────

export interface WebhookLogEntry {
  ts: string
  caller: string
  question: string
}

export interface AgentToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export const getWebhookLog = (): Promise<WebhookLogEntry[]> =>
  http.get<WebhookLogEntry[]>('/api/webhooks/recent').then(r => r.data)

export const getAgentTools = (): Promise<AgentToolDef[]> =>
  http.get<AgentToolDef[]>('/api/agents/tools').then(r => r.data)

// ── Multi-agent workflow orchestration ────────────────────────────────────────

export interface WorkflowStepResult {
  step_id: string
  label: string
  query: string
  depends_on: string[]
  status: 'queued' | 'running' | 'completed' | 'error'
  result: string | null
  error: string | null
  sql_used: string | null
  sources_touched: string[]
  latency_ms: number | null
}

export interface WorkflowRun {
  run_id: string
  name: string
  status: 'queued' | 'running' | 'completed' | 'error'
  started_at: string
  completed_at: string | null
  steps: Record<string, WorkflowStepResult>
}

export interface WorkflowRunSummary {
  run_id: string
  name: string
  status: 'queued' | 'running' | 'completed' | 'error'
  started_at: string
  completed_at: string | null
  step_count: number
  steps_done: number
  steps_error: number
}

export interface WorkflowStepInput {
  step_id: string
  label: string
  query: string
  depends_on: string[]
}

export const startWorkflowRun = (
  name: string,
  steps: WorkflowStepInput[],
): Promise<{ run_id: string; status: string; step_count: number }> =>
  http.post('/api/agent/workflow/run', { name, steps }).then(r => r.data)

export const getWorkflowRun = (runId: string): Promise<WorkflowRun> =>
  http.get<WorkflowRun>(`/api/agent/workflow/${encodeURIComponent(runId)}`).then(r => r.data)

export const listWorkflowRuns = (): Promise<WorkflowRunSummary[]> =>
  http.get<WorkflowRunSummary[]>('/api/agent/workflow/list').then(r => r.data)
