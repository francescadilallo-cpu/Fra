import { api } from './client'

export interface BackendMember {
  id: string
  username: string
  email: string
  role: 'admin' | 'editor' | 'viewer'
  status: 'active' | 'pending'
  created_at: string
}

export const listMembers = (): Promise<BackendMember[]> =>
  api.get<BackendMember[]>('/api/users').then(r => r.data)

export const inviteMember = (email: string, role: string): Promise<BackendMember> =>
  api.post<BackendMember>('/api/users', { email, role }).then(r => r.data)

export const updateMemberRole = (id: string, role: string): Promise<void> =>
  api.patch(`/api/users/${id}/role`, { role }).then(() => undefined)

export const removeMember = (id: string): Promise<void> =>
  api.delete(`/api/users/${id}`).then(() => undefined)
