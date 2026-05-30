import axios from 'axios'
import { getAuthToken, clearAuthToken } from './client'
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
    if (e.response?.status === 401) { clearAuthToken(); window.dispatchEvent(new CustomEvent('logout-requested')) }
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

// ── API functions ────────────────────────────────────────────────────────────

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
