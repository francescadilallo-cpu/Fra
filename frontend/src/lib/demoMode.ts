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
