import type { ReactNode } from 'react'
import { LayoutDashboard, GitBranch, MessageSquare, Table2, Workflow, Presentation, Brain } from 'lucide-react'
import type { NavTab } from '../types'

interface Props {
  activeTab: NavTab
  onTabChange: (tab: NavTab) => void
  children: ReactNode
}

const NAV_ITEMS: { id: NavTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview',  label: 'Overview',   icon: Presentation },
  { id: 'dashboard', label: 'Dashboard',  icon: LayoutDashboard },
  { id: 'ontology',  label: 'Ontologia',  icon: GitBranch },
  { id: 'query',     label: 'Query AI',   icon: MessageSquare },
  { id: 'mappings',  label: 'Mappings',   icon: Table2 },
  { id: 'process',   label: 'Processo',   icon: Workflow },
]

export default function Layout({ activeTab, onTabChange, children }: Props) {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-teal-600" />
            <span className="text-sm font-bold text-slate-900">
              Semantic<span className="text-teal-600">Intelligence</span>
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400 leading-tight">Semantic Data Layer Platform</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-0.5">
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
                <span className="ml-auto text-[9px] font-bold bg-teal-600 text-white rounded px-1 py-0.5 leading-none">
                  NEW
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
            <span className="text-xs text-slate-400">Demo · Dati Mock</span>
          </div>
          <p className="mt-1 text-xs text-slate-300">v0.1 MVP</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-slate-50">
        {children}
      </main>
    </div>
  )
}
