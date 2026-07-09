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
  applied: CurationDecision[]
  merge_proposals: {
    table: string
    with_entity: string
    concept?: string
    reason: string
    queued: string
  }[]
  note?: string
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

export const runCurationAdvisor = (): Promise<CurationAdviseResult> =>
  http.post<CurationAdviseResult>('/api/curation/advise').then(r => r.data)
