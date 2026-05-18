import axios from 'axios'
import type {
  DashboardData,
  MappingEntry,
  MappingsResponse,
  OntologyGraphData,
  PaginatedData,
  QueryResult,
} from '../types'

const BASE_URL = 'http://localhost:8000'

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 60_000, // 60s for LLM calls
})

// ── Health ─────────────────────────────────────────────────────────────────────

export const checkHealth = () =>
  api.get<{ status: string }>('/api/health').then((r) => r.data)

// ── Dashboard ──────────────────────────────────────────────────────────────────

export const fetchDashboard = () =>
  api.get<DashboardData>('/api/dashboard').then((r) => r.data)

// ── Ontology ───────────────────────────────────────────────────────────────────

export const fetchOntologyGraph = () =>
  api.get<OntologyGraphData>('/api/ontology/graph').then((r) => r.data)

export const fetchMappings = () =>
  api.get<MappingsResponse>('/api/ontology/mappings').then((r) => r.data)

export const updateMapping = (entry: Pick<MappingEntry, 'table' | 'field'> & { ontology_path: string }) =>
  api.put<{ success: boolean }>('/api/ontology/mappings', entry).then((r) => r.data)

// ── Query ──────────────────────────────────────────────────────────────────────

export const runQuery = (question: string) =>
  api.post<QueryResult>('/api/query', { question }).then((r) => r.data)

// ── Data ───────────────────────────────────────────────────────────────────────

export const fetchTableData = (table: string, page = 1, pageSize = 20) =>
  api
    .get<PaginatedData>(`/api/data/${table}`, { params: { page, page_size: pageSize } })
    .then((r) => r.data)
