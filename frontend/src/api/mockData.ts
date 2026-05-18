import type { DashboardData, MappingsResponse, OntologyGraphData, QueryResult } from '../types'

export const mockDashboard: DashboardData = {
  total_customers: 20,
  total_products: 30,
  total_quotes: 50,
  total_orders: 13,
  quote_conversion_rate: 26.0,
  open_quotes_value: 1173063.45,
  recent_orders: [
    { id: 5,  customer_name: 'Tutino e figli',                      total_value: 197866.48, status: 'cancelled',     date: '2026-05-03' },
    { id: 11, customer_name: 'Lettiere-Cremonesi e figli',           total_value: 142066.66, status: 'in_production', date: '2026-04-24' },
    { id: 3,  customer_name: 'Moccia s.r.l.',                        total_value:  98451.37, status: 'in_production', date: '2026-04-16' },
    { id: 4,  customer_name: 'Caracciolo, Asmundo e Leone e figli',  total_value:  16383.72, status: 'delivered',     date: '2026-04-02' },
    { id: 12, customer_name: 'Moccia s.r.l.',                        total_value:  55136.48, status: 'delivered',     date: '2026-03-30' },
  ],
  data_sources: [
    { name: 'ERP – Clienti & Prodotti',    type: 'SQLite', status: 'connected', tables: ['customers', 'products'],                              row_counts: { customers: 20, products: 30 } },
    { name: 'ERP – Preventivi & Ordini',   type: 'SQLite', status: 'connected', tables: ['quotes', 'quote_lines', 'orders', 'order_lines'],     row_counts: { quotes: 50, quote_lines: 155, orders: 13, order_lines: 37 } },
  ],
}

export const mockOntologyGraph: OntologyGraphData = {
  nodes: [
    { id: 'Organization',    type: 'ontologyClass', position: { x: 400, y: 50  }, data: { label: 'Organization',    uri: 'mfg:Organization',    db_table: null,          row_count: 0,   properties: ['name'] } },
    { id: 'Customer',        type: 'ontologyClass', position: { x: 100, y: 200 }, data: { label: 'Customer',        uri: 'mfg:Customer',        db_table: 'customers',   row_count: 20,  properties: ['name', 'sector', 'country', 'vatNumber', 'creditLimit'] } },
    { id: 'Product',         type: 'ontologyClass', position: { x: 700, y: 200 }, data: { label: 'Product',         uri: 'mfg:Product',         db_table: 'products',    row_count: 30,  properties: ['sku', 'name', 'category', 'unitPrice', 'unitOfMeasure'] } },
    { id: 'Quote',           type: 'ontologyClass', position: { x: 100, y: 400 }, data: { label: 'Quote',           uri: 'mfg:Quote',           db_table: 'quotes',      row_count: 50,  properties: ['date', 'status', 'totalValue', 'validUntil'] } },
    { id: 'Order',           type: 'ontologyClass', position: { x: 700, y: 400 }, data: { label: 'Order',           uri: 'mfg:Order',           db_table: 'orders',      row_count: 13,  properties: ['date', 'status', 'totalValue', 'deliveryDate'] } },
    { id: 'QuoteLineItem',   type: 'ontologyClass', position: { x: 400, y: 550 }, data: { label: 'QuoteLineItem',   uri: 'mfg:QuoteLineItem',   db_table: 'quote_lines', row_count: 155, properties: ['quantity', 'unitPrice', 'discountPct', 'lineTotal'] } },
    { id: 'OrderLineItem',   type: 'ontologyClass', position: { x: 700, y: 550 }, data: { label: 'OrderLineItem',   uri: 'mfg:OrderLineItem',   db_table: 'order_lines', row_count: 37,  properties: ['quantity', 'unitPrice', 'lineTotal'] } },
  ],
  edges: [
    { id: 'e1', source: 'Customer',      target: 'Organization',  label: 'subClassOf',       type: 'smoothstep', animated: false, style: { stroke: '#64748b' }, labelStyle: { fill: '#94a3b8', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
    { id: 'e2', source: 'Quote',         target: 'Customer',      label: 'hasCustomer',      type: 'smoothstep', animated: true,  style: { stroke: '#14b8a6' }, labelStyle: { fill: '#14b8a6', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
    { id: 'e3', source: 'Order',         target: 'Customer',      label: 'hasCustomer',      type: 'smoothstep', animated: true,  style: { stroke: '#14b8a6' }, labelStyle: { fill: '#14b8a6', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
    { id: 'e4', source: 'Order',         target: 'Quote',         label: 'relatedToQuote',   type: 'smoothstep', animated: false, style: { stroke: '#f59e0b' }, labelStyle: { fill: '#f59e0b', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
    { id: 'e5', source: 'Quote',         target: 'QuoteLineItem', label: 'hasLineItem',      type: 'smoothstep', animated: false, style: { stroke: '#64748b' }, labelStyle: { fill: '#94a3b8', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
    { id: 'e6', source: 'Order',         target: 'OrderLineItem', label: 'hasLineItem',      type: 'smoothstep', animated: false, style: { stroke: '#64748b' }, labelStyle: { fill: '#94a3b8', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
    { id: 'e7', source: 'QuoteLineItem', target: 'Product',       label: 'hasProduct',       type: 'smoothstep', animated: false, style: { stroke: '#64748b' }, labelStyle: { fill: '#94a3b8', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
  ],
}

export const mockMappings: MappingsResponse = {
  mappings: [
    { table: 'customers', field: 'id',            ontology_class: 'Customer', ontology_property: 'identifier',    field_type: 'INTEGER' },
    { table: 'customers', field: 'name',          ontology_class: 'Customer', ontology_property: 'name',          field_type: 'TEXT' },
    { table: 'customers', field: 'sector',        ontology_class: 'Customer', ontology_property: 'sector',        field_type: 'TEXT' },
    { table: 'customers', field: 'country',       ontology_class: 'Customer', ontology_property: 'country',       field_type: 'TEXT' },
    { table: 'customers', field: 'credit_limit',  ontology_class: 'Customer', ontology_property: 'creditLimit',   field_type: 'REAL' },
    { table: 'products',  field: 'id',            ontology_class: 'Product',  ontology_property: 'identifier',    field_type: 'INTEGER' },
    { table: 'products',  field: 'sku',           ontology_class: 'Product',  ontology_property: 'sku',           field_type: 'TEXT' },
    { table: 'products',  field: 'name',          ontology_class: 'Product',  ontology_property: 'name',          field_type: 'TEXT' },
    { table: 'products',  field: 'category',      ontology_class: 'Product',  ontology_property: 'category',      field_type: 'TEXT' },
    { table: 'products',  field: 'unit_price',    ontology_class: 'Product',  ontology_property: 'unitPrice',     field_type: 'REAL' },
    { table: 'quotes',    field: 'id',            ontology_class: 'Quote',    ontology_property: 'identifier',    field_type: 'INTEGER' },
    { table: 'quotes',    field: 'status',        ontology_class: 'Quote',    ontology_property: 'status',        field_type: 'TEXT' },
    { table: 'quotes',    field: 'total_value',   ontology_class: 'Quote',    ontology_property: 'totalValue',    field_type: 'REAL' },
    { table: 'quotes',    field: 'valid_until',   ontology_class: 'Quote',    ontology_property: 'validUntil',    field_type: 'DATE' },
    { table: 'orders',    field: 'id',            ontology_class: 'Order',    ontology_property: 'identifier',    field_type: 'INTEGER' },
    { table: 'orders',    field: 'status',        ontology_class: 'Order',    ontology_property: 'status',        field_type: 'TEXT' },
    { table: 'orders',    field: 'total_value',   ontology_class: 'Order',    ontology_property: 'totalValue',    field_type: 'REAL' },
    { table: 'orders',    field: 'delivery_date', ontology_class: 'Order',    ontology_property: 'deliveryDate',  field_type: 'DATE' },
  ],
  raw: {},
}

export const mockQueryResult: QueryResult = {
  question: 'Quali clienti hanno preventivi accettati questo mese?',
  interpreted_as: "Clienti con almeno un preventivo in stato 'accepted' nel mese corrente",
  sql_query: "SELECT DISTINCT c.name, q.total_value, q.date\nFROM customers c\nJOIN quotes q ON q.customer_id = c.id\nWHERE q.status = 'accepted'\nAND q.date >= date('now','start of month')\nORDER BY q.total_value DESC",
  results: [
    { name: 'Moccia s.r.l.',          total_value: 98451.37, date: '2026-05-12' },
    { name: 'Tutino e figli',          total_value: 45200.00, date: '2026-05-08' },
    { name: 'Ferrari Metalli S.p.A.',  total_value: 31750.50, date: '2026-05-02' },
  ],
  summary: 'Questo mese 3 clienti hanno preventivi accettati, per un valore totale di €175.401. Il cliente principale è Moccia s.r.l. con €98.451.',
}
