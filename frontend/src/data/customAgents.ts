import { useState, useEffect } from 'react'
import type { SectorId } from './sectors'

export type AgentTemplate = 'monitor' | 'alert' | 'reconciler' | 'validator' | 'enricher'

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
}

const KEY = (sectorId: string) => `custom-agents-${sectorId}`
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

export function useCustomAgents(sectorId: SectorId): CustomAgentDef[] {
  const [agents, setAgents] = useState<CustomAgentDef[]>(() => loadCustomAgents(sectorId))

  useEffect(() => {
    setAgents(loadCustomAgents(sectorId))
    const refresh = () => setAgents(loadCustomAgents(sectorId))
    window.addEventListener(EVENT, refresh)
    const onStorage = (e: StorageEvent) => { if (e.key === KEY(sectorId)) refresh() }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(EVENT, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [sectorId])

  return agents
}
