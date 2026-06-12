import { api } from './client'

export interface BackendToken {
  id: string
  name: string
  scopes: string[]
  token_preview: string
  created_at: string
  expires_at: string
  last_used_at: string | null
  status: 'active' | 'expiring'
  days_left: number
  full_token?: string // present only on creation response
}

export const listTokens = (): Promise<BackendToken[]> =>
  api.get<BackendToken[]>('/api/tokens').then(r => r.data)

export const createToken = (name: string, scopes: string[]): Promise<BackendToken> =>
  api.post<BackendToken>('/api/tokens', { name, scopes }).then(r => r.data)

export const revokeToken = (id: string): Promise<void> =>
  api.delete(`/api/tokens/${id}`).then(() => undefined)
