/**
 * Source Plan — persists the inventory & prioritization from the onboarding
 * wizard (Step 2) so DataSourcesView can surface planned-but-not-yet-connected
 * sources as a guided roadmap.
 */
import type { SectorId } from './sectors'

export type PlanPriority = 'high' | 'medium' | 'low'

export interface SourcePlanEntry {
  connectorId: string   // matches ConnectorDef.id / BackendSource.connector_type
  name: string
  category: string
  priority: PlanPriority
  useCases: string[]
}

const PLAN_KEY = 'si-source-plan'

export function loadSourcePlan(): SourcePlanEntry[] {
  try {
    const raw = localStorage.getItem(PLAN_KEY)
    return raw ? (JSON.parse(raw) as SourcePlanEntry[]) : []
  } catch {
    return []
  }
}

export function saveSourcePlan(plan: SourcePlanEntry[]): void {
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(plan))
  } catch { /* quota */ }
  window.dispatchEvent(new CustomEvent('source-plan-updated'))
}

export const SECTOR_USE_CASES: Record<SectorId, string[]> = {
  manufacturing: ['Sales Analytics', 'Production KPIs', 'Supply Chain', 'HR & Payroll', 'Customer Analytics'],
  retail: ['Sales & Revenue', 'Customer 360', 'Inventory Management', 'Marketing ROI', 'Operations'],
  healthcare: ['Patient Analytics', 'Clinical Ops', 'Revenue Cycle', 'Compliance', 'HR'],
  finance: ['Portfolio Analytics', 'Risk & Compliance', 'KYC / AML', 'Revenue Analytics', 'Client 360'],
}

export const SECTOR_SOURCE_SUGGESTIONS: Record<SectorId, SourcePlanEntry[]> = {
  manufacturing: [
    { connectorId: 'teamsystem',       name: 'TeamSystem',         category: 'ERP',        priority: 'high',   useCases: ['Sales Analytics', 'HR & Payroll'] },
    { connectorId: 'zucchetti',        name: 'Zucchetti',          category: 'ERP',        priority: 'high',   useCases: ['Sales Analytics', 'HR & Payroll'] },
    { connectorId: 'sap-b1',           name: 'SAP Business One',   category: 'ERP',        priority: 'high',   useCases: ['Sales Analytics', 'Production KPIs'] },
    { connectorId: 'salesforce',       name: 'Salesforce',         category: 'CRM',        priority: 'high',   useCases: ['Sales Analytics', 'Customer Analytics'] },
    { connectorId: 'hubspot',          name: 'HubSpot',            category: 'CRM',        priority: 'medium', useCases: ['Sales Analytics', 'Customer Analytics'] },
    { connectorId: 'postgresql',       name: 'PostgreSQL',         category: 'Database',   priority: 'medium', useCases: ['Production KPIs', 'Supply Chain'] },
    { connectorId: 'fatture-in-cloud', name: 'Fatture in Cloud',   category: 'Invoicing',  priority: 'medium', useCases: ['Sales Analytics'] },
    { connectorId: 'excel-file',       name: 'Excel / CSV',        category: 'File',       priority: 'low',    useCases: ['HR & Payroll', 'Supply Chain'] },
    { connectorId: 'google-sheets',    name: 'Google Sheets',      category: 'File',       priority: 'low',    useCases: ['HR & Payroll', 'Production KPIs'] },
  ],
  retail: [
    { connectorId: 'shopify',          name: 'Shopify',            category: 'E-commerce', priority: 'high',   useCases: ['Sales & Revenue', 'Customer 360', 'Inventory Management'] },
    { connectorId: 'woocommerce',      name: 'WooCommerce',        category: 'E-commerce', priority: 'high',   useCases: ['Sales & Revenue', 'Customer 360'] },
    { connectorId: 'salesforce',       name: 'Salesforce',         category: 'CRM',        priority: 'high',   useCases: ['Customer 360', 'Sales & Revenue'] },
    { connectorId: 'hubspot',          name: 'HubSpot',            category: 'CRM',        priority: 'medium', useCases: ['Customer 360', 'Marketing ROI'] },
    { connectorId: 'stripe',           name: 'Stripe',             category: 'Payments',   priority: 'high',   useCases: ['Sales & Revenue', 'Customer 360'] },
    { connectorId: 'satispay',         name: 'Satispay',           category: 'Payments',   priority: 'medium', useCases: ['Sales & Revenue'] },
    { connectorId: 'fatture-in-cloud', name: 'Fatture in Cloud',   category: 'Invoicing',  priority: 'medium', useCases: ['Sales & Revenue'] },
    { connectorId: 'google-sheets',    name: 'Google Sheets',      category: 'File',       priority: 'low',    useCases: ['Inventory Management', 'Operations'] },
  ],
  healthcare: [
    { connectorId: 'postgresql',       name: 'PostgreSQL',         category: 'Database',   priority: 'high',   useCases: ['Patient Analytics', 'Clinical Ops'] },
    { connectorId: 'mysql',            name: 'MySQL',              category: 'Database',   priority: 'high',   useCases: ['Patient Analytics', 'Revenue Cycle'] },
    { connectorId: 'teamsystem',       name: 'TeamSystem',         category: 'ERP',        priority: 'high',   useCases: ['HR', 'Revenue Cycle'] },
    { connectorId: 'fatture-in-cloud', name: 'Fatture in Cloud',   category: 'Invoicing',  priority: 'high',   useCases: ['Revenue Cycle'] },
    { connectorId: 'google-sheets',    name: 'Google Sheets',      category: 'File',       priority: 'medium', useCases: ['HR', 'Compliance'] },
    { connectorId: 'excel-file',       name: 'Excel / CSV',        category: 'File',       priority: 'low',    useCases: ['Compliance', 'Clinical Ops'] },
  ],
  finance: [
    { connectorId: 'postgresql',       name: 'PostgreSQL',         category: 'Database',   priority: 'high',   useCases: ['Portfolio Analytics', 'Risk & Compliance'] },
    { connectorId: 'mysql',            name: 'MySQL',              category: 'Database',   priority: 'high',   useCases: ['Portfolio Analytics', 'Client 360'] },
    { connectorId: 'salesforce',       name: 'Salesforce',         category: 'CRM',        priority: 'high',   useCases: ['Client 360', 'Revenue Analytics'] },
    { connectorId: 'teamsystem',       name: 'TeamSystem',         category: 'ERP',        priority: 'medium', useCases: ['Revenue Analytics'] },
    { connectorId: 'stripe',           name: 'Stripe',             category: 'Payments',   priority: 'medium', useCases: ['Revenue Analytics'] },
    { connectorId: 'nexi',             name: 'Nexi',               category: 'Payments',   priority: 'medium', useCases: ['Revenue Analytics'] },
    { connectorId: 'excel-file',       name: 'Excel / CSV',        category: 'File',       priority: 'low',    useCases: ['Risk & Compliance', 'KYC / AML'] },
    { connectorId: 'google-sheets',    name: 'Google Sheets',      category: 'File',       priority: 'low',    useCases: ['Risk & Compliance'] },
  ],
}

export const PRIORITY_COLORS: Record<PlanPriority, { badge: string; dot: string }> = {
  high:   { badge: 'bg-red-50 text-red-700 border-red-200',    dot: 'bg-red-500' },
  medium: { badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  low:    { badge: 'bg-slate-50 text-slate-500 border-slate-200', dot: 'bg-slate-400' },
}
