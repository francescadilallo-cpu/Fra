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
      { stage: 'Preventivi Creati',    count: 50, value: 2340000 },
      { stage: 'Preventivi Inviati',   count: 38, value: 1820000 },
      { stage: 'Preventivi Accettati', count: 13, value: 820000  },
      { stage: 'Ordini Confermati',    count: 13, value: 810000  },
      { stage: 'In Produzione',        count: 6,  value: 380000  },
      { stage: 'Consegnati',           count: 4,  value: 240000  },
    ],
    kpiLabels: { quotes: 'Preventivi Totali', orders: 'Ordini Totali', conversion: 'Tasso di Conversione', openValue: 'Valore Preventivi Aperti' },
    processStages: [
      { key: 'quote', label: 'Preventivo' },
      { key: 'order', label: 'Ordine' },
      { key: 'production', label: 'Produzione' },
      { key: 'delivery', label: 'Consegna' },
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
      { stage: 'Visite Sito',      count: 12500, value: 0 },
      { stage: 'Carrelli Creati',  count: 1850,  value: 285000 },
      { stage: 'Checkout Avviati', count: 920,   value: 162000 },
      { stage: 'Ordini Pagati',    count: 740,   value: 138000 },
      { stage: 'Spediti',          count: 680,   value: 128000 },
      { stage: 'Consegnati',       count: 650,   value: 123000 },
    ],
    kpiLabels: { quotes: 'Carrelli Attivi', orders: 'Ordini Pagati', conversion: 'Tasso Conversione Checkout', openValue: 'Valore Carrelli Aperti' },
    processStages: [
      { key: 'cart',     label: 'Carrello' },
      { key: 'checkout', label: 'Checkout' },
      { key: 'paid',     label: 'Pagato' },
      { key: 'shipped',  label: 'Spedito' },
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
      { stage: 'Pazienti Registrati', count: 1240, value: 0 },
      { stage: 'Visite Prenotate',    count: 980,  value: 0 },
      { stage: 'Diagnosi Effettuate', count: 870,  value: 0 },
      { stage: 'Trattamenti Avviati', count: 720,  value: 0 },
      { stage: 'Follow-up Completati', count: 540, value: 0 },
    ],
    kpiLabels: { quotes: 'Pazienti Attivi', orders: 'Trattamenti in Corso', conversion: 'Tasso Aderenza Terapia', openValue: 'Visite Programmate' },
    processStages: [
      { key: 'register',  label: 'Registrazione' },
      { key: 'diagnose',  label: 'Diagnosi' },
      { key: 'treat',     label: 'Trattamento' },
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
      { stage: 'Richieste Inviate',  count: 320, value: 8400000 },
      { stage: 'KYC Completati',     count: 280, value: 7350000 },
      { stage: 'Pratiche in Analisi', count: 210, value: 5520000 },
      { stage: 'Approvate',          count: 145, value: 3810000 },
      { stage: 'Erogate',            count: 132, value: 3460000 },
    ],
    kpiLabels: { quotes: 'Richieste Aperte', orders: 'Prestiti Erogati', conversion: 'Tasso Approvazione', openValue: 'Capitale Erogato' },
    processStages: [
      { key: 'apply',   label: 'Richiesta' },
      { key: 'kyc',     label: 'KYC' },
      { key: 'analyze', label: 'Analisi' },
      { key: 'disburse', label: 'Erogazione' },
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
