import { api } from './client'

export interface BackendAuditEntry {
  id: number
  ts: string        // ISO timestamp
  username: string
  action: string
  resource: string
  ip: string
  category: 'auth' | 'config' | 'data' | 'reports'
}

export const listAuditEntries = (params?: {
  limit?: number
  category?: string
  q?: string
}): Promise<BackendAuditEntry[]> =>
  api.get<BackendAuditEntry[]>('/api/audit', { params }).then(r => r.data)
