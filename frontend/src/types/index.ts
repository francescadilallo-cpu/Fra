// ── Dashboard ──────────────────────────────────────────────────────────────────

export interface RecentOrder {
  id: number
  customer_name: string
  total_value: number
  status: string
  date: string
}

export interface DataSource {
  name: string
  type: string
  status: 'connected' | 'disconnected' | 'error'
  tables: string[]
  row_counts: Record<string, number>
}

export interface DashboardData {
  total_customers: number
  total_products: number
  total_quotes: number
  total_orders: number
  quote_conversion_rate: number
  open_quotes_value: number
  recent_orders: RecentOrder[]
  data_sources: DataSource[]
}

// ── Ontology graph ─────────────────────────────────────────────────────────────

export interface OntologyNodeData {
  label: string
  uri: string
  db_table: string | null
  row_count: number
  properties: string[]
}

export interface OntologyNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: OntologyNodeData
}

export interface OntologyEdge {
  id: string
  source: string
  target: string
  label: string
  type: string
  animated: boolean
  style: Record<string, string>
  labelStyle: Record<string, string | number>
  markerEnd: Record<string, string>
}

export interface OntologyGraphData {
  nodes: OntologyNode[]
  edges: OntologyEdge[]
}

// ── Mappings ───────────────────────────────────────────────────────────────────

export interface MappingEntry {
  table: string
  field: string
  ontology_class: string
  ontology_property: string
  type: string
}

export interface MappingsResponse {
  mappings: MappingEntry[]
  raw: Record<string, unknown>
}

// ── Query ──────────────────────────────────────────────────────────────────────

export interface QueryResult {
  question: string
  interpreted_as: string
  sql_query: string
  results: Record<string, unknown>[]
  summary: string
}

// ── Paginated data ─────────────────────────────────────────────────────────────

export interface PaginatedData {
  table: string
  total: number
  page: number
  page_size: number
  data: Record<string, unknown>[]
}

// ── Nav ────────────────────────────────────────────────────────────────────────

export type NavTab = 'dashboard' | 'ontology' | 'query' | 'mappings'
