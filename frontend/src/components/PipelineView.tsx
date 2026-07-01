/**
 * PipelineView — the auto-build pipeline (Context → Sources → Data model).
 *
 * One button runs the server-side orchestrator, which analyses uploaded context
 * documents, reads the connected data sources, and auto-builds the data model
 * (entities, relations, metrics, query templates). The view polls run status and
 * shows live per-stage progress, then links to the resulting model preview.
 *
 * Stages 4–5 (manual/conversational integration, reliability agents) are wired
 * but report as "skipped" for now — the backend marks them as such.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, CheckCircle2, XCircle, MinusCircle, Loader2, Circle, ArrowRight, AlertTriangle, Info, Wand2 } from 'lucide-react'
import type { NavTab } from '../types'
import {
  runPipeline,
  getPipelineStatus,
  integrateModel,
  backendErrorMessage,
  type PipelineRun,
  type PipelineStage,
  type PipelineStageState,
  type VerificationWarning,
} from '../api/semantic'
import { toast } from './Toast'

interface Props {
  onNavigate: (tab: NavTab) => void
}

// Backend stage id → user-facing label + one-line description. Neutral business
// wording (no internal jargon) so it reads the same for live customers.
const STAGE_META: Record<string, { label: string; detail: string }> = {
  context: {
    label: '1 · Context',
    detail: 'Read your uploaded documents to learn your business vocabulary.',
  },
  sources: {
    label: '2 · Data sources',
    detail: 'Discover the tables across every connected source.',
  },
  build: {
    label: '3 · Build data model',
    detail: 'Propose and apply entities, relations and metrics automatically.',
  },
  integration: {
    label: '4 · Integration',
    detail: 'Refine the model manually or by conversation. (Coming soon)',
  },
  verification: {
    label: '5 · Verification',
    detail: 'Agents check reliability and consistency of the mapped data. (Coming soon)',
  },
}

const POLL_MS = 1500
// ~45s of transient backend unavailability tolerated before we give up polling.
const MAX_POLL_FAILS = 30

function StateIcon({ state }: { state: PipelineStageState }) {
  switch (state) {
    case 'running':
      return <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
    case 'done':
      return <CheckCircle2 className="h-5 w-5 text-teal-500" />
    case 'error':
      return <XCircle className="h-5 w-5 text-red-500" />
    case 'skipped':
      return <MinusCircle className="h-5 w-5 text-slate-300" />
    default:
      return <Circle className="h-5 w-5 text-slate-300" />
  }
}

function StageRow({ stage }: { stage: PipelineStage }) {
  const meta = STAGE_META[stage.name] ?? { label: stage.name, detail: '' }
  const active = stage.state === 'running'
  const errored = stage.state === 'error'
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl p-4 shadow-soft transition-all ring-1 ${
        errored
          ? 'bg-red-50 ring-red-200'
          : active
            ? 'bg-brand-soft ring-indigo-200/70'
            : 'bg-white ring-slate-900/[0.06]'
      }`}
    >
      <div className="mt-0.5">
        <StateIcon state={stage.state} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-slate-900">{meta.label}</span>
          <span className={`text-xs font-semibold uppercase tracking-wide ${errored ? 'text-red-500' : 'text-slate-400'}`}>{stage.state}</span>
        </div>
        <p className={`mt-0.5 text-sm ${errored ? 'text-red-700' : 'text-slate-500'}`}>{stage.detail || meta.detail}</p>
      </div>
    </div>
  )
}

function WarningRow({ w }: { w: VerificationWarning }) {
  const isAdvisory = w.severity === 'info'
  const color =
    w.severity === 'high' ? 'text-red-500' : w.severity === 'medium' ? 'text-amber-500' : 'text-slate-400'
  const Icon = isAdvisory ? Info : AlertTriangle
  return (
    <li className="flex items-start gap-2 text-sm text-slate-600">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
      <span>{w.detail}</span>
    </li>
  )
}

export default function PipelineView({ onNavigate }: Props) {
  const [run, setRun] = useState<PipelineRun | null>(null)
  const [starting, setStarting] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [integrating, setIntegrating] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Consecutive failed polls. A heavy stage-3 build can briefly starve the
  // backend's single worker (a 502/timeout reaches the browser as a CORS/
  // network error), so we tolerate a run of failures rather than giving up on
  // the first one — otherwise the UI would stick on "RUNNING" forever even
  // though the build finishes server-side.
  const pollFailsRef = useRef(0)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const poll = useCallback(async () => {
    try {
      const status = await getPipelineStatus()
      pollFailsRef.current = 0
      setRun(status)
      if (!status.running) stopPolling()
    } catch {
      pollFailsRef.current += 1
      if (pollFailsRef.current >= MAX_POLL_FAILS) {
        stopPolling()
        toast('Lost contact with the build — refresh to check its status.', 'error')
      }
      // else: transient — keep polling; the build is likely still running.
    }
  }, [stopPolling])

  // Load any existing run on mount; resume polling if one is in flight.
  useEffect(() => {
    void (async () => {
      try {
        const status = await getPipelineStatus()
        setRun(status)
        if (status.running && !pollRef.current) {
          pollFailsRef.current = 0
          pollRef.current = setInterval(() => void poll(), POLL_MS)
        }
      } catch {
        /* no run yet */
      }
    })()
    return stopPolling
  }, [poll, stopPolling])

  const handleRun = useCallback(async () => {
    setStarting(true)
    try {
      const started = await runPipeline()
      setRun(started)
      if (started.running && !pollRef.current) {
        pollFailsRef.current = 0
        pollRef.current = setInterval(() => void poll(), POLL_MS)
      } else {
        toast('Auto-build complete', started.ok ? 'success' : 'error')
      }
    } catch (e) {
      toast(backendErrorMessage(e), 'error')
    } finally {
      setStarting(false)
    }
  }, [poll])

  // Surface a toast when a polled run finishes.
  const prevRunning = useRef<boolean>(false)
  useEffect(() => {
    if (prevRunning.current && run && !run.running) {
      toast(run.ok ? 'Auto-build complete' : 'Auto-build finished with errors', run.ok ? 'success' : 'error')
    }
    prevRunning.current = run?.running ?? false
  }, [run])

  const handleIntegrate = useCallback(async () => {
    const text = instruction.trim()
    if (!text) return
    setIntegrating(true)
    try {
      const res = await integrateModel(text)
      if (res.applied.length === 0) {
        toast(res.notes || 'No changes matched your instruction', 'info')
      } else {
        toast(`Applied: ${res.applied.join(', ')}`, 'success')
        setInstruction('')
      }
    } catch (e) {
      toast(backendErrorMessage(e), 'error')
    } finally {
      setIntegrating(false)
    }
  }, [instruction])

  const running = run?.running ?? false
  const finished = run && !run.running
  const verification = run?.report?.verification
  const issues = [...(verification?.warnings ?? []), ...(verification?.advisory ?? [])]
  const erroredStages = (run?.stages ?? []).filter((s) => s.state === 'error')

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-900">
            <span className="brand-mark flex h-9 w-9 items-center justify-center rounded-xl">
              <Sparkles className="h-4 w-4 text-white" />
            </span>
            Auto-Build
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Turn your documents and connected data sources into a working data model — automatically.
          </p>
        </div>
        <button
          onClick={() => void handleRun()}
          disabled={starting || running}
          className="btn-primary shrink-0"
        >
          {starting || running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {running ? 'Building…' : 'Run auto-build'}
        </button>
      </div>

      <div className="space-y-3">
        {(run?.stages ?? Object.keys(STAGE_META).map((name) => ({
          name,
          state: 'pending' as PipelineStageState,
          detail: '',
          started_at: null,
          finished_at: null,
        }))).map((stage) => (
          <StageRow key={stage.name} stage={stage} />
        ))}
      </div>

      {finished && (
        <>
          {erroredStages.length > 0 && (
            <div className="mt-6 rounded-2xl bg-red-50 p-4 ring-1 ring-red-200 shadow-soft">
              <div className="mb-1.5 flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" />
                <span className="font-semibold text-slate-900">
                  {erroredStages.length === 1 ? 'A stage failed' : `${erroredStages.length} stages failed`}
                </span>
              </div>
              <ul className="space-y-1.5">
                {erroredStages.map((s) => (
                  <li key={s.name} className="text-sm text-red-700">
                    <span className="font-semibold">{STAGE_META[s.name]?.label ?? s.name}:</span>{' '}
                    {s.detail || 'failed without a message — check the backend logs.'}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => void handleRun()}
                disabled={starting || running}
                className="btn btn-secondary btn-sm mt-3"
              >
                <Loader2 className={`h-3.5 w-3.5 ${starting || running ? 'animate-spin' : 'hidden'}`} />
                Retry build
              </button>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] shadow-soft">
            <span className="text-sm text-slate-600">
              {run?.ok ? 'Your data model is ready.' : 'Build finished with issues — review the stages above.'}
            </span>
            <button
              onClick={() => onNavigate('sembuilder')}
              className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
            >
              Open data model preview <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          {verification && (
            <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] shadow-soft">
              <div className="mb-2 flex items-center gap-2">
                {verification.ok ? (
                  <CheckCircle2 className="h-5 w-5 text-teal-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                )}
                <span className="font-semibold text-slate-900">Verification</span>
                {typeof verification.summary?.faithfulness_score === 'number' && (
                  <span className="ml-auto text-xs text-slate-500">
                    Faithfulness {Math.round((verification.summary.faithfulness_score as number) * 100)}%
                    {' · '}
                    {verification.summary.templates_tested ?? 0} queries replayed
                  </span>
                )}
              </div>
              {issues.length === 0 ? (
                <p className="text-sm text-slate-500">No consistency issues found.</p>
              ) : (
                <ul className="space-y-1.5">
                  {issues.map((w, i) => (
                    <WarningRow key={i} w={w} />
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] shadow-soft">
            <div className="mb-2 flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-indigo-500" />
              <span className="font-semibold text-slate-900">Refine by instruction</span>
            </div>
            <p className="mb-3 text-sm text-slate-500">
              Adjust the model in plain language, e.g. “link orders to customers via customer_id”
              or “add a revenue metric = SUM(orders.total)”.
            </p>
            <div className="flex gap-2">
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleIntegrate()
                }}
                placeholder="Describe a change…"
                disabled={integrating}
                className="input flex-1"
              />
              <button
                onClick={() => void handleIntegrate()}
                disabled={integrating || !instruction.trim()}
                className="btn-primary shrink-0"
              >
                {integrating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Apply
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
