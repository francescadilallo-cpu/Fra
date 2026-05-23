import { useState } from 'react'
import {
  ShieldCheck, AlertTriangle, Info, Download, FileText,
  Database, Bot, ChevronRight, CheckCircle2,
  Clock, Lock, Globe,
} from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import {
  getSectorCompliance,
  computeComplianceScore,
  type EntityCompliance,
  type AgentCompliance,
  type DataCategory,
  type LawfulBasis,
  type DataResidency,
  type AiRiskLevel,
  type HumanOversight,
} from '../data/complianceData'

// -- Label maps --
const CATEGORY_LABELS: Record<DataCategory, string> = {
  identification: 'Identification',
  contact: 'Contact',
  financial: 'Financial',
  health: 'Health',
  behavioral: 'Behavioral',
  professional: 'Professional',
  transactional: 'Transactional',
}

const BASIS_LABELS: Record<LawfulBasis, string> = {
  contract: 'Contract',
  'legal-obligation': 'Legal obligation',
  'legitimate-interests': 'Leg. interests',
  consent: 'Consent',
  'vital-interests': 'Vital interests',
}

const RISK_ORDER: Record<AiRiskLevel, number> = { high: 0, limited: 1, minimal: 2, unacceptable: -1 }

// -- Sub-components --
function ScoreBar({ label, score, icon }: { label: string; score: number; icon: React.ReactNode }) {
  const color = score >= 85 ? 'teal' : score >= 70 ? 'amber' : 'red'
  const barClass = color === 'teal'
    ? 'bg-teal-500'
    : color === 'amber'
    ? 'bg-amber-500'
    : 'bg-red-500'
  const textClass = color === 'teal'
    ? 'text-teal-700'
    : color === 'amber'
    ? 'text-amber-700'
    : 'text-red-700'
  const bgClass = color === 'teal'
    ? 'bg-teal-50 border-teal-200'
    : color === 'amber'
    ? 'bg-amber-50 border-amber-200'
    : 'bg-red-50 border-red-200'

  return (
    <div className={`flex-1 rounded-xl border p-4 ${bgClass}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-gray-700">{label}</span>
        </div>
        <span className={`text-2xl font-bold ${textClass}`}>{score}%</span>
      </div>
      <div className="h-3 bg-white rounded-full overflow-hidden border border-gray-200">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barClass}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  )
}

function PersonalDataChip({ entity }: { entity: EntityCompliance }) {
  if (!entity.personalData) {
    return <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500">None</span>
  }
  if (entity.specialCategory) {
    return <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Special</span>
  }
  return <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Personal</span>
}

function ResidencyCell({ residency }: { residency: DataResidency }) {
  if (residency === 'EU-only') {
    return (
      <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
        <Lock size={12} /> EU-only
      </span>
    )
  }
  if (residency === 'EU-adequacy') {
    return (
      <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
        <Globe size={12} /> EU + Adequate
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
      <Globe size={12} /> Std. clauses
    </span>
  )
}

function GdprRow({ entity }: { entity: EntityCompliance }) {
  const firstBasis = entity.lawfulBasis[0] as LawfulBasis | undefined
  const isGray = !entity.personalData

  return (
    <tr className={isGray ? 'bg-gray-50/60' : 'bg-white hover:bg-gray-50/40 transition-colors'}>
      <td className="px-3 py-2.5">
        <span className={`text-sm font-medium ${isGray ? 'text-gray-400' : 'text-gray-800'}`}>
          {entity.label}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <PersonalDataChip entity={entity} />
      </td>
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap gap-1">
          {entity.categories.map(c => (
            <span key={c} className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-700 border border-blue-100">
              {CATEGORY_LABELS[c]}
            </span>
          ))}
          {entity.categories.length === 0 && <span className="text-xs text-gray-300">—</span>}
        </div>
      </td>
      <td className="px-3 py-2.5">
        {firstBasis
          ? <span className="px-2 py-0.5 rounded text-xs bg-indigo-50 text-indigo-700 border border-indigo-100">{BASIS_LABELS[firstBasis]}</span>
          : <span className="text-xs text-gray-300">—</span>
        }
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">{entity.retention}</td>
      <td className="px-3 py-2.5">
        <ResidencyCell residency={entity.residency} />
      </td>
      <td className="px-3 py-2.5 text-center">
        {entity.dpiaRequired
          ? <CheckCircle2 size={16} className="text-teal-500 mx-auto" />
          : <span className="text-gray-300 text-xs">—</span>
        }
      </td>
    </tr>
  )
}

function RiskBadge({ level }: { level: AiRiskLevel }) {
  const styles: Record<AiRiskLevel, string> = {
    high: 'bg-red-100 text-red-700',
    limited: 'bg-amber-100 text-amber-700',
    minimal: 'bg-slate-100 text-slate-600',
    unacceptable: 'bg-purple-100 text-purple-700',
  }
  const labels: Record<AiRiskLevel, string> = {
    high: 'High risk',
    limited: 'Limited risk',
    minimal: 'Minimal risk',
    unacceptable: 'Unacceptable',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${styles[level]}`}>
      {labels[level]}
    </span>
  )
}

function OversightBadge({ level }: { level: HumanOversight }) {
  const styles: Record<HumanOversight, string> = {
    mandatory: 'bg-red-50 text-red-600 border-red-200',
    recommended: 'bg-amber-50 text-amber-600 border-amber-200',
    'not-required': 'bg-slate-50 text-slate-500 border-slate-200',
  }
  const labels: Record<HumanOversight, string> = {
    mandatory: 'Mandatory oversight',
    recommended: 'Oversight recommended',
    'not-required': 'Not required',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs border ${styles[level]}`}>
      {labels[level]}
    </span>
  )
}

function AgentCard({ agent }: { agent: AgentCompliance }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3.5 bg-white hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-sm font-semibold text-gray-800">{agent.name}</span>
        <RiskBadge level={agent.riskLevel} />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        <OversightBadge level={agent.humanOversight} />
        {agent.dpiaRequired && (
          <span className="px-2 py-0.5 rounded text-xs border bg-teal-50 text-teal-700 border-teal-200">
            DPIA required
          </span>
        )}
      </div>
      {agent.aiActArticles.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {agent.aiActArticles.map(a => (
            <code key={a} className="px-1.5 py-0.5 rounded text-xs bg-teal-50 text-teal-700 border border-teal-100 font-mono">
              {a}
            </code>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-500 leading-relaxed">{agent.rationale}</p>
    </div>
  )
}

// -- Toast --
type ToastMsg = { id: number; text: string }

// -- Main component --
export default function ComplianceView() {
  const { sectorId, sector } = useSector()
  const compliance = getSectorCompliance(sectorId)
  const scores = computeComplianceScore(compliance)
  const [toasts, setToasts] = useState<ToastMsg[]>([])

  const showToast = (text: string) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, text }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }

  const sortedAgents = [...compliance.agents].sort(
    (a, b) => RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel]
  )

  const entitiesWithData = compliance.entities.filter(e => e.personalData)
  const dpiaCount = scores.dpiaRequired
  const highRiskCount = scores.highRiskCount

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Toast container */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className="bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2 animate-pulse">
            <CheckCircle2 size={15} className="text-teal-400 shrink-0" />
            {t.text}
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck size={22} className="text-teal-600" />
              <h1 className="text-xl font-bold text-gray-900">Compliance &amp; Governance</h1>
            </div>
            <p className="text-sm text-gray-500">
              GDPR data map and EU AI Act risk register — sector{' '}
              <span className="font-medium text-gray-700">{sector.name}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => showToast('ROPA generated — downloading')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <FileText size={14} /> Generate ROPA
            </button>
            <button
              onClick={() => showToast('DPA Checklist downloaded — downloading')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm hover:bg-teal-700 transition-colors"
            >
              <Download size={14} /> Download DPA
            </button>
          </div>
        </div>

        {/* Stat chips */}
        <div className="flex flex-wrap gap-2 mt-4">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-600">
            <Database size={13} className="text-blue-500" />
            <span><strong>{entitiesWithData.length}</strong> entities with personal data</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-600">
            <Clock size={13} className="text-amber-500" />
            <span><strong>{dpiaCount}</strong> DPIA required</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-600">
            <AlertTriangle size={13} className="text-red-500" />
            <span><strong>{highRiskCount}</strong> high-risk AI agents</span>
          </div>
        </div>
      </div>

      {/* Score bars */}
      <div className="flex gap-4 mb-6">
        <ScoreBar
          label="GDPR Score"
          score={scores.gdprScore}
          icon={<ShieldCheck size={16} className="text-gray-500" />}
        />
        <ScoreBar
          label="EU AI Act Score"
          score={scores.aiActScore}
          icon={<Bot size={16} className="text-gray-500" />}
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-12 gap-5">
        {/* GDPR Data Map */}
        <div className="col-span-7">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <Database size={16} className="text-blue-500" />
              <h2 className="text-sm font-semibold text-gray-800">GDPR Data Map</h2>
              <ChevronRight size={14} className="text-gray-400 ml-auto" />
              <span className="text-xs text-gray-400">{compliance.entities.length} entities</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {['Entity', 'Personal data', 'Category', 'Lawful basis', 'Retention', 'Residency', 'DPIA'].map(h => (
                      <th key={h} className="px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {compliance.entities.map(entity => (
                    <GdprRow key={entity.entityId} entity={entity} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* EU AI Act Risk Register */}
        <div className="col-span-5">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <Bot size={16} className="text-purple-500" />
              <h2 className="text-sm font-semibold text-gray-800">EU AI Act Risk Register</h2>
              <ChevronRight size={14} className="text-gray-400 ml-auto" />
              <span className="text-xs text-gray-400">{compliance.agents.length} agents</span>
            </div>
            <div className="p-3 flex flex-col gap-2.5">
              {sortedAgents.map(agent => (
                <AgentCard key={agent.agentId} agent={agent} />
              ))}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => showToast('DPIA scheduled — check your calendar')}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Info size={14} className="text-teal-500" /> Schedule DPIA
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer note */}
      <p className="mt-5 text-xs text-gray-400 flex items-center gap-1.5">
        <Info size={12} />
        Scores are computed automatically based on the sector risk profile. They do not replace professional legal advice.
      </p>
    </div>
  )
}
