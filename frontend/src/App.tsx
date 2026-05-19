import { useState } from 'react'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import OntologyGraph from './components/OntologyGraph'
import QueryInterface from './components/QueryInterface'
import MappingView from './components/MappingView'
import ProcessView from './components/ProcessView'
import type { NavTab } from './types'

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard')

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'dashboard' && <Dashboard />}
      {activeTab === 'ontology' && <OntologyGraph />}
      {activeTab === 'query' && <QueryInterface />}
      {activeTab === 'mappings' && <MappingView />}
      {activeTab === 'process' && <ProcessView />}
    </Layout>
  )
}
