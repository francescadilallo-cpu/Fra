/**
 * CurationPanel — "why is this table (not) in my model?"
 *
 * Shows the curation report (kept / excluded / uncertain with the rule or
 * signal that decided each table) and lets the user flip any decision —
 * exclusions are reversible, nothing is ever deleted. Admins can also ask
 * the AI advisor to judge the uncertain tables (merge suggestions land in
 * the approval queue, they never auto-execute).
 */
import { useCallback, useEffect, useState } from 'react'
import { Filter, RefreshCw, Sparkles, Eye, EyeOff, Loader2, ChevronDown, ChevronRight, X } from 'lucide-react'
import {
  getCurationReport, setCurationDecision, runCuration, runCurationAdvisor,
  type CurationAdviseResult, type CurationDecision, type CurationReport,
} from '../api/curation'
import { getAuthToken } from '../api/client'
import { backendErrorMessage } from '../api/semantic'
import { toast } from './Toast'

function isAdmin(): boolean {
  const token = getAuthToken()
  if (!token) return false
  try {
    const b64 = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/')
    if (!b64) return false
    const payload = JSON.parse(atob(b64)) as Record<string, unknown>
    return payload.role === 'admin'
  } catch { return false }
}

const PROVENANCE_LABEL: Record<CurationDecision['decided_by'], string> = {
  rule: 'rule',
  signal: 'auto',
  llm: 'AI',
  user: 'you',
}

function DecisionRow({ d, onFlip, busy }: {
  d: CurationDecision
  onFlip: (table: string, to: 'kept' | 'excluded') => void
  busy: boolean
}) {
  const flipTo = d.status === 'excluded' ? 'kept' : 'excluded'
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-50 group">
      <span className="font-mono text-[11px] text-slate-700 truncate flex-shrink min-w-0">{d.table}</span>
      <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full flex-shrink-0" title={d.reason}>
        {PROVENANCE_LABEL[d.decided_by]} · {d.reason.length > 42 ? d.reason.slice(0, 42) + '…' : d.reason}
      </span>
      <button
        onClick={() => onFlip(d.table, flipTo)}
        disabled={busy}
        className="ml-auto flex items-center gap-1 text-[11px] text-slate-400 hover:text-teal-600 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-40 flex-shrink-0"
        title={flipTo === 'excluded' ? 'Hide from the model (reversible)' : 'Restore into the model'}
      >
        {flipTo === 'excluded' ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        {flipTo === 'excluded' ? 'Exclude' : 'Restore'}
      </button>
    </div>
  )
}

function Section({ title, items, tone, onFlip, busy, defaultOpen }: {
  title: string
  items: CurationDecision[]
  tone: string
  onFlip: (table: string, to: 'kept' | 'excluded') => void
  busy: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  if (items.length === 0) return null
  return (
    <div className="border border-slate-100 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-left transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
        <span className="text-xs font-semibold text-slate-700">{title}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tone}`}>{items.length}</span>
      </button>
      {open && (
        <div className="p-1.5 max-h-56 overflow-y-auto">
          {items.map(d => <DecisionRow key={d.table} d={d} onFlip={onFlip} busy={busy} />)}
        </div>
      )}
    </div>
  )
}

function pct(confidence?: number): string {
  return confidence == null ? '' : ` · ${Math.round(confidence * 100)}%`
}

function AdviseOutcome({ res, onClose }: { res: CurationAdviseResult; onClose: () => void }) {
  const skipped = res.skipped_low_confidence ?? []
  const cooldown = res.on_cooldown ?? []
  return (
    <div className="border border-indigo-100 bg-indigo-50/50 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
        <span className="text-xs font-semibold text-slate-700">AI review outcome</span>
        <span className="text-[11px] text-slate-400">
          {res.applied.length} applied · {res.merge_proposals.length} merge proposal{res.merge_proposals.length === 1 ? '' : 's'}
        </span>
        <button onClick={onClose} className="ml-auto text-slate-300 hover:text-slate-500" title="Dismiss">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {res.merge_proposals.length > 0 && (
        <div className="space-y-1">
          {res.merge_proposals.map((m, i) => (
            <div key={i} className="text-[11px] text-slate-500 flex items-baseline gap-1.5 flex-wrap">
              <span className="font-mono text-slate-700">{m.table}</span>
              <span>→</span>
              <span className="font-mono text-slate-700">{m.with_entity}</span>
              {m.queued.startsWith('pending_approval') ? (
                <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">awaiting your approval</span>
              ) : m.queued.startsWith('denied') ? (
                <span className="text-[10px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full" title={m.queued}>blocked — previously rejected</span>
              ) : (
                <span className="text-[10px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full" title={m.queued}>not queued</span>
              )}
              <span className="text-slate-400" title={m.reason}>{m.reason.length > 60 ? m.reason.slice(0, 60) + '…' : m.reason}{pct(m.confidence)}</span>
            </div>
          ))}
        </div>
      )}
      {skipped.length > 0 && (
        <div className="text-[11px] text-slate-500">
          <span className="font-medium text-slate-600">Left for you to review (AI not confident enough):</span>
          <div className="mt-0.5 space-y-0.5">
            {skipped.map((s, i) => (
              <div key={i} className="flex items-baseline gap-1.5 flex-wrap">
                <span className="font-mono text-slate-700">{s.table}</span>
                <span className="text-slate-400">
                  {s.merge_with ? `merge with ${s.merge_with}` : s.decision}{pct(s.confidence)} — {s.reason.length > 60 ? s.reason.slice(0, 60) + '…' : s.reason}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {cooldown.length > 0 && (
        <p className="text-[11px] text-slate-400">
          {cooldown.length} table{cooldown.length === 1 ? '' : 's'} skipped — already reviewed recently with low confidence. They stay under “Needs review”.
        </p>
      )}
    </div>
  )
}

export default function CurationPanel() {
  const [report, setReport] = useState<CurationReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [advising, setAdvising] = useState(false)
  const [adviseResult, setAdviseResult] = useState<CurationAdviseResult | null>(null)

  const refresh = useCallback(() => {
    getCurationReport().then(setReport).catch(() => {})
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const handler = () => refresh()
    window.addEventListener('pipeline-run-updated', handler)
    return () => window.removeEventListener('pipeline-run-updated', handler)
  }, [refresh])

  const flip = useCallback(async (table: string, to: 'kept' | 'excluded') => {
    setBusy(true)
    try {
      await setCurationDecision(table, to)
      toast(to === 'excluded' ? `${table} hidden from the model` : `${table} restored`, 'success')
      refresh()
    } catch (err) {
      toast(backendErrorMessage(err) || 'Could not update the decision', 'error')
    } finally { setBusy(false) }
  }, [refresh])

  const rerun = useCallback(async () => {
    setBusy(true)
    try {
      setReport(await runCuration())
      toast('Curation re-run complete', 'success')
    } catch (err) {
      toast(backendErrorMessage(err) || 'Curation run failed', 'error')
    } finally { setBusy(false) }
  }, [])

  const advise = useCallback(async () => {
    setAdvising(true)
    setAdviseResult(null)
    try {
      const res = await runCurationAdvisor()
      const n = res.applied.length
      const m = res.merge_proposals.length
      toast(
        res.note ?? `AI review: ${n} decision${n === 1 ? '' : 's'} applied, ${m} merge proposal${m === 1 ? '' : 's'} queued for approval`,
        'success',
      )
      setAdviseResult(res)
      refresh()
    } catch (err) {
      toast(
        backendErrorMessage(err) || (err instanceof Error ? err.message : 'AI review unavailable'),
        'error',
      )
    } finally { setAdvising(false) }
  }, [refresh])

  if (!report) return null
  const total = (report.counts.kept ?? 0) + (report.counts.excluded ?? 0) + (report.counts.uncertain ?? 0)
  if (total === 0) return null

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-teal-600" />
        <h3 className="text-sm font-semibold text-slate-900">Schema curation</h3>
        <span className="text-xs text-slate-400">
          {report.counts.kept ?? 0} in the model · {report.counts.excluded ?? 0} excluded · {report.counts.uncertain ?? 0} to review
        </span>
        <div className="ml-auto flex items-center gap-2">
          {isAdmin() && (report.counts.uncertain ?? 0) > 0 && (
            <button
              onClick={advise}
              disabled={advising || busy}
              className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-40 transition-colors"
              title="Let the AI judge the uncertain tables — merge suggestions go to the approval queue"
            >
              {advising ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              AI review
            </button>
          )}
          <button
            onClick={rerun}
            disabled={busy || advising}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-40 transition-colors"
            title="Re-run the curation rules (e.g. after editing the skill pack)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
            Re-run
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Every table gets a decision with its reason. Exclusions only hide a table from the model — the data stays in place and one click restores it.
      </p>
      {advising && (
        <p className="text-[11px] text-indigo-500 flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          AI review in progress — this can take up to a minute, you can keep working.
        </p>
      )}
      {adviseResult && <AdviseOutcome res={adviseResult} onClose={() => setAdviseResult(null)} />}
      <div className="space-y-2">
        <Section title="Needs review" items={report.uncertain} tone="bg-amber-100 text-amber-700" onFlip={flip} busy={busy} defaultOpen />
        <Section title="Excluded from the model" items={report.excluded} tone="bg-slate-200 text-slate-600" onFlip={flip} busy={busy} />
        <Section title="In the model" items={report.kept} tone="bg-teal-100 text-teal-700" onFlip={flip} busy={busy} />
      </div>
    </div>
  )
}
