export interface SemanticStatusResponse {
  loaded: boolean
  entities: string[]
  kg_nodes: number
  kg_edges: number
  metadata_rows: number
  sources: string[]
  dedup_count: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function parseSemanticStatusResponse(payload: unknown): SemanticStatusResponse {
  if (!isRecord(payload)) {
    throw new Error('Invalid semantic status payload: expected object')
  }

  const {
    loaded,
    entities,
    kg_nodes,
    kg_edges,
    metadata_rows,
    sources,
    dedup_count,
  } = payload

  if (typeof loaded !== 'boolean') {
    throw new Error('Invalid semantic status payload: loaded must be boolean')
  }
  if (!isStringArray(entities)) {
    throw new Error('Invalid semantic status payload: entities must be string[]')
  }
  if (typeof kg_nodes !== 'number') {
    throw new Error('Invalid semantic status payload: kg_nodes must be number')
  }
  if (typeof kg_edges !== 'number') {
    throw new Error('Invalid semantic status payload: kg_edges must be number')
  }
  if (typeof metadata_rows !== 'number') {
    throw new Error('Invalid semantic status payload: metadata_rows must be number')
  }
  if (!isStringArray(sources)) {
    throw new Error('Invalid semantic status payload: sources must be string[]')
  }
  if (typeof dedup_count !== 'number') {
    throw new Error('Invalid semantic status payload: dedup_count must be number')
  }

  return {
    loaded,
    entities,
    kg_nodes,
    kg_edges,
    metadata_rows,
    sources,
    dedup_count,
  }
}

export const semanticStatusContractSample = {
  loaded: true,
  entities: ['SalesOrder', 'Customer'],
  kg_nodes: 1,
  kg_edges: 1,
  metadata_rows: 1,
  sources: ['erp', 'crm', 'hr_pim'],
  dedup_count: 0,
} satisfies SemanticStatusResponse
