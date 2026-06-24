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
  /** True for connectors that use OAuth2 Authorization Code + PKCE (e.g. Salesforce).
   *  The credential modal shows a popup-based auth flow instead of a credential form. */
  oauth_pkce?: boolean
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
      { key: 'path', label: 'Google Sheets URL', type: 'url', placeholder: 'https://docs.google.com/spreadsheets/d/…/edit', required: true, hint: 'Paste the sharing URL — sharing/edit links are auto-converted to CSV export' },
      { key: 'table_name', label: 'Table name', type: 'text', placeholder: 'my_sheet', required: true },
    ],
  },
  airtable: {
    connector_type: 'csv',
    params_schema: [
      { key: 'path', label: 'CSV export file path', type: 'text', placeholder: '/data/airtable_export.csv', required: true },
      { key: 'table_name', label: 'Table name', type: 'text', placeholder: 'airtable_records', required: true },
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
      { key: 'table_name', label: 'Table name', type: 'text', placeholder: 'excel_data', required: true },
      { key: 'sheet', label: 'Sheet name (default: first sheet)', type: 'text', placeholder: 'Sheet1', required: false },
    ],
  },
  'parquet-file': {
    connector_type: 'parquet',
    params_schema: [
      { key: 'path', label: 'Parquet file path', type: 'text', placeholder: '/data/events.parquet', required: true },
      { key: 'table_name', label: 'Table name', type: 'text', placeholder: 'parquet_data', required: true },
    ],
  },
  'json-file': {
    connector_type: 'json',
    params_schema: [
      { key: 'path', label: 'JSON file path', type: 'text', placeholder: '/data/records.json', required: true, hint: 'Top-level array or NDJSON supported' },
      { key: 'table_name', label: 'Table name', type: 'text', placeholder: 'json_data', required: true },
    ],
  },
  shopify:            { connector_type: 'shopify',            params_schema: [], waitlist_only: true },
  woocommerce:        { connector_type: 'woocommerce',        params_schema: [], waitlist_only: true },
  magento:            { connector_type: 'magento',            params_schema: [], waitlist_only: true },
  prestashop:         { connector_type: 'prestashop',         params_schema: [], waitlist_only: true },
  stripe:             { connector_type: 'stripe',             params_schema: [], waitlist_only: true },
  satispay:           { connector_type: 'satispay',           params_schema: [], waitlist_only: true },
  nexi:               { connector_type: 'nexi',               params_schema: [], waitlist_only: true },
  salesforce: {
    connector_type: 'salesforce',
    oauth_pkce: true,
    params_schema: [
      {
        key: 'instance_url',
        label: 'Instance URL',
        type: 'url',
        placeholder: 'https://mycompany.my.salesforce.com',
        required: true,
        hint: 'Your Salesforce org URL — with or without https://',
      },
      {
        key: 'client_id',
        label: 'Consumer Key (Client ID)',
        type: 'text',
        placeholder: 'Paste your Connected App Consumer Key',
        required: true,
        hint: 'Found in Setup → Apps → App Manager → your Connected App',
      },
      {
        key: 'client_secret',
        label: 'Consumer Secret (Client Secret)',
        type: 'password',
        placeholder: 'Paste your Connected App Consumer Secret',
        required: true,
        hint: 'Set Callback URL in Connected App to the backend /api/salesforce/auth/callback URL',
      },
    ],
  },
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

// ── Salesforce schema API ─────────────────────────────────────────────────────

export interface SalesforceField {
  name: string
  label: string
  type: string
  is_required: boolean
  is_relation: boolean
  relation_to: string | null
}

export interface SalesforceObject {
  name: string
  label: string
  field_count: number
  is_custom: boolean
  key_prefix: string | null
  fields: SalesforceField[]
}

export interface SalesforceSchema {
  instance_url: string
  org_id: string
  api_version: string
  object_count: number
  objects: SalesforceObject[]
  fetched_at: string
}

export async function startSalesforceAuth(params: {
  instance_url: string
  client_id: string
  client_secret: string
  label?: string
}): Promise<{ auth_url: string; state: string; source_id: string }> {
  const res = await api.get<{ auth_url: string; state: string; source_id: string }>(
    '/api/salesforce/auth/start',
    { params },
  )
  return res.data
}

export async function getSalesforceSchema(sourceId: string): Promise<SalesforceSchema> {
  const res = await api.get<SalesforceSchema>(`/api/salesforce/schema/${encodeURIComponent(sourceId)}`)
  return res.data
}

export async function refreshSalesforceSchema(sourceId: string): Promise<SalesforceSchema> {
  const res = await api.post<SalesforceSchema>(`/api/salesforce/schema/${encodeURIComponent(sourceId)}/refresh`)
  return res.data
}

// ── Salesforce profile API ────────────────────────────────────────────────────

export interface SalesforceFieldProfile {
  field_name: string
  field_label: string
  field_type: string
  is_relation: boolean
  populated_count: number
  total_count: number
  null_rate: number        // 0.0–1.0
  distinct_count: number
  top_values: string[]
}

export interface SalesforceObjectProfile {
  object_name: string
  object_label: string
  sample_size: number
  fields_profiled: number
  field_profiles: SalesforceFieldProfile[]
  profiled_at: string
}

export interface SalesforceSchemaProfile {
  source_id: string
  sample_size_requested: number
  objects_profiled: number
  object_profiles: SalesforceObjectProfile[]
  profiled_at: string
}

export async function getSalesforceProfile(sourceId: string): Promise<SalesforceSchemaProfile> {
  const res = await api.get<SalesforceSchemaProfile>(`/api/salesforce/profile/${encodeURIComponent(sourceId)}`)
  return res.data
}

export async function runSalesforceProfile(sourceId: string, sampleSize = 500): Promise<SalesforceSchemaProfile> {
  const res = await api.post<SalesforceSchemaProfile>(
    `/api/salesforce/profile/${encodeURIComponent(sourceId)}?sample_size=${sampleSize}`,
  )
  return res.data
}

export function getConnectorBackendDef(connectorId: string): ConnectorBackendDef {
  return CONNECTOR_BACKEND_MAP[connectorId] ?? {
    connector_type: connectorId.replace(/-/g, '_'),
    params_schema: [
      { key: 'path', label: 'File path or URL', type: 'text', placeholder: '/data/export.csv', required: true },
      { key: 'table_name', label: 'Table name', type: 'text', placeholder: 'imported_data', required: true },
    ],
  }
}
