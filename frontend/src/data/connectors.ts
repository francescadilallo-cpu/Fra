import { useEffect, useState } from 'react'
import type { SectorId } from './sectors'
import { modeScopedSector } from '../lib/demoMode'

export type ConnectorCategory = 'erp' | 'accounting' | 'ecommerce' | 'crm' | 'payments' | 'database' | 'cloud' | 'logistics' | 'fiscal'
export type ConnectorStatus = 'available' | 'beta' | 'coming-soon'

export interface ConnectorDef {
  id: string
  name: string
  logo: string         // single char or emoji
  bg: string           // tailwind bg class
  fg: string           // tailwind text class
  category: ConnectorCategory
  description: string
  status: ConnectorStatus
  popular?: boolean
  italian?: boolean
}

export const CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  erp:        'ERP',
  accounting: 'Invoicing',
  ecommerce:  'E-commerce',
  crm:        'CRM',
  payments:   'Payments',
  database:   'Database',
  cloud:      'Cloud / File',
  logistics:  'Logistics',
  fiscal:     'Fiscal / SDI',
}

export const CONNECTORS: ConnectorDef[] = [
  // ── ERP italiani ───────────────────────────────────────────────────────────
  { id: 'teamsystem',       name: 'TeamSystem',       logo: 'T',  bg: 'bg-blue-600',   fg: 'text-white', category: 'erp',        description: 'Leading Italian ERP for SMBs',          status: 'available', popular: true, italian: true },
  { id: 'zucchetti',        name: 'Zucchetti',        logo: 'Z',  bg: 'bg-red-600',    fg: 'text-white', category: 'erp',        description: 'Integrated management solutions',        status: 'available', italian: true },
  { id: 'sap-b1',           name: 'SAP Business One', logo: 'S',  bg: 'bg-sky-700',    fg: 'text-white', category: 'erp',        description: 'ERP for mid-size companies',             status: 'available' },
  { id: 'odoo',             name: 'Odoo',             logo: 'O',  bg: 'bg-violet-600', fg: 'text-white', category: 'erp',        description: 'Modular open-source ERP',                status: 'available' },

  // ── Invoicing ─────────────────────────────────────────────────────────────
  { id: 'fatture-in-cloud', name: 'Fatture in Cloud', logo: '☁',  bg: 'bg-sky-100',    fg: 'text-sky-700',  category: 'accounting', description: 'SaaS electronic invoicing',              status: 'available', popular: true, italian: true },
  { id: 'aruba-fe',         name: 'Aruba Fatturazione', logo: 'A', bg: 'bg-orange-500', fg: 'text-white', category: 'accounting', description: 'B2B/B2C electronic invoicing',           status: 'available', italian: true },
  { id: 'danea-easyfatt',   name: 'Danea EasyFatt',   logo: 'D',  bg: 'bg-emerald-600', fg: 'text-white',category: 'accounting', description: 'Management software for small businesses', status: 'available', italian: true },

  // ── E-commerce ─────────────────────────────────────────────────────────────
  { id: 'shopify',          name: 'Shopify',          logo: '🛒', bg: 'bg-green-100',  fg: 'text-green-700', category: 'ecommerce', description: 'SaaS e-commerce platform',             status: 'available', popular: true },
  { id: 'woocommerce',      name: 'WooCommerce',      logo: 'W',  bg: 'bg-purple-600', fg: 'text-white', category: 'ecommerce',   description: 'E-commerce plugin for WordPress',       status: 'available' },
  { id: 'magento',          name: 'Magento',          logo: 'M',  bg: 'bg-orange-600', fg: 'text-white', category: 'ecommerce',   description: 'Enterprise e-commerce platform',        status: 'available' },
  { id: 'prestashop',       name: 'PrestaShop',       logo: 'P',  bg: 'bg-fuchsia-500',fg: 'text-white', category: 'ecommerce',   description: 'Open-source e-commerce CMS',            status: 'beta' },

  // ── Payments ──────────────────────────────────────────────────────────────
  { id: 'stripe',           name: 'Stripe',           logo: 'S',  bg: 'bg-violet-500', fg: 'text-white', category: 'payments',    description: 'Global online payments',                status: 'available', popular: true },
  { id: 'satispay',         name: 'Satispay',         logo: '€',  bg: 'bg-red-500',    fg: 'text-white', category: 'payments',    description: 'Italian mobile payments',               status: 'available', italian: true },
  { id: 'nexi',             name: 'Nexi',             logo: 'N',  bg: 'bg-slate-800',  fg: 'text-white', category: 'payments',    description: 'Acquiring & POS',                       status: 'available', italian: true },

  // ── CRM ────────────────────────────────────────────────────────────────────
  { id: 'salesforce',       name: 'Salesforce',       logo: 'SF', bg: 'bg-sky-500',    fg: 'text-white', category: 'crm',         description: 'Enterprise CRM',                        status: 'available' },
  { id: 'hubspot',          name: 'HubSpot',          logo: 'H',  bg: 'bg-orange-500', fg: 'text-white', category: 'crm',         description: 'CRM, marketing & sales',                status: 'available' },

  // ── Database ───────────────────────────────────────────────────────────────
  { id: 'postgresql',       name: 'PostgreSQL',       logo: 'Pg', bg: 'bg-blue-800',   fg: 'text-white', category: 'database',    description: 'Open-source relational database',       status: 'available' },
  { id: 'mysql',            name: 'MySQL',            logo: 'My', bg: 'bg-amber-600',  fg: 'text-white', category: 'database',    description: 'Popular relational database',            status: 'available' },
  { id: 'sqlite-file',      name: 'SQLite File',      logo: '🗄', bg: 'bg-slate-600',  fg: 'text-white', category: 'database',    description: 'Embed SQLite database file (.db / .sqlite)', status: 'available' },

  // ── Cloud / File ───────────────────────────────────────────────────────────
  { id: 'google-sheets',    name: 'Google Sheets',    logo: '📊', bg: 'bg-green-50',   fg: 'text-green-700', category: 'cloud',  description: 'Cloud spreadsheets',                    status: 'available' },
  { id: 'airtable',         name: 'Airtable',         logo: 'A',  bg: 'bg-yellow-400', fg: 'text-slate-900', category: 'cloud', description: 'Hybrid database + spreadsheet',          status: 'beta' },
  { id: 'excel-file',       name: 'Excel File',       logo: '📗', bg: 'bg-emerald-600',fg: 'text-white', category: 'cloud',      description: 'Import .xlsx / .xls workbooks',         status: 'available' },
  { id: 'parquet-file',     name: 'Parquet File',     logo: '▤',  bg: 'bg-indigo-600', fg: 'text-white', category: 'cloud',      description: 'Column-oriented analytics data format', status: 'available' },
  { id: 'json-file',        name: 'JSON File',        logo: '{}', bg: 'bg-amber-500',  fg: 'text-white', category: 'cloud',      description: 'JSON / NDJSON records from file or URL', status: 'available' },

  // ── Logistics ──────────────────────────────────────────────────────────────
  { id: 'brt',              name: 'BRT',              logo: 'B',  bg: 'bg-yellow-500', fg: 'text-slate-900', category: 'logistics', description: 'Italian express courier',             status: 'coming-soon', italian: true },
  { id: 'gls-italy',        name: 'GLS Italy',        logo: 'G',  bg: 'bg-blue-500',   fg: 'text-white', category: 'logistics',   description: 'Shipping & tracking',                   status: 'coming-soon', italian: true },

  // ── Fiscal / SDI ──────────────────────────────────────────────────────────
  { id: 'sdi',              name: 'SDI (E-Invoicing)', logo: '📄', bg: 'bg-green-700', fg: 'text-white', category: 'fiscal', description: 'Interchange System — mandatory e-invoicing in Italy', status: 'available', popular: true, italian: true },
  { id: 'agenzia-entrate',  name: 'Agenzia delle Entrate', logo: 'AE', bg: 'bg-slate-700', fg: 'text-white', category: 'fiscal', description: 'Tax returns, F24, fiscal drawer',       status: 'beta', italian: true },
  { id: 'inps',             name: 'INPS',             logo: 'IN', bg: 'bg-sky-700',    fg: 'text-white', category: 'fiscal',      description: 'Social contributions, CU, UNIEMENS',    status: 'coming-soon', italian: true },
]

// ── Connected sources persistence ────────────────────────────────────────────

export interface ConnectedSource {
  connectorId: string
  connectedAt: string  // ISO
  lastSyncAt: string   // ISO
  rowCount: number
}

const SOURCES_KEY = (sectorId: string) => `connected-sources-${modeScopedSector(sectorId)}`
const SOURCES_EVENT = 'connected-sources-changed'

export function loadConnectedSources(sectorId: string): ConnectedSource[] {
  try {
    const raw = localStorage.getItem(SOURCES_KEY(sectorId))
    return raw ? (JSON.parse(raw) as ConnectedSource[]) : []
  } catch { return [] }
}

export function saveConnectedSources(sectorId: string, sources: ConnectedSource[]) {
  localStorage.setItem(SOURCES_KEY(sectorId), JSON.stringify(sources))
  window.dispatchEvent(new CustomEvent(SOURCES_EVENT, { detail: { sectorId } }))
}

export function useConnectedSources(sectorId: SectorId): [ConnectedSource[], (next: ConnectedSource[]) => void] {
  const [sources, setSources] = useState<ConnectedSource[]>(() => loadConnectedSources(sectorId))

  useEffect(() => {
    setSources(loadConnectedSources(sectorId))
    const refresh = () => setSources(loadConnectedSources(sectorId))
    window.addEventListener(SOURCES_EVENT, refresh)
    const onStorage = (e: StorageEvent) => { if (e.key === SOURCES_KEY(sectorId)) refresh() }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(SOURCES_EVENT, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [sectorId])

  const update = (next: ConnectedSource[]) => {
    saveConnectedSources(sectorId, next)
    setSources(next)
  }

  return [sources, update]
}
