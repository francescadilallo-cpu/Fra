import type { ReactNode } from 'react'
import { LayoutDashboard, GitBranch, MessageSquare, Table2, Activity, Workflow, Presentation } from 'lucide-react'
import type { NavTab } from '../types'

interface Props {
  activeTab: NavTab
  onTabChange: (tab: NavTab) => void
  children: ReactNode
}

const NAV_ITEMS: { id: NavTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: Presentation },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'ontology', label: 'Ontology', icon: GitBranch },
  { id: 'query', label: 'Query AI', icon: MessageSquare },
  { id: 'mappings', label: 'Mappings', icon: Table2 },
  { id: 'process', label: 'Processo', icon: Workflow },
]

export default function Layout({ activeTab, onTabChange, children }: Props) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 bg-navy-900 border-r border-navy-700 flex flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-navy-700">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-white leading-tight flex items-center gap-2">
                Semantic
                <span className="text-xs font-normal text-slate-500">v0.1 MVP</span>
              </div>
              <div className="text-xs text-teal-400 leading-tight">Intelligence</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">Semantic Data Layer Platform</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === id
                  ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-navy-700'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
              {id === 'overview' && activeTab !== 'overview' && (
                <span className="ml-auto text-[9px] font-bold bg-teal-600 text-white rounded px-1 py-0.5 leading-none">
                  NEW
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-navy-700">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
            <span className="text-xs text-slate-500">Demo · Dati Mock</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">Manufacturing Ontology v1.0</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-navy-950">
        {children}
      </main>
    </div>
  )
}
