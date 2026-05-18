import axios from 'axios'
import type {
  DashboardData,
  MappingEntry,
  MappingsResponse,
  OntologyGraphData,
  PaginatedData,
  QueryResult,
} from '../types'
import { mockDashboard, mockMappings, mockOntologyGraph, mockQueryResult } from './mockData'

const IS_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 60_000,
})

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── Health ──────────────────────────────────────────────────────────────────────

export const checkHealth = async () => {
  if (IS_MOCK) return { status: 'ok' }
  return api.get<{ status: string }>('/api/health').then((r) => r.data)
}

// ── Dashboard ───────────────────────────────────────────────────────────────────

export const fetchDashboard = async (): Promise<DashboardData> => {
  if (IS_MOCK) { await delay(300); return mockDashboard }
  return api.get<DashboardData>('/api/dashboard').then((r) => r.data)
}

// ── Ontology ────────────────────────────────────────────────────────────────────

export const fetchOntologyGraph = async (): Promise<OntologyGraphData> => {
  if (IS_MOCK) { await delay(300); return mockOntologyGraph }
  return api.get<OntologyGraphData>('/api/ontology/graph').then((r) => r.data)
}

export const fetchMappings = async (): Promise<MappingsResponse> => {
  if (IS_MOCK) { await delay(300); return mockMappings }
  return api.get<MappingsResponse>('/api/ontology/mappings').then((r) => r.data)
}

export const updateMapping = (entry: Pick<MappingEntry, 'table' | 'field'> & { ontology_path: string }) => {
  if (IS_MOCK) return Promise.resolve({ success: true })
  return api.put<{ success: boolean }>('/api/ontology/mappings', entry).then((r) => r.data)
}

// ── Query ───────────────────────────────────────────────────────────────────────

export const runQuery = async (question: string): Promise<QueryResult> => {
  if (IS_MOCK) {
    await delay(1200)
    return { ...mockQueryResult, question }
  }
  return api.post<QueryResult>('/api/query', { question }).then((r) => r.data)
}

// ── Data ────────────────────────────────────────────────────────────────────────

export const fetchTableData = (table: string, page = 1, pageSize = 20) => {
  if (IS_MOCK) return Promise.resolve({ table, total: 0, page, page_size: pageSize, data: [] } as PaginatedData)
  return api.get<PaginatedData>(`/api/data/${table}`, { params: { page, page_size: pageSize } }).then((r) => r.data)
}
