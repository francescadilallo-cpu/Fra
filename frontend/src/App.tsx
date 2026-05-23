import { useState, useEffect } from 'react'
import Layout from './components/Layout'
import AccessGate, { SESSION_KEY } from './components/AccessGate'
import OverviewScreen from './components/OverviewScreen'
import Dashboard from './components/Dashboard'
import OntologyGraph from './components/OntologyGraph'
import OntologyBuilder from './components/OntologyBuilder'
import QueryInterface from './components/QueryInterface'
import MappingView from './components/MappingView'
import ProcessView from './components/ProcessView'
import ConfigurationView from './components/ConfigurationView'
import AgentsView from './components/AgentsView'
import DataExplorer from './components/DataExplorer'
import DataSourcesView from './components/DataSourcesView'
import ComplianceView from './components/ComplianceView'
import UseCasesView from './components/UseCasesView'
import OnboardingWizard from './components/OnboardingWizard'
import type { NavTab } from './types'
import { useSector } from './contexts/SectorContext'
import type { SectorId } from './data/sectors'
import { loadExtension, saveExtension } from './data/ontologyExtensions'
import { createCompany, migrateExistingCompany, logoutCurrent } from './data/companies'

const ONBOARDING_KEY = 'si-onboarding-done'

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
  const [granted, setGranted] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1')
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

  // Logout: archives the active company so all its data is preserved, then
  // clears the live state and onboarding flag. Re-entry triggers the wizard.
  // Previously-saved companies remain accessible via the dropdown after the
  // new one is configured.
  useEffect(() => {
    const onLogout = () => {
      logoutCurrent()
      localStorage.removeItem(ONBOARDING_KEY)
      sessionStorage.removeItem(SESSION_KEY)
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
        setGranted(true)
      }} />
    )
  }

  return (
    <>
      {showOnboarding && (
        <OnboardingWizard
          onComplete={(companyName: string, newSectorId: SectorId, customEntity: string) => {
            // createCompany archives the previous company's data and starts the new one with clean storage
            createCompany(companyName, newSectorId)
            localStorage.setItem(ONBOARDING_KEY, '1')
            if (customEntity) addCustomEntityToOntology(newSectorId, customEntity)
            setSector(newSectorId)
            setShowOnboarding(false)
            window.dispatchEvent(new CustomEvent('company-name-changed'))
            // Reload to ensure all React state (sector context, hooks) reads from the new company's storage
            window.location.reload()
          }}
          onSkip={() => {
            localStorage.setItem(ONBOARDING_KEY, '1')
            setShowOnboarding(false)
          }}
        />
      )}
      <Layout activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'overview' && <OverviewScreen onNavigate={setActiveTab} />}
        {activeTab === 'usecases' && <UseCasesView onNavigate={setActiveTab} />}
        {activeTab === 'dashboard' && <Dashboard onNavigate={setActiveTab} />}
        {activeTab === 'ontology' && <OntologyGraph />}
        {activeTab === 'builder' && <OntologyBuilder />}
        {activeTab === 'agents' && <AgentsView />}
        {activeTab === 'sources' && <DataSourcesView />}
        {activeTab === 'data' && <DataExplorer />}
        {activeTab === 'query' && <QueryInterface />}
        {activeTab === 'mappings' && <MappingView />}
        {activeTab === 'process' && <ProcessView />}
        {activeTab === 'compliance' && <ComplianceView />}
        {activeTab === 'config' && <ConfigurationView />}
      </Layout>
    </>
  )
}
