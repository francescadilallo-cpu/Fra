/**
 * Source Registry API client — uses the shared axios instance from client.ts
 * so the JWT Bearer token is included automatically on every request.
 */
import { api } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BackendSource {
  id: string
  connector_type: string
  label: string
  params: Record<string, unknown>
  target_tables: string[]
  row_count: number
  status: 'pending' | 'active' | 'error' | 'syncing'
  error_msg: string | null
  connected_at: string
  last_sync_at: string | null
  is_default: boolean
}

export interface SourceAddPayload {
  connector_type: string
  label: string
  params: Record<string, unknown>
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function listSources(): Promise<BackendSource[]> {
  const res = await api.get<BackendSource[]>('/api/sources')
  return res.data
}

export async function addSource(payload: SourceAddPayload): Promise<BackendSource> {
  const res = await api.post<BackendSource>('/api/sources', payload)
  return res.data
}

export async function removeSource(sourceId: string): Promise<void> {
  await api.delete(`/api/sources/${encodeURIComponent(sourceId)}`)
}

export async function syncSource(sourceId: string): Promise<BackendSource> {
  const res = await api.post<BackendSource>(
    `/api/sources/${encodeURIComponent(sourceId)}/sync`,
  )
  return res.data
}

// ── Connector → backend param schema ─────────────────────────────────────────

export interface ParamField {
  key: string
  label: string
  type: 'text' | 'password' | 'url'
  placeholder: string
  required: boolean
  hint?: string
}

export interface ConnectorBackendDef {
  connector_type: string
  params_schema: ParamField[]
  /** True when backend ingestion is not yet implemented for this connector type.
   *  The credential modal will show a "register interest" panel instead of the form. */
  waitlist_only?: boolean
}

export const CONNECTOR_BACKEND_MAP: Record<string, ConnectorBackendDef> = {
  postgresql: {
    connector_type: 'postgresql',
    params_schema: [
      { key: 'dsn', label: 'Connection string', type: 'text', placeholder: 'postgresql://user:pass@host:5432/db', required: true },
      { key: 'tables', label: 'Tables (comma-separated)', type: 'text', placeholder: 'orders,customers,products', required: true, hint: 'List of tables to import' },
      { key: 'schema', label: 'Schema (default: public)', type: 'text', placeholder: 'public', required: false },
    ],
  },
  mysql: {
    connector_type: 'mysql',
    params_schema: [
      { key: 'dsn', label: 'Connection string', type: 'text', placeholder: 'mysql://user:pass@host:3306/db', required: true },
      { key: 'tables', label: 'Tables (comma-separated)', type: 'text', placeholder: 'orders,customers', required: true },
    ],
  },
  'google-sheets': {
    connector_type: 'csv',
    params_schema: [
      { key: 'path', label: 'CSV Export URL or file path', type: 'url', placeholder: 'https://docs.google.com/spreadsheets/d/.../export?format=csv', required: true, hint: 'File → Download → CSV, then paste that URL' },
      { key: 'table_name', label: 'Table name in DuckDB', type: 'text', placeholder: 'my_sheet', required: true },
    ],
  },
  airtable: {
    connector_type: 'csv',
    params_schema: [
      { key: 'path', label: 'CSV export file path', type: 'text', placeholder: '/data/airtable_export.csv', required: true },
      { key: 'table_name', label: 'Table name in DuckDB', type: 'text', placeholder: 'airtable_records', required: true },
    ],
  },
  'sqlite-file': {
    connector_type: 'sqlite',
    params_schema: [
      { key: 'path', label: 'SQLite file path', type: 'text', placeholder: '/data/mydb.sqlite', required: true },
      { key: 'tables', label: 'Tables (comma-separated, leave blank for all)', type: 'text', placeholder: 'orders,customers', required: false, hint: 'Leave empty to import all tables' },
    ],
  },
  'excel-file': {
    connector_type: 'excel',
    params_schema: [
      { key: 'path', label: 'Excel file path or URL', type: 'text', placeholder: '/data/report.xlsx', required: true },
      { key: 'table_name', label: 'Table name in DuckDB', type: 'text', placeholder: 'excel_data', required: true },
      { key: 'sheet', label: 'Sheet name (default: first sheet)', type: 'text', placeholder: 'Sheet1', required: false },
    ],
  },
  'parquet-file': {
    connector_type: 'parquet',
    params_schema: [
      { key: 'path', label: 'Parquet file path', type: 'text', placeholder: '/data/events.parquet', required: true },
      { key: 'table_name', label: 'Table name in DuckDB', type: 'text', placeholder: 'parquet_data', required: true },
    ],
  },
  'json-file': {
    connector_type: 'json',
    params_schema: [
      { key: 'path', label: 'JSON file path', type: 'text', placeholder: '/data/records.json', required: true, hint: 'Top-level array or NDJSON supported' },
      { key: 'table_name', label: 'Table name in DuckDB', type: 'text', placeholder: 'json_data', required: true },
    ],
  },
  shopify:            { connector_type: 'shopify',            params_schema: [], waitlist_only: true },
  woocommerce:        { connector_type: 'woocommerce',        params_schema: [], waitlist_only: true },
  magento:            { connector_type: 'magento',            params_schema: [], waitlist_only: true },
  prestashop:         { connector_type: 'prestashop',         params_schema: [], waitlist_only: true },
  stripe:             { connector_type: 'stripe',             params_schema: [], waitlist_only: true },
  satispay:           { connector_type: 'satispay',           params_schema: [], waitlist_only: true },
  nexi:               { connector_type: 'nexi',               params_schema: [], waitlist_only: true },
  salesforce:         { connector_type: 'salesforce',         params_schema: [], waitlist_only: true },
  hubspot:            { connector_type: 'hubspot',            params_schema: [], waitlist_only: true },
  teamsystem:         { connector_type: 'teamsystem',         params_schema: [], waitlist_only: true },
  zucchetti:          { connector_type: 'zucchetti',          params_schema: [], waitlist_only: true },
  'sap-b1':           { connector_type: 'sap_b1',            params_schema: [], waitlist_only: true },
  odoo:               { connector_type: 'odoo',               params_schema: [], waitlist_only: true },
  'fatture-in-cloud': { connector_type: 'fatture_in_cloud',  params_schema: [], waitlist_only: true },
  'aruba-fe':         { connector_type: 'aruba_fe',          params_schema: [], waitlist_only: true },
  'danea-easyfatt':   { connector_type: 'danea_easyfatt',    params_schema: [], waitlist_only: true },
  sdi:                { connector_type: 'sdi',                params_schema: [], waitlist_only: true },
  'agenzia-entrate':  { connector_type: 'agenzia_entrate',   params_schema: [], waitlist_only: true },
}

export function getConnectorBackendDef(connectorId: string): ConnectorBackendDef {
  return CONNECTOR_BACKEND_MAP[connectorId] ?? {
    connector_type: connectorId.replace(/-/g, '_'),
    params_schema: [
      { key: 'path', label: 'File path or URL', type: 'text', placeholder: '/data/export.csv', required: true },
      { key: 'table_name', label: 'Table name in DuckDB', type: 'text', placeholder: 'imported_data', required: true },
    ],
  }
}
