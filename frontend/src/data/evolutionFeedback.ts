/**
 * Evolution Feedback — user-reported observations for continuous improvement
 * of the data platform. Stored locally; ready for backend sync in a future phase.
 */

export type FeedbackKind = 'data_quality' | 'missing_metric' | 'wrong_result' | 'schema_change' | 'other'
export type FeedbackStatus = 'open' | 'in_review' | 'resolved'

export interface FeedbackItem {
  id: string
  sectorId: string
  kind: FeedbackKind
  title: string
  notes: string
  submittedAt: string
  status: FeedbackStatus
  resolvedAt?: string
}

const FEEDBACK_KEY = (sectorId: string) => `fra:evolution-feedback:${sectorId}`

export const KIND_LABELS: Record<FeedbackKind, string> = {
  data_quality: 'Data quality issue',
  missing_metric: 'Missing metric',
  wrong_result: 'Wrong query result',
  schema_change: 'Schema change detected',
  other: 'Other',
}

export function loadFeedback(sectorId: string): FeedbackItem[] {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY(sectorId))
    return raw ? (JSON.parse(raw) as FeedbackItem[]) : []
  } catch {
    return []
  }
}

export function saveFeedback(sectorId: string, items: FeedbackItem[]): void {
  try {
    localStorage.setItem(FEEDBACK_KEY(sectorId), JSON.stringify(items))
  } catch { /* quota */ }
  window.dispatchEvent(new CustomEvent('evolution-feedback-updated', { detail: { sectorId } }))
}

export function addFeedback(
  sectorId: string,
  kind: FeedbackKind,
  title: string,
  notes: string,
): FeedbackItem {
  const item: FeedbackItem = {
    id: `fb-${Date.now()}`,
    sectorId, kind, title, notes,
    submittedAt: new Date().toISOString(),
    status: 'open',
  }
  const existing = loadFeedback(sectorId)
  saveFeedback(sectorId, [item, ...existing])
  return item
}

export function resolveFeedback(sectorId: string, id: string): void {
  const items = loadFeedback(sectorId)
  const updated = items.map(i =>
    i.id === id ? { ...i, status: 'resolved' as FeedbackStatus, resolvedAt: new Date().toISOString() } : i
  )
  saveFeedback(sectorId, updated)
}
