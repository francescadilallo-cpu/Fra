import { useState, useEffect } from 'react'
import { CheckCircle2, XCircle, Info, X } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: string
  message: string
  type: ToastType
}

type Action =
  | { kind: 'add'; item: ToastItem }
  | { kind: 'remove'; id: string }

// ── Global event bus (no React context needed) ────────────────────────────────

const _listeners: Array<(a: Action) => void> = []

export function toast(message: string, type: ToastType = 'info', duration = 3500) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  _listeners.forEach(fn => fn({ kind: 'add', item: { id, message, type } }))
  setTimeout(() => _listeners.forEach(fn => fn({ kind: 'remove', id })), duration)
}

// ── Toaster (mount once in App) ───────────────────────────────────────────────

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    const listener = (a: Action) => {
      if (a.kind === 'add') {
        setItems(prev => [...prev.slice(-4), a.item])
      } else {
        setItems(prev => prev.filter(x => x.id !== a.id))
      }
    }
    _listeners.push(listener)
    return () => {
      const idx = _listeners.indexOf(listener)
      if (idx >= 0) _listeners.splice(idx, 1)
    }
  }, [])

  if (items.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
      {items.map(item => (
        <ToastChip
          key={item.id}
          item={item}
          onDismiss={() => setItems(prev => prev.filter(x => x.id !== item.id))}
        />
      ))}
    </div>
  )
}

// ── Individual chip ───────────────────────────────────────────────────────────

const CHIP_CFG = {
  success: { bg: 'bg-emerald-600', icon: <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> },
  error:   { bg: 'bg-red-600',     icon: <XCircle      className="w-4 h-4 flex-shrink-0" /> },
  info:    { bg: 'bg-slate-800',   icon: <Info         className="w-4 h-4 flex-shrink-0" /> },
}

function ToastChip({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const { bg, icon } = CHIP_CFG[item.type]
  return (
    <div
      className={`${bg} text-white text-sm rounded-xl shadow-xl px-4 py-3 flex items-center gap-2.5 pointer-events-auto max-w-sm`}
    >
      {icon}
      <span className="flex-1 leading-snug">{item.message}</span>
      <button onClick={onDismiss} className="opacity-60 hover:opacity-100 ml-1 transition-opacity">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
