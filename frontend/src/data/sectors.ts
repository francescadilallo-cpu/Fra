import type { OntologyGraphData, ProcessFunnelStage } from '../types'

export type SectorId = 'manufacturing' | 'retail' | 'healthcare' | 'finance'

export interface SectorConfig {
  id: SectorId
  name: string
  icon: string  // emoji
  domain: string
  ontologyTitle: string
  funnel: ProcessFunnelStage[]
  kpiLabels: { quotes: string; orders: string; conversion: string; openValue: string }
  processStages: { key: string; label: string }[]
  ontology: OntologyGraphData
  connectors: string[]  // e.g. ['SAP', 'Salesforce']
}

export const SECTORS: Record<SectorId, SectorConfig> = {
  manufacturing: {
    id: 'manufacturing',
    name: 'Manufacturing',
    icon: '🏭',
    domain: 'Order-to-Cash · Production Planning',
    ontologyTitle: 'Manufacturing Order Management Ontology',
    funnel: [
      { stage: 'Quotes Created',    count: 50, value: 2340000 },
      { stage: 'Quotes Sent',       count: 38, value: 1820000 },
      { stage: 'Quotes Accepted',   count: 13, value: 820000  },
      { stage: 'Orders Confirmed',  count: 13, value: 810000  },
      { stage: 'In Production',     count: 6,  value: 380000  },
      { stage: 'Delivered',         count: 4,  value: 240000  },
    ],
    kpiLabels: { quotes: 'Total Quotes', orders: 'Total Orders', conversion: 'Conversion Rate', openValue: 'Open Quotes Value' },
    processStages: [
      { key: 'quote', label: 'Quote' },
      { key: 'order', label: 'Order' },
      { key: 'production', label: 'Production' },
      { key: 'delivery', label: 'Delivery' },
    ],
    connectors: ['SAP S/4HANA', 'Oracle ERP', 'Microsoft Dynamics', 'Siemens MES', 'Salesforce'],
    ontology: {
      nodes: [
        { id: 'Customer',      type: 'ontologyNode', position: { x: 100, y: 200 }, data: { label: 'Customer',      uri: 'mfg:Customer',      db_table: 'customers',   row_count: 20,  properties: ['name','sector','country','vatNumber'] } },
        { id: 'Product',       type: 'ontologyNode', position: { x: 700, y: 200 }, data: { label: 'Product',       uri: 'mfg:Product',       db_table: 'products',    row_count: 30,  properties: ['sku','name','category','unitPrice'] } },
        { id: 'Quote',         type: 'ontologyNode', position: { x: 100, y: 400 }, data: { label: 'Quote',         uri: 'mfg:Quote',         db_table: 'quotes',      row_count: 50,  properties: ['date','status','totalValue'] } },
        { id: 'Order',         type: 'ontologyNode', position: { x: 700, y: 400 }, data: { label: 'Order',         uri: 'mfg:Order',         db_table: 'orders',      row_count: 13,  properties: ['date','status','deliveryDate'] } },
      ],
      edges: [
        { id: 'e1', source: 'Quote', target: 'Customer', label: 'hasCustomer', type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e2', source: 'Order', target: 'Customer', label: 'hasCustomer', type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e3', source: 'Order', target: 'Quote',    label: 'fromQuote',   type: 'smoothstep', animated: false, style: { stroke: '#F59E0B' }, labelStyle: { fill: '#F59E0B', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
      ],
    },
  },
  retail: {
    id: 'retail',
    name: 'Retail',
    icon: '🛍️',
    domain: 'Catalog → Order → Fulfillment',
    ontologyTitle: 'Retail Order Management Ontology',
    funnel: [
      { stage: 'Site Visits',      count: 12500, value: 0 },
      { stage: 'Carts Created',    count: 1850,  value: 285000 },
      { stage: 'Checkouts Started',count: 920,   value: 162000 },
      { stage: 'Orders Paid',      count: 740,   value: 138000 },
      { stage: 'Shipped',          count: 680,   value: 128000 },
      { stage: 'Delivered',        count: 650,   value: 123000 },
    ],
    kpiLabels: { quotes: 'Active Carts', orders: 'Orders Paid', conversion: 'Checkout Conversion Rate', openValue: 'Open Carts Value' },
    processStages: [
      { key: 'cart',     label: 'Cart' },
      { key: 'checkout', label: 'Checkout' },
      { key: 'paid',     label: 'Paid' },
      { key: 'shipped',  label: 'Shipped' },
    ],
    connectors: ['Shopify', 'Magento', 'Salesforce Commerce', 'SAP CAR', 'Klaviyo'],
    ontology: {
      nodes: [
        { id: 'Customer', type: 'ontologyNode', position: { x: 100, y: 200 }, data: { label: 'Customer', uri: 'rtl:Customer', db_table: 'customers', row_count: 4520, properties: ['email','loyaltyTier','country'] } },
        { id: 'Product',  type: 'ontologyNode', position: { x: 700, y: 200 }, data: { label: 'Product',  uri: 'rtl:Product',  db_table: 'products',  row_count: 2840, properties: ['sku','name','price','stockLevel'] } },
        { id: 'Cart',     type: 'ontologyNode', position: { x: 100, y: 400 }, data: { label: 'Cart',     uri: 'rtl:Cart',     db_table: 'carts',     row_count: 1850, properties: ['createdAt','totalValue','itemCount'] } },
        { id: 'Order',    type: 'ontologyNode', position: { x: 700, y: 400 }, data: { label: 'Order',    uri: 'rtl:Order',    db_table: 'orders',    row_count: 740,  properties: ['paidAt','shippingAddress','total'] } },
      ],
      edges: [
        { id: 'e1', source: 'Cart',  target: 'Customer', label: 'belongsTo',   type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e2', source: 'Order', target: 'Customer', label: 'placedBy',    type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e3', source: 'Order', target: 'Cart',     label: 'convertedFrom', type: 'smoothstep', animated: false, style: { stroke: '#F59E0B' }, labelStyle: { fill: '#F59E0B', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
      ],
    },
  },
  healthcare: {
    id: 'healthcare',
    name: 'Healthcare',
    icon: '⚕️',
    domain: 'Patient Journey · Clinical Workflow',
    ontologyTitle: 'Patient Care Pathway Ontology',
    funnel: [
      { stage: 'Patients Registered',  count: 1240, value: 0 },
      { stage: 'Visits Scheduled',     count: 980,  value: 0 },
      { stage: 'Diagnoses Performed',  count: 870,  value: 0 },
      { stage: 'Treatments Started',   count: 720,  value: 0 },
      { stage: 'Follow-ups Completed', count: 540,  value: 0 },
    ],
    kpiLabels: { quotes: 'Active Patients', orders: 'Treatments in Progress', conversion: 'Therapy Adherence Rate', openValue: 'Scheduled Visits' },
    processStages: [
      { key: 'register',  label: 'Registration' },
      { key: 'diagnose',  label: 'Diagnosis' },
      { key: 'treat',     label: 'Treatment' },
      { key: 'follow-up', label: 'Follow-up' },
    ],
    connectors: ['Epic', 'Cerner', 'HL7 FHIR', 'Philips IntelliVue', 'GE Healthcare'],
    ontology: {
      nodes: [
        { id: 'Patient',    type: 'ontologyNode', position: { x: 100, y: 200 }, data: { label: 'Patient',    uri: 'hc:Patient',    db_table: 'patients',     row_count: 1240, properties: ['birthDate','gender','bloodType'] } },
        { id: 'Diagnosis',  type: 'ontologyNode', position: { x: 700, y: 200 }, data: { label: 'Diagnosis',  uri: 'hc:Diagnosis',  db_table: 'diagnoses',    row_count: 870,  properties: ['icd10','severity','date'] } },
        { id: 'Treatment',  type: 'ontologyNode', position: { x: 100, y: 400 }, data: { label: 'Treatment',  uri: 'hc:Treatment',  db_table: 'treatments',   row_count: 720,  properties: ['type','startDate','protocol'] } },
        { id: 'Encounter',  type: 'ontologyNode', position: { x: 700, y: 400 }, data: { label: 'Encounter',  uri: 'hc:Encounter',  db_table: 'encounters',   row_count: 4200, properties: ['date','provider','location'] } },
      ],
      edges: [
        { id: 'e1', source: 'Diagnosis', target: 'Patient',   label: 'diagnosedFor', type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e2', source: 'Treatment', target: 'Diagnosis', label: 'treats',       type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e3', source: 'Encounter', target: 'Patient',   label: 'involves',     type: 'smoothstep', animated: false, style: { stroke: '#F59E0B' }, labelStyle: { fill: '#F59E0B', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
      ],
    },
  },
  finance: {
    id: 'finance',
    name: 'Finance',
    icon: '💰',
    domain: 'Loan Origination · Risk Assessment',
    ontologyTitle: 'Credit Risk & Loan Ontology',
    funnel: [
      { stage: 'Applications Submitted', count: 320, value: 8400000 },
      { stage: 'KYC Completed',          count: 280, value: 7350000 },
      { stage: 'Under Review',           count: 210, value: 5520000 },
      { stage: 'Approved',               count: 145, value: 3810000 },
      { stage: 'Disbursed',              count: 132, value: 3460000 },
    ],
    kpiLabels: { quotes: 'Open Applications', orders: 'Loans Disbursed', conversion: 'Approval Rate', openValue: 'Capital Disbursed' },
    processStages: [
      { key: 'apply',   label: 'Application' },
      { key: 'kyc',     label: 'KYC' },
      { key: 'analyze', label: 'Analysis' },
      { key: 'disburse', label: 'Disbursement' },
    ],
    connectors: ['Temenos', 'FIS', 'Murex', 'Bloomberg', 'Refinitiv'],
    ontology: {
      nodes: [
        { id: 'Applicant', type: 'ontologyNode', position: { x: 100, y: 200 }, data: { label: 'Applicant', uri: 'fin:Applicant', db_table: 'applicants',     row_count: 320, properties: ['name','fiscalCode','riskScore'] } },
        { id: 'Loan',      type: 'ontologyNode', position: { x: 700, y: 200 }, data: { label: 'Loan',      uri: 'fin:Loan',      db_table: 'loans',          row_count: 132, properties: ['amount','rate','term'] } },
        { id: 'Collateral',type: 'ontologyNode', position: { x: 100, y: 400 }, data: { label: 'Collateral',uri: 'fin:Collateral',db_table: 'collaterals',    row_count: 89,  properties: ['type','value','status'] } },
        { id: 'Transaction',type:'ontologyNode', position: { x: 700, y: 400 }, data: { label: 'Transaction',uri:'fin:Transaction',db_table:'transactions',  row_count: 8420,properties: ['date','amount','currency'] } },
      ],
      edges: [
        { id: 'e1', source: 'Loan',       target: 'Applicant', label: 'grantedTo',  type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e2', source: 'Loan',       target: 'Collateral',label: 'securedBy',  type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e3', source: 'Transaction',target: 'Loan',      label: 'relatedTo',  type: 'smoothstep', animated: false, style: { stroke: '#F59E0B' }, labelStyle: { fill: '#F59E0B', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
      ],
    },
  },
}
