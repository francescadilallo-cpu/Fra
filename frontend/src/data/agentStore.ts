import { useState, useEffect } from 'react'
import type { SectorId } from './sectors'
import { IS_DEMO_MODE, modeScopedSector } from '../lib/demoMode'

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

const KEY = (sectorId: string) => `agent-runs-${modeScopedSector(sectorId)}`
const CHANGE_EVENT = 'agent-store-changed'

// Pre-populated demo runs shown in the Dashboard before the user runs any agent.
// Uses Date.now() at module load so relative timestamps ("X min ago") look recent.
const _now = Date.now()
const DEMO_AGENT_SEED: Partial<Record<string, AgentRunSummary[]>> = {
  manufacturing: [
    {
      agentId: 'sales-performance',
      agentName: 'Sales Performance Agent',
      ranAt: new Date(_now - 1000 * 60 * 12).toISOString(),
      metrics: [
        { label: 'Reps analyzed',       value: '14' },
        { label: 'Top: Linda Mitchell', value: '$4.25M YTD' },
        { label: 'Highest bonus',       value: '$6,700 (Jae Pak)' },
        { label: 'Below quota',         value: '3 reps' },
      ],
      findings: [
        { severity: 'info',    text: 'Linda Mitchell ($4.25M) and Rachel Reiter ($4.12M) top the leaderboard — both above $250K quota' },
        { severity: 'warning', text: 'Jae Pak has the highest bonus ($6,700) despite ranking 8th in revenue — commission model review suggested' },
        { severity: 'warning', text: 'Shu Ito ($559K) is well below peers — territory Southeast has lowest order count (1,833)' },
      ],
    },
    {
      agentId: 'crm-dedup',
      agentName: 'CRM Data Quality Agent',
      ranAt: new Date(_now - 1000 * 60 * 10).toISOString(),
      metrics: [
        { label: 'Raw accounts',    value: '20,201' },
        { label: 'Duplicates',      value: '372' },
        { label: 'Clean accounts',  value: '19,829' },
        { label: 'Bridge match',    value: '93.2%' },
      ],
      findings: [
        { severity: 'critical', text: '372 accounts with accountId < 0 confirmed as legacy migration duplicates — ready for removal' },
        { severity: 'warning',  text: '1,345 CRM accounts have no ERP order history — likely prospects never converted' },
        { severity: 'info',     text: '18,484 accounts successfully bridged to ERP via customer_ref ↔ accountId' },
      ],
    },
    {
      agentId: 'revenue-disambiguator',
      agentName: 'Revenue Disambiguation Agent',
      ranAt: new Date(_now - 1000 * 60 * 8).toISOString(),
      metrics: [
        { label: 'subtotal (net)',  value: '$20.1M' },
        { label: 'total_due (gross)', value: '$22.4M' },
        { label: 'Delta',           value: '$2.3M (11.3%)' },
        { label: 'Ambiguity',       value: 'documented' },
      ],
      findings: [
        { severity: 'critical', text: '"fatturato" maps to two fields: subtotal_amount $20.1M vs total_due $22.4M — $2.3M gap (tax + freight)' },
        { severity: 'info',     text: 'Semantic layer enforces disambiguation at query time — AI asks before assuming' },
        { severity: 'info',     text: 'Use subtotal_amount for commercial KPIs, total_due for billing/AR' },
      ],
    },
    {
      agentId: 'bridge-validator',
      agentName: 'Bridge Validation Agent',
      ranAt: new Date(_now - 1000 * 60 * 6).toISOString(),
      metrics: [
        { label: 'PLACED_BY', value: '93.2%' },
        { label: 'SOLD_BY',   value: '100%' },
        { label: 'OF_PRODUCT', value: '99.6%' },
        { label: 'Orphans',   value: '47 products' },
      ],
      findings: [
        { severity: 'info',    text: 'PLACED_BY bridge: 18,484 / 19,829 clean accounts matched (93.2%) — 1,345 unmatched are likely prospects' },
        { severity: 'info',    text: 'SOLD_BY bridge: 14/14 sales reps fully resolved — HR matricolaDip ↔ ERP salesPersonId 100%' },
        { severity: 'warning', text: '47 PIM products not found in any ERP order line — possible discontinued catalog entries' },
      ],
    },
  ],
}

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
  if (runs.length === 0 && IS_DEMO_MODE) return DEMO_AGENT_SEED[sectorId] ?? []
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
