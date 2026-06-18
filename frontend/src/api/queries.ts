import axios from 'axios'
import { getAuthToken, handle401 } from './client'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

const http = axios.create({ baseURL: BASE_URL, timeout: 15_000 })

http.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) { config.headers = config.headers ?? {}; config.headers.Authorization = `Bearer ${token}` }
  return config
})

http.interceptors.response.use(
  r => r,
  (error: unknown) => {
    const e = error as { response?: { status?: number } }
    handle401(e.response?.status)
    return Promise.reject(error)
  },
)

export interface SavedQuery {
  id: string
  sector_id: string
  query: string
  created_at: string
}

export async function listSavedQueries(sectorId: string): Promise<SavedQuery[]> {
  const res = await http.get<SavedQuery[]>('/api/queries/saved', { params: { sector_id: sectorId } })
  return res.data
}

export async function saveQueryRemote(sectorId: string, query: string, id?: string): Promise<void> {
  const payload: SavedQuery = {
    id: id ?? `${sectorId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sector_id: sectorId,
    query,
    created_at: new Date().toISOString(),
  }
  await http.post('/api/queries/saved', payload)
}

export async function deleteSavedQueryRemote(queryId: string): Promise<void> {
  await http.delete(`/api/queries/saved/${encodeURIComponent(queryId)}`)
}
