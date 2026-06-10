import { useState, useEffect, lazy, Suspense } from 'react'
import Layout from './components/Layout'
import AccessGate, { SESSION_KEY } from './components/AccessGate'
import OverviewScreen from './components/OverviewScreen'
import Dashboard from './components/Dashboard'
import OnboardingWizard from './components/OnboardingWizard'
import type { NavTab } from './types'
import { useSector } from './contexts/SectorContext'
import type { SectorId } from './data/sectors'
import { loadExtension, saveExtension } from './data/ontologyExtensions'
import { createCompany, migrateExistingCompany, logoutCurrent } from './data/companies'
import { clearAuthToken, getAuthToken } from './api/client'
import { Toaster } from './components/Toast'
import { ConfirmProvider } from './components/ConfirmDialog'
import { ErrorBoundary } from './components/ErrorBoundary'

// Lazy-load heavy tabs to split the JS bundle and speed up initial paint
const OntologyGraph = lazy(() => import('./components/OntologyGraph'))
const OntologyBuilder = lazy(() => import('./components/OntologyBuilder'))
const QueryInterface = lazy(() => import('./components/QueryInterface'))
const ProcessView = lazy(() => import('./components/ProcessView'))
const ConfigurationView = lazy(() => import('./components/ConfigurationView'))
const AgentsView = lazy(() => import('./components/AgentsView'))
const DataExplorer = lazy(() => import('./components/DataExplorer'))
const DataSourcesView = lazy(() => import('./components/DataSourcesView'))
const ComplianceView = lazy(() => import('./components/ComplianceView'))
const UseCasesView = lazy(() => import('./components/UseCasesView'))
const SemanticLayerView = lazy(() => import('./components/SemanticLayerView'))
const ContextTab = lazy(() => import('./components/ContextTab'))

const ONBOARDING_KEY = 'si-onboarding-done'

function TabFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function normalizeEntityName(raw: string): string {
  const map: Record<string, string> = {
    stabilimento: 'Plant', stabilimenti: 'Plant',
    reparto: 'Department', reparti: 'Department',
    filiale: 'Branch', filiali: 'Branch',
    negozio: 'Shop', negozi: 'Shop',
    magazzino: 'Warehouse', magazzini: 'Warehouse',
    cliente: 'Customer', clienti: 'Customer',
    fornitore: 'Supplier', fornitori: 'Supplier',
    dipendente: 'Employee', dipendenti: 'Employee',
    progetto: 'Project', progetti: 'Project',
    contratto: 'Contract', contratti: 'Contract',
  }
  const lower = raw.toLowerCase().trim()
  if (map[lower]) return map[lower]
  return raw
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('')
    .replace(/[^A-Za-z0-9]/g, '')
}

function addCustomEntityToOntology(sectorId: SectorId, rawName: string) {
  const name = normalizeEntityName(rawName)
  if (!name || name.length < 2) return
  const ext = loadExtension(sectorId)
  if (ext.nodes.some(n => n.id === name)) return
  const prefix = sectorId === 'manufacturing' ? 'mfg' : sectorId === 'retail' ? 'rtl' : sectorId === 'healthcare' ? 'hc' : 'fin'
  ext.nodes.push({
    id: name,
    label: name,
    uri: `${prefix}:${name}`,
    properties: [
      { name: 'id', type: 'uuid', required: true, unique: true },
      { name: 'name', type: 'string', required: true },
      { name: 'code', type: 'string' },
      { name: 'createdAt', type: 'datetime' },
    ],
    position: { x: 1300, y: 350 },
    db_table: name.toLowerCase() + 's',
  })
  saveExtension(sectorId, ext)
}

export default function App() {
  const [granted, setGranted] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1' && Boolean(getAuthToken()))
  const [activeTab, setActiveTab] = useState<NavTab>('overview')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const { setSector, sectorId } = useSector()

  // Migrate any pre-existing company so it appears in the dropdown after upgrade
  useEffect(() => {
    if (granted) migrateExistingCompany(sectorId)
  }, [granted, sectorId])

  useEffect(() => {
    if (granted && !localStorage.getItem(ONBOARDING_KEY)) {
      setShowOnboarding(true)
    }
  }, [granted])

  useEffect(() => {
    const handler = (e: Event) => {
      const entity = (e as CustomEvent<{ entity: string }>).detail?.entity
      if (entity) sessionStorage.setItem('agent-builder-prefill', entity)
      setActiveTab('agents')
    }
    window.addEventListener('create-agent-from-entity', handler)
    return () => window.removeEventListener('create-agent-from-entity', handler)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const { question } = (e as CustomEvent<{ question: string }>).detail ?? {}
      if (question) sessionStorage.setItem('query-prefill', question)
      setActiveTab('query')
    }
    window.addEventListener('navigate-to-query', handler)
    return () => window.removeEventListener('navigate-to-query', handler)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const { tab } = (e as CustomEvent<{ tab: NavTab }>).detail ?? {}
      if (tab) setActiveTab(tab)
    }
    window.addEventListener('navigate-to-tab', handler)
    return () => window.removeEventListener('navigate-to-tab', handler)
  }, [])

  // Logout: archives the active company so all its data is preserved, then
  // clears the live state and onboarding flag. Re-entry triggers the wizard.
  // Previously-saved companies remain accessible via the dropdown after the
  // new one is configured.
  useEffect(() => {
    const onLogout = () => {
      logoutCurrent()
      localStorage.removeItem(ONBOARDING_KEY)
      sessionStorage.removeItem(SESSION_KEY)
      clearAuthToken()
      setGranted(false)
      setActiveTab('overview')
    }
    window.addEventListener('logout-requested', onLogout)
    return () => window.removeEventListener('logout-requested', onLogout)
  }, [])

  // "New company": triggers the onboarding wizard. The existing company is
  // archived by createCompany() in the wizard's onComplete handler.
  useEffect(() => {
    const onNewCompany = () => {
      localStorage.removeItem(ONBOARDING_KEY)
      setShowOnboarding(true)
    }
    window.addEventListener('new-company-requested', onNewCompany)
    return () => window.removeEventListener('new-company-requested', onNewCompany)
  }, [])

  // "Switch company": archives current, restores target, then reload to reset
  // all React state cleanly (sector context, hooks, etc.)
  useEffect(() => {
    const onSwitch = () => {
      window.location.reload()
    }
    window.addEventListener('company-switched', onSwitch)
    return () => window.removeEventListener('company-switched', onSwitch)
  }, [])

  if (!granted) {
    return (
      <AccessGate onGrant={() => {
        sessionStorage.setItem(SESSION_KEY, '1')
        // Full reload so all module-level constants (IS_DEMO_MODE, AGENTS, etc.)
        // are re-evaluated against the newly-stored JWT.
        window.location.reload()
      }} />
    )
  }

  return (
    <ErrorBoundary>
      <Toaster />
      <ConfirmProvider />
      {showOnboarding && (
        <OnboardingWizard
          onComplete={(companyName: string, newSectorId: SectorId, customEntity: string) => {
            createCompany(companyName, newSectorId)
            try { localStorage.setItem(ONBOARDING_KEY, '1') } catch { /* quota */ }
            if (customEntity) addCustomEntityToOntology(newSectorId, customEntity)
            setSector(newSectorId)
            setShowOnboarding(false)
            window.dispatchEvent(new CustomEvent('company-name-changed'))
            window.location.reload()
          }}
          onSkip={() => {
            try { localStorage.setItem(ONBOARDING_KEY, '1') } catch { /* quota */ }
            setShowOnboarding(false)
          }}
        />
      )}
      <Layout activeTab={activeTab} onTabChange={setActiveTab}>
        <Suspense fallback={<TabFallback />}>
          {activeTab === 'overview' && <OverviewScreen onNavigate={setActiveTab} />}
          {activeTab === 'usecases' && <UseCasesView onNavigate={setActiveTab} />}
          {activeTab === 'sembuilder' && <SemanticLayerView />}
          {activeTab === 'context' && <ContextTab />}
          {activeTab === 'dashboard' && <Dashboard onNavigate={setActiveTab} />}
          {activeTab === 'ontology' && <OntologyGraph />}
          {activeTab === 'builder' && <OntologyBuilder />}
          {activeTab === 'agents' && <AgentsView />}
          {activeTab === 'sources' && <DataSourcesView onNavigate={setActiveTab} />}
          {activeTab === 'data' && <DataExplorer />}
          {activeTab === 'query' && <QueryInterface />}
          {activeTab === 'process' && <ProcessView />}
          {activeTab === 'compliance' && <ComplianceView />}
          {activeTab === 'config' && <ConfigurationView />}
        </Suspense>
      </Layout>
    </ErrorBoundary>
  )
}
