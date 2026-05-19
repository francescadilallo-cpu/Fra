import { useEffect, useState, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type NodeProps,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Loader2, AlertCircle, Database, X } from 'lucide-react'
import { fetchOntologyGraph } from '../api/client'
import type { OntologyGraphData, OntologyNodeData } from '../types'

// ── Custom node ────────────────────────────────────────────────────────────────

function OntologyClassNode({ data, selected }: NodeProps) {
  const d = data as unknown as OntologyNodeData
  return (
    <div
      className={`min-w-[160px] rounded-xl border transition-all bg-white ${
        selected
          ? 'border-teal-400 shadow-lg shadow-teal-500/20'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-teal-500 !border-0 !w-2.5 !h-2.5" />

      {/* Header */}
      <div className="px-3 py-2 bg-slate-50 rounded-t-xl border-b border-slate-200">
        <p className="text-sm font-bold text-slate-900">{d.label}</p>
        {d.db_table && (
          <div className="flex items-center gap-1 mt-0.5">
            <Database className="w-3 h-3 text-teal-600" />
            <span className="text-xs text-teal-600">{d.db_table}</span>
          </div>
        )}
      </div>

      {/* Properties */}
      <div className="px-3 py-2 space-y-0.5">
        {d.properties.slice(0, 5).map((p) => (
          <div key={p} className="text-xs text-slate-500">
            <span className="text-slate-400">·</span> {p}
          </div>
        ))}
        {d.properties.length > 5 && (
          <div className="text-xs text-slate-400">+{d.properties.length - 5} more</div>
        )}
        {d.row_count > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-slate-100">
            <span className="badge bg-teal-50 text-teal-700 border border-teal-200 text-xs">
              {d.row_count} records
            </span>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-teal-500 !border-0 !w-2.5 !h-2.5" />
    </div>
  )
}

const nodeTypes = { ontologyNode: OntologyClassNode }

// ── Detail panel ───────────────────────────────────────────────────────────────

function DetailPanel({ node, onClose }: { node: OntologyNodeData; onClose: () => void }) {
  return (
    <div className="absolute top-4 right-4 w-72 card z-10 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900">{node.label}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2 text-sm">
        <div>
          <span className="text-slate-400 text-xs uppercase tracking-wide">URI</span>
          <p className="text-teal-600 text-xs mt-0.5 font-mono break-all">{node.uri}</p>
        </div>
        {node.db_table && (
          <div>
            <span className="text-slate-400 text-xs uppercase tracking-wide">DB Table</span>
            <p className="text-slate-900 mt-0.5">{node.db_table}</p>
          </div>
        )}
        {node.row_count > 0 && (
          <div>
            <span className="text-slate-400 text-xs uppercase tracking-wide">Records</span>
            <p className="text-slate-900 mt-0.5">{node.row_count.toLocaleString('it-IT')}</p>
          </div>
        )}
        <div>
          <span className="text-slate-400 text-xs uppercase tracking-wide">Properties</span>
          <div className="mt-1 space-y-1">
            {node.properties.map((p) => (
              <div key={p} className="flex items-center gap-2 bg-slate-50 rounded px-2 py-1 border border-slate-100">
                <span className="w-1.5 h-1.5 bg-teal-500 rounded-full flex-shrink-0" />
                <span className="text-xs text-slate-600 font-mono">{p}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Architecture diagram ───────────────────────────────────────────────────────

function ArchitectureDiagram() {
  const layers = [
    {
      id: 'consumption',
      title: 'CONSUMPTION LAYER',
      items: ['Canali Fisici', 'Canali Digitali', 'App Business'],
      bg: 'bg-slate-50',
      border: 'border-slate-300',
      text: 'text-slate-700',
      titleColor: 'text-slate-600',
      highlight: false,
    },
    {
      id: 'agentic',
      title: 'AGENTIC LAYER',
      items: ['Interface Agent', 'Operational Agent', 'Specialized Agent'],
      bg: 'bg-slate-100',
      border: 'border-slate-400',
      text: 'text-slate-700',
      titleColor: 'text-slate-600',
      highlight: false,
    },
    {
      id: 'semantic',
      title: 'SEMANTIC LAYER',
      items: ['Entità', 'Relazioni', 'Regole', 'MCP Server'],
      bg: 'bg-teal-50',
      border: 'border-teal-500',
      text: 'text-teal-800',
      titleColor: 'text-teal-700',
      highlight: true,
      badge: '★ Ciò che costruiamo',
    },
    {
      id: 'legacy',
      title: 'LEGACY SYSTEM LAYER',
      items: ['ERP', 'CRM', 'MES', 'PDM', 'Altri sistemi'],
      bg: 'bg-slate-200',
      border: 'border-slate-400',
      text: 'text-slate-500',
      titleColor: 'text-slate-500',
      highlight: false,
    },
  ] as const

  const benefits = [
    'Company Knowledge Sovereignty',
    'Technology Portability',
    'Cost-Efficient Results',
    'Auditable Outputs',
    'Secure by Design',
  ]

  const tableRows = [
    { component: 'Ontologia', tech: 'OWL/RDF', desc: 'Template di settore per manufacturing, retail...' },
    { component: 'MCP Server', tech: 'Model Context Protocol', desc: 'API compatibile con qualsiasi AI agent' },
    { component: 'Mapping Engine', tech: 'Custom', desc: "Connette ERP/CRM/MES all'ontologia" },
    { component: 'Governance', tech: 'Rule-based', desc: 'Compliance EU AI Act integrata' },
  ]

  return (
    <div className="p-8 overflow-auto bg-white min-h-full">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-xl font-bold text-slate-900 mb-2">Architettura Sistema</h2>
        <p className="text-sm text-slate-500 mb-8">
          Stack a 4 layer — dalla fondazione semantica ai canali di consumo
        </p>

        {/* Diagram + Benefits side by side */}
        <div className="flex gap-8 items-center mb-10">
          {/* Layer stack */}
          <div className="flex-1 space-y-0">
            {layers.map((layer, idx) => (
              <div key={layer.id}>
                <div
                  className={`rounded-xl border-2 px-6 py-4 ${layer.bg} ${layer.border} ${
                    layer.highlight ? 'shadow-md shadow-teal-100' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-bold tracking-widest uppercase ${layer.titleColor}`}>
                      {layer.title}
                    </span>
                    {layer.highlight && 'badge' in layer && (
                      <span className="text-xs font-semibold bg-teal-600 text-white rounded-full px-3 py-0.5">
                        {layer.badge}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {layer.items.map((item) => (
                      <span
                        key={item}
                        className={`text-xs px-3 py-1 rounded-full border ${
                          layer.highlight
                            ? 'bg-teal-100 border-teal-300 text-teal-700 font-medium'
                            : `bg-white/60 border-slate-300 ${layer.text}`
                        }`}
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
                {idx < layers.length - 1 && (
                  <div className="flex justify-center py-1">
                    <span className="text-slate-300 text-xl font-bold leading-none">↓</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Benefits column */}
          <div className="w-52 flex-shrink-0 bg-slate-50 border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Benefici</p>
            <ul className="space-y-3">
              {benefits.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="text-teal-600 font-bold flex-shrink-0 mt-0.5">✓</span>
                  {b}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Semantic Layer component table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-sm font-bold text-teal-700 uppercase tracking-wide">
              Semantic Layer — Componenti
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-teal-600 uppercase tracking-wide w-32">
                  Componente
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-teal-600 uppercase tracking-wide w-44">
                  Tecnologia
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-teal-600 uppercase tracking-wide">
                  Descrizione
                </th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, idx) => (
                <tr key={row.component} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="px-6 py-3 font-semibold text-slate-900">{row.component}</td>
                  <td className="px-6 py-3 text-slate-500 font-mono text-xs">{row.tech}</td>
                  <td className="px-6 py-3 text-slate-500">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function OntologyGraph() {
  const [graphData, setGraphData] = useState<OntologyGraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<OntologyNodeData | null>(null)
  const [activeSubTab, setActiveSubTab] = useState<'graph' | 'architecture'>('graph')

  useEffect(() => {
    fetchOntologyGraph()
      .then(setGraphData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.data as unknown as OntologyNodeData)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-white">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    )
  }

  if (error || !graphData) {
    return (
      <div className="p-8 bg-white min-h-full">
        <div className="card flex items-center gap-3 text-red-600">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>Errore: {error}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 flex-shrink-0 bg-white">
        <h1 className="text-2xl font-semibold text-slate-900">Ontologia</h1>
        <p className="text-slate-500 mt-1 text-sm">
          Manufacturing Order Management Ontology · {graphData.nodes.length} classi · {graphData.edges.length} proprietà
        </p>
      </div>

      {/* Sub-tab switcher */}
      <div className="px-8 py-0 border-b border-slate-200 flex items-end gap-0 flex-shrink-0 bg-white">
        {[
          { id: 'graph' as const, label: 'Grafo Ontologia' },
          { id: 'architecture' as const, label: 'Architettura Sistema' },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveSubTab(id)}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeSubTab === id
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Architecture tab */}
      {activeSubTab === 'architecture' && (
        <div className="flex-1 overflow-auto">
          <ArchitectureDiagram />
        </div>
      )}

      {/* Graph tab */}
      {activeSubTab === 'graph' && (
        <>
          {/* Legend */}
          <div className="px-8 py-3 border-b border-slate-200 flex items-center gap-6 text-xs text-slate-500 flex-shrink-0 bg-white">
            <div className="flex items-center gap-2">
              <div className="w-8 h-4 bg-white border border-slate-200 rounded" />
              <span>Classe OWL</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5 bg-teal-500" />
              <span>Object Property</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-teal-500 rounded-full" />
              <span>Record DB</span>
            </div>
          </div>

          {/* Graph */}
          <div className="flex-1 relative">
            <ReactFlow
              nodes={graphData.nodes as unknown as Node[]}
              edges={graphData.edges as unknown as Edge[]}
              nodeTypes={nodeTypes}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.3}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#E2E8F0" gap={24} size={1} />
              <Controls />
              <MiniMap
                nodeColor={() => '#ffffff'}
                maskColor="rgba(241,245,249,0.7)"
              />
            </ReactFlow>

            {selectedNode && (
              <DetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
            )}
          </div>
        </>
      )}
    </div>
  )
}
