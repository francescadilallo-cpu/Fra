import type { ReactNode } from 'react'
import { LayoutDashboard, GitBranch, MessageSquare, Table2, Workflow } from 'lucide-react'
import type { NavTab } from '../types'

interface Props {
  activeTab: NavTab
  onTabChange: (tab: NavTab) => void
  children: ReactNode
}

const NAV_ITEMS: { id: NavTab; label: string; icon: typeof LayoutDashboard }[] = [
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
      <aside className="w-56 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 bg-teal-600 rounded-full flex-shrink-0" />
            <div>
              <div className="text-sm font-semibold text-slate-900 leading-tight">
                Semantic<span className="font-bold">Intelligence</span>
              </div>
              <div className="text-xs text-slate-400 leading-tight mt-0.5">v0.1 MVP</div>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-400">Semantic Data Layer Platform</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                activeTab === id
                  ? 'bg-teal-50 text-teal-700 font-medium'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-200">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
            <span className="text-xs text-slate-400">Demo · Dati Mock</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">Manufacturing Ontology v1.0</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-slate-50">
        {children}
      </main>
    </div>
  )
}
