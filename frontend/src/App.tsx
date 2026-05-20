import { useState } from 'react'
import Layout from './components/Layout'
import OverviewScreen from './components/OverviewScreen'
import Dashboard from './components/Dashboard'
import OntologyGraph from './components/OntologyGraph'
import OntologyBuilder from './components/OntologyBuilder'
import QueryInterface from './components/QueryInterface'
import MappingView from './components/MappingView'
import ProcessView from './components/ProcessView'
import ConfigurationView from './components/ConfigurationView'
import AgentsView from './components/AgentsView'
import type { NavTab } from './types'

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview')

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'overview' && <OverviewScreen onNavigate={setActiveTab} />}
      {activeTab === 'dashboard' && <Dashboard />}
      {activeTab === 'ontology' && <OntologyGraph />}
      {activeTab === 'builder' && <OntologyBuilder />}
      {activeTab === 'agents' && <AgentsView />}
      {activeTab === 'query' && <QueryInterface />}
      {activeTab === 'mappings' && <MappingView />}
      {activeTab === 'process' && <ProcessView />}
      {activeTab === 'config' && <ConfigurationView />}
    </Layout>
  )
}
