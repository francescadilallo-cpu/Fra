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

api.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const maybeResponse = error as { response?: { status?: number } }
    if (maybeResponse.response?.status === 401) {
      clearAuthToken()
      // Signal App.tsx to drop the auth gate back to login
      window.dispatchEvent(new CustomEvent('logout-requested'))
    }
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

