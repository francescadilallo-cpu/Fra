import { useEffect, useState } from 'react'
import type { OntologyEdge, OntologyGraphData, OntologyNode } from '../types'
import { SECTORS, type SectorId } from './sectors'

// ── Persisted shape ─────────────────────────────────────────────────────────
export interface SavedExtension {
  nodes: {
    id: string
    label: string
    uri: string
    properties: string[]
    position: { x: number; y: number }
    db_table?: string
  }[]
  edges: { id: string; source: string; target: string; label: string }[]
  addedProperties: { nodeId: string; property: string }[]
}

const EMPTY: SavedExtension = { nodes: [], edges: [], addedProperties: [] }
const STORAGE_KEY = (sectorId: string) => `ontology-builder-ext-${sectorId}`
const STORAGE_EVENT = 'ontology-builder-changed'

export function loadExtension(sectorId: string): SavedExtension {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(sectorId))
    if (!raw) return { ...EMPTY }
    const parsed = JSON.parse(raw) as SavedExtension
    return {
      nodes: parsed.nodes ?? [],
      edges: parsed.edges ?? [],
      addedProperties: parsed.addedProperties ?? [],
    }
  } catch {
    return { ...EMPTY }
  }
}

export function saveExtension(sectorId: string, ext: SavedExtension) {
  try {
    localStorage.setItem(STORAGE_KEY(sectorId), JSON.stringify(ext))
    // Notify same-tab listeners (storage event only fires cross-tab)
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: { sectorId } }))
  } catch {
    // quota — silent for demo
  }
}

// ── Merging logic ───────────────────────────────────────────────────────────
// Merge sector base ontology with saved user extensions.
export function buildExtendedOntology(sectorId: SectorId): OntologyGraphData {
  const base = SECTORS[sectorId].ontology
  const ext = loadExtension(sectorId)

  // Apply added properties to base nodes
  const baseNodes: OntologyNode[] = base.nodes.map((n) => {
    const extra = ext.addedProperties
      .filter((p) => p.nodeId === n.id)
      .map((p) => p.property)
    return extra.length > 0
      ? { ...n, data: { ...n.data, properties: [...n.data.properties, ...extra] } }
      : n
  })

  // Add extension nodes
  const extNodes: OntologyNode[] = ext.nodes.map((n) => ({
    id: n.id,
    type: 'ontologyNode',
    position: n.position,
    data: {
      label: n.label,
      uri: n.uri,
      db_table: n.db_table ?? null,
      row_count: 0,
      properties: n.properties,
    },
  }))

  // Add extension edges (styled to look the same as base, but with a hint they're user-added)
  const extEdges: OntologyEdge[] = ext.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: 'smoothstep',
    animated: true,
    style: { stroke: '#7C3AED' },          // violet to indicate user-added
    labelStyle: { fill: '#7C3AED', fontSize: 11 },
    markerEnd: { type: 'ArrowClosed' },
  }))

  return {
    nodes: [...baseNodes, ...extNodes],
    edges: [...base.edges, ...extEdges],
  }
}

// ── Hook: reactive merged ontology ─────────────────────────────────────────-
export function useExtendedOntology(sectorId: SectorId): OntologyGraphData {
  const [data, setData] = useState<OntologyGraphData>(() => buildExtendedOntology(sectorId))

  useEffect(() => {
    setData(buildExtendedOntology(sectorId))

    const refresh = () => setData(buildExtendedOntology(sectorId))
    // Same-tab updates
    window.addEventListener(STORAGE_EVENT, refresh)
    // Other-tab updates
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY(sectorId)) refresh()
    }
    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener(STORAGE_EVENT, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [sectorId])

  return data
}

// Hook to get just the saved extension (useful for badges/counts).
export function useSavedExtension(sectorId: SectorId): SavedExtension {
  const [ext, setExt] = useState<SavedExtension>(() => loadExtension(sectorId))

  useEffect(() => {
    setExt(loadExtension(sectorId))
    const refresh = () => setExt(loadExtension(sectorId))
    window.addEventListener(STORAGE_EVENT, refresh)
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY(sectorId)) refresh()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(STORAGE_EVENT, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [sectorId])

  return ext
}
