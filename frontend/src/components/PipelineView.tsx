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
import { Sparkles, CheckCircle2, XCircle, MinusCircle, Loader2, Circle, ArrowRight } from 'lucide-react'
import type { NavTab } from '../types'
import {
  runPipeline,
  getPipelineStatus,
  backendErrorMessage,
  type PipelineRun,
  type PipelineStage,
  type PipelineStageState,
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

export default function PipelineView({ onNavigate }: Props) {
  const [run, setRun] = useState<PipelineRun | null>(null)
  const [starting, setStarting] = useState(false)
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

  const running = run?.running ?? false
  const finished = run && !run.running

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
      )}
    </div>
  )
}
