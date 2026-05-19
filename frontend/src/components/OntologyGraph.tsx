import { useState, useCallback } from 'react'
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, type NodeProps, type Node, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Database, X, GitBranch, Code2, Layers, Server, FileCode, Sparkles } from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import type { OntologyNodeData } from '../types'

// ── Custom node ─────────────────────────────────────────────────────────────
function OntologyClassNode({ data, selected }: NodeProps) {
  const d = data as unknown as OntologyNodeData
  return (
    <div className={`min-w-[160px] rounded-xl border transition-all bg-white ${selected ? 'border-teal-500 shadow-lg' : 'border-slate-200 hover:border-slate-300'}`}>
      <Handle type="target" position={Position.Top} className="!bg-teal-500 !border-0 !w-2.5 !h-2.5" />
      <div className="px-3 py-2 bg-slate-50 rounded-t-xl border-b border-slate-200">
        <p className="text-sm font-bold text-slate-900">{d.label}</p>
        {d.db_table && (
          <div className="flex items-center gap-1 mt-0.5">
            <Database className="w-3 h-3 text-teal-600" />
            <span className="text-xs text-teal-700 font-mono">{d.db_table}</span>
          </div>
        )}
      </div>
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
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-700">{d.row_count.toLocaleString('it-IT')} records</span>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-teal-500 !border-0 !w-2.5 !h-2.5" />
    </div>
  )
}
const nodeTypes = { ontologyNode: OntologyClassNode }

// ── Detail panel ────────────────────────────────────────────────────────────
function DetailPanel({ node, onClose }: { node: OntologyNodeData; onClose: () => void }) {
  return (
    <div className="absolute top-4 right-4 w-72 bg-white border border-slate-200 rounded-xl shadow-lg z-10 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900">{node.label}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
      </div>
      <div className="space-y-2 text-sm">
        <div>
          <span className="text-slate-400 text-xs uppercase tracking-wide">URI</span>
          <p className="text-teal-700 text-xs mt-0.5 font-mono break-all">{node.uri}</p>
        </div>
        {node.db_table && (
          <div>
            <span className="text-slate-400 text-xs uppercase tracking-wide">DB Table</span>
            <p className="text-slate-700 mt-0.5 font-mono">{node.db_table}</p>
          </div>
        )}
        {node.row_count > 0 && (
          <div>
            <span className="text-slate-400 text-xs uppercase tracking-wide">Records</span>
            <p className="text-slate-700 mt-0.5">{node.row_count.toLocaleString('it-IT')}</p>
          </div>
        )}
        <div>
          <span className="text-slate-400 text-xs uppercase tracking-wide">Properties</span>
          <div className="mt-1 space-y-1">
            {node.properties.map((p) => (
              <div key={p} className="flex items-center gap-2 bg-slate-50 rounded px-2 py-1">
                <span className="w-1.5 h-1.5 bg-teal-500 rounded-full flex-shrink-0" />
                <span className="text-xs text-slate-700 font-mono">{p}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Architecture diagram ────────────────────────────────────────────────────
function ArchitectureDiagram() {
  const layers = [
    { name: 'CONSUMPTION LAYER', sub: 'Canali Fisici · Canali Digitali · App Business', bg: 'bg-slate-50',    border: 'border-slate-200', text: 'text-slate-700' },
    { name: 'AGENTIC LAYER',     sub: 'Interface · Operational · Specialized Agent',     bg: 'bg-slate-100',   border: 'border-slate-300', text: 'text-slate-700' },
    { name: 'SEMANTIC LAYER',    sub: 'Entità · Relazioni · Regole · MCP Server',         bg: 'bg-teal-50',     border: 'border-teal-400',  text: 'text-teal-800', highlight: true },
    { name: 'LEGACY SYSTEM LAYER', sub: 'ERP · CRM · MES · PDM · Altri sistemi',          bg: 'bg-slate-50',    border: 'border-slate-200', text: 'text-slate-600' },
  ]
  const benefits = [
    'Company Knowledge Sovereignty',
    'Technology Portability',
    'Cost-Efficient Results',
    'Auditable Outputs',
    'Secure by Design',
  ]
  return (
    <div className="p-8 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-2">
          {layers.map((l, i) => (
            <div key={l.name}>
              <div className={`rounded-xl border-2 ${l.border} ${l.bg} p-5 relative`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-xs font-bold uppercase tracking-wider ${l.text}`}>{l.name}</p>
                    <p className={`text-sm mt-1 ${l.text}`}>{l.sub}</p>
                  </div>
                  {l.highlight && (
                    <span className="text-[10px] font-bold bg-teal-600 text-white rounded px-2 py-1 leading-none flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> CIÒ CHE COSTRUIAMO
                    </span>
                  )}
                </div>
              </div>
              {i < layers.length - 1 && <div className="text-center text-slate-300 text-xl my-1">↓</div>}
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Benefici Architetturali</h3>
          {benefits.map((b) => (
            <div key={b} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2.5">
              <span className="w-1.5 h-1.5 bg-teal-500 rounded-full flex-shrink-0" />
              <span className="text-sm text-slate-700">{b}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Componenti del Semantic Layer</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-200">
              <th className="text-left pb-2 font-medium">Componente</th>
              <th className="text-left pb-2 font-medium">Tecnologia</th>
              <th className="text-left pb-2 font-medium">Descrizione</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr><td className="py-2.5 font-medium text-slate-800">Ontologia</td><td className="py-2.5 font-mono text-teal-700">OWL/RDF</td><td className="py-2.5 text-slate-600">Template di settore per Manufacturing, Retail, Healthcare, Finance</td></tr>
            <tr><td className="py-2.5 font-medium text-slate-800">MCP Server</td><td className="py-2.5 font-mono text-teal-700">Model Context Protocol</td><td className="py-2.5 text-slate-600">API compatibile con qualsiasi AI agent (Anthropic, OpenAI...)</td></tr>
            <tr><td className="py-2.5 font-medium text-slate-800">Mapping Engine</td><td className="py-2.5 font-mono text-teal-700">Custom + AI-assisted</td><td className="py-2.5 text-slate-600">Connette ERP/CRM/MES all'ontologia tramite mappings configurabili</td></tr>
            <tr><td className="py-2.5 font-medium text-slate-800">Governance</td><td className="py-2.5 font-mono text-teal-700">Rule-based</td><td className="py-2.5 text-slate-600">Compliance EU AI Act integrata · Audit trail completo</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Code view (OWL/RDF + SPARQL + MCP) ──────────────────────────────────────
function CodeView() {
  const { sector } = useSector()
  const prefix = sector.id === 'manufacturing' ? 'mfg' : sector.id === 'retail' ? 'rtl' : sector.id === 'healthcare' ? 'hc' : 'fin'
  const baseUri = `https://semanticintelligence.io/ontology/${sector.id}#`

  const turtle = `@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
@prefix ${prefix}:  <${baseUri}> .

${sector.ontology.nodes.map(n => `${prefix}:${n.data.label} a owl:Class ;
    rdfs:label "${n.data.label}"@en${n.data.db_table ? ` ;\n    rdfs:comment "Maps to DB table ${n.data.db_table}"` : ''} .`).join('\n\n')}

${sector.ontology.edges.map(e => `${prefix}:${e.label} a owl:ObjectProperty ;
    rdfs:domain ${prefix}:${e.source} ;
    rdfs:range ${prefix}:${e.target} .`).join('\n\n')}`

  const sparqlExamples = [
    {
      title: `Query ${sector.ontology.nodes[0].data.label} con relazione`,
      code: `PREFIX ${prefix}: <${baseUri}>

SELECT ?entity ?related WHERE {
  ?entity a ${prefix}:${sector.ontology.nodes[0].data.label} ;
          ${prefix}:${sector.ontology.edges[0]?.label ?? 'hasRelation'} ?related .
}
LIMIT 100`,
    },
    {
      title: 'Aggregazione con filtro',
      code: `PREFIX ${prefix}: <${baseUri}>

SELECT (COUNT(?x) AS ?total) WHERE {
  ?x a ${prefix}:${sector.ontology.nodes[1]?.data.label ?? 'Entity'} ;
     ${prefix}:status "active" .
}`,
    },
  ]

  const mcpTool1 = `{
  "name": "query_semantic_layer",
  "description": "Query the ${sector.name} semantic layer using natural language. Returns structured results from the unified ontology.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "question": {
        "type": "string",
        "description": "Natural language question in Italian or English"
      },
      "sector": {
        "type": "string",
        "enum": ["manufacturing", "retail", "healthcare", "finance"]
      }
    },
    "required": ["question"]
  }
}`

  const mcpTool2 = `{
  "name": "list_entities",
  "description": "List all entities of a given ontology class with their properties.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "class": {
        "type": "string",
        "description": "Ontology class URI (e.g., ${prefix}:${sector.ontology.nodes[0].data.label})"
      },
      "filter": { "type": "object" },
      "limit": { "type": "integer", "default": 100 }
    },
    "required": ["class"]
  }
}`

  return (
    <div className="p-8 space-y-6">
      {/* OWL/RDF */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <FileCode className="w-4 h-4 text-teal-600" />
          <h2 className="font-semibold text-slate-900">Ontologia OWL · Turtle Syntax</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">Codice generato automaticamente dall'ontologia attiva ({sector.name}). Compatibile con Protégé, RDFLib, Jena.</p>
        <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs font-mono text-slate-700 overflow-x-auto leading-relaxed">{turtle}</pre>
      </section>

      {/* SPARQL */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <Code2 className="w-4 h-4 text-teal-600" />
          <h2 className="font-semibold text-slate-900">Query SPARQL · Esempi</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">Query semantiche eseguibili direttamente sul triplestore. Più espressive di SQL per dati relazionali complessi.</p>
        <div className="space-y-3">
          {sparqlExamples.map((ex, i) => (
            <div key={i}>
              <p className="text-xs font-semibold text-slate-700 mb-1.5">{ex.title}</p>
              <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs font-mono text-slate-700 overflow-x-auto leading-relaxed">{ex.code}</pre>
            </div>
          ))}
        </div>
      </section>

      {/* MCP */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <Server className="w-4 h-4 text-teal-600" />
          <h2 className="font-semibold text-slate-900">MCP Server · Tool Schema (JSON)</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">Schema dei tool esposti via Model Context Protocol. Compatibile con Claude, GPT, Gemini e qualsiasi agent MCP-aware.</p>
        <div className="space-y-3">
          <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs font-mono text-slate-700 overflow-x-auto leading-relaxed">{mcpTool1}</pre>
          <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs font-mono text-slate-700 overflow-x-auto leading-relaxed">{mcpTool2}</pre>
        </div>
        <p className="text-xs text-slate-400 mt-4 italic">Compatibile con Anthropic MCP Protocol v1.0 · Esposto via HTTP+SSE su `https://api.semanticintelligence.io/mcp`</p>
      </section>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────
type SubTab = 'graph' | 'architecture' | 'code'

export default function OntologyGraph() {
  const { sector } = useSector()
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('graph')
  const [selectedNode, setSelectedNode] = useState<OntologyNodeData | null>(null)

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.data as unknown as OntologyNodeData)
  }, [])

  const tabs: { id: SubTab; label: string; icon: typeof GitBranch }[] = [
    { id: 'graph',        label: 'Grafo Ontologia',     icon: GitBranch },
    { id: 'architecture', label: 'Architettura Sistema',icon: Layers },
    { id: 'code',         label: 'Codice OWL/RDF',      icon: Code2 },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 py-5 border-b border-slate-200 flex-shrink-0">
        <h1 className="text-2xl font-bold text-slate-900">Ontologia</h1>
        <p className="text-slate-500 mt-1 text-sm">
          {sector.ontologyTitle} · {sector.ontology.nodes.length} classi · {sector.ontology.edges.length} object properties
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="px-8 border-b border-slate-200 flex gap-1 flex-shrink-0 bg-white">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveSubTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm transition-colors border-b-2 -mb-px ${
              activeSubTab === t.id
                ? 'border-teal-500 text-teal-700 font-medium'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeSubTab === 'graph' && (
          <div className="h-full relative">
            <ReactFlow
              nodes={sector.ontology.nodes as unknown as Node[]}
              edges={sector.ontology.edges as unknown as Edge[]}
              nodeTypes={nodeTypes}
              onNodeClick={onNodeClick}
              onPaneClick={() => setSelectedNode(null)}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.3}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#CBD5E1" gap={24} size={1} />
              <Controls />
              <MiniMap nodeColor={() => '#ffffff'} maskColor="rgba(248,250,252,0.8)" />
            </ReactFlow>
            {selectedNode && <DetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />}
          </div>
        )}
        {activeSubTab === 'architecture' && <ArchitectureDiagram />}
        {activeSubTab === 'code' && <CodeView />}
      </div>
    </div>
  )
}
