import { getAuthToken } from '../api/client'

function getModeFromToken(): 'demo' | 'live' {
  const token = getAuthToken()
  if (!token) return 'demo'
  try {
    const b64 = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/')
    if (!b64) return 'demo'
    const payload = JSON.parse(atob(b64)) as Record<string, unknown>
    return payload.mode === 'live' ? 'live' : 'demo'
  } catch {
    return 'demo'
  }
}

export const IS_DEMO_MODE = getModeFromToken() !== 'live'

/**
 * Label for the active workspace in page headers.
 * Demo: the sector name (Manufacturing, Retail…) — sectors are a demo concept.
 * Live: the user's company name from onboarding, falling back to "Live workspace".
 */
export function workspaceLabel(sectorName: string): string {
  if (IS_DEMO_MODE) return sectorName
  try {
    return localStorage.getItem('si-company-name') ?? 'Live workspace'
  } catch {
    return 'Live workspace'
  }
}
