import { api } from './client'

export interface WorkspaceSettings {
  name: string | null
  sector_id: string | null
}

export async function getWorkspace(): Promise<WorkspaceSettings> {
  const res = await api.get<WorkspaceSettings>('/api/workspace')
  return res.data
}

export async function saveWorkspace(name: string | null, sector_id: string | null): Promise<WorkspaceSettings> {
  const res = await api.put<WorkspaceSettings>('/api/workspace', { name, sector_id })
  return res.data
}
