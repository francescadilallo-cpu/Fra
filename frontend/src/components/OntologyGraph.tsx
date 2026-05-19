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
      className={`min-w-[160px] rounded-xl border transition-all ${
        selected
          ? 'border-teal-400 shadow-lg shadow-teal-500/20'
          : 'border-slate-200 hover:border-slate-300'
      } bg-slate-50`}
    >
      <Handle type="target" position={Position.Top} className="!bg-teal-500 !border-0 !w-2.5 !h-2.5" />

      {/* Header */}
      <div className="px-3 py-2 bg-slate-100 rounded-t-xl border-b border-slate-200">
        <p className="text-sm font-bold text-white">{d.label}</p>
        {d.db_table && (
          <div className="flex items-center gap-1 mt-0.5">
            <Database className="w-3 h-3 text-teal-400" />
            <span className="text-xs text-teal-400">{d.db_table}</span>
          </div>
        )}
      </div>

      {/* Properties */}
      <div className="px-3 py-2 space-y-0.5">
        {d.properties.slice(0, 5).map((p) => (
          <div key={p} className="text-xs text-slate-400">
            <span className="text-slate-500">·</span> {p}
          </div>
        ))}
        {d.properties.length > 5 && (
          <div className="text-xs text-slate-600">+{d.properties.length - 5} more</div>
        )}
        {d.row_count > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-slate-200">
            <span className="badge bg-teal-500/10 text-teal-400 text-xs">
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
    <div className="absolute top-4 right-4 w-72 card z-10 shadow-2xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-white">{node.label}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2 text-sm">
        <div>
          <span className="text-slate-500 text-xs uppercase tracking-wide">URI</span>
          <p className="text-teal-400 text-xs mt-0.5 font-mono break-all">{node.uri}</p>
        </div>
        {node.db_table && (
          <div>
            <span className="text-slate-500 text-xs uppercase tracking-wide">DB Table</span>
            <p className="text-white mt-0.5">{node.db_table}</p>
          </div>
        )}
        {node.row_count > 0 && (
          <div>
            <span className="text-slate-500 text-xs uppercase tracking-wide">Records</span>
            <p className="text-white mt-0.5">{node.row_count.toLocaleString('it-IT')}</p>
          </div>
        )}
        <div>
          <span className="text-slate-500 text-xs uppercase tracking-wide">Properties</span>
          <div className="mt-1 space-y-1">
            {node.properties.map((p) => (
              <div key={p} className="flex items-center gap-2 bg-white rounded px-2 py-1">
                <span className="w-1.5 h-1.5 bg-teal-500 rounded-full flex-shrink-0" />
                <span className="text-xs text-slate-300 font-mono">{p}</span>
              </div>
            ))}
          </div>
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
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
      </div>
    )
  }

  if (error || !graphData) {
    return (
      <div className="p-8">
        <div className="card flex items-center gap-3 text-red-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>Errore: {error}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 flex-shrink-0">
        <h1 className="text-2xl font-bold text-white">Ontologia</h1>
        <p className="text-slate-400 mt-1 text-sm">
          Manufacturing Order Management Ontology · {graphData.nodes.length} classi · {graphData.edges.length} proprietà
        </p>
      </div>

      {/* Legend */}
      <div className="px-8 py-3 border-b border-slate-200 flex items-center gap-6 text-xs text-slate-400 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-4 bg-slate-100 border border-slate-200 rounded" />
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
          <Background color="#1e1b4b" gap={24} size={1} />
          <Controls />
          <MiniMap
            nodeColor={() => '#1e1b4b'}
            maskColor="rgba(7,6,26,0.7)"
          />
        </ReactFlow>

        {selectedNode && (
          <DetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
        )}
      </div>
    </div>
  )
}
