import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LayoutDashboard, GitBranch, MessageSquare, Table2, Workflow, Presentation, Settings, ChevronDown, ChevronRight, Brain, Wand2, BotMessageSquare, Command, Plug, ShieldCheck, LogOut, Building2, Plus, Trash2, Check, CheckCircle2, ArrowRight, Briefcase, Network, BookOpenCheck, Sparkles, Database } from 'lucide-react'
import { listCompanies, getCurrentCompanyId, switchToCompany, deleteCompany, type Company } from '../data/companies'
import type { NavTab } from '../types'
import { useSector } from '../contexts/SectorContext'
import { SECTORS, type SectorId } from '../data/sectors'
import { useAgentStore, countFindings } from '../data/agentStore'
import { useJourneyProgress, type JourneyProgress } from '../data/journeyProgress'
import CommandPalette from './CommandPalette'
import { showConfirm } from './ConfirmDialog'
import { IS_DEMO_MODE, workspaceLabel } from '../lib/demoMode'
import { getWorkspace } from '../api/workspace'

interface Props {
  activeTab: NavTab
  onTabChange: (tab: NavTab) => void
  children: ReactNode
}

// ── Navigation: five value stages mapping the user's journey ──────────────────
// The 13 features are grouped into the buyer's mental model rather than a flat
// list. Each stage maps (where applicable) to a journey milestone so the stage
// header can show a completion check. Advanced stages collapse by default.

type NavItemDef = { id: NavTab; label: string; icon: typeof LayoutDashboard }

interface NavStage {
  id: 'connect' | 'model' | 'ask' | 'automate' | 'govern'
  label: string
  items: NavItemDef[]
}

const NAV_STAGES: NavStage[] = [
  {
    id: 'connect',
    label: 'Connect',
    items: [
      { id: 'sources', label: 'Data Sources',  icon: Plug },
      { id: 'data',    label: 'Data Explorer',  icon: Table2 },
    ],
  },
  {
    id: 'model',
    label: 'Model',
    items: [
      { id: 'ontology',   label: 'Entity Graph', icon: GitBranch },
      { id: 'builder',    label: 'Builder AI',   icon: Wand2 },
      { id: 'sembuilder', label: 'Data Model',   icon: Network },
      { id: 'context',    label: 'Context',      icon: BookOpenCheck },
      { id: 'process',    label: 'Setup',        icon: Workflow },
    ],
  },
  {
    id: 'ask',
    label: 'Ask',
    items: [
      { id: 'query',     label: 'Query AI',  icon: MessageSquare },
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    id: 'automate',
    label: 'Automate',
    items: [
      { id: 'agents', label: 'Agents', icon: BotMessageSquare },
    ],
  },
  {
    id: 'govern',
    label: 'Govern',
    items: [
      { id: 'compliance', label: 'Compliance',    icon: ShieldCheck },
      { id: 'config',     label: 'Configuration', icon: Settings },
    ],
  },
]

// Stages collapsed by default on first run (progressive disclosure: advanced
// model + admin tabs stay tucked away until the user goes looking for them).
const DEFAULT_COLLAPSED = ['model', 'govern']

function NavItem({ item, activeTab, onClick }: { item: NavItemDef; activeTab: NavTab; onClick: (t: NavTab) => void }) {
  const isActive = activeTab === item.id
  const Icon = item.icon
  return (
    <button
      onClick={() => onClick(item.id)}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${
        isActive
          ? 'bg-teal-500/10 text-teal-300 font-medium ring-1 ring-teal-500/20'
          : 'text-slate-400 hover:text-slate-100 hover:bg-white/5'
      }`}
    >
      <Icon className={`w-4 h-4 flex-shrink-0 transition-colors ${isActive ? 'text-teal-400' : ''}`} />
      {item.label}
    </button>
  )
}

function ProgressSpine({ journey, onNavigate }: { journey: JourneyProgress; onNavigate: (t: NavTab) => void }) {
  const { doneCount, total, nextStep } = journey
  const pct = Math.round((doneCount / total) * 100)
  const allDone = doneCount === total

  return (
    <div className="mx-2 mb-1 rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Getting started</span>
        <span className="text-[10px] font-bold text-teal-300">{doneCount}/{total}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-2.5">
        <div className="h-full bg-teal-400 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      {allDone ? (
        <div className="flex items-center gap-1.5 text-[11px] text-teal-300 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" /> You&apos;re all set
        </div>
      ) : nextStep ? (
        <button
          onClick={() => onNavigate(nextStep.tab)}
          className="w-full flex items-center gap-2 rounded-lg bg-teal-500/15 hover:bg-teal-500/25 ring-1 ring-teal-500/25 px-2.5 py-1.5 text-left transition-colors group"
        >
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-teal-200 leading-tight">Next: {nextStep.label}</p>
            <p className="text-[10px] text-slate-400 truncate">{nextStep.hint}</p>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-teal-300 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
        </button>
      ) : null}
    </div>
  )
}

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
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-sm transition-all shadow-sm"
      >
        <span className="text-base leading-none">{sector.icon}</span>
        <span className="font-medium text-slate-800">{sector.name}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden ring-1 ring-black/5">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/80">
            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Switch sector</p>
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
                  <p className={`text-sm font-semibold ${isActive ? 'text-teal-700' : 'text-slate-800'}`}>{s.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{s.domain}</p>
                </div>
                {isActive && (
                  <span className="text-[10px] font-bold bg-teal-600 text-white rounded-md px-1.5 py-0.5 leading-none mt-1 tracking-wide">
                    ACTIVE
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CompanyMenu({ companyName }: { companyName: string }) {
  const { sector } = useSector()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [companies, setCompanies] = useState<Company[]>(() => listCompanies())
  const currentId = getCurrentCompanyId()

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', onDocClick)
      setCompanies(listCompanies())
    }
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const handleLogout = async () => {
    setOpen(false)
    const ok = await showConfirm(
      'The current company will be archived — you can restore it from the dropdown later.',
      { title: 'Close session?', confirmLabel: 'Close session' },
    )
    if (ok) window.dispatchEvent(new CustomEvent('logout-requested'))
  }

  const handleNewCompany = () => {
    setOpen(false)
    window.dispatchEvent(new CustomEvent('new-company-requested'))
  }

  const handleSwitch = (id: string) => {
    if (id === currentId) { setOpen(false); return }
    setOpen(false)
    switchToCompany(id)
    window.dispatchEvent(new CustomEvent('company-switched'))
  }

  const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation()
    if (id === currentId) {
      await showConfirm('Switch to another company before deleting this one.', { title: 'Cannot delete active company', confirmLabel: 'OK' })
      return
    }
    const ok = await showConfirm(`All archived data for "${name}" will be permanently lost.`, {
      title: `Delete "${name}"?`, dangerous: true,
    })
    if (ok) { deleteCompany(id); setCompanies(listCompanies()) }
  }

  const otherCompanies = companies.filter(c => c.id !== currentId)
    .sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt))

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors text-sm font-semibold text-slate-700 max-w-[200px]"
        title="Manage company"
      >
        <Building2 className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        <span className="truncate">{companyName}</span>
        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden ring-1 ring-black/5">
          {/* Current company header */}
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80">
            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Active company</p>
            <div className="flex items-center gap-2 mt-0.5">
              <Check className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />
              <p className="text-sm font-bold text-slate-900 truncate">{companyName}</p>
            </div>
            {IS_DEMO_MODE && (
              <p className="text-xs text-slate-500 mt-0.5">{sector.icon} {sector.name} · {sector.domain}</p>
            )}
          </div>

          {/* Other saved companies */}
          {otherCompanies.length > 0 && (
            <>
              <div className="px-4 pt-2.5 pb-1">
                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Your companies</p>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {otherCompanies.map(c => {
                  const s = SECTORS[c.sectorId]
                  return (
                    <div
                      key={c.id}
                      onClick={() => handleSwitch(c.id)}
                      className="group w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <span className="text-base flex-shrink-0">{s.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">{s.name}</p>
                      </div>
                      <button
                        onClick={(e) => handleDelete(e, c.id, c.name)}
                        className="w-6 h-6 rounded-md hover:bg-red-100 text-slate-300 hover:text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                        title="Delete company"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Actions */}
          <div className="border-t border-slate-100">
            <button
              onClick={handleNewCompany}
              className="w-full text-left px-4 py-2.5 flex items-start gap-3 hover:bg-teal-50 transition-colors"
            >
              <Plus className="w-4 h-4 text-teal-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-teal-700">New company</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-snug">Set up another company. The current one is archived.</p>
              </div>
            </button>
            <button
              onClick={handleLogout}
              className="w-full text-left px-4 py-2.5 flex items-start gap-3 hover:bg-slate-50 transition-colors border-t border-slate-100"
            >
              <LogOut className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">Log out</p>
<p className="text-xs text-slate-500 mt-0.5 leading-snug">Close session. All companies remain saved.</p>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function HeaderBar({ onTabChange }: { activeTab: NavTab; onTabChange: (t: NavTab) => void }) {
  const { sectorId } = useSector()
  const runs = useAgentStore(sectorId)
  const counts = countFindings(runs)
  const [companyName, setCompanyName] = useState<string | null>(() => localStorage.getItem('si-company-name'))

  useEffect(() => {
    const refresh = () => setCompanyName(localStorage.getItem('si-company-name'))
    window.addEventListener('company-name-changed', refresh)
    return () => window.removeEventListener('company-name-changed', refresh)
  }, [])

  useEffect(() => {
    if (!IS_DEMO_MODE && !companyName) {
      getWorkspace().then(ws => {
        if (ws.name) {
          localStorage.setItem('si-company-name', ws.name)
          setCompanyName(ws.name)
        }
      }).catch(() => {})
    }
  }, [])

  return (
    <div className="h-14 border-b border-slate-200/80 bg-white/95 backdrop-blur-sm flex items-center justify-between px-6 flex-shrink-0 shadow-sm">
      <div className="flex items-center gap-3">
        {counts.critical > 0 && (
          <button
            onClick={() => onTabChange('agents')}
            className="flex items-center gap-2 text-xs bg-red-50 border border-red-200 text-red-600 rounded-full px-3 py-1.5 hover:bg-red-100 transition-colors font-medium"
          >
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            {counts.critical} critical · View agents
          </button>
        )}
        {counts.critical === 0 && runs.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-3 py-1.5">
            <span className="w-1.5 h-1.5 bg-teal-400 rounded-full" />
            {runs.length} agent{runs.length !== 1 ? 's' : ''} · all clear
          </div>
        )}
      </div>
      <div className="flex items-center gap-2.5">
        {companyName ? (
          <>
            <CompanyMenu companyName={companyName} />
            <div className="w-px h-5 bg-slate-200" />
          </>
        ) : !IS_DEMO_MODE && (
          <>
            <button
              onClick={() => { onTabChange('config'); setTimeout(() => document.getElementById('workspace-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150) }}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-teal-600 border border-dashed border-slate-300 hover:border-teal-400 rounded-lg px-2.5 py-1 transition-colors"
              title="Set your workspace name"
            >
              <Building2 className="w-3 h-3" />
              Set up workspace
            </button>
            <div className="w-px h-5 bg-slate-200" />
          </>
        )}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-white hover:border-slate-300 hover:shadow-sm text-[11px] font-mono text-slate-400 hover:text-slate-600 transition-all"
          title="Open command palette (⌘K)"
        >
          <Command className="w-3 h-3" />
          <span className="font-sans font-medium">K</span>
        </button>
        <div className="w-px h-5 bg-slate-200" />
        {/* Mode badge — always visible so it's clear which workspace is active */}
        {IS_DEMO_MODE ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-2 py-1">
            <Sparkles className="w-3 h-3" />Demo
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] font-semibold bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2 py-1">
            <Database className="w-3 h-3" />Live
          </span>
        )}
        {/* Sectors are a demo concept — live workspaces have a single, real one */}
        {IS_DEMO_MODE && (
          <>
            <div className="w-px h-5 bg-slate-200" />
            <SectorSwitcher />
          </>
        )}
      </div>
    </div>
  )
}

const ALL_NAV_ITEMS: NavItemDef[] = [
  { id: 'overview', label: 'Home',      icon: Presentation },
  { id: 'usecases', label: 'Use Cases', icon: Briefcase },
  ...NAV_STAGES.flatMap(s => s.items),
]

const TAB_TITLES = Object.fromEntries(
  ALL_NAV_ITEMS.map(i => [i.id, i.label]),
) as Partial<Record<NavTab, string>>

export default function Layout({ activeTab, onTabChange, children }: Props) {
  const { sector } = useSector()
  const journey = useJourneyProgress()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('si-nav-collapsed')
      if (saved) return new Set(JSON.parse(saved) as string[])
    } catch {
      /* ignore */
    }
    return new Set(DEFAULT_COLLAPSED)
  })

  useEffect(() => {
    const label = TAB_TITLES[activeTab] ?? activeTab
    document.title = `${label} · ${workspaceLabel(sector.name)} — Fra`
  }, [activeTab, sector.name])

  function handleTabChange(tab: NavTab) {
    onTabChange(tab)
  }

  function toggleStage(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem('si-nav-collapsed', JSON.stringify([...next]))
      } catch {
        /* quota — non-critical */
      }
      return next
    })
  }

  // The stage holding the active tab is always shown expanded, regardless of
  // the collapsed preference, so the current location is never hidden.
  const activeStageId = NAV_STAGES.find(s => s.items.some(it => it.id === activeTab))?.id
  const stageDone = (id: NavStage['id']) => journey.steps.find(st => st.id === id)?.done ?? false

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      <CommandPalette onNavigate={handleTabChange} />

      {/* Sidebar — dark */}
      <aside className="w-56 flex-shrink-0 bg-slate-900 flex flex-col">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-teal-500/15 flex items-center justify-center ring-1 ring-teal-500/25">
              <Brain className="w-4 h-4 text-teal-400" />
            </div>
            <span className="text-sm font-bold text-white tracking-tight">
              Data<span className="text-teal-400">Intelligence</span>
            </span>
          </div>
          <p className="mt-2.5 text-[11px] text-slate-500 leading-tight">Data Intelligence Platform</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 overflow-y-auto sidebar-scrollbar">
          {/* Progress spine */}
          <ProgressSpine journey={journey} onNavigate={handleTabChange} />

          {/* Home + (demo) Use Cases */}
          <div className="mt-2 space-y-0.5">
            <NavItem item={{ id: 'overview', label: 'Home', icon: Presentation }} activeTab={activeTab} onClick={handleTabChange} />
            {IS_DEMO_MODE && (
              <NavItem item={{ id: 'usecases', label: 'Use Cases', icon: Briefcase }} activeTab={activeTab} onClick={handleTabChange} />
            )}
          </div>

          {/* Value stages */}
          <div className="mt-2">
            {NAV_STAGES.map((stage, si) => {
              const open = !collapsed.has(stage.id) || stage.id === activeStageId
              const done = stageDone(stage.id)
              return (
                <div key={stage.id} className="mt-1">
                  <button
                    onClick={() => toggleStage(stage.id)}
                    className="w-full flex items-center gap-1.5 px-3 pt-3 pb-1 group"
                  >
                    <span className="text-[10px] font-bold text-slate-600 tabular-nums">{si + 1}</span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 group-hover:text-slate-300 transition-colors">
                      {stage.label}
                    </span>
                    {done && <CheckCircle2 className="w-3 h-3 text-teal-500/70 flex-shrink-0" />}
                    <ChevronRight className={`w-3 h-3 text-slate-600 ml-auto transition-transform ${open ? 'rotate-90' : ''}`} />
                  </button>
                  {open && (
                    <div className="space-y-0.5">
                      {stage.items.map(item => (
                        <NavItem key={item.id} item={item} activeTab={activeTab} onClick={handleTabChange} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-white/5">
          <button
            onClick={async () => {
              const ok = await showConfirm('The current company will be archived — you can restore it from the dropdown later.', { title: 'Close session?', confirmLabel: 'Close session' })
              if (ok) {
                window.dispatchEvent(new CustomEvent('logout-requested'))
              }
            }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-100 hover:bg-white/5 transition-colors mb-2"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log out</span>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-teal-500 rounded-full" />
            <span className="text-xs text-slate-500">DataIntelligence</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-600">v0.2{IS_DEMO_MODE ? ' · Multi-Sector' : ''}</p>
          <p className="text-[10px] text-slate-700" title="Build timestamp">build {__BUILD_ID__}</p>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <HeaderBar activeTab={activeTab} onTabChange={onTabChange} />
        <div key={activeTab} className="flex-1 overflow-auto bg-slate-50 animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  )
}
