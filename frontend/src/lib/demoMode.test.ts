/**
 * demoMode.ts is the single switch the whole app branches on — these tests
 * pin the JWT decoding and the two helpers every view relies on.
 *
 * IS_DEMO_MODE is computed at import time from the token in localStorage, so
 * each case re-imports the module with vi.resetModules() after seeding it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

function makeToken(payload: Record<string, unknown>): string {
  const b64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `header.${b64}.signature`
}

async function importDemoMode() {
  vi.resetModules()
  return await import('./demoMode')
}

beforeEach(() => {
  localStorage.clear()
})

describe('IS_DEMO_MODE', () => {
  it('is demo without a token', async () => {
    const mod = await importDemoMode()
    expect(mod.IS_DEMO_MODE).toBe(true)
  })

  it('is live when the JWT carries mode=live', async () => {
    localStorage.setItem('si-auth-token', makeToken({ mode: 'live' }))
    const mod = await importDemoMode()
    expect(mod.IS_DEMO_MODE).toBe(false)
  })

  it('is demo for any other mode claim', async () => {
    localStorage.setItem('si-auth-token', makeToken({ mode: 'demo' }))
    expect((await importDemoMode()).IS_DEMO_MODE).toBe(true)
  })

  it('falls back to demo on a malformed token', async () => {
    localStorage.setItem('si-auth-token', 'not-a-jwt')
    expect((await importDemoMode()).IS_DEMO_MODE).toBe(true)
  })
})

describe('workspaceLabel', () => {
  it('returns the sector name in demo', async () => {
    const mod = await importDemoMode()
    expect(mod.workspaceLabel('Manufacturing')).toBe('Manufacturing')
  })

  it('returns the company name in live, never the demo sector', async () => {
    localStorage.setItem('si-auth-token', makeToken({ mode: 'live' }))
    localStorage.setItem('si-company-name', 'ACME S.p.A.')
    const mod = await importDemoMode()
    expect(mod.workspaceLabel('Manufacturing')).toBe('ACME S.p.A.')
  })

  it('falls back to "Live workspace" in live without a company name', async () => {
    localStorage.setItem('si-auth-token', makeToken({ mode: 'live' }))
    const mod = await importDemoMode()
    expect(mod.workspaceLabel('Manufacturing')).toBe('Live workspace')
  })
})

describe('modeScopedSector', () => {
  it('keeps the bare sector id in demo (existing saved data survives)', async () => {
    const mod = await importDemoMode()
    expect(mod.modeScopedSector('manufacturing')).toBe('manufacturing')
  })

  it('prefixes live- in live mode so demo data never leaks in', async () => {
    localStorage.setItem('si-auth-token', makeToken({ mode: 'live' }))
    const mod = await importDemoMode()
    expect(mod.modeScopedSector('manufacturing')).toBe('live-manufacturing')
  })
})
