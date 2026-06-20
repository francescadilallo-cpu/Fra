import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Search, LayoutDashboard, GitBranch, MessageSquare, Table2, Workflow, Presentation,
  Settings, Wand2, BotMessageSquare, Download, Play, Factory, ShoppingCart, Heart,
  Banknote, Plug, Network, type LucideIcon,
} from 'lucide-react'
import { useSector } from '../contexts/SectorContext'
import type { NavTab } from '../types'
import type { SectorId } from '../data/sectors'
import { IS_DEMO_MODE } from '../lib/demoMode'

interface Command {
  id: string
  label: string
  group: string
  icon: LucideIcon
  keywords?: string
  shortcut?: string
  action: () => void
  disabled?: boolean
}

interface Props {
  onNavigate: (tab: NavTab) => void
}

const SECTOR_ICONS: Record<SectorId, LucideIcon> = {
  manufacturing: Factory,
  retail:        ShoppingCart,
  healthcare:    Heart,
  finance:       Banknote,
}

const SECTOR_LABELS: Record<SectorId, string> = {
  manufacturing: 'Manufacturing',
  retail:        'Retail',
  healthcare:    'Healthcare',
  finance:       'Finance',
}

export default function CommandPalette({ onNavigate }: Props) {
  const { setSector, sectorId } = useSector()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Global keyboard listener
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // External open event (so header button can open palette)
  useEffect(() => {
    function handler() { setOpen(true) }
    window.addEventListener('open-command-palette', handler)
    return () => window.removeEventListener('open-command-palette', handler)
  }, [])

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30)
      setQuery('')
      setSelectedIdx(0)
    }
  }, [open])

  function go(tab: NavTab) { onNavigate(tab); setOpen(false) }
  function switchSector(id: SectorId) { setSector(id); setOpen(false) }

  function exportReport() {
    onNavigate('dashboard')
    setTimeout(() => window.dispatchEvent(new CustomEvent('trigger-export-report')), 220)
    setOpen(false)
  }

  function triggerPipeline() {
    onNavigate('process')
    setTimeout(() => window.dispatchEvent(new CustomEvent('trigger-pipeline-run')), 280)
    setOpen(false)
  }

  const commands: Command[] = useMemo(() => {
    const navItems: Array<{ tab: NavTab; label: string; icon: LucideIcon; kw?: string }> = [
      { tab: 'overview',  label: 'Overview',        icon: Presentation,      kw: 'home start landing pitch' },
      { tab: 'dashboard', label: 'Dashboard',       icon: LayoutDashboard,   kw: 'kpi metrics chart' },
      { tab: 'ontology',  label: 'Entity Graph',     icon: GitBranch,         kw: 'graph schema entities ontology' },
      { tab: 'builder',   label: 'Builder AI',      icon: Wand2,             kw: 'ai generate entities editor' },
      { tab: 'agents',    label: 'Agents',          icon: BotMessageSquare,  kw: 'ai automation findings' },
      { tab: 'sources',   label: 'Data Sources',    icon: Plug,              kw: 'connect csv upload teamsystem shopify integrations' },
      { tab: 'data',      label: 'Data Explorer',   icon: Table2,            kw: 'browse table records' },
      { tab: 'query',     label: 'Query AI',        icon: MessageSquare,     kw: 'ask question nlp sql chat' },
      { tab: 'sembuilder', label: 'Data Model',        icon: Network,          kw: 'erp field mapping definitions metrics bridges' },
      { tab: 'process',   label: 'Process',         icon: Workflow,          kw: 'pipeline lifecycle funnel' },
      { tab: 'config',    label: 'Configuration',   icon: Settings,          kw: 'settings admin users tokens' },
    ]

    const navCommands: Command[] = navItems.map(n => ({
      id: `nav-${n.tab}`,
      label: `Go to ${n.label}`,
      group: 'Navigate',
      icon: n.icon,
      keywords: n.kw,
      action: () => go(n.tab),
    }))

    // Sector switching is a demo concept — live workspaces have no sectors.
    const sectorCommands: Command[] = (IS_DEMO_MODE ? (['manufacturing','retail','healthcare','finance'] as SectorId[]) : [])
      .filter(id => id !== sectorId)
      .map(id => ({
        id: `sector-${id}`,
        label: `Switch to ${SECTOR_LABELS[id]}`,
        group: 'Sector',
        icon: SECTOR_ICONS[id],
        keywords: `sector switch template ${id}`,
        action: () => switchSector(id),
      }))

    const actionCommands: Command[] = [
      {
        id: 'action-report',
        label: 'Generate Executive Report',
        group: 'Actions',
        icon: Download,
        keywords: 'pdf html download export',
        action: exportReport,
      },
      {
        id: 'action-pipeline',
        label: 'Run Semantic Pipeline',
        group: 'Actions',
        icon: Play,
        keywords: 'pipeline extract enrich index sync refresh',
        action: triggerPipeline,
      },
      {
        id: 'action-ask',
        label: 'Ask AI a Question',
        group: 'Actions',
        icon: MessageSquare,
        keywords: 'query nlp natural language ask',
        action: () => go('query'),
      },
    ]

    return [...navCommands, ...sectorCommands, ...actionCommands]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorId])

  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.group.toLowerCase().includes(q) ||
      (c.keywords?.toLowerCase().includes(q) ?? false)
    )
  }, [query, commands])

  useEffect(() => { setSelectedIdx(0) }, [query])

  // Scroll selected item into view
  useEffect(() => {
    if (!open || !listRef.current) return
    const items = listRef.current.querySelectorAll<HTMLButtonElement>('[data-cmd-item]')
    items[selectedIdx]?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx, open])

  const grouped = useMemo(() => {
    const groups: Record<string, Command[]> = {}
    for (const c of filtered) {
      ;(groups[c.group] ??= []).push(c)
    }
    return groups
  }, [filtered])

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(filtered.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      filtered[selectedIdx]?.action()
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[18vh] bg-slate-900/40 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent text-sm outline-none placeholder-slate-400 text-slate-900"
          />
          <kbd className="text-[10px] font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200">esc</kbd>
        </div>

        {/* List */}
        <div ref={listRef} className="max-h-[440px] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-10">
              No commands match "<span className="text-slate-600 font-medium">{query}</span>"
            </p>
          ) : (
            Object.entries(grouped).map(([group, cmds]) => (
              <div key={group} className="mb-1">
                <p className="px-4 pt-2 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">{group}</p>
                {cmds.map(c => {
                  const idx = filtered.indexOf(c)
                  const isSelected = idx === selectedIdx
                  const Icon = c.icon
                  return (
                    <button
                      key={c.id}
                      data-cmd-item
                      onClick={c.action}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                        isSelected ? 'bg-teal-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <Icon className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-teal-600' : 'text-slate-400'}`} />
                      <span className={`text-sm flex-1 ${isSelected ? 'text-teal-900 font-medium' : 'text-slate-700'}`}>
                        {c.label}
                      </span>
                      {isSelected && (
                        <kbd className="text-[10px] font-mono bg-white border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded">↵</kbd>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 bg-slate-50 text-[10px] text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><kbd className="font-mono bg-white border border-slate-200 px-1 rounded">↑↓</kbd>navigate</span>
            <span className="flex items-center gap-1"><kbd className="font-mono bg-white border border-slate-200 px-1 rounded">↵</kbd>select</span>
            <span className="flex items-center gap-1"><kbd className="font-mono bg-white border border-slate-200 px-1 rounded">esc</kbd>close</span>
          </div>
          <span className="text-slate-500 font-semibold">SemanticIntelligence</span>
        </div>
      </div>
    </div>
  )
}
