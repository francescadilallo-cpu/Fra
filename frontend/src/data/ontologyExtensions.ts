import { useEffect, useState } from 'react'
import type { OntologyEdge, OntologyGraphData, OntologyNode, OntologyProperty } from '../types'
import { SECTORS, type SectorId } from './sectors'
import { IS_DEMO_MODE } from '../lib/demoMode'

const EMPTY_ONTOLOGY: OntologyGraphData = { nodes: [], edges: [] }

// Migration helper: converts old string format to OntologyProperty
export function toOntologyProperty(p: OntologyProperty | string): OntologyProperty {
  return typeof p === 'string' ? { name: p, type: 'string' } : p
}

// ── Persisted shape ─────────────────────────────────────────────────────────
export interface NodeOverride {
  label?: string             // rename
  db_table?: string | null   // change DB mapping (null = remove)
  removedProperties?: string[]
}

export interface SavedExtension {
  nodes: {
    id: string
    label: string
    uri: string
    properties: Array<OntologyProperty | string>  // string for backward compat
    position: { x: number; y: number }
    db_table?: string
  }[]
  edges: { id: string; source: string; target: string; label: string }[]
  addedProperties: { nodeId: string; property: OntologyProperty | string }[]  // string for backward compat
  // Modifications to existing base entities (keyed by node ID)
  baseOverrides?: Record<string, NodeOverride>
  // IDs of base nodes/edges that have been deleted by the user
  removedBaseNodes?: string[]
  removedBaseEdges?: string[]
}

const EMPTY: SavedExtension = {
  nodes: [],
  edges: [],
  addedProperties: [],
  baseOverrides: {},
  removedBaseNodes: [],
  removedBaseEdges: [],
}
const STORAGE_KEY = (sectorId: string) => `ontology-builder-ext-${sectorId}`
const STORAGE_EVENT = 'ontology-builder-changed'

export function loadExtension(sectorId: string): SavedExtension {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(sectorId))
    if (!raw) return { ...EMPTY, baseOverrides: {}, removedBaseNodes: [], removedBaseEdges: [] }
    const parsed = JSON.parse(raw) as SavedExtension
    return {
      nodes: parsed.nodes ?? [],
      edges: parsed.edges ?? [],
      addedProperties: parsed.addedProperties ?? [],
      baseOverrides: parsed.baseOverrides ?? {},
      removedBaseNodes: parsed.removedBaseNodes ?? [],
      removedBaseEdges: parsed.removedBaseEdges ?? [],
    }
  } catch {
    return { ...EMPTY, baseOverrides: {}, removedBaseNodes: [], removedBaseEdges: [] }
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
  // Live workspaces start from scratch: no pre-built sector ontology, only
  // entities the user adds (or that the semantic layer derives from real sources).
  const base = IS_DEMO_MODE ? SECTORS[sectorId].ontology : EMPTY_ONTOLOGY
  const ext = loadExtension(sectorId)
  const removedNodes = new Set(ext.removedBaseNodes ?? [])
  const removedEdges = new Set(ext.removedBaseEdges ?? [])
  const overrides = ext.baseOverrides ?? {}
  const prefix =
    sectorId === 'manufacturing' ? 'mfg' :
    sectorId === 'retail' ? 'rtl' :
    sectorId === 'healthcare' ? 'hc' : 'fin'

  // Apply overrides + added properties on base nodes (filter out removed ones)
  const baseNodes: OntologyNode[] = base.nodes
    .filter((n) => !removedNodes.has(n.id))
    .map((n) => {
      const ov = overrides[n.id]
      const extra: OntologyProperty[] = ext.addedProperties
        .filter((p) => p.nodeId === n.id)
        .map((p) => toOntologyProperty(p.property))
      const removedProps = new Set(ov?.removedProperties ?? [])
      const newLabel = ov?.label ?? n.data.label
      const newUri = ov?.label ? `${prefix}:${ov.label}` : n.data.uri
      const newDbTable = ov && 'db_table' in ov ? (ov.db_table ?? null) : n.data.db_table
      const newProps = [...n.data.properties.filter((p) => !removedProps.has(p.name)), ...extra]
      return {
        ...n,
        data: {
          ...n.data,
          label: newLabel,
          uri: newUri,
          db_table: newDbTable,
          properties: newProps,
        },
      }
    })

  // Add extension nodes (migrate old string properties to OntologyProperty)
  const extNodes: OntologyNode[] = ext.nodes.map((n) => ({
    id: n.id,
    type: 'ontologyNode',
    position: n.position,
    data: {
      label: n.label,
      uri: n.uri,
      db_table: n.db_table ?? null,
      row_count: 0,
      properties: n.properties.map(toOntologyProperty),
    },
  }))

  // Base edges with removed ones filtered out + any referencing removed nodes
  const baseEdges = base.edges.filter(
    (e) => !removedEdges.has(e.id) && !removedNodes.has(e.source) && !removedNodes.has(e.target),
  )

  // Add extension edges (styled with violet hint)
  const extEdges: OntologyEdge[] = ext.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: 'smoothstep',
    animated: true,
    style: { stroke: '#7C3AED' },
    labelStyle: { fill: '#7C3AED', fontSize: 11 },
    markerEnd: { type: 'ArrowClosed' },
  }))

  return {
    nodes: [...baseNodes, ...extNodes],
    edges: [...baseEdges, ...extEdges],
  }
}

// ── Mutation helpers ────────────────────────────────────────────────────────
export function applyNodeChange(
  sectorId: string,
  nodeId: string,
  patch: { label?: string; db_table?: string | null; properties?: OntologyProperty[] },
  isBaseNode: boolean,
) {
  const ext = loadExtension(sectorId)

  if (isBaseNode) {
    // Compare against base values to compute override
    const sector = SECTORS[sectorId as SectorId]
    const base = sector?.ontology.nodes.find((n) => n.id === nodeId)
    if (!base) return

    const ov: NodeOverride = { ...(ext.baseOverrides?.[nodeId] ?? {}) }

    if (patch.label !== undefined && patch.label !== base.data.label) {
      ov.label = patch.label
    } else if (patch.label !== undefined) {
      delete ov.label
    }

    if (patch.db_table !== undefined && patch.db_table !== base.data.db_table) {
      ov.db_table = patch.db_table
    } else if (patch.db_table !== undefined) {
      delete ov.db_table
    }

    if (patch.properties !== undefined) {
      const baseNames = new Set(base.data.properties.map((p) => p.name))
      const targetProps = patch.properties
      const targetNames = new Set(targetProps.map((p) => p.name))
      const removedProps = base.data.properties.filter((p) => !targetNames.has(p.name)).map((p) => p.name)
      // New properties not in base → become addedProperties
      const newAdded = targetProps.filter((p) => !baseNames.has(p.name))

      // Update addedProperties: remove old entries for this node, add new
      ext.addedProperties = (ext.addedProperties || []).filter((p) => p.nodeId !== nodeId)
      newAdded.forEach((p) => ext.addedProperties.push({ nodeId, property: p }))

      ov.removedProperties = removedProps.length > 0 ? removedProps : undefined
    }

    ext.baseOverrides = { ...(ext.baseOverrides ?? {}), [nodeId]: ov }
  } else {
    // Extension node: mutate in place
    ext.nodes = ext.nodes.map((n) =>
      n.id === nodeId
        ? {
            ...n,
            label: patch.label ?? n.label,
            uri: patch.label ? n.uri.replace(/[^:]+$/, patch.label) : n.uri,
            db_table: patch.db_table === null ? undefined : (patch.db_table ?? n.db_table),
            properties: patch.properties ?? n.properties,
          }
        : n,
    )
  }

  saveExtension(sectorId, ext)
}

export function removeNode(sectorId: string, nodeId: string, isBaseNode: boolean) {
  const ext = loadExtension(sectorId)
  if (isBaseNode) {
    const removed = new Set(ext.removedBaseNodes ?? [])
    removed.add(nodeId)
    ext.removedBaseNodes = Array.from(removed)
    // Also clean up baseOverrides for this node
    if (ext.baseOverrides) delete ext.baseOverrides[nodeId]
    // Clean addedProperties on this node
    ext.addedProperties = (ext.addedProperties || []).filter((p) => p.nodeId !== nodeId)
  } else {
    ext.nodes = ext.nodes.filter((n) => n.id !== nodeId)
    // Remove edges referencing this node
    ext.edges = ext.edges.filter((e) => e.source !== nodeId && e.target !== nodeId)
    ext.addedProperties = (ext.addedProperties || []).filter((p) => p.nodeId !== nodeId)
  }
  saveExtension(sectorId, ext)
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
