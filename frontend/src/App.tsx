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
import OnboardingWizard from './components/OnboardingWizard'
import type { NavTab } from './types'
import { useSector } from './contexts/SectorContext'
import type { SectorId } from './data/sectors'

const ONBOARDING_KEY = 'si-onboarding-done'

export default function App() {
  const [granted, setGranted] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1')
  const [activeTab, setActiveTab] = useState<NavTab>('overview')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const { setSector } = useSector()

  // Show onboarding on first login (after access gate, before main UI)
  useEffect(() => {
    if (granted && !localStorage.getItem(ONBOARDING_KEY)) {
      setShowOnboarding(true)
    }
  }, [granted])

  // Navigate to agents tab when OntologyBuilder triggers "Create Agent"
  useEffect(() => {
    const handler = (e: Event) => {
      const entity = (e as CustomEvent<{ entity: string }>).detail?.entity
      if (entity) sessionStorage.setItem('agent-builder-prefill', entity)
      setActiveTab('agents')
    }
    window.addEventListener('create-agent-from-entity', handler)
    return () => window.removeEventListener('create-agent-from-entity', handler)
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
          onComplete={(companyName: string, sectorId: SectorId) => {
            localStorage.setItem(ONBOARDING_KEY, '1')
            setSector(sectorId)
            setShowOnboarding(false)
            // Store company name for later use
            localStorage.setItem('si-company-name', companyName)
            setActiveTab('overview')
          }}
          onSkip={() => {
            localStorage.setItem(ONBOARDING_KEY, '1')
            setShowOnboarding(false)
          }}
        />
      )}
      <Layout activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'overview' && <OverviewScreen onNavigate={setActiveTab} />}
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
