import axios from 'axios'
import type {
  DashboardData,
  MappingEntry,
  MappingsResponse,
  OntologyGraphData,
  PaginatedData,
  QueryResult,
  SemanticStatusResponse,
} from '../types'
import { parseSemanticStatusResponse } from '../types/semantic'
import { mockDashboard, mockMappings, mockOntologyGraph, mockQueryResult } from './mockData'

const IS_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
export const AUTH_TOKEN_STORAGE_KEY = 'si-auth-token'

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 60_000,
})

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const getAuthToken = (): string | null => {
  try {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

export const setAuthToken = (token: string): void => {
  try {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
  } catch {
    // Private browsing or storage quota exceeded — token held only in memory
  }
}

export const clearAuthToken = (): void => {
  try {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
  } catch {
    // ignore storage failures
  }
}

api.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const maybeResponse = error as { response?: { status?: number } }
    if (maybeResponse.response?.status === 401) {
      clearAuthToken()
      // Signal App.tsx to drop the auth gate back to login
      window.dispatchEvent(new CustomEvent('logout-requested'))
    }
    return Promise.reject(error)
  },
)

interface LoginResponse {
  access_token: string
  token_type: 'bearer'
  expires_in: number
  role: 'admin' | 'user'
  mode: 'demo' | 'live'
}

interface SemanticAskApiResponse {
  answer: unknown
  sql_used: string | null
  sources_touched: string[]
  provenance: Record<string, unknown>
  latency_ms: number
  disambiguation_required: boolean
  candidates: string[]
  notes: string
  ambiguity_error: boolean
}

export const login = async (username: string, password: string, mode: 'demo' | 'live' = 'demo'): Promise<void> => {
  if (IS_MOCK) {
    await delay(250)
    // Encode mode into a fake JWT-like structure so demoMode.ts can read it
    const fakePayload = btoa(JSON.stringify({ sub: username, mode, role: 'user' }))
    const fake = `mock.${fakePayload}.sig`
    setAuthToken(fake)
    return
  }

  const form = new URLSearchParams()
  form.set('username', username)
  form.set('password', password)
  form.set('mode', mode)

  const response = await api.post<LoginResponse>('/api/auth/token', form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  setAuthToken(response.data.access_token)
}

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

  const semantic = await api
    .post<SemanticAskApiResponse>('/api/semantic/ask', { question })
    .then((r) => r.data)

  const answer = semantic.answer
  let rows: Record<string, unknown>[] = []
  if (Array.isArray(answer)) {
    rows = answer.map((item) => {
      if (item && typeof item === 'object') return item as Record<string, unknown>
      return { value: item as unknown }
    })
  } else if (answer && typeof answer === 'object') {
    rows = [answer as Record<string, unknown>]
  } else if (answer !== null && answer !== undefined) {
    rows = [{ value: answer }]
  }

  const ontologyIntent = (
    ((semantic.provenance?.ontology_intent as Record<string, unknown> | undefined)?.intent_type as string | undefined)
      ?? 'unknown'
  )
  const connectors = semantic.sources_touched.length ? semantic.sources_touched.join(', ') : 'n/a'

  return {
    question,
    interpreted_as: `intent=${ontologyIntent}`,
    sql_query: semantic.sql_used ?? '-- deterministic semantic-layer query plan',
    results: rows,
    summary: semantic.notes || `Semantic query executed using connectors: ${connectors}`,
  }
}

// ── Data ────────────────────────────────────────────────────────────────────────

export const fetchTableData = (table: string, page = 1, pageSize = 20) => {
  if (IS_MOCK) return Promise.resolve({ table, total: 0, page, page_size: pageSize, data: [] } as PaginatedData)
  return api.get<PaginatedData>(`/api/data/${table}`, { params: { page, page_size: pageSize } }).then((r) => r.data)
}

// ── Semantic layer ─────────────────────────────────────────────────────────────

export const fetchSemanticStatus = async (): Promise<SemanticStatusResponse> => {
  if (IS_MOCK) {
    await delay(250)
    return {
      loaded: false,
      entities: [],
      kg_nodes: 0,
      kg_edges: 0,
      metadata_rows: 0,
      sources: [],
      dedup_count: 0,
    }
  }
  return api.get<unknown>('/api/semantic/status').then((r) => parseSemanticStatusResponse(r.data))
}
