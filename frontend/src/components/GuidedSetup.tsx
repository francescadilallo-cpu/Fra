/**
 * GuidedSetup — the unified "Smart Setup" flow.
 *
 * Turns the four activation milestones (Connect → Build → Ask → Automate) into
 * one guided, sequential checklist. Each step links to the tab where the real
 * work happens; the "Build" step is where Smart Connect chains quality →
 * AI model proposal → auto-generated context behind the Run Setup action.
 *
 * Driven entirely by useJourneyProgress so it stays in sync with the sidebar
 * spine and never drifts from real system state.
 */
import { CheckCircle2, ArrowRight, Plug, Wand2, MessageSquare, BotMessageSquare, PartyPopper } from 'lucide-react'
import { useJourneyProgress, type JourneyStep } from '../data/journeyProgress'
import type { NavTab } from '../types'

interface Props {
  onNavigate: (tab: NavTab) => void
}

// Per-step presentation: icon, the CTA verb, and a one-line "what happens".
const STEP_META: Record<JourneyStep['id'], { icon: typeof Plug; cta: string; detail: string }> = {
  connect: {
    icon: Plug,
    cta: 'Connect data',
    detail: 'Add a database, file, or SaaS connector — your data stays in your workspace.',
  },
  model: {
    icon: Wand2,
    cta: 'Run setup',
    detail: 'We profile data quality, propose your model with AI, and auto-generate schema context.',
  },
  ask: {
    icon: MessageSquare,
    cta: 'Ask a question',
    detail: 'Ask in plain English — cross-source joins and ambiguous terms are handled for you.',
  },
  automate: {
    icon: BotMessageSquare,
    cta: 'Set up an agent',
    detail: 'Agents and workflows monitor your data continuously and surface what matters.',
  },
}

function StepRow({
  step,
  index,
  state,
  onNavigate,
}: {
  step: JourneyStep
  index: number
  state: 'done' | 'current' | 'upcoming'
  onNavigate: (tab: NavTab) => void
}) {
  const meta = STEP_META[step.id]
  const Icon = meta.icon
  return (
    <div
      className={`flex items-start gap-4 rounded-xl border p-4 transition-all ${
        state === 'current'
          ? 'bg-white border-teal-300 shadow-sm shadow-teal-100/60'
          : state === 'done'
            ? 'bg-teal-50/40 border-teal-100'
            : 'bg-white border-slate-200'
      }`}
    >
      {/* Status marker */}
      <div className="flex-shrink-0 mt-0.5">
        {state === 'done' ? (
          <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-white" />
          </div>
        ) : (
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
              state === 'current'
                ? 'bg-teal-100 text-teal-700 ring-2 ring-teal-300'
                : 'bg-slate-100 text-slate-400'
            }`}
          >
            {index + 1}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 flex-shrink-0 ${state === 'upcoming' ? 'text-slate-400' : 'text-teal-600'}`} />
          <p className={`text-sm font-semibold ${state === 'upcoming' ? 'text-slate-500' : 'text-slate-900'}`}>
            {step.label}
          </p>
          {state === 'done' && (
            <span className="text-[10px] font-bold uppercase tracking-wide text-teal-600 bg-teal-100 rounded px-1.5 py-0.5">
              Done
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">{meta.detail}</p>
      </div>

      {/* Action — only the current step gets a primary CTA */}
      <div className="flex-shrink-0 self-center">
        {state === 'current' ? (
          <button
            onClick={() => onNavigate(step.tab)}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand hover:brightness-110 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
          >
            {meta.cta}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        ) : state === 'done' ? (
          <button
            onClick={() => onNavigate(step.tab)}
            className="text-xs font-medium text-slate-400 hover:text-teal-600 transition-colors"
          >
            Open
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default function GuidedSetup({ onNavigate }: Props) {
  const { steps, doneCount, total, nextStep, loading } = useJourneyProgress()
  const allDone = doneCount === total
  const pct = Math.round((doneCount / total) * 100)

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 animate-pulse">
        <div className="h-4 w-40 bg-slate-100 rounded mb-4" />
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-slate-50 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (allDone) {
    return (
      <div className="bg-gradient-to-br from-teal-50 to-violet-50 border border-teal-200 rounded-2xl p-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-teal-100 flex items-center justify-center flex-shrink-0">
            <PartyPopper className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <p className="text-base font-bold text-slate-900">Your workspace is ready</p>
            <p className="text-sm text-slate-500 mt-0.5">
              All set up — ask a question or let an agent watch your data.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onNavigate('agents')}
            className="px-4 py-2 border border-slate-300 text-slate-600 text-sm font-semibold rounded-lg hover:bg-white transition-colors"
          >
            Agents
          </button>
          <button
            onClick={() => onNavigate('query')}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand hover:brightness-110 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
          >
            Ask a question
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  const currentId = nextStep?.id

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4 mb-1">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Set up your workspace</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Four steps to go from raw data to AI answers. Pick up where you left off.
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-2xl font-bold text-teal-600 leading-none">{doneCount}<span className="text-slate-300 text-lg">/{total}</span></p>
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-1">complete</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden my-4">
        <div className="h-full bg-teal-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>

      {/* Steps */}
      <div className="space-y-2.5">
        {steps.map((step, i) => (
          <StepRow
            key={step.id}
            step={step}
            index={i}
            state={step.done ? 'done' : step.id === currentId ? 'current' : 'upcoming'}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  )
}
