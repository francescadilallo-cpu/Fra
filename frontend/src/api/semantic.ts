/**
 * Semantic Layer API client — all calls to /api/semantic/* and /api/ask.
 * Typed against the FastAPI backend in backend/app/main.py.
 */
import axios, { AxiosError } from 'axios'
import type { EngineResult, ChartData, SourceBadge } from '../data/queryEngine'
import { getAuthToken, handle401 } from './client'

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

// Reuse the shared 401 handler so both axios instances use the same dedup guard.
http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const maybeResponse = error as { response?: { status?: number } }
    handle401(maybeResponse.response?.status)
    return Promise.reject(error)
  },
)

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SemanticStatus {
  loaded: boolean
  entities: string[]
  kg_nodes: number
  kg_edges: number
  metadata_rows: number
  sources: string[]
  dedup_count: number
}

export interface BackendSource {
  id: string
  name: string
  source_type: string
  tables: string[]
  record_counts: Record<string, number>
  total_rows: number
  loaded_at: string
  quality_score: number
  freshness_status: 'fresh' | 'warning' | 'stale'
}

export interface BackendMetric {
  id: string
  sector_id: string
  name: string
  description: string
  type: 'sum' | 'count' | 'count_distinct' | 'avg' | 'ratio' | 'derived'
  entity: string
  field: string
  numerator: string
  denominator: string
  expression: string
  filters: string[]
  time_dimension: string
  grains: string[]
  format: 'number' | 'currency' | 'percentage'
  status: 'verified' | 'draft'
  owner: string
  tags: string[]
  is_builtin: boolean
}

export interface BackendHierarchyLevel {
  name: string
  field: string
}

export interface BackendHierarchy {
  id: string
  sector_id: string
  name: string
  entity: string
  description: string
  type: 'time' | 'categorical'
  levels: BackendHierarchyLevel[]
  is_builtin: boolean
}

export interface BackendSegmentCondition {
  field: string
  operator: string
  value: string
}

export interface BackendSegment {
  id: string
  sector_id: string
  name: string
  description: string
  entity: string
  conditions: BackendSegmentCondition[]
  tags: string[]
  used_by: string[]
  is_builtin: boolean
}

export interface AskResult {
  question: string
  interpreted_as: string
  sql_used: string | null
  rows: Record<string, unknown>[]
  total_rows: number
  summary: string
  sources_touched: string[]
  provenance: Record<string, unknown>
  latency_ms: number
  disambiguation_required: boolean
  candidates: string[]
  ambiguity_error: boolean
  chart_hint: { type: string; label_col: string; value_col: string } | null
  notes: string | null
}


// ── Health ────────────────────────────────────────────────────────────────────

export async function checkBackend(): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await http.get('/api/health', { timeout: 10_000 })
      return true
    } catch {
      if (attempt === 0) await new Promise(r => setTimeout(r, 1_000))
    }
  }
  return false
}

// ── Status & Sources ──────────────────────────────────────────────────────────

export const semanticStatus = (): Promise<SemanticStatus> =>
  http.get<SemanticStatus>('/api/semantic/status').then(r => r.data)

export const semanticSources = (): Promise<BackendSource[]> =>
  http.get<BackendSource[]>('/api/semantic/sources').then(r => r.data)

// ── Metrics ───────────────────────────────────────────────────────────────────

export const getMetrics = (sectorId = 'manufacturing'): Promise<BackendMetric[]> =>
  http.get<BackendMetric[]>('/api/semantic/metrics', { params: { sector_id: sectorId } }).then(r => r.data)

export const createMetric = (m: Omit<BackendMetric, 'id' | 'is_builtin'>): Promise<BackendMetric> =>
  http.post<BackendMetric>('/api/semantic/metrics', m).then(r => r.data)

export const deleteMetric = (id: string): Promise<void> =>
  http.delete(`/api/semantic/metrics/${id}`).then(() => undefined)

// ── Hierarchies ───────────────────────────────────────────────────────────────

export const getHierarchies = (sectorId = 'manufacturing'): Promise<BackendHierarchy[]> =>
  http.get<BackendHierarchy[]>('/api/semantic/hierarchies', { params: { sector_id: sectorId } }).then(r => r.data)

export const createHierarchy = (h: Omit<BackendHierarchy, 'id' | 'is_builtin'>): Promise<BackendHierarchy> =>
  http.post<BackendHierarchy>('/api/semantic/hierarchies', h).then(r => r.data)

export const deleteHierarchy = (id: string): Promise<void> =>
  http.delete(`/api/semantic/hierarchies/${id}`).then(() => undefined)

// ── Segments ──────────────────────────────────────────────────────────────────

export const getSegments = (sectorId = 'manufacturing'): Promise<BackendSegment[]> =>
  http.get<BackendSegment[]>('/api/semantic/segments', { params: { sector_id: sectorId } }).then(r => r.data)

export const createSegment = (s: Omit<BackendSegment, 'id' | 'is_builtin'>): Promise<BackendSegment> =>
  http.post<BackendSegment>('/api/semantic/segments', s).then(r => r.data)

export const deleteSegment = (id: string): Promise<void> =>
  http.delete(`/api/semantic/segments/${id}`).then(() => undefined)

// ── Query ─────────────────────────────────────────────────────────────────────

export const ask = (question: string, sectorId = 'manufacturing'): Promise<AskResult> =>
  http.post<AskResult>('/api/ask', { question, sector_id: sectorId }).then(r => r.data)

// ── Adapters: backend → frontend EngineResult ─────────────────────────────────

const SOURCE_META: Record<string, { label: string; bg: string; text: string }> = {
  erp:     { label: 'ERP',     bg: 'bg-blue-100',   text: 'text-blue-700' },
  crm:     { label: 'CRM',     bg: 'bg-teal-100',   text: 'text-teal-700' },
  hr_pim:  { label: 'HR/PIM',  bg: 'bg-violet-100', text: 'text-violet-700' },
  hr:      { label: 'HR',      bg: 'bg-violet-100', text: 'text-violet-700' },
  pim:     { label: 'PIM',     bg: 'bg-amber-100',  text: 'text-amber-700' },
}

function mapChartHint(
  hint: { type: string; label_col: string; value_col: string },
  rows: Record<string, unknown>[],
): ChartData | undefined {
  if (!hint || rows.length === 0) return undefined
  const raw = rows.map(r => ({
    label: String(r[hint.label_col] ?? ''),
    value: Number(r[hint.value_col] ?? 0),
  })).filter(p => !isNaN(p.value))
  if (raw.length === 0) return undefined
  return {
    type: (hint.type === 'line' || hint.type === 'pie') ? hint.type : 'bar',
    title: `${hint.value_col} by ${hint.label_col}`,
    labels: raw.map(p => p.label),
    values: raw.map(p => p.value),
  }
}

export function adaptAskResult(result: AskResult): EngineResult {
  // The backend returns `answer: Any` (SemanticAskResponse shape) rather than
  // separate rows/summary/total_rows fields. Normalise here so the UI never
  // receives undefined for array or string props.
  const rawAnswer = (result as unknown as Record<string, unknown>).answer

  let rows: Record<string, unknown>[] = result.rows ?? []
  let summary = result.summary ?? ''

  if (rows.length === 0 && rawAnswer !== undefined && rawAnswer !== null) {
    if (Array.isArray(rawAnswer)) {
      rows = rawAnswer as Record<string, unknown>[]
    } else if (typeof rawAnswer === 'object') {
      // A plain dict answer (e.g. {total: 20201, duplicates: 381, unique: 19820})
      // is a single-row result — wrap it so the table renderer gets an array.
      rows = [rawAnswer as Record<string, unknown>]
    }
  }

  if (!summary) {
    if (typeof rawAnswer === 'string') {
      summary = rawAnswer
    } else if (typeof rawAnswer === 'number') {
      summary = `**${rawAnswer.toLocaleString('en-US')}**`
    } else if (rows.length > 0) {
      // Build a readable summary from the row data
      const row = rows[0]
      const entries = Object.entries(row)
      const numericFields = entries.filter(([, v]) => typeof v === 'number')
      if (rows.length === 1 && numericFields.length > 0) {
        // Single-row result: list all numeric fields
        summary = numericFields
          .map(([col, val]) => `**${(val as number).toLocaleString('en-US')}** (${col})`)
          .join(' · ')
      } else if (numericFields.length > 0) {
        // Multi-row result: show count and the key numeric column
        const [col] = numericFields[0]
        summary = `**${rows.length}** result${rows.length !== 1 ? 's' : ''} — see table below (${col} and more)`
      } else {
        summary = `**${rows.length}** result${rows.length !== 1 ? 's' : ''} returned`
      }
    }
  }

  const totalRows = result.total_rows ?? rows.length
  const touched = result.sources_touched ?? []

  const sources: SourceBadge[] = touched.map(s => ({
    id: s,
    label: SOURCE_META[s]?.label ?? s.toUpperCase(),
    bg:    SOURCE_META[s]?.bg    ?? 'bg-slate-100',
    text:  SOURCE_META[s]?.text  ?? 'text-slate-700',
  }))

  // notes is a last-resort fallback: some handlers (impossible, entity_not_modeled)
  // set answer=null with the explanation only in notes. This ensures the user
  // always sees a message rather than an empty response.
  const finalSummary =
    summary ||
    (typeof result.notes === 'string' && result.notes ? result.notes : '') ||
    (result.ambiguity_error ? `Ambiguity: ${(result.candidates ?? []).join(', ')}` : '')

  return {
    sql: result.sql_used ?? '-- no SQL generated',
    rows,
    summary: finalSummary,
    interpreted_as: result.interpreted_as ?? '',
    chartData: result.chart_hint ? mapChartHint(result.chart_hint, rows) : undefined,
    sources,
    isDisambiguation: result.disambiguation_required || result.ambiguity_error,
    candidates: result.candidates ?? [],
    followUps: [],
    steps: touched.length > 0
      ? [`Queried: ${touched.join(', ')} — ${totalRows} rows in ${result.latency_ms?.toFixed(0) ?? '?'}ms`]
      : undefined,
  }
}

// ── Semantic Draft ────────────────────────────────────────────────────────────

export interface DraftEntity {
  name: string
  table: string
  columns: string[]
  description: string
  user_description: string
  context_notes: string
  record_count: number
  sources: string[]
}

export interface DraftRelation {
  from_table: string
  to_table: string
  via_column: string
  edge_type: string
}

export interface DraftMetric {
  name: string
  label: string
  description: string
  formula: string
  unit: string
}

export interface ContextDoc {
  id: string
  title: string
  content: string
  created_at: string
}

export interface QueryTemplate {
  id: number
  name: string
  description: string
  sql_query: string
  keywords: string[]
  sources: string[]
  intent_type: string
  is_active: boolean
  auto_generated: boolean
  created_at: string
  updated_at: string
}

export interface QueryTemplateCreate {
  name: string
  description: string
  sql_query: string
  keywords: string[]
  sources: string[]
}

export interface SemanticDraft {
  entities: DraftEntity[]
  relations: DraftRelation[]
  metrics: DraftMetric[]
  context_docs: ContextDoc[]
  templates: QueryTemplate[]
  loaded: boolean
  built_at: string | null
}

export const buildSemanticLayer = (signal?: AbortSignal, force = false): Promise<SemanticDraft> =>
  http.post<SemanticDraft>('/api/semantic/build', undefined, { signal, params: force ? { force: true } : undefined }).then(r => r.data)

export const getDraft = (): Promise<SemanticDraft> =>
  http.get<SemanticDraft>('/api/semantic/draft').then(r => r.data)

export const patchDraftEntity = (
  name: string,
  updates: { user_description?: string; context_notes?: string },
): Promise<void> =>
  http
    .patch(`/api/semantic/draft/entities/${encodeURIComponent(name)}`, updates)
    .then(() => undefined)

export const patchDraftMetric = (
  name: string,
  updates: { description?: string; formula?: string; label?: string },
): Promise<void> =>
  http
    .patch(`/api/semantic/draft/metrics/${encodeURIComponent(name)}`, updates)
    .then(() => undefined)

export const addContextDoc = (title: string, content: string): Promise<ContextDoc> =>
  http.post<ContextDoc>('/api/semantic/draft/context', { title, content }).then(r => r.data)

export const deleteContextDoc = (id: string): Promise<void> =>
  http.delete(`/api/semantic/draft/context/${encodeURIComponent(id)}`).then(() => undefined)

// ── Query Templates ───────────────────────────────────────────────────────────

export const listQueryTemplates = (): Promise<QueryTemplate[]> =>
  http.get<QueryTemplate[]>('/api/semantic/templates').then(r => r.data)

export const createQueryTemplate = (t: QueryTemplateCreate): Promise<QueryTemplate> =>
  http.post<QueryTemplate>('/api/semantic/templates', t).then(r => r.data)

export const updateQueryTemplate = (
  id: number,
  t: Partial<QueryTemplateCreate>,
): Promise<QueryTemplate> =>
  http.patch<QueryTemplate>(`/api/semantic/templates/${id}`, t).then(r => r.data)

export const deleteQueryTemplate = (id: number): Promise<void> =>
  http.delete(`/api/semantic/templates/${id}`).then(() => undefined)

// ── Live Config ───────────────────────────────────────────────────────────────

export interface LiveOntologyNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    uri: string
    db_table: string
    row_count: number
    properties: { name: string; type: string }[]
  }
}

export interface LiveOntologyEdge {
  id: string
  source: string
  target: string
  type: string
  animated: boolean
  label: string
}

export interface LiveKpiStat {
  label: string
  value: number | string
  unit: string
  type: 'count' | 'sum' | 'date_range'
}

export interface LiveConfig {
  name: string
  domain: string
  connectors: string[]
  ontology: {
    nodes: LiveOntologyNode[]
    edges: LiveOntologyEdge[]
  }
  metrics: { name: string; label: string; formula: string; unit: string }[]
  funnel: { stage: string; count: number; value: number }[] | null
  process_stages: { key: string; label: string; count: number }[]
  kpi_stats: LiveKpiStat[]
  built_at: string
}

export const getLiveConfig = (): Promise<LiveConfig> =>
  http.get<LiveConfig>('/api/semantic/live-config').then(r => r.data)

export interface DataStoreStatus {
  source_type: string
  built_at: string | null
  tables: string[]
  row_counts: Record<string, number>
  total_rows: number
  notes: string
  error?: string
}

export const getDataStoreStatus = (): Promise<DataStoreStatus> =>
  http.get<DataStoreStatus>('/api/data/store/status').then(r => r.data)

// ── Example Questions ─────────────────────────────────────────────────────────

export interface ExampleQuestion {
  question: string
  description: string
}

export const listExampleQuestions = (): Promise<ExampleQuestion[]> =>
  http.get<ExampleQuestion[]>('/api/semantic/example-questions').then(r => r.data)

// ── Error helpers ─────────────────────────────────────────────────────────────

export function backendErrorMessage(e: unknown): string {
  if (e instanceof AxiosError) {
    const status = e.response?.status
    const detail = e.response?.data?.detail
    // FastAPI pydantic validation errors return detail as an array of {msg, type, loc}
    if (Array.isArray(detail)) return detail.map((d: { msg?: string }) => d.msg ?? String(d)).join('; ')
    if (typeof detail === 'string') return detail
    if (detail && typeof detail === 'object' && 'message' in detail) return String(detail.message)
    if (status === 500) return 'Server error — please try again'
    if (status === 503) return 'Service temporarily unavailable'
    if (e.code === 'ECONNABORTED') return 'Request timed out — please try again'
    return e.message
  }
  return String(e)
}
