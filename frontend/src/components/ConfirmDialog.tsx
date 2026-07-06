import { useState, useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'

// ── Global event bus ──────────────────────────────────────────────────────────

interface DialogOptions {
  title?: string
  message: string
  confirmLabel?: string
  dangerous?: boolean
}

type Resolver = (confirmed: boolean) => void

let _setDialog: ((d: (DialogOptions & { resolve: Resolver }) | null) => void) | null = null

export function showConfirm(
  message: string,
  opts?: Omit<DialogOptions, 'message'>,
): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    _setDialog?.({ message, resolve, ...opts })
  })
}

// ── Provider (mount once in App) ──────────────────────────────────────────────

export function ConfirmProvider() {
  const [dialog, setDialog] = useState<(DialogOptions & { resolve: Resolver }) | null>(null)

  useEffect(() => {
    _setDialog = setDialog
    return () => { _setDialog = null }
  }, [])

  if (!dialog) return null

  const close = (confirmed: boolean) => {
    dialog.resolve(confirmed)
    setDialog(null)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close(false)
    if (e.key === 'Enter') close(true)
  }

  return (
    <div
      className="fixed inset-0 z-[99999] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) close(false) }}
      onKeyDown={handleKey}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {dialog.dangerous && (
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
            )}
            <div>
              {dialog.title && (
                <h3 className="text-sm font-bold text-slate-900">{dialog.title}</h3>
              )}
              <p className={`text-sm text-slate-600 ${dialog.title ? 'mt-1' : ''}`}>
                {dialog.message}
              </p>
            </div>
          </div>
          <button
            onClick={() => close(false)}
            className="text-slate-400 hover:text-slate-600 p-1 rounded flex-shrink-0 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => close(false)}
            className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            autoFocus
          >
            Cancel
          </button>
          <button
            onClick={() => close(true)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors text-white ${
              dialog.dangerous
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-brand hover:brightness-110'
            }`}
          >
            {dialog.confirmLabel ?? (dialog.dangerous ? 'Delete' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
