import { api } from './client'

export interface BackendChannel {
  id: string
  name: string
  type: 'slack' | 'email' | 'teams' | 'webhook'
  destination: string
  enabled: boolean
}

export interface BackendRouting {
  critical: string[]
  warning: string[]
  info: string[]
}

export const listChannels = (): Promise<BackendChannel[]> =>
  api.get<BackendChannel[]>('/api/notifications/channels').then(r => r.data)

export const addChannel = (
  name: string,
  channel_type: string,
  destination: string,
): Promise<BackendChannel> =>
  api.post<BackendChannel>('/api/notifications/channels', { name, channel_type, destination }).then(r => r.data)

export const updateChannel = (
  id: string,
  patch: { enabled?: boolean; name?: string },
): Promise<void> =>
  api.patch(`/api/notifications/channels/${id}`, patch).then(() => undefined)

export const removeChannel = (id: string): Promise<void> =>
  api.delete(`/api/notifications/channels/${id}`).then(() => undefined)

export const getRouting = (): Promise<BackendRouting> =>
  api.get<BackendRouting>('/api/notifications/routing').then(r => r.data)

export const saveRouting = (routing: BackendRouting): Promise<void> =>
  api.put('/api/notifications/routing', routing).then(() => undefined)

export const testChannel = (id: string): Promise<{ ok: boolean; latency_ms: number | null; note?: string }> =>
  api.post<{ ok: boolean; latency_ms: number | null; note?: string }>(`/api/notifications/channels/${id}/test`).then(r => r.data)
