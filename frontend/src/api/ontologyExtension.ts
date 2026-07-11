import { api } from './client'

// Server-side persistence for the Ontology Builder's extension document.
// localStorage stays the synchronous source of truth for rendering; these
// calls make it durable across browsers and devices.

export interface RemoteExtension {
  payload: unknown | null
  updated_at: string | null
}

export async function fetchRemoteExtension(workspaceId: string): Promise<RemoteExtension> {
  const res = await api.get<RemoteExtension>('/api/ontology/extension', {
    params: { workspace_id: workspaceId },
  })
  return res.data
}

export async function pushRemoteExtension(
  workspaceId: string,
  payload: unknown,
): Promise<{ ok: boolean; updated_at: string }> {
  const res = await api.put<{ ok: boolean; updated_at: string }>(
    '/api/ontology/extension',
    { payload },
    { params: { workspace_id: workspaceId } },
  )
  return res.data
}
