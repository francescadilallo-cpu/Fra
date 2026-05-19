import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LayoutDashboard, GitBranch, MessageSquare, Table2, Workflow, Presentation, Settings, ChevronDown, Brain } from 'lucide-react'
import type { NavTab } from '../types'
import { useSector } from '../contexts/SectorContext'
import { SECTORS, type SectorId } from '../data/sectors'

interface Props {
  activeTab: NavTab
  onTabChange: (tab: NavTab) => void
  children: ReactNode
}

const NAV_ITEMS: { id: NavTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview',  label: 'Overview',       icon: Presentation },
  { id: 'dashboard', label: 'Dashboard',      icon: LayoutDashboard },
  { id: 'ontology',  label: 'Ontologia',      icon: GitBranch },
  { id: 'query',     label: 'Query AI',       icon: MessageSquare },
  { id: 'mappings',  label: 'Mappings',       icon: Table2 },
  { id: 'process',   label: 'Processo',       icon: Workflow },
  { id: 'config',    label: 'Configurazione', icon: Settings },
]

function SectorSwitcher() {
  const { sectorId, sector, setSector } = useSector()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-teal-300 text-sm transition-colors"
      >
        <span className="text-base leading-none">{sector.icon}</span>
        <span className="font-medium text-slate-900">{sector.name}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1.5 w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Seleziona settore</p>
          </div>
          {(Object.keys(SECTORS) as SectorId[]).map((id) => {
            const s = SECTORS[id]
            const isActive = id === sectorId
            return (
              <button
                key={id}
                onClick={() => { setSector(id); setOpen(false) }}
                className={`w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors ${
                  isActive ? 'bg-teal-50' : 'hover:bg-slate-50'
                }`}
              >
                <span className="text-xl leading-none mt-0.5">{s.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${isActive ? 'text-teal-700' : 'text-slate-900'}`}>{s.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{s.domain}</p>
                </div>
                {isActive && <span className="text-[10px] font-bold bg-teal-600 text-white rounded px-1.5 py-0.5 leading-none mt-1">ATTIVO</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Layout({ activeTab, onTabChange, children }: Props) {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
        <div className="px-4 py-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-teal-600" />
            <span className="text-sm font-bold text-slate-900">
              Semantic<span className="text-teal-600">Intelligence</span>
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400 leading-tight">Semantic Data Layer Platform</p>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeTab === id
                  ? 'bg-teal-50 text-teal-700 font-medium'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
              {id === 'overview' && activeTab !== 'overview' && (
                <span className="ml-auto text-[9px] font-bold bg-teal-600 text-white rounded px-1 py-0.5 leading-none">NEW</span>
              )}
              {id === 'config' && activeTab !== 'config' && (
                <span className="ml-auto text-[9px] font-bold bg-amber-500 text-white rounded px-1 py-0.5 leading-none">NEW</span>
              )}
            </button>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
            <span className="text-xs text-slate-400">Demo · Dati Mock</span>
          </div>
          <p className="mt-1 text-xs text-slate-300">v0.2 MVP · Multi-Sector</p>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="h-14 border-b border-slate-200 bg-white flex items-center justify-end px-6 flex-shrink-0 gap-3">
          <span className="text-xs text-slate-400">Settore attivo:</span>
          <SectorSwitcher />
        </div>
        <div className="flex-1 overflow-auto bg-slate-50">
          {children}
        </div>
      </main>
    </div>
  )
}
