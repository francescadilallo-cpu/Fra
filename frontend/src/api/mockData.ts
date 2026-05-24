import type { DashboardData, MappingsResponse, OntologyGraphData, OntologyProperty, QueryResult } from '../types'

// ── AdventureWorks 2014 — real data from distributed scenario ─────────────────
// Sources: ERP OrionSales (PostgreSQL/DuckDB), CRM ClientHub (SQLite),
//          HR CSV + PIM JSON — 31,465 orders, 20,201 customers, 504 products

function prop(name: string, type: OntologyProperty['type'] = 'string', opts: Partial<OntologyProperty> = {}): OntologyProperty {
  return { name, type, ...opts }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export const mockDashboard: DashboardData = {
  total_customers: 19829,   // unique CRM accounts after dedup (372 neg-ID removed)
  total_products:  504,     // PIM catalog
  total_quotes:    290,     // HR employees (field repurposed)
  total_orders:    31465,   // ERP sales_order_header
  quote_conversion_rate: 71.4,   // orders shipped / total (indicative)
  open_quotes_value: 22419498,   // total_due 2014 (all years: ~$109M)

  data_sources: [
    {
      name: 'ERP — OrionSales',
      type: 'PostgreSQL / DuckDB',
      status: 'connected',
      tables: ['sales_order_header', 'sales_order_line', 'salesperson', 'territory', 'offer'],
      row_counts: {
        sales_order_header: 31465,
        sales_order_line:  121317,
        salesperson:           17,
        territory:             10,
        offer:                 16,
      },
    },
    {
      name: 'CRM — ClientHub',
      type: 'SQLite',
      status: 'connected',
      tables: ['account', 'contact', 'address', 'account_address', 'state_province', 'country'],
      row_counts: {
        account:        20201,   // 372 duplicates (accountId < 0)
        contact:        19302,
        address:        19614,
        state_province:    70,
        country:           6,
      },
    },
    {
      name: 'HR + PIM — Files',
      type: 'CSV + JSON',
      status: 'connected',
      tables: ['dipendenti_hr', 'product_catalog_pim'],
      row_counts: {
        dipendenti_hr:       290,
        product_catalog_pim: 504,
      },
    },
  ],

  recent_orders: [
    { id: 75123, customer_name: 'Bike World',              total_value: 87145.20, status: 'shipped',   date: '2014-12-28' },
    { id: 75089, customer_name: 'Action Bicycle Specialists', total_value: 53209.80, status: 'delivered', date: '2014-12-26' },
    { id: 75044, customer_name: 'Riding Cycles',           total_value: 46312.50, status: 'delivered', date: '2014-12-24' },
    { id: 74998, customer_name: 'Valley Bicycle Specialists', total_value: 32890.00, status: 'shipped',   date: '2014-12-22' },
    { id: 74956, customer_name: 'Eastside Department Store', total_value: 28750.40, status: 'delivered', date: '2014-12-20' },
    { id: 74901, customer_name: 'Sporting Goods Store',   total_value: 19435.60, status: 'confirmed', date: '2014-12-18' },
    { id: 74870, customer_name: 'Bike Riders Company',    total_value: 14820.90, status: 'confirmed', date: '2014-12-17' },
    { id: 74835, customer_name: 'Metropolitan Bicycle Supply', total_value: 11260.00, status: 'confirmed', date: '2014-12-15' },
  ],

  process_funnel: [
    { stage: 'Orders Created',  count: 31465, value: 22419498 },
    { stage: 'Orders Shipped',  count: 22468, value: 16003964 },
    { stage: 'Top Territory',   count:  6692, value:  7905146 },  // Southwest
    { stage: 'Online Sales',    count: 27659, value: 19651300 },  // online channel
    { stage: 'With Discount',   count:  3806, value:  2768198 },  // offer_ref != 1
  ],

  recent_activities: [
    { id: 1, type: 'order', message: 'Top salesperson 2014: Jae Pak — 67 orders in Q4', time: '2014-12-31', status: 'Confirmed' },
    { id: 2, type: 'order', message: 'Southwest territory leads: $7.9M revenue',         time: '2014-12-30', status: 'Shipped'   },
    { id: 3, type: 'quote', message: 'CRM dedup completed — 372 duplicate accounts merged', time: '2014-12-29', status: 'Resolved' },
    { id: 4, type: 'order', message: 'PIM sync: 504 products, 97 Bikes · 134 Components', time: '2014-12-28', status: 'Synced'   },
    { id: 5, type: 'order', message: 'HR load: 290 employees across 16 departments',    time: '2014-12-27', status: 'Loaded'   },
  ],
}

// ── Ontology graph — AdventureWorks entities ──────────────────────────────────

export const mockOntologyGraph: OntologyGraphData = {
  nodes: [
    {
      id: 'Customer',
      type: 'ontologyNode',
      position: { x: 150, y: 280 },
      data: {
        label: 'Customer',
        uri: 'aw:Customer',
        db_table: 'crm.account',
        row_count: 19829,
        properties: [
          prop('customer_id', 'integer', { required: true, unique: true }),
          prop('display_name', 'string', { required: true }),
          prop('account_type', 'string'),   // B2C | B2B
          prop('email', 'string'),
          prop('is_active', 'boolean'),
        ],
      },
    },
    {
      id: 'B2CCustomer',
      type: 'ontologyNode',
      position: { x: -80, y: 460 },
      data: {
        label: 'B2C Customer',
        uri: 'aw:B2CCustomer',
        db_table: 'crm.account (accountType=B2C)',
        row_count: 19119,
        properties: [
          prop('contact_name', 'string'),
        ],
      },
    },
    {
      id: 'B2BCustomer',
      type: 'ontologyNode',
      position: { x: 360, y: 460 },
      data: {
        label: 'B2B Customer',
        uri: 'aw:B2BCustomer',
        db_table: 'crm.account (accountType=B2B)',
        row_count: 710,
        properties: [
          prop('company_name', 'string'),
        ],
      },
    },
    {
      id: 'Employee',
      type: 'ontologyNode',
      position: { x: 150, y: 60 },
      data: {
        label: 'Employee',
        uri: 'aw:Employee',
        db_table: 'hr.dipendenti_hr',
        row_count: 290,
        properties: [
          prop('employee_id', 'integer', { required: true }),
          prop('full_name', 'string'),
          prop('department', 'string'),
          prop('hire_date', 'date'),
          prop('hourly_rate', 'decimal'),
        ],
      },
    },
    {
      id: 'Salesperson',
      type: 'ontologyNode',
      position: { x: 420, y: 60 },
      data: {
        label: 'Salesperson',
        uri: 'aw:Salesperson',
        db_table: 'erp.salesperson',
        row_count: 17,
        properties: [
          prop('salesperson_id', 'integer', { required: true }),
          prop('sales_quota', 'decimal'),
          prop('territory_id', 'fk', { fkTarget: 'Territory' }),
        ],
      },
    },
    {
      id: 'SalesOrder',
      type: 'ontologyNode',
      position: { x: 590, y: 280 },
      data: {
        label: 'SalesOrder',
        uri: 'aw:SalesOrder',
        db_table: 'erp.sales_order_header',
        row_count: 31465,
        properties: [
          prop('order_id', 'integer', { required: true, unique: true }),
          prop('order_date', 'date'),
          prop('customer_ref', 'fk', { fkTarget: 'Customer' }),
          prop('salesperson_ref', 'fk', { fkTarget: 'Salesperson' }),
          prop('territory_ref', 'fk', { fkTarget: 'Territory' }),
          prop('subtotal_amount', 'decimal'),
          prop('tax_amount', 'decimal'),
          prop('total_due', 'decimal'),
        ],
      },
    },
    {
      id: 'SalesOrderLine',
      type: 'ontologyNode',
      position: { x: 800, y: 460 },
      data: {
        label: 'SalesOrderLine',
        uri: 'aw:SalesOrderLine',
        db_table: 'erp.sales_order_line',
        row_count: 121317,
        properties: [
          prop('order_id', 'fk', { fkTarget: 'SalesOrder' }),
          prop('line_id', 'integer'),
          prop('product_ref', 'fk', { fkTarget: 'Product' }),
          prop('qty', 'integer'),
          prop('unit_price', 'decimal'),
          prop('line_total', 'decimal'),
        ],
      },
    },
    {
      id: 'Product',
      type: 'ontologyNode',
      position: { x: 1020, y: 280 },
      data: {
        label: 'Product',
        uri: 'aw:Product',
        db_table: 'pim.product_catalog_pim',
        row_count: 504,
        properties: [
          prop('product_id', 'integer', { required: true }),
          prop('sku', 'string', { unique: true }),
          prop('display_name', 'string'),
          prop('category_path', 'string'),
          prop('standard_cost', 'decimal'),
          prop('list_price', 'decimal'),
        ],
      },
    },
    {
      id: 'Territory',
      type: 'ontologyNode',
      position: { x: 590, y: 60 },
      data: {
        label: 'Territory',
        uri: 'aw:Territory',
        db_table: 'erp.territory',
        row_count: 10,
        properties: [
          prop('territory_id', 'integer', { required: true }),
          prop('territory_name', 'string'),
          prop('country_region', 'string'),
        ],
      },
    },
    {
      id: 'Offer',
      type: 'ontologyNode',
      position: { x: 800, y: 60 },
      data: {
        label: 'Offer',
        uri: 'aw:Offer',
        db_table: 'erp.offer',
        row_count: 16,
        properties: [
          prop('offer_id', 'integer', { required: true }),
          prop('offer_name', 'string'),
          prop('discount_pct', 'decimal'),
        ],
      },
    },
  ],

  edges: [
    // Subtype edges
    { id: 'e-b2c',    source: 'B2CCustomer',    target: 'Customer',      label: 'subClassOf',          type: 'smoothstep', animated: false, style: { stroke: '#64748b' }, labelStyle: { fill: '#94a3b8', fontSize: 10 }, markerEnd: { type: 'ArrowClosed', color: '#64748b' } },
    { id: 'e-b2b',    source: 'B2BCustomer',    target: 'Customer',      label: 'subClassOf',          type: 'smoothstep', animated: false, style: { stroke: '#64748b' }, labelStyle: { fill: '#94a3b8', fontSize: 10 }, markerEnd: { type: 'ArrowClosed', color: '#64748b' } },
    { id: 'e-sp',     source: 'Salesperson',    target: 'Employee',      label: 'subClassOf',          type: 'smoothstep', animated: false, style: { stroke: '#64748b' }, labelStyle: { fill: '#94a3b8', fontSize: 10 }, markerEnd: { type: 'ArrowClosed', color: '#64748b' } },
    // SalesOrder relations — cross-source bridges highlighted
    { id: 'e-placed', source: 'SalesOrder',     target: 'Customer',      label: 'PLACED_BY ⚡',        type: 'smoothstep', animated: true,  style: { stroke: '#f59e0b' }, labelStyle: { fill: '#f59e0b', fontSize: 10 }, markerEnd: { type: 'ArrowClosed', color: '#f59e0b' }, cardinality: 'N:1' },
    { id: 'e-sold',   source: 'SalesOrder',     target: 'Salesperson',   label: 'SOLD_BY ⚡',          type: 'smoothstep', animated: true,  style: { stroke: '#f59e0b' }, labelStyle: { fill: '#f59e0b', fontSize: 10 }, markerEnd: { type: 'ArrowClosed', color: '#f59e0b' }, cardinality: 'N:1' },
    { id: 'e-terr',   source: 'SalesOrder',     target: 'Territory',     label: 'IN_TERRITORY',        type: 'smoothstep', animated: false, style: { stroke: '#14b8a6' }, labelStyle: { fill: '#14b8a6', fontSize: 10 }, markerEnd: { type: 'ArrowClosed', color: '#14b8a6' }, cardinality: 'N:1' },
    { id: 'e-offer',  source: 'SalesOrder',     target: 'Offer',         label: 'HAS_OFFER',           type: 'smoothstep', animated: false, style: { stroke: '#14b8a6' }, labelStyle: { fill: '#14b8a6', fontSize: 10 }, markerEnd: { type: 'ArrowClosed', color: '#14b8a6' }, cardinality: 'N:1' },
    { id: 'e-lines',  source: 'SalesOrder',     target: 'SalesOrderLine', label: 'CONTAINS_LINE',      type: 'smoothstep', animated: false, style: { stroke: '#6366f1' }, labelStyle: { fill: '#6366f1', fontSize: 10 }, markerEnd: { type: 'ArrowClosed', color: '#6366f1' }, cardinality: '1:N' },
    { id: 'e-prod',   source: 'SalesOrderLine', target: 'Product',       label: 'OF_PRODUCT ⚡',       type: 'smoothstep', animated: true,  style: { stroke: '#f59e0b' }, labelStyle: { fill: '#f59e0b', fontSize: 10 }, markerEnd: { type: 'ArrowClosed', color: '#f59e0b' }, cardinality: 'N:1' },
    { id: 'e-works',  source: 'Salesperson',    target: 'Territory',     label: 'WORKS_IN',            type: 'smoothstep', animated: false, style: { stroke: '#14b8a6' }, labelStyle: { fill: '#14b8a6', fontSize: 10 }, markerEnd: { type: 'ArrowClosed', color: '#14b8a6' }, cardinality: 'N:1' },
  ],
}

// ── Mappings — cross-source field bridges (the semantic challenge) ─────────────

export const mockMappings: MappingsResponse = {
  mappings: [
    // ⚡ Cross-source key bridges
    { table: 'erp.sales_order_header', field: 'customer_ref',    ontology_class: 'Customer',    ontology_property: 'customer_id',   field_type: 'INTEGER' },
    { table: 'crm.account',            field: 'accountId',        ontology_class: 'Customer',    ontology_property: 'customer_id',   field_type: 'INTEGER' },
    { table: 'erp.sales_order_header', field: 'salesperson_ref', ontology_class: 'Salesperson', ontology_property: 'employee_id',   field_type: 'INTEGER' },
    { table: 'hr.dipendenti',          field: 'MatricolaDip',     ontology_class: 'Employee',    ontology_property: 'employee_id',   field_type: 'INTEGER' },
    { table: 'erp.sales_order_line',   field: 'product_ref',     ontology_class: 'Product',     ontology_property: 'product_id',    field_type: 'INTEGER' },
    { table: 'pim.products',           field: 'internal_id',     ontology_class: 'Product',     ontology_property: 'product_id',    field_type: 'INTEGER' },
    // Customer fields — CRM Italian schema
    { table: 'crm.account', field: 'ragioneSociale',  ontology_class: 'B2BCustomer', ontology_property: 'company_name',   field_type: 'TEXT' },
    { table: 'crm.account', field: 'nomeContatto',    ontology_class: 'B2CCustomer', ontology_property: 'contact_name',   field_type: 'TEXT' },
    { table: 'crm.account', field: 'emailContatto',   ontology_class: 'Customer',    ontology_property: 'email',          field_type: 'TEXT' },
    { table: 'crm.account', field: 'accountType',     ontology_class: 'Customer',    ontology_property: 'account_type',   field_type: 'TEXT' },
    { table: 'crm.account', field: 'isActive',        ontology_class: 'Customer',    ontology_property: 'is_active',      field_type: 'INTEGER' },
    // Employee fields — HR Italian schema, Italian dates
    { table: 'hr.dipendenti', field: 'Nome',              ontology_class: 'Employee', ontology_property: 'first_name',    field_type: 'TEXT' },
    { table: 'hr.dipendenti', field: 'Cognome',           ontology_class: 'Employee', ontology_property: 'last_name',     field_type: 'TEXT' },
    { table: 'hr.dipendenti', field: 'Reparto',           ontology_class: 'Employee', ontology_property: 'department',    field_type: 'TEXT' },
    { table: 'hr.dipendenti', field: 'DataAssunzione',    ontology_class: 'Employee', ontology_property: 'hire_date',     field_type: 'DATE (DD/MM/YYYY)' },
    { table: 'hr.dipendenti', field: 'RetribuzioneOraria', ontology_class: 'Employee', ontology_property: 'hourly_rate',  field_type: 'DECIMAL' },
    // SalesOrder fields
    { table: 'erp.sales_order_header', field: 'order_id',         ontology_class: 'SalesOrder', ontology_property: 'order_id',        field_type: 'INTEGER' },
    { table: 'erp.sales_order_header', field: 'order_date',       ontology_class: 'SalesOrder', ontology_property: 'order_date',      field_type: 'DATE' },
    { table: 'erp.sales_order_header', field: 'subtotal_amount',  ontology_class: 'SalesOrder', ontology_property: 'subtotal_amount', field_type: 'DECIMAL' },
    { table: 'erp.sales_order_header', field: 'total_due',        ontology_class: 'SalesOrder', ontology_property: 'total_due',       field_type: 'DECIMAL' },
    // Product fields — PIM JSON schema
    { table: 'pim.products', field: 'sku',          ontology_class: 'Product', ontology_property: 'sku',           field_type: 'TEXT' },
    { table: 'pim.products', field: 'displayName',  ontology_class: 'Product', ontology_property: 'display_name',  field_type: 'TEXT' },
    { table: 'pim.products', field: 'categoryPath', ontology_class: 'Product', ontology_property: 'category_path', field_type: 'TEXT' },
    { table: 'pim.products', field: 'standardCost', ontology_class: 'Product', ontology_property: 'standard_cost', field_type: 'DECIMAL' },
    { table: 'pim.products', field: 'listPrice',    ontology_class: 'Product', ontology_property: 'list_price',    field_type: 'DECIMAL' },
  ],
  raw: {
    erp_crm_bridge: 'sales_order_header.customer_ref = account.accountId',
    erp_hr_bridge:  'sales_order_header.salesperson_ref = dipendenti.MatricolaDip',
    erp_pim_bridge: 'sales_order_line.product_ref = products.internal_id',
    known_ambiguity: '"fatturato" → subtotal_amount ($20.1M) OR total_due ($22.4M)',
    crm_duplicates:  '372 accounts with accountId < 0 (merge by email + normalised name)',
    hr_date_format:  'DD/MM/YYYY → normalised to ISO at load time',
  },
}

// ── Query result — top salesperson golden question ────────────────────────────

export const mockQueryResult: QueryResult = {
  question: 'Chi è il venditore con più ordini nel 2014?',
  interpreted_as: "Salesperson con COUNT(sales_order_header) massimo WHERE year=2014 — join cross-fonte ERP→HR (salesperson_ref ↔ MatricolaDip)",
  sql_query: `SELECT h.salesperson_ref, COUNT(*) as n
FROM sales_order_header h
WHERE strftime('%Y', h.order_date) = '2014'
  AND h.salesperson_ref IS NOT NULL
GROUP BY h.salesperson_ref
ORDER BY n DESC LIMIT 1
-- then JOIN hr.dipendenti ON MatricolaDip = salesperson_ref`,
  results: [
    { salesperson_ref: 289, order_count: 67, full_name: 'Jae Pak', department: 'Sales', sources: 'ERP + HR' },
  ],
  summary: 'Jae Pak (matricola 289, reparto Sales) ha gestito 67 ordini nel 2014 — il massimo tra i 17 venditori. Dato ottenuto via join cross-fonte: conteggio ordini da ERP OrionSales + nome/cognome da HR dipendenti_hr.csv.',
}
