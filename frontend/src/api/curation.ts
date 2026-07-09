/**
 * Curation API client — /api/curation/* (reversible schema pruning).
 * The curation layer decides which tables become entities in the graph and
 * data model; every decision is explainable and reversible.
 */
import axios from 'axios'
import { getAuthToken } from './client'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

const http = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 120_000,
})

http.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export interface CurationDecision {
  table: string
  status: 'kept' | 'excluded' | 'uncertain'
  reason: string
  decided_by: 'rule' | 'signal' | 'llm' | 'user'
  decided_at: string
}

export interface CurationReport {
  kept: CurationDecision[]
  excluded: CurationDecision[]
  uncertain: CurationDecision[]
  counts: Record<string, number>
}

export interface CurationAdviseResult {
  applied: (CurationDecision & { confidence?: number })[]
  merge_proposals: {
    table: string
    with_entity: string
    concept?: string
    confidence?: number
    reason: string
    queued: string
  }[]
  /** Verdicts the AI was not confident enough about — left for a human. */
  skipped_low_confidence?: {
    table: string
    decision?: string
    merge_with?: string
    confidence: number
    reason: string
  }[]
  /** Tables not re-asked because a recent run already judged them low-confidence. */
  on_cooldown?: string[]
  note?: string
}

export interface CurationAdvisorJob {
  status: 'idle' | 'running' | 'done' | 'error'
  result?: CurationAdviseResult
  error?: string
  started_at?: string
  finished_at?: string
  started_by?: string
  force?: boolean
}

export const getCurationReport = (): Promise<CurationReport> =>
  http.get<CurationReport>('/api/curation/report').then(r => r.data)

export const setCurationDecision = (
  table: string,
  status: 'kept' | 'excluded',
  reason = '',
): Promise<CurationDecision> =>
  http
    .post<CurationDecision>('/api/curation/decision', { table, status, reason })
    .then(r => r.data)

export const runCuration = (): Promise<CurationReport> =>
  http.post<CurationReport>('/api/curation/run').then(r => r.data)

export const startCurationAdvisor = (force = false): Promise<{ status: string }> =>
  http.post<{ status: string }>('/api/curation/advise', { force }).then(r => r.data)

export const getCurationAdvisorStatus = (): Promise<CurationAdvisorJob> =>
  http.get<CurationAdvisorJob>('/api/curation/advise/status').then(r => r.data)

/**
 * Start an AI review and poll until it finishes. The backend runs the review
 * as a background job (the model call can take ~30s), so the POST returns
 * immediately and we poll the status endpoint.
 */
export const runCurationAdvisor = async (
  force = false,
): Promise<CurationAdviseResult> => {
  await startCurationAdvisor(force)
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    await new Promise(res => setTimeout(res, 1500))
    const job = await getCurationAdvisorStatus()
    if (job.status === 'done' && job.result) return job.result
    if (job.status === 'error') throw new Error(job.error ?? 'AI review failed')
    if (job.status === 'idle') throw new Error('AI review did not start')
  }
  throw new Error('AI review timed out — check back with a re-run later')
}
