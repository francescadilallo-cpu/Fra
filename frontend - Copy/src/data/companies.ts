import type { SectorId } from './sectors'

export interface Company {
  id: string
  name: string
  sectorId: SectorId
  createdAt: string
  lastAccessedAt: string
}

const COMPANIES_KEY = 'si-companies'
const CURRENT_KEY = 'si-current-company-id'
const ARCHIVE_KEY = (id: string) => `si-company-${id}-archive`

// Storage keys that represent per-company data (keyed internally by sector).
// When switching companies, we snapshot all of these into the archive.
const DATA_PREFIXES = [
  'custom-agents-',
  'ontology-builder-ext-',
  'connected-sources-',
  'agent-runs-',
  'pipeline-last-run-',
]

// Per-company UI state (not sector-prefixed)
const COMPANY_UI_KEYS = ['si-company-name', 'si-welcome-banner-dismissed']

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40)
}

export function listCompanies(): Company[] {
  try {
    const raw = localStorage.getItem(COMPANIES_KEY)
    return raw ? (JSON.parse(raw) as Company[]) : []
  } catch { return [] }
}

function saveCompanies(list: Company[]) {
  localStorage.setItem(COMPANIES_KEY, JSON.stringify(list))
}

export function getCurrentCompanyId(): string | null {
  return localStorage.getItem(CURRENT_KEY)
}

export function getCurrentCompany(): Company | null {
  const id = getCurrentCompanyId()
  if (!id) return null
  return listCompanies().find(c => c.id === id) ?? null
}

function snapshotLiveData(): Record<string, string> {
  const snapshot: Record<string, string> = {}
  Object.keys(localStorage).forEach(k => {
    const isData = DATA_PREFIXES.some(p => k.startsWith(p))
    const isUI = COMPANY_UI_KEYS.includes(k)
    if (isData || isUI) {
      const v = localStorage.getItem(k)
      if (v !== null) snapshot[k] = v
    }
  })
  return snapshot
}

function clearLiveData() {
  const toRemove: string[] = []
  Object.keys(localStorage).forEach(k => {
    const isData = DATA_PREFIXES.some(p => k.startsWith(p))
    const isUI = COMPANY_UI_KEYS.includes(k)
    if (isData || isUI) toRemove.push(k)
  })
  toRemove.forEach(k => localStorage.removeItem(k))
}

function restoreFromSnapshot(snapshot: Record<string, string>) {
  Object.entries(snapshot).forEach(([k, v]) => localStorage.setItem(k, v))
}

function archiveCurrent() {
  const id = getCurrentCompanyId()
  if (!id) return
  const snapshot = snapshotLiveData()
  localStorage.setItem(ARCHIVE_KEY(id), JSON.stringify(snapshot))
  const list = listCompanies()
  saveCompanies(list.map(c => c.id === id ? { ...c, lastAccessedAt: new Date().toISOString() } : c))
}

export function switchToCompany(id: string) {
  archiveCurrent()
  clearLiveData()
  try {
    const archiveRaw = localStorage.getItem(ARCHIVE_KEY(id))
    if (archiveRaw) restoreFromSnapshot(JSON.parse(archiveRaw) as Record<string, string>)
  } catch { /* ignore */ }
  const company = listCompanies().find(c => c.id === id)
  if (!company) return
  localStorage.setItem(CURRENT_KEY, id)
  saveCompanies(listCompanies().map(c => c.id === id ? { ...c, lastAccessedAt: new Date().toISOString() } : c))
}

export function createCompany(name: string, sectorId: SectorId): Company {
  archiveCurrent()
  clearLiveData()
  const baseSlug = slugify(name) || 'azienda'
  const id = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`
  const company: Company = {
    id,
    name,
    sectorId,
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
  }
  saveCompanies([...listCompanies(), company])
  localStorage.setItem(CURRENT_KEY, id)
  localStorage.setItem('si-company-name', name)
  return company
}

export function deleteCompany(id: string) {
  const list = listCompanies()
  saveCompanies(list.filter(c => c.id !== id))
  localStorage.removeItem(ARCHIVE_KEY(id))
  if (getCurrentCompanyId() === id) {
    localStorage.removeItem(CURRENT_KEY)
    clearLiveData()
  }
}

// Logout: archive the current company's data, then clear live state so the
// next login starts at the onboarding wizard. Previously-saved companies
// remain accessible via switchToCompany() from the dropdown after a new
// company is set up.
export function logoutCurrent() {
  archiveCurrent()
  clearLiveData()
  localStorage.removeItem(CURRENT_KEY)
}

// Auto-register a pre-existing company (for users who had a setup before this feature shipped).
export function migrateExistingCompany(sectorId: SectorId) {
  const name = localStorage.getItem('si-company-name')
  const currentId = getCurrentCompanyId()
  if (!name || currentId) return
  const existing = listCompanies()
  if (existing.length > 0) {
    // Companies list exists but no current — pick the first one
    localStorage.setItem(CURRENT_KEY, existing[0].id)
    return
  }
  const id = `${slugify(name) || 'azienda'}-legacy`
  const company: Company = {
    id,
    name,
    sectorId,
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
  }
  saveCompanies([company])
  localStorage.setItem(CURRENT_KEY, id)
}
