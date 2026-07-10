import { useState, useEffect } from 'react'
import type { SectorId } from './sectors'
import { listAgents, createAgent, updateAgent, deleteAgentRemote } from '../api/agents'
import { modeScopedSector } from '../lib/demoMode'

export type AgentTemplate = 'monitor' | 'alert' | 'reconciler' | 'validator' | 'enricher'

export type ScheduleInterval = '5min' | 'hourly' | 'daily' | 'weekly'
export type EventTriggerKind = 'new-entity' | 'pipeline-complete' | 'critical-finding'

export type AgentTrigger =
  | { kind: 'manual' }
  | { kind: 'schedule'; interval: ScheduleInterval }
  | { kind: 'event'; on: EventTriggerKind }

export interface CustomFinding {
  severity: 'info' | 'warning' | 'critical'
  text: string
}

export interface CustomAgentDef {
  id: string
  sectorId: string
  name: string
  description: string
  template: AgentTemplate
  entities: string[]
  findings: CustomFinding[]
  actions: string[]
  createdAt: string
  trigger?: AgentTrigger
  lastRunAt?: string
}

export function getTrigger(agent: CustomAgentDef): AgentTrigger {
  return agent.trigger ?? { kind: 'manual' }
}

const KEY = (sectorId: string) => `custom-agents-${modeScopedSector(sectorId)}`
const EVENT = 'custom-agents-changed'

export function loadCustomAgents(sectorId: string): CustomAgentDef[] {
  try {
    const raw = localStorage.getItem(KEY(sectorId))
    return raw ? (JSON.parse(raw) as CustomAgentDef[]) : []
  } catch { return [] }
}

export function saveCustomAgents(sectorId: string, agents: CustomAgentDef[]) {
  localStorage.setItem(KEY(sectorId), JSON.stringify(agents))
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { sectorId } }))
}

export function addCustomAgent(sectorId: string, agent: CustomAgentDef) {
  const existing = loadCustomAgents(sectorId)
  saveCustomAgents(sectorId, [...existing, agent])
}

export function removeCustomAgent(sectorId: string, agentId: string) {
  const existing = loadCustomAgents(sectorId)
  saveCustomAgents(sectorId, existing.filter(a => a.id !== agentId))
}

export function updateCustomAgent(sectorId: string, agentId: string, patch: Partial<CustomAgentDef>) {
  const existing = loadCustomAgents(sectorId)
  saveCustomAgents(sectorId, existing.map(a => a.id === agentId ? { ...a, ...patch } : a))
}

export function useCustomAgents(sectorId: SectorId): CustomAgentDef[] {
  const [agents, setAgents] = useState<CustomAgentDef[]>(() => loadCustomAgents(sectorId))

  useEffect(() => {
    setAgents(loadCustomAgents(sectorId))
    const refresh = () => setAgents(loadCustomAgents(sectorId))
    window.addEventListener(EVENT, refresh)
    const onStorage = (e: StorageEvent) => { if (e.key === KEY(sectorId)) refresh() }
    window.addEventListener('storage', onStorage)

    // Sync from backend. Unknown remote agents are added; for agents we
    // already have, the backend wins on run outcome (findings/lastRunAt):
    // scheduled live agents execute server-side, so the server holds the
    // real results — the browser copy is just a cache of the definition.
    listAgents(modeScopedSector(sectorId))
      .then(remote => {
        const local = loadCustomAgents(sectorId)
        const remoteById = new Map(remote.map(a => [a.id, a]))
        const localIds = new Set(local.map(a => a.id))
        const merged = local.map(a => {
          const r = remoteById.get(a.id)
          if (!r) return a
          const serverIsNewer =
            (r.lastRunAt ?? '') > (a.lastRunAt ?? '') && r.findings.length > 0
          return serverIsNewer ? { ...a, findings: r.findings, lastRunAt: r.lastRunAt } : a
        })
        for (const r of remote) {
          if (!localIds.has(r.id)) merged.push(r)
        }
        saveCustomAgents(sectorId, merged)
      })
      .catch(() => { /* backend offline — use localStorage */ })

    return () => {
      window.removeEventListener(EVENT, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [sectorId])

  return agents
}

// ── Backend-aware write helpers ───────────────────────────────────────────────
// These keep localStorage and backend in sync. Backend failure is silent
// (localStorage is always updated first so the UI is never blocked).

export async function addCustomAgentPersisted(sectorId: string, agent: CustomAgentDef): Promise<void> {
  addCustomAgent(sectorId, agent)
  // Use mode-scoped sector for backend isolation (localStorage KEY already applies modeScopedSector)
  const backendAgent = { ...agent, sectorId: modeScopedSector(agent.sectorId || sectorId) }
  try { await createAgent(backendAgent) } catch { /* offline — localStorage is the source of truth */ }
}

export async function removeCustomAgentPersisted(sectorId: string, agentId: string): Promise<void> {
  removeCustomAgent(sectorId, agentId)
  try { await deleteAgentRemote(agentId) } catch { /* offline */ }
}

export async function updateCustomAgentPersisted(
  sectorId: string,
  agentId: string,
  patch: Partial<CustomAgentDef>,
): Promise<void> {
  updateCustomAgent(sectorId, agentId, patch)
  const updated = loadCustomAgents(sectorId).find(a => a.id === agentId)
  if (updated) { try { await updateAgent(agentId, updated) } catch { /* offline */ } }
}

