import { useState, useCallback, useEffect } from 'react'
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, type NodeProps, type Node, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Database, X, GitBranch, Code2, Layers, Server, FileCode, Sparkles, Search, Download, Copy, Check, Table2, ArrowRight } from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import { useExtendedOntology } from '../data/ontologyExtensions'
import { getLiveConfig, type LiveConfig } from '../api/semantic'
import { IS_DEMO_MODE } from '../lib/demoMode'
import type { OntologyNodeData, OntologyNode, OntologyEdge, PropertyType, NavTab } from '../types'

// ── Type color map ───────────────────────────────────────────────────────────
const TYPE_COLORS: Record<PropertyType, string> = {
  uuid:     'bg-orange-100 text-orange-700',
  string:   'bg-slate-100 text-slate-600',
  integer:  'bg-blue-100 text-blue-700',
  decimal:  'bg-purple-100 text-purple-700',
  boolean:  'bg-amber-100 text-amber-700',
  date:     'bg-green-100 text-green-700',
  datetime: 'bg-green-100 text-green-700',
  text:     'bg-slate-100 text-slate-500',
  fk:       'bg-teal-100 text-teal-700',
}

// ── Source system color map (by db_table prefix) ─────────────────────────────
type SourceKey = 'erp' | 'crm' | 'hr' | 'pim' | 'custom' | 'user'
const SOURCE_COLORS: Record<SourceKey, { header: string; badge: string; dot: string; label: string }> = {
  erp:    { header: 'bg-blue-50   border-blue-200',   badge: 'bg-blue-100 text-blue-700',    dot: 'bg-blue-500',    label: 'ERP' },
  crm:    { header: 'bg-purple-50 border-purple-200', badge: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500',  label: 'CRM' },
  hr:     { header: 'bg-orange-50 border-orange-200', badge: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500',  label: 'HR' },
  pim:    { header: 'bg-green-50  border-green-200',  badge: 'bg-green-100 text-green-700',   dot: 'bg-green-500',   label: 'PIM' },
  custom: { header: 'bg-slate-50  border-slate-200',  badge: 'bg-slate-100 text-slate-600',   dot: 'bg-slate-400',   label: 'DB' },
  user:   { header: 'bg-violet-50 border-violet-200', badge: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500',  label: 'Custom' },
}

function getSourceKey(dbTable: string | null, isUserNode = false): SourceKey {
  if (isUserNode) return 'user'
  if (!dbTable) return 'user'
  const prefix = dbTable.split('.')[0].toLowerCase()
  if (prefix in SOURCE_COLORS) return prefix as SourceKey
  return 'custom'
}

// XSD type mapping for OWL turtle generation
function toXsd(type: PropertyType): string {
  switch (type) {
    case 'integer': return 'xsd:integer'
    case 'decimal': return 'xsd:decimal'
    case 'boolean': return 'xsd:boolean'
    case 'date':    return 'xsd:date'
    case 'datetime': return 'xsd:dateTime'
    default:        return 'xsd:string'
  }
}

type GraphNodeData = OntologyNodeData & { isUserNode?: boolean }
function gnd(n: Node): GraphNodeData { return n.data as unknown as GraphNodeData }

// ── Custom node ─────────────────────────────────────────────────────────────
function OntologyClassNode({ data, selected }: NodeProps) {
  const d = data as unknown as GraphNodeData
  const srcKey = getSourceKey(d.db_table ?? null, d.isUserNode)
  const src = SOURCE_COLORS[srcKey]
  return (
    <div className={`min-w-[160px] rounded-xl border transition-all bg-white ${selected ? 'border-teal-500 shadow-lg ring-1 ring-teal-300' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'}`}>
      <Handle type="target" position={Position.Top} className="!bg-teal-500 !border-0 !w-2.5 !h-2.5" />
      <div className={`px-3 py-2 rounded-t-xl border-b ${src.header}`}>
        <div className="flex items-center justify-between gap-1">
          <p className="text-sm font-bold text-slate-900 truncate">{d.label}</p>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${src.badge}`}>{src.label}</span>
        </div>
        {d.db_table && (
          <div className="flex items-center gap-1 mt-0.5">
            <Database className="w-3 h-3 text-slate-500" />
            <span className="text-xs text-slate-600 font-mono truncate">{d.db_table}</span>
          </div>
        )}
      </div>
      <div className="px-3 py-2 space-y-0.5">
        {d.properties.slice(0, 5).map((p) => (
          <div key={p.name} className="text-xs text-slate-500 flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${TYPE_COLORS[p.type]?.includes('teal') ? 'bg-teal-400' : 'bg-slate-300'}`} />
            <span className="truncate">{p.name}{p.required ? <span className="text-rose-500 ml-0.5">*</span> : null}</span>
            <span className={`text-[9px] font-mono px-1 rounded flex-shrink-0 ${TYPE_COLORS[p.type] ?? 'bg-slate-100 text-slate-500'}`}>{p.type}</span>
          </div>
        ))}
        {d.properties.length > 5 && (
          <div className="text-xs text-slate-400 italic">+{d.properties.length - 5} more</div>
        )}
        {d.row_count > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-slate-100">
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-700">{d.row_count.toLocaleString('en-US')} records</span>
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
  const srcKey = getSourceKey(node.db_table ?? null)
  const src = SOURCE_COLORS[srcKey]
  return (
    <div className="absolute top-4 right-4 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-10 p-4 max-h-[calc(100%-2rem)] overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${src.dot}`} />
          <h3 className="font-semibold text-slate-900">{node.label}</h3>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${src.badge}`}>{src.label}</span>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 ml-2 flex-shrink-0"><X className="w-4 h-4" /></button>
      </div>
      <div className="space-y-3 text-sm">
        <div>
          <span className="text-slate-400 text-[10px] uppercase tracking-wide font-medium">URI</span>
          <p className="text-teal-700 text-xs mt-0.5 font-mono break-all">{node.uri}</p>
        </div>
        {node.db_table && (
          <div>
            <span className="text-slate-400 text-[10px] uppercase tracking-wide font-medium">DB Table</span>
            <p className="text-slate-700 mt-0.5 font-mono text-xs">{node.db_table}</p>
          </div>
        )}
        {node.row_count > 0 && (
          <div>
            <span className="text-slate-400 text-[10px] uppercase tracking-wide font-medium">Records</span>
            <p className="text-slate-700 mt-0.5 font-medium">{node.row_count.toLocaleString('en-US')}</p>
          </div>
        )}
        <div>
          <span className="text-slate-400 text-[10px] uppercase tracking-wide font-medium">Properties ({node.properties.length})</span>
          <div className="mt-1.5 space-y-1">
            {node.properties.map((p) => (
              <div key={p.name} className="bg-slate-50 rounded-lg px-2.5 py-1.5 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-800 font-mono font-semibold">{p.name}</span>
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${TYPE_COLORS[p.type] ?? 'bg-slate-100 text-slate-500'}`}>{p.type}</span>
                  {p.required && <span className="text-[9px] font-medium px-1 rounded bg-red-50 text-red-600">req</span>}
                  {p.unique && <span className="text-[9px] font-medium px-1 rounded bg-orange-50 text-orange-600">uniq</span>}
                  {p.type === 'fk' && p.fkTarget && <span className="text-[9px] font-mono text-teal-600">→ {p.fkTarget}</span>}
                </div>
                {p.physicalName && p.physicalName !== p.name && (
                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                    <span className="font-medium text-slate-500">physical:</span>
                    <span className="font-mono text-slate-600">{p.physicalName}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Legend panel ─────────────────────────────────────────────────────────────
function LegendPanel() {
  const sources = Object.entries(SOURCE_COLORS) as [SourceKey, typeof SOURCE_COLORS[SourceKey]][]
  return (
    <div className="absolute bottom-4 left-4 bg-white border border-slate-200 rounded-xl shadow-md z-10 p-3 text-xs space-y-2 max-w-[200px]">
      <p className="font-semibold text-slate-700 text-[10px] uppercase tracking-wide">Source Systems</p>
      <div className="space-y-1">
        {sources.map(([key, val]) => (
          <div key={key} className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${val.dot}`} />
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${val.badge}`}>{val.label}</span>
            <span className="text-slate-500 text-[9px]">{
              key === 'erp' ? 'Enterprise resource' :
              key === 'crm' ? 'Customer relations' :
              key === 'hr' ? 'Human resources' :
              key === 'pim' ? 'Product info mgmt' :
              key === 'user' ? 'User-defined' : 'Database'
            }</span>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 pt-2 space-y-1">
        <p className="font-semibold text-slate-700 text-[10px] uppercase tracking-wide">Relations</p>
        <div className="flex items-center gap-2">
          <div className="w-6 h-0.5 bg-teal-500 rounded" style={{ background: 'repeating-linear-gradient(90deg,#14b8a6 0 4px,transparent 4px 8px)' }} />
          <span className="text-[9px] text-slate-500">Cross-source bridge</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-0.5 bg-slate-400 rounded" />
          <span className="text-[9px] text-slate-500">Intra-source relation</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-0.5 bg-violet-500 rounded" style={{ background: 'repeating-linear-gradient(90deg,#7c3aed 0 4px,transparent 4px 8px)' }} />
          <span className="text-[9px] text-slate-500">User-defined edge</span>
        </div>
      </div>
    </div>
  )
}

// ── Entities tabular view ────────────────────────────────────────────────────
function EntitiesView() {
  const { sectorId } = useSector()
  const extendedOntology = useExtendedOntology(sectorId)
  const [search, setSearch] = useState('')
  const [expandedNode, setExpandedNode] = useState<string | null>(null)

  const filtered = extendedOntology.nodes.filter(n =>
    !search || n.data.label.toLowerCase().includes(search.toLowerCase()) ||
    (n.data.db_table ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search entities…"
            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-teal-300 focus:border-teal-400 outline-none"
          />
        </div>
        <span className="text-sm text-slate-500">{filtered.length} / {extendedOntology.nodes.length} entities</span>
      </div>

      {extendedOntology.nodes.length === 0 && !IS_DEMO_MODE && (
        <div className="py-14 text-center">
          <Table2 className="w-8 h-8 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-500 font-medium mb-1">No entities yet</p>
          <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed mb-4">
            Connect a data source and run the pipeline, or build entities manually with the Ontology Builder AI.
          </p>
          <div className="flex justify-center gap-2">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: { tab: 'sources' } }))}
              className="text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 transition-colors font-medium"
            >
              Connect sources →
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: { tab: 'builder' } }))}
              className="text-xs border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors font-medium"
            >
              Build manually
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map(node => {
          const srcKey = getSourceKey(node.data.db_table ?? null)
          const src = SOURCE_COLORS[srcKey]
          const isOpen = expandedNode === node.id
          return (
            <div key={node.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedNode(isOpen ? null : node.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
              >
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${src.dot}`} />
                <span className="font-semibold text-slate-900 flex-1">{node.data.label}</span>
                {node.data.db_table && (
                  <span className="text-xs font-mono text-slate-500 flex items-center gap-1">
                    <Database className="w-3 h-3" /> {node.data.db_table}
                  </span>
                )}
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${src.badge}`}>{src.label}</span>
                <span className="text-xs text-slate-400">{node.data.properties.length} props</span>
                {node.data.row_count > 0 && (
                  <span className="text-xs text-teal-600 font-medium">{node.data.row_count.toLocaleString()} rows</span>
                )}
                <span className={`text-slate-400 text-lg leading-none transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
              </button>

              {isOpen && (
                <div className="border-t border-slate-100 px-4 py-3">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide font-medium mb-2">URI: <span className="font-mono text-teal-700 normal-case">{node.data.uri}</span></p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[10px] text-slate-400 uppercase tracking-wide border-b border-slate-100">
                          <th className="text-left pb-1.5 font-medium pr-3">Semantic name</th>
                          <th className="text-left pb-1.5 font-medium pr-3">Physical column</th>
                          <th className="text-left pb-1.5 font-medium pr-3">Type</th>
                          <th className="text-left pb-1.5 font-medium pr-3">Flags</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {node.data.properties.map(p => (
                          <tr key={p.name} className="hover:bg-slate-50">
                            <td className="py-1.5 pr-3 font-mono text-slate-800 font-semibold">{p.name}</td>
                            <td className="py-1.5 pr-3 font-mono text-slate-500">
                              {p.physicalName && p.physicalName !== p.name
                                ? <span className="text-slate-600">{p.physicalName}</span>
                                : <span className="text-slate-300 italic">= semantic</span>
                              }
                            </td>
                            <td className="py-1.5 pr-3">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${TYPE_COLORS[p.type] ?? 'bg-slate-100 text-slate-500'}`}>{p.type}</span>
                              {p.type === 'fk' && p.fkTarget && <span className="ml-1 text-teal-600">→ {p.fkTarget}</span>}
                            </td>
                            <td className="py-1.5 flex items-center gap-1">
                              {p.required && <span className="px-1 py-0.5 rounded bg-red-50 text-red-600 text-[9px] font-medium">req</span>}
                              {p.unique && <span className="px-1 py-0.5 rounded bg-orange-50 text-orange-600 text-[9px] font-medium">uniq</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Architecture diagram ────────────────────────────────────────────────────
function ArchitectureDiagram() {
  const layers = [
    { name: 'CONSUMPTION LAYER', sub: 'Physical Channels · Digital Channels · Business Apps', bg: 'bg-slate-50',    border: 'border-slate-200', text: 'text-slate-700' },
    { name: 'AGENTIC LAYER',     sub: 'Interface · Operational · Specialized Agent',     bg: 'bg-slate-100',   border: 'border-slate-300', text: 'text-slate-700' },
    { name: 'SEMANTIC LAYER',    sub: 'Entities · Relations · Rules · MCP Server',         bg: 'bg-teal-50',     border: 'border-teal-400',  text: 'text-teal-800', highlight: true },
    { name: 'LEGACY SYSTEM LAYER', sub: 'ERP · CRM · MES · PDM · Other systems',          bg: 'bg-slate-50',    border: 'border-slate-200', text: 'text-slate-600' },
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
                      <Sparkles className="w-3 h-3" /> WHAT WE BUILD
                    </span>
                  )}
                </div>
              </div>
              {i < layers.length - 1 && <div className="text-center text-slate-300 text-xl my-1">↓</div>}
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Architectural Benefits</h3>
          {benefits.map((b) => (
            <div key={b} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2.5">
              <span className="w-1.5 h-1.5 bg-teal-500 rounded-full flex-shrink-0" />
              <span className="text-sm text-slate-700">{b}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Semantic Layer Components</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-200">
              <th className="text-left pb-2 font-medium">Component</th>
              <th className="text-left pb-2 font-medium">Technology</th>
              <th className="text-left pb-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr><td className="py-2.5 font-medium text-slate-800">Ontology</td><td className="py-2.5 font-mono text-teal-700">OWL/RDF</td><td className="py-2.5 text-slate-600">Sector templates for Manufacturing, Retail, Healthcare, Finance</td></tr>
            <tr><td className="py-2.5 font-medium text-slate-800">MCP Server</td><td className="py-2.5 font-mono text-teal-700">Model Context Protocol</td><td className="py-2.5 text-slate-600">API compatible with any AI agent (Anthropic, OpenAI...)</td></tr>
            <tr><td className="py-2.5 font-medium text-slate-800">Mapping Engine</td><td className="py-2.5 font-mono text-teal-700">Custom + AI-assisted</td><td className="py-2.5 text-slate-600">Connects ERP/CRM/MES to the ontology via configurable mappings</td></tr>
            <tr><td className="py-2.5 font-medium text-slate-800">Governance</td><td className="py-2.5 font-mono text-teal-700">Rule-based</td><td className="py-2.5 text-slate-600">Integrated EU AI Act compliance · Complete audit trail</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Code view (OWL/RDF + SPARQL + MCP) ──────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-teal-600" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function DownloadButton({ text, filename }: { text: string; filename: string }) {
  const download = () => {
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <button
      onClick={download}
      className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
    >
      <Download className="w-3.5 h-3.5" />
      Download
    </button>
  )
}

function CodeView() {
  const { sector, sectorId } = useSector()
  const extendedOntology = useExtendedOntology(sectorId)
  const prefix = sector.id === 'manufacturing' ? 'mfg' : sector.id === 'retail' ? 'rtl' : sector.id === 'healthcare' ? 'hc' : 'fin'
  const baseUri = `https://semanticintelligence.io/ontology/${sector.id}#`

  const turtle = `@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
@prefix si:   <https://semanticintelligence.io/meta#> .
@prefix ${prefix}:  <${baseUri}> .

${extendedOntology.nodes.map(n => {
  const physMappings = n.data.properties.filter(p => p.physicalName && p.physicalName !== p.name)
  return `${prefix}:${n.data.label} a owl:Class ;
    rdfs:label "${n.data.label}"@en${n.data.db_table ? ` ;\n    si:dbTable "${n.data.db_table}"` : ''} .

${n.data.properties.filter(p => p.type !== 'fk').map(p => {
  const physLine = p.physicalName && p.physicalName !== p.name ? ` ;\n    si:physicalColumn "${p.physicalName}"` : ''
  return `${prefix}:${n.data.label}_${p.name} a owl:DatatypeProperty ;\n    rdfs:domain ${prefix}:${n.data.label} ;\n    rdfs:range ${toXsd(p.type)}${physLine} .`
}).join('\n')}
${n.data.properties.filter(p => p.type === 'fk').map(p => {
  const physLine = p.physicalName && p.physicalName !== p.name ? ` ;\n    si:physicalColumn "${p.physicalName}"` : ''
  return `${prefix}:${n.data.label}_${p.name} a owl:ObjectProperty ;\n    rdfs:domain ${prefix}:${n.data.label}${p.fkTarget ? ` ;\n    rdfs:range ${prefix}:${p.fkTarget}` : ''}${physLine} .`
}).join('\n')}${physMappings.length > 0 ? `\n\n# Physical column mappings for ${n.data.label}:\n${physMappings.map(p => `# ${p.name} → ${p.physicalName}`).join('\n')}` : ''}`
}).join('\n\n')}

${extendedOntology.edges.map(e => `${prefix}:${e.label} a owl:ObjectProperty ;
    rdfs:domain ${prefix}:${e.source} ;
    rdfs:range ${prefix}:${e.target}${e.cardinality ? ` ;\n    rdfs:comment "cardinality ${e.cardinality}"` : ''} .`).join('\n\n')}`

  const sparqlExamples = [
    {
      title: `Query ${extendedOntology.nodes[0]?.data.label ?? 'Entity'} with relation`,
      code: `PREFIX ${prefix}: <${baseUri}>

SELECT ?entity ?related WHERE {
  ?entity a ${prefix}:${extendedOntology.nodes[0]?.data.label ?? 'Entity'} ;
          ${prefix}:${extendedOntology.edges[0]?.label ?? 'hasRelation'} ?related .
}
LIMIT 100`,
    },
    {
      title: 'Aggregation with filter',
      code: `PREFIX ${prefix}: <${baseUri}>

SELECT (COUNT(?x) AS ?total) WHERE {
  ?x a ${prefix}:${extendedOntology.nodes[1]?.data.label ?? 'Entity'} ;
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
        "description": "Natural language question in English"
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
        "description": "Ontology class URI (e.g., ${prefix}:${extendedOntology.nodes[0]?.data.label ?? (IS_DEMO_MODE ? sector.ontology.nodes[0]?.data.label : undefined) ?? 'Entity'})"
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
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <FileCode className="w-4 h-4 text-teal-600" />
            <h2 className="font-semibold text-slate-900">OWL Ontology · Turtle Syntax</h2>
          </div>
          <div className="flex items-center gap-2">
            <CopyButton text={turtle} />
            <DownloadButton text={turtle} filename={`ontology-${sector.id}.ttl`} />
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Code generated automatically from the active ontology ({sector.name}).
          Physical column mappings are annotated with <code className="bg-slate-100 px-1 rounded font-mono">si:physicalColumn</code>.
          Compatible with Protégé, RDFLib, Jena.
        </p>
        <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs font-mono text-slate-700 overflow-x-auto leading-relaxed">{turtle}</pre>
      </section>

      {/* SPARQL */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-teal-600" />
            <h2 className="font-semibold text-slate-900">SPARQL Query · Examples</h2>
          </div>
          <CopyButton text={sparqlExamples.map(e => `# ${e.title}\n${e.code}`).join('\n\n')} />
        </div>
        <p className="text-xs text-slate-500 mb-4">Semantic queries executable directly on the triplestore. More expressive than SQL for complex relational data.</p>
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
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-teal-600" />
            <h2 className="font-semibold text-slate-900">MCP Server · Tool Schema (JSON)</h2>
          </div>
          <CopyButton text={`${mcpTool1}\n\n${mcpTool2}`} />
        </div>
        <p className="text-xs text-slate-500 mb-4">Schema of tools exposed via Model Context Protocol. Compatible with Claude, GPT, Gemini and any MCP-aware agent.</p>
        <div className="space-y-3">
          <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs font-mono text-slate-700 overflow-x-auto leading-relaxed">{mcpTool1}</pre>
          <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs font-mono text-slate-700 overflow-x-auto leading-relaxed">{mcpTool2}</pre>
        </div>
        <p className="text-xs text-slate-400 mt-4 italic">Compatible with Anthropic MCP Protocol v1.0 · Exposed via HTTP+SSE at `https://api.semanticintelligence.io/mcp`</p>
      </section>
    </div>
  )
}

// ── Live config → OntologyGraphData converter ────────────────────────────────
function liveConfigToNodes(liveConfig: LiveConfig): OntologyNode[] {
  return liveConfig.ontology.nodes.map(n => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: {
      label: n.data.label,
      uri: n.data.uri,
      db_table: n.data.db_table,
      row_count: n.data.row_count,
      properties: n.data.properties.map(p => ({
        name: p.name,
        type: (p.type as PropertyType) ?? 'string',
      })),
    },
  }))
}

function liveConfigToEdges(liveConfig: LiveConfig): OntologyEdge[] {
  return liveConfig.ontology.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: e.type ?? 'smoothstep',
    animated: e.animated,
    style: { stroke: '#0D9488', strokeWidth: 1.5 },
    labelStyle: { fill: '#0D9488', fontSize: 10 },
    markerEnd: { type: 'ArrowClosed' },
  }))
}

// ── Main component ──────────────────────────────────────────────────────────
type SubTab = 'graph' | 'entities' | 'architecture' | 'code'

export default function OntologyGraph({ onNavigate }: { onNavigate?: (tab: NavTab) => void } = {}) {
  const { sector, sectorId } = useSector()
  const extendedOntology = useExtendedOntology(sectorId)
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('graph')
  const [selectedNode, setSelectedNode] = useState<OntologyNodeData | null>(null)
  const [graphSearch, setGraphSearch] = useState('')
  const [liveConfig, setLiveConfig] = useState<LiveConfig | null>(null)

  useEffect(() => {
    getLiveConfig().then(setLiveConfig).catch(() => {})
  }, [])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(gnd(node))
  }, [])

  const tabs: { id: SubTab; label: string; icon: typeof GitBranch }[] = [
    { id: 'graph',        label: 'Ontology Graph',      icon: GitBranch },
    { id: 'entities',     label: 'Entities',            icon: Table2 },
    { id: 'architecture', label: 'System Architecture', icon: Layers },
    { id: 'code',         label: 'OWL/RDF Code',        icon: Code2 },
  ]

  // Use live config nodes/edges if available, otherwise fall back to local extended ontology
  const graphNodes: OntologyNode[] = (liveConfig?.ontology.nodes.length ?? 0) > 0
    ? liveConfigToNodes(liveConfig!)
    : extendedOntology.nodes

  const graphEdges: OntologyEdge[] = (liveConfig?.ontology.edges.length ?? 0) > 0
    ? liveConfigToEdges(liveConfig!)
    : extendedOntology.edges

  // Filter graph nodes by search
  const filteredNodes = graphSearch
    ? graphNodes.filter(n =>
        n.data.label.toLowerCase().includes(graphSearch.toLowerCase()) ||
        (n.data.db_table ?? '').toLowerCase().includes(graphSearch.toLowerCase())
      )
    : graphNodes

  const filteredNodeIds = new Set(filteredNodes.map(n => n.id))
  const filteredEdges = graphSearch
    ? graphEdges.filter(e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target))
    : graphEdges

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 py-5 border-b border-slate-200 flex-shrink-0">
        <h1 className="text-2xl font-bold text-slate-900">Ontology</h1>
        <p className="text-slate-500 mt-1 text-sm">
          {sector.ontologyTitle} · {graphNodes.length} classes · {graphEdges.length} object properties
          {IS_DEMO_MODE
            ? extendedOntology.nodes.length > sector.ontology.nodes.length && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs bg-violet-50 text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded-full font-medium">
                  +{extendedOntology.nodes.length - sector.ontology.nodes.length} from Builder
                </span>
              )
            : extendedOntology.nodes.length > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs bg-violet-50 text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded-full font-medium">
                  +{extendedOntology.nodes.length} from Builder
                </span>
              )
          }
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
            {/* Search bar */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 w-64">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={graphSearch}
                  onChange={e => setGraphSearch(e.target.value)}
                  placeholder="Filter entities…"
                  className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg bg-white shadow-md focus:ring-2 focus:ring-teal-300 focus:border-teal-400 outline-none"
                />
                {graphSearch && (
                  <button onClick={() => setGraphSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {graphSearch && (
                <p className="text-center text-xs text-slate-500 mt-1 bg-white/80 rounded px-2">
                  {filteredNodes.length} of {graphNodes.length} entities shown
                </p>
              )}
            </div>

            {!IS_DEMO_MODE && graphNodes.length === 0 && (
              <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                <div className="bg-white border border-slate-200 rounded-2xl shadow-lg p-8 text-center max-w-sm pointer-events-auto">
                  <GitBranch className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-600 mb-1">No ontology built yet</p>
                  <p className="text-xs text-slate-400 mb-4">Connect a data source and build your semantic layer — entities and relationships will appear here automatically.</p>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => onNavigate?.('sources')}
                      className="inline-flex items-center justify-center gap-1.5 text-xs bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium"
                    >
                      Connect a data source <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onNavigate?.('builder')}
                      className="inline-flex items-center justify-center gap-1.5 text-xs bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                    >
                      Build manually with AI <Sparkles className="w-3.5 h-3.5 text-teal-500" />
                    </button>
                  </div>
                </div>
              </div>
            )}
            <ReactFlow
              nodes={filteredNodes as unknown as Node[]}
              edges={filteredEdges.map(e => ({
                ...e,
                label: e.cardinality ? `${e.label} · ${e.cardinality}` : e.label,
              })) as unknown as Edge[]}
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
              <MiniMap nodeColor={(n) => {
                const d = gnd(n)
                const srcKey = getSourceKey(d?.db_table ?? null)
                const colors: Record<SourceKey, string> = { erp: '#93c5fd', crm: '#c4b5fd', hr: '#fdba74', pim: '#86efac', custom: '#94a3b8', user: '#a78bfa' }
                return colors[srcKey] ?? '#e2e8f0'
              }} maskColor="rgba(248,250,252,0.8)" />
            </ReactFlow>
            {selectedNode && <DetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />}
            <LegendPanel />
          </div>
        )}
        {activeSubTab === 'entities' && <EntitiesView />}
        {activeSubTab === 'architecture' && <ArchitectureDiagram />}
        {activeSubTab === 'code' && <CodeView />}
      </div>
    </div>
  )
}
