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

function StateIcon({ state }: { state: PipelineStageState }) {
  switch (state) {
    case 'running':
      return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
    case 'done':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />
    case 'error':
      return <XCircle className="h-5 w-5 text-red-500" />
    case 'skipped':
      return <MinusCircle className="h-5 w-5 text-gray-400" />
    default:
      return <Circle className="h-5 w-5 text-gray-300" />
  }
}

function StageRow({ stage }: { stage: PipelineStage }) {
  const meta = STAGE_META[stage.name] ?? { label: stage.name, detail: '' }
  const active = stage.state === 'running'
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-4 transition-all ${
        active ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="mt-0.5">
        <StateIcon state={stage.state} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-gray-900">{meta.label}</span>
          <span className="text-xs uppercase tracking-wide text-gray-400">{stage.state}</span>
        </div>
        <p className="mt-0.5 text-sm text-gray-500">{stage.detail || meta.detail}</p>
      </div>
    </div>
  )
}

function WarningRow({ w }: { w: VerificationWarning }) {
  const isAdvisory = w.severity === 'info'
  const color =
    w.severity === 'high' ? 'text-red-500' : w.severity === 'medium' ? 'text-amber-500' : 'text-gray-400'
  const Icon = isAdvisory ? Info : AlertTriangle
  return (
    <li className="flex items-start gap-2 text-sm text-gray-600">
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

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const poll = useCallback(async () => {
    try {
      const status = await getPipelineStatus()
      setRun(status)
      if (!status.running) stopPolling()
    } catch {
      stopPolling()
    }
  }, [stopPolling])

  // Load any existing run on mount; resume polling if one is in flight.
  useEffect(() => {
    void (async () => {
      try {
        const status = await getPipelineStatus()
        setRun(status)
        if (status.running && !pollRef.current) {
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
        toast(res.llm_used ? 'No changes matched your instruction' : 'AI not available — try the editor', 'info')
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

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
            <Sparkles className="h-6 w-6 text-blue-500" />
            Auto-Build
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Turn your documents and connected data sources into a working data model — automatically.
          </p>
        </div>
        <button
          onClick={() => void handleRun()}
          disabled={starting || running}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
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
          <div className="mt-6 flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-4">
            <span className="text-sm text-gray-600">
              {run?.ok ? 'Your data model is ready.' : 'Build finished with issues — review the stages above.'}
            </span>
            <button
              onClick={() => onNavigate('sembuilder')}
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Open data model preview <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          {verification && (
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-2">
                {verification.ok ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                )}
                <span className="font-medium text-gray-900">Verification</span>
                {typeof verification.summary?.faithfulness_score === 'number' && (
                  <span className="ml-auto text-xs text-gray-500">
                    Faithfulness {Math.round((verification.summary.faithfulness_score as number) * 100)}%
                    {' · '}
                    {verification.summary.templates_tested ?? 0} queries replayed
                  </span>
                )}
              </div>
              {issues.length === 0 ? (
                <p className="text-sm text-gray-500">No consistency issues found.</p>
              ) : (
                <ul className="space-y-1.5">
                  {issues.map((w, i) => (
                    <WarningRow key={i} w={w} />
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-blue-500" />
              <span className="font-medium text-gray-900">Refine by instruction</span>
            </div>
            <p className="mb-3 text-sm text-gray-500">
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
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={() => void handleIntegrate()}
                disabled={integrating || !instruction.trim()}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
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
