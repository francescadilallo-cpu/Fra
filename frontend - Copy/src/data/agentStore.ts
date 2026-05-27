import { useState, useEffect } from 'react'
import type { SectorId } from './sectors'

export interface StoredFinding {
  severity: 'info' | 'warning' | 'critical'
  text: string
}

export interface AgentRunSummary {
  agentId: string
  agentName: string
  ranAt: string  // ISO string
  metrics: { label: string; value: string }[]
  findings: StoredFinding[]
}

const KEY = (sectorId: string) => `agent-runs-${sectorId}`
const CHANGE_EVENT = 'agent-store-changed'

export function saveAgentRun(sectorId: string, run: AgentRunSummary) {
  try {
    const existing = loadAgentRuns(sectorId)
    // Keep last run per agent, plus history of last 20
    const filtered = existing.filter(r => r.agentId !== run.agentId)
    const updated = [run, ...filtered].slice(0, 20)
    localStorage.setItem(KEY(sectorId), JSON.stringify(updated))
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { sectorId } }))
  } catch { /* quota — silent */ }
}

export function loadAgentRuns(sectorId: string): AgentRunSummary[] {
  try {
    const raw = localStorage.getItem(KEY(sectorId))
    return raw ? (JSON.parse(raw) as AgentRunSummary[]) : []
  } catch {
    return []
  }
}

export function clearAgentRuns(sectorId: string) {
  localStorage.removeItem(KEY(sectorId))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { sectorId } }))
}

// ── Derived helpers ──────────────────────────────────────────────────────────

export function getLatestRunsPerAgent(sectorId: string): AgentRunSummary[] {
  const runs = loadAgentRuns(sectorId)
  const seen = new Set<string>()
  return runs.filter(r => { if (seen.has(r.agentId)) return false; seen.add(r.agentId); return true })
}

export function countFindings(runs: AgentRunSummary[]) {
  const all = runs.flatMap(r => r.findings)
  return {
    critical: all.filter(f => f.severity === 'critical').length,
    warning:  all.filter(f => f.severity === 'warning').length,
    info:     all.filter(f => f.severity === 'info').length,
    total:    all.length,
  }
}

// ── Reactive hook ────────────────────────────────────────────────────────────

export function useAgentStore(sectorId: SectorId) {
  const [runs, setRuns] = useState<AgentRunSummary[]>(() => getLatestRunsPerAgent(sectorId))

  useEffect(() => {
    setRuns(getLatestRunsPerAgent(sectorId))
    const refresh = () => setRuns(getLatestRunsPerAgent(sectorId))
    window.addEventListener(CHANGE_EVENT, refresh)
    const onStorage = (e: StorageEvent) => { if (e.key === KEY(sectorId)) refresh() }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [sectorId])

  return runs
}
