/**
 * useJourneyProgress — single source of truth for the activation journey.
 *
 * Tracks the four milestones a workspace moves through, from empty to fully
 * operational:  Connect → Build → Ask → Automate.  Used by the sidebar
 * progress spine (Layout) and any other view that wants to nudge the user to
 * their next step.  Detection is derived from real backend/system state, with
 * a localStorage flag for the one milestone we can't infer server-side
 * (whether the user has asked a question yet).
 */
import { useState, useEffect, useCallback } from 'react'
import { useSector } from '../contexts/SectorContext'
import { useAgentStore } from './agentStore'
import { semanticStatus } from '../api/semantic'
import { listSources, type BackendSource } from '../api/sources'
import { IS_DEMO_MODE } from '../lib/demoMode'
import type { NavTab } from '../types'

export interface JourneyStep {
  id: 'connect' | 'model' | 'ask' | 'automate'
  label: string
  hint: string
  tab: NavTab
  done: boolean
}

export interface JourneyProgress {
  steps: JourneyStep[]
  doneCount: number
  total: number
  nextStep: JourneyStep | null
  loading: boolean
}

const ASKED_KEY = 'si-asked-question'

/** Record that the user has asked their first question (advances the journey). */
export function markQuestionAsked(): void {
  if (localStorage.getItem(ASKED_KEY) === '1') return
  try {
    localStorage.setItem(ASKED_KEY, '1')
  } catch {
    /* quota — non-critical */
  }
  window.dispatchEvent(new CustomEvent('journey-progress-updated'))
}

export function useJourneyProgress(): JourneyProgress {
  const { sectorId } = useSector()
  const agentRuns = useAgentStore(sectorId)
  const [semBuilt, setSemBuilt] = useState(false)
  const [sourceCount, setSourceCount] = useState(0)
  const [asked, setAsked] = useState(() => localStorage.getItem(ASKED_KEY) === '1')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    Promise.all([
      semanticStatus().catch(() => null),
      listSources().catch(() => [] as BackendSource[]),
    ]).then(([status, srcs]) => {
      setSemBuilt(status?.loaded === true)
      setSourceCount((srcs as BackendSource[]).filter(s => !s.is_default).length)
      setAsked(localStorage.getItem(ASKED_KEY) === '1')
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const handler = () => refresh()
    window.addEventListener('pipeline-run-updated', handler)
    window.addEventListener('journey-progress-updated', handler)
    return () => {
      window.removeEventListener('pipeline-run-updated', handler)
      window.removeEventListener('journey-progress-updated', handler)
    }
  }, [refresh])

  // In demo mode the sources and model are always present — mark them done so
  // the spine nudges the demo user straight to "ask" and "automate".
  const steps: JourneyStep[] = [
    {
      id: 'connect',
      label: 'Connect data',
      hint: 'Add your first data source',
      tab: 'sources',
      done: sourceCount > 0 || IS_DEMO_MODE,
    },
    {
      id: 'model',
      label: 'Build your model',
      hint: 'Run setup to index your data',
      tab: 'process',
      done: semBuilt || IS_DEMO_MODE,
    },
    {
      id: 'ask',
      label: 'Ask a question',
      hint: 'Query your data in plain English',
      tab: 'query',
      done: asked,
    },
    {
      id: 'automate',
      label: 'Automate',
      hint: 'Set up an agent to monitor your data',
      tab: 'agents',
      done: agentRuns.length > 0,
    },
  ]

  const doneCount = steps.filter(s => s.done).length
  const nextStep = steps.find(s => !s.done) ?? null

  return { steps, doneCount, total: steps.length, nextStep, loading }
}
