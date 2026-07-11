/**
 * Dashboard pins — questions pinned from Query AI. Each pin is re-executed
 * against live data when the Dashboard renders, so tiles show current
 * numbers, not snapshots. Server-persisted: the whole team sees them.
 */
import { api } from './client'

export interface DashboardPin {
  id: string
  sector_id: string
  question: string
  title: string
  pinned_by: string
  created_at: string
}

export const listPins = (sectorId: string): Promise<DashboardPin[]> =>
  api
    .get<DashboardPin[]>('/api/dashboard/pins', { params: { sector_id: sectorId } })
    .then(r => r.data)

export const createPin = (
  pin: Pick<DashboardPin, 'id' | 'sector_id' | 'question' | 'title'>,
): Promise<DashboardPin> =>
  api.post<DashboardPin>('/api/dashboard/pins', pin).then(r => r.data)

export const deletePin = (id: string): Promise<void> =>
  api.delete(`/api/dashboard/pins/${encodeURIComponent(id)}`).then(() => undefined)
