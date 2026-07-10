/**
 * customAgents.ts — localStorage CRUD and the backend-sync semantics used by
 * useCustomAgents: unknown remote agents are added; for known agents the
 * server wins on run outcome (scheduled live agents execute server-side).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from './testUtils'
import type { CustomAgentDef } from './customAgents'

vi.mock('../api/agents', () => ({
  listAgents: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgentRemote: vi.fn(),
}))

import { listAgents } from '../api/agents'
import {
  loadCustomAgents,
  saveCustomAgents,
  addCustomAgent,
  removeCustomAgent,
  updateCustomAgent,
  useCustomAgents,
} from './customAgents'

function agent(id: string, patch: Partial<CustomAgentDef> = {}): CustomAgentDef {
  return {
    id,
    sectorId: 'manufacturing',
    name: `Agent ${id}`,
    description: '',
    template: 'monitor',
    entities: ['Account'],
    findings: [],
    actions: [],
    createdAt: '2026-01-01T00:00:00Z',
    trigger: { kind: 'manual' },
    ...patch,
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.mocked(listAgents).mockResolvedValue([])
})

describe('localStorage CRUD', () => {
  it('round-trips agents per sector', () => {
    addCustomAgent('manufacturing', agent('a1'))
    addCustomAgent('manufacturing', agent('a2'))
    addCustomAgent('retail', agent('r1', { sectorId: 'retail' }))
    expect(loadCustomAgents('manufacturing').map(a => a.id)).toEqual(['a1', 'a2'])
    expect(loadCustomAgents('retail').map(a => a.id)).toEqual(['r1'])
  })

  it('update patches a single agent, remove deletes it', () => {
    saveCustomAgents('manufacturing', [agent('a1'), agent('a2')])
    updateCustomAgent('manufacturing', 'a1', { name: 'Renamed' })
    expect(loadCustomAgents('manufacturing')[0].name).toBe('Renamed')
    removeCustomAgent('manufacturing', 'a1')
    expect(loadCustomAgents('manufacturing').map(a => a.id)).toEqual(['a2'])
  })

  it('survives corrupted storage', () => {
    localStorage.setItem('custom-agents-manufacturing', '{not json')
    expect(loadCustomAgents('manufacturing')).toEqual([])
  })
})

describe('useCustomAgents backend sync', () => {
  it('adds remote agents the browser has never seen', async () => {
    saveCustomAgents('manufacturing', [agent('local1')])
    vi.mocked(listAgents).mockResolvedValue([agent('remote1')])
    renderHook(() => useCustomAgents('manufacturing'))
    await waitFor(() =>
      expect(loadCustomAgents('manufacturing').map(a => a.id)).toEqual([
        'local1',
        'remote1',
      ]),
    )
  })

  it('server findings win when its run is newer (scheduled server-side runs)', async () => {
    saveCustomAgents('manufacturing', [
      agent('a1', { lastRunAt: '2026-07-01T00:00:00Z', findings: [{ severity: 'info', text: 'old local' }] }),
    ])
    vi.mocked(listAgents).mockResolvedValue([
      agent('a1', {
        lastRunAt: '2026-07-10T00:00:00Z',
        findings: [{ severity: 'warning', text: 'Account: -10 rows since last run' }],
      }),
    ])
    renderHook(() => useCustomAgents('manufacturing'))
    await waitFor(() => {
      const stored = loadCustomAgents('manufacturing')[0]
      expect(stored.findings[0].text).toContain('-10 rows')
      expect(stored.lastRunAt).toBe('2026-07-10T00:00:00Z')
    })
  })

  it('keeps local findings when the server has nothing newer', async () => {
    saveCustomAgents('manufacturing', [
      agent('a1', { lastRunAt: '2026-07-10T00:00:00Z', findings: [{ severity: 'info', text: 'fresh local' }] }),
    ])
    vi.mocked(listAgents).mockResolvedValue([
      agent('a1', { lastRunAt: '2026-07-01T00:00:00Z', findings: [{ severity: 'info', text: 'stale remote' }] }),
    ])
    renderHook(() => useCustomAgents('manufacturing'))
    await waitFor(() =>
      expect(loadCustomAgents('manufacturing')[0].findings[0].text).toBe('fresh local'),
    )
  })
})
