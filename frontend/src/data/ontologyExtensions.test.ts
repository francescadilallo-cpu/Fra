/**
 * ontologyExtensions sync semantics — the workspace's ontology document must
 * converge across browsers: empty local adopts the server copy; in live mode
 * a server copy written by a teammate after our last push replaces ours;
 * a never-synced non-empty local document is never clobbered.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../api/ontologyExtension', () => ({
  fetchRemoteExtension: vi.fn(),
  pushRemoteExtension: vi.fn(),
}))

function makeToken(payload: Record<string, unknown>): string {
  const b64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `h.${b64}.s`
}

const remoteDoc = {
  nodes: [{ id: 'n1' }],
  edges: [],
  addedProperties: [],
  baseOverrides: {},
  removedBaseNodes: [],
  removedBaseEdges: [],
}

async function setup(mode: 'demo' | 'live') {
  vi.resetModules()
  localStorage.clear()
  if (mode === 'live') {
    localStorage.setItem('si-auth-token', makeToken({ mode: 'live' }))
  }
  const api = await import('../api/ontologyExtension')
  const mod = await import('./ontologyExtensions')
  return { api: vi.mocked(api), mod }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('hydrateExtensionFromBackend', () => {
  it('adopts the server copy when local is empty (fresh browser)', async () => {
    const { api, mod } = await setup('live')
    api.fetchRemoteExtension.mockResolvedValue({
      payload: remoteDoc,
      updated_at: '2026-07-10T10:00:00+00:00',
    })
    await mod.hydrateExtensionFromBackend('manufacturing')
    expect(mod.loadExtension('manufacturing').nodes).toHaveLength(1)
  })

  it('live: adopts a server copy newer than our last sync (teammate wrote)', async () => {
    const { api, mod } = await setup('live')
    const key = 'ontology-builder-ext-live-manufacturing'
    localStorage.setItem(key, JSON.stringify({ ...remoteDoc, nodes: [{ id: 'stale' }] }))
    localStorage.setItem(`${key}-synced-at`, '2026-07-09T00:00:00+00:00')
    api.fetchRemoteExtension.mockResolvedValue({
      payload: remoteDoc,
      updated_at: '2026-07-10T10:00:00+00:00',
    })
    await mod.hydrateExtensionFromBackend('manufacturing')
    expect(mod.loadExtension('manufacturing').nodes[0].id).toBe('n1')
    expect(localStorage.getItem(`${key}-synced-at`)).toBe('2026-07-10T10:00:00+00:00')
  })

  it('live: keeps a never-synced non-empty local document (no clobber)', async () => {
    const { api, mod } = await setup('live')
    const key = 'ontology-builder-ext-live-manufacturing'
    localStorage.setItem(key, JSON.stringify({ ...remoteDoc, nodes: [{ id: 'mine' }] }))
    api.fetchRemoteExtension.mockResolvedValue({
      payload: remoteDoc,
      updated_at: '2026-07-10T10:00:00+00:00',
    })
    await mod.hydrateExtensionFromBackend('manufacturing')
    expect(mod.loadExtension('manufacturing').nodes[0].id).toBe('mine')
  })

  it('demo: local wins even when the server copy is newer', async () => {
    const { api, mod } = await setup('demo')
    const key = 'ontology-builder-ext-manufacturing'
    localStorage.setItem(key, JSON.stringify({ ...remoteDoc, nodes: [{ id: 'sandbox' }] }))
    localStorage.setItem(`${key}-synced-at`, '2026-07-01T00:00:00+00:00')
    api.fetchRemoteExtension.mockResolvedValue({
      payload: remoteDoc,
      updated_at: '2026-07-10T10:00:00+00:00',
    })
    await mod.hydrateExtensionFromBackend('manufacturing')
    expect(mod.loadExtension('manufacturing').nodes[0].id).toBe('sandbox')
  })

  it('survives an unreachable backend', async () => {
    const { api, mod } = await setup('live')
    api.fetchRemoteExtension.mockRejectedValue(new Error('offline'))
    await expect(mod.hydrateExtensionFromBackend('manufacturing')).resolves.toBeUndefined()
  })
})

describe('saveExtension push', () => {
  it('records the server updated_at as the sync marker after a push', async () => {
    vi.useFakeTimers()
    try {
      const { api, mod } = await setup('live')
      api.pushRemoteExtension.mockResolvedValue({
        ok: true,
        updated_at: '2026-07-10T12:00:00+00:00',
      })
      mod.saveExtension('manufacturing', remoteDoc as never)
      await vi.advanceTimersByTimeAsync(1000)
      expect(api.pushRemoteExtension).toHaveBeenCalledWith('live-manufacturing', remoteDoc)
      expect(
        localStorage.getItem('ontology-builder-ext-live-manufacturing-synced-at'),
      ).toBe('2026-07-10T12:00:00+00:00')
    } finally {
      vi.useRealTimers()
    }
  })
})
