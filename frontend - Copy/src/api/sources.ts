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
  shopify: {
    connector_type: 'shopify',
    params_schema: [
      { key: 'shop_url', label: 'Shop URL', type: 'url', placeholder: 'https://your-store.myshopify.com', required: true },
      { key: 'api_key', label: 'Admin API access token', type: 'password', placeholder: 'shpat_...', required: true },
    ],
  },
  woocommerce: {
    connector_type: 'woocommerce',
    params_schema: [
      { key: 'url', label: 'Store URL', type: 'url', placeholder: 'https://yourstore.com', required: true },
      { key: 'consumer_key', label: 'Consumer key', type: 'text', placeholder: 'ck_...', required: true },
      { key: 'consumer_secret', label: 'Consumer secret', type: 'password', placeholder: 'cs_...', required: true },
    ],
  },
  magento: {
    connector_type: 'magento',
    params_schema: [
      { key: 'base_url', label: 'Store URL', type: 'url', placeholder: 'https://yourstore.com', required: true },
      { key: 'access_token', label: 'Integration access token', type: 'password', placeholder: '...', required: true },
    ],
  },
  stripe: {
    connector_type: 'stripe',
    params_schema: [
      { key: 'api_key', label: 'Secret key', type: 'password', placeholder: 'sk_live_...', required: true },
    ],
  },
  satispay: {
    connector_type: 'satispay',
    params_schema: [
      { key: 'key_id', label: 'Key ID', type: 'text', placeholder: 'your-key-id', required: true },
      { key: 'private_key', label: 'Private key (PEM)', type: 'password', placeholder: '-----BEGIN...', required: true },
    ],
  },
  nexi: {
    connector_type: 'nexi',
    params_schema: [
      { key: 'api_key', label: 'API key', type: 'password', placeholder: '...', required: true },
    ],
  },
  salesforce: {
    connector_type: 'salesforce',
    params_schema: [
      { key: 'instance_url', label: 'Instance URL', type: 'url', placeholder: 'https://yourorg.salesforce.com', required: true },
      { key: 'access_token', label: 'Access token', type: 'password', placeholder: '00D...', required: true },
    ],
  },
  hubspot: {
    connector_type: 'hubspot',
    params_schema: [
      { key: 'api_key', label: 'Private app token', type: 'password', placeholder: 'pat-na1-...', required: true },
    ],
  },
  teamsystem: {
    connector_type: 'teamsystem',
    params_schema: [
      { key: 'api_url', label: 'API endpoint', type: 'url', placeholder: 'https://api.teamsystem.com', required: true },
      { key: 'api_key', label: 'API key', type: 'password', placeholder: '...', required: true },
    ],
  },
  zucchetti: {
    connector_type: 'zucchetti',
    params_schema: [
      { key: 'api_url', label: 'API endpoint', type: 'url', placeholder: 'https://api.zucchetti.it', required: true },
      { key: 'api_key', label: 'API key', type: 'password', placeholder: '...', required: true },
    ],
  },
  'sap-b1': {
    connector_type: 'sap_b1',
    params_schema: [
      { key: 'service_layer_url', label: 'Service Layer URL', type: 'url', placeholder: 'https://sap-server:50000/b1s/v1', required: true },
      { key: 'username', label: 'Username', type: 'text', placeholder: 'manager', required: true },
      { key: 'password', label: 'Password', type: 'password', placeholder: '', required: true },
      { key: 'company_db', label: 'Company DB', type: 'text', placeholder: 'SBODEMOIT', required: true },
    ],
  },
  odoo: {
    connector_type: 'odoo',
    params_schema: [
      { key: 'url', label: 'Odoo URL', type: 'url', placeholder: 'https://yourinstance.odoo.com', required: true },
      { key: 'db', label: 'Database', type: 'text', placeholder: 'mycompany', required: true },
      { key: 'api_key', label: 'API key', type: 'password', placeholder: '...', required: true },
    ],
  },
  'fatture-in-cloud': {
    connector_type: 'fatture_in_cloud',
    params_schema: [
      { key: 'access_token', label: 'Access token', type: 'password', placeholder: '...', required: true },
      { key: 'company_id', label: 'Company ID', type: 'text', placeholder: '12345', required: true },
    ],
  },
  'aruba-fe': {
    connector_type: 'aruba_fe',
    params_schema: [
      { key: 'username', label: 'Username', type: 'text', placeholder: 'user@company.it', required: true },
      { key: 'api_key', label: 'API key', type: 'password', placeholder: '...', required: true },
    ],
  },
  'danea-easyfatt': {
    connector_type: 'danea_easyfatt',
    params_schema: [
      { key: 'path', label: 'Danea XML/CSV export path', type: 'text', placeholder: '/data/danea_export.csv', required: true },
      { key: 'table_name', label: 'Table name', type: 'text', placeholder: 'danea_data', required: false },
    ],
  },
  prestashop: {
    connector_type: 'prestashop',
    params_schema: [
      { key: 'url', label: 'Store URL', type: 'url', placeholder: 'https://yourstore.com', required: true },
      { key: 'api_key', label: 'API key', type: 'password', placeholder: '...', required: true },
    ],
  },
  sdi: {
    connector_type: 'sdi',
    params_schema: [
      { key: 'path', label: 'XML invoices folder', type: 'text', placeholder: '/data/fatture_sdi', required: true, hint: 'Folder containing SDI XML files (.xml or .zip)' },
      { key: 'table_name', label: 'Table name in DuckDB', type: 'text', placeholder: 'sdi_invoices', required: false },
    ],
  },
  'agenzia-entrate': {
    connector_type: 'agenzia_entrate',
    params_schema: [
      { key: 'credentials_path', label: 'Credentials file path', type: 'text', placeholder: '/data/ae_credentials.json', required: true },
    ],
  },
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
