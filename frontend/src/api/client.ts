import axios from 'axios'

const IS_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
export const AUTH_TOKEN_STORAGE_KEY = 'si-auth-token'

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 60_000,
})

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const getAuthToken = (): string | null => {
  try {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

export const setAuthToken = (token: string): void => {
  try {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
  } catch {
    // Private browsing or storage quota exceeded — token held only in memory
  }
}

export const clearAuthToken = (): void => {
  try {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
  } catch {
    // ignore storage failures
  }
}

/** Username (JWT `sub`) of the logged-in user, or null when not available. */
export const getTokenSubject = (): string | null => {
  const token = getAuthToken()
  if (!token) return null
  try {
    const b64 = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/')
    if (!b64) return null
    const payload = JSON.parse(atob(b64)) as Record<string, unknown>
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

api.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Deduplicate 401 logouts — multiple in-flight requests can all fail with 401
// simultaneously. Only the first one triggers logout; the rest are no-ops.
let _logoutPending = false

export function handle401(status: number | undefined): void {
  if (status === 401 && !_logoutPending) {
    _logoutPending = true
    clearAuthToken()
    window.dispatchEvent(new CustomEvent('logout-requested'))
    // Reset after 5 s so fresh logins within the same tab work normally
    setTimeout(() => { _logoutPending = false }, 5_000)
  }
}

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const maybeResponse = error as { response?: { status?: number } }
    handle401(maybeResponse.response?.status)
    return Promise.reject(error)
  },
)

interface LoginResponse {
  access_token: string
  token_type: 'bearer'
  expires_in: number
  role: 'admin' | 'user'
  mode: 'demo' | 'live'
}

export const login = async (username: string, password: string, mode: 'demo' | 'live' = 'demo'): Promise<void> => {
  if (IS_MOCK) {
    await delay(250)
    // Encode mode into a fake JWT-like structure so demoMode.ts can read it
    const fakePayload = btoa(JSON.stringify({ sub: username, mode, role: 'user' }))
    const fake = `mock.${fakePayload}.sig`
    setAuthToken(fake)
    return
  }

  const form = new URLSearchParams()
  form.set('username', username)
  form.set('password', password)
  form.set('mode', mode)

  const response = await api.post<LoginResponse>('/api/auth/token', form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  setAuthToken(response.data.access_token)
}

