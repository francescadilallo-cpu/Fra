import { api } from './client'

export interface ContextDocumentMeta {
  id: number
  filename: string
  file_type: string
  created_at: string
}

export interface ContextEntity {
  id: number
  name: string
  display_name: string
  synonyms: string[]
  description: string
  source: string
  created_at: string
}

export interface NewEntity {
  name: string
  display_name: string
  synonyms: string[]
  description: string
  source: string
}

export interface ContextMetric {
  id: number
  name: string
  display_name: string
  synonyms: string[]
  description: string
  unit: string
  certified: boolean
  created_at: string
}

export interface NewMetric {
  name: string
  display_name: string
  synonyms: string[]
  description: string
  unit: string
  certified: boolean
}

export interface GlossaryTerm {
  id: number
  term: string
  definition: string
  created_at: string
}

export async function uploadDocument(file: File): Promise<ContextDocumentMeta> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<ContextDocumentMeta>('/api/context/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function listDocuments(): Promise<ContextDocumentMeta[]> {
  const { data } = await api.get<ContextDocumentMeta[]>('/api/context/documents')
  return data
}

export async function deleteDocument(id: number): Promise<void> {
  await api.delete(`/api/context/documents/${id}`)
}

export async function listEntities(): Promise<ContextEntity[]> {
  const { data } = await api.get<ContextEntity[]>('/api/context/entities')
  return data
}

export async function createEntity(entity: NewEntity): Promise<ContextEntity> {
  const { data } = await api.post<ContextEntity>('/api/context/entities', entity)
  return data
}

export async function deleteEntity(id: number): Promise<void> {
  await api.delete(`/api/context/entities/${id}`)
}

export async function listMetrics(): Promise<ContextMetric[]> {
  const { data } = await api.get<ContextMetric[]>('/api/context/metrics')
  return data
}

export async function createMetric(metric: NewMetric): Promise<ContextMetric> {
  const { data } = await api.post<ContextMetric>('/api/context/metrics', metric)
  return data
}

export async function deleteMetric(id: number): Promise<void> {
  await api.delete(`/api/context/metrics/${id}`)
}

export async function listGlossary(): Promise<GlossaryTerm[]> {
  const { data } = await api.get<GlossaryTerm[]>('/api/context/glossary')
  return data
}

export async function createGlossaryTerm(term: string, definition: string): Promise<GlossaryTerm> {
  const { data } = await api.post<GlossaryTerm>('/api/context/glossary', { term, definition })
  return data
}

export async function deleteGlossaryTerm(id: number): Promise<void> {
  await api.delete(`/api/context/glossary/${id}`)
}
