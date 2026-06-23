/**
 * Change Review Queue — persists a queue of ontology items that were added
 * (e.g. by AI generation) and need human certification before activation.
 */

export type ReviewStatus = 'pending' | 'certified' | 'flagged'
export type ReviewSource = 'ai_proposal' | 'manual' | 'csv_upload'

export interface ReviewItem {
  id: string
  sectorId: string
  kind: 'entity' | 'metric' | 'relation'
  name: string
  description: string
  tableKey?: string
  source: ReviewSource
  submittedAt: string
  status: ReviewStatus
  notes: string
  certifiedAt?: string
}

const QUEUE_KEY = (sectorId: string) => `fra:review-queue:${sectorId}`

export function loadReviewQueue(sectorId: string): ReviewItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY(sectorId))
    return raw ? (JSON.parse(raw) as ReviewItem[]) : []
  } catch {
    return []
  }
}

export function saveReviewQueue(sectorId: string, items: ReviewItem[]): void {
  try {
    localStorage.setItem(QUEUE_KEY(sectorId), JSON.stringify(items))
  } catch { /* quota */ }
  window.dispatchEvent(new CustomEvent('review-queue-updated', { detail: { sectorId } }))
}

export function addReviewItems(sectorId: string, newItems: Omit<ReviewItem, 'id' | 'sectorId' | 'submittedAt' | 'status' | 'notes'>[]): void {
  const existing = loadReviewQueue(sectorId)
  const existingIds = new Set(existing.map(i => `${i.kind}:${i.name}`))
  const toAdd: ReviewItem[] = newItems
    .filter(item => !existingIds.has(`${item.kind}:${item.name}`))
    .map(item => ({
      ...item,
      id: `${item.kind}-${item.name}-${Date.now()}`,
      sectorId,
      submittedAt: new Date().toISOString(),
      status: 'pending',
      notes: '',
    }))
  if (toAdd.length > 0) {
    saveReviewQueue(sectorId, [...existing, ...toAdd])
  }
}

export function updateReviewItem(
  sectorId: string,
  id: string,
  status: ReviewStatus,
  notes: string,
): void {
  const items = loadReviewQueue(sectorId)
  const updated = items.map(item => item.id === id
    ? {
        ...item, status, notes,
        certifiedAt: status === 'certified' ? new Date().toISOString() : item.certifiedAt,
      }
    : item
  )
  saveReviewQueue(sectorId, updated)
}

export function certifyAll(sectorId: string): void {
  const items = loadReviewQueue(sectorId)
  const now = new Date().toISOString()
  const updated = items.map(item =>
    item.status === 'pending' ? { ...item, status: 'certified' as ReviewStatus, certifiedAt: now } : item
  )
  saveReviewQueue(sectorId, updated)
}
