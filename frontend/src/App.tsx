import { useState } from 'react'
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
import type { NavTab } from './types'

export default function App() {
  const [granted, setGranted] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1')
  const [activeTab, setActiveTab] = useState<NavTab>('overview')

  if (!granted) {
    return (
      <AccessGate onGrant={() => {
        sessionStorage.setItem(SESSION_KEY, '1')
        setGranted(true)
      }} />
    )
  }

  return (
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
      {activeTab === 'config' && <ConfigurationView />}
    </Layout>
  )
}
