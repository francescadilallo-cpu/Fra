import type { OntologyGraphData, OntologyProperty, ProcessFunnelStage } from '../types'

export type SectorId = 'manufacturing' | 'retail' | 'healthcare' | 'finance'

export interface SectorConfig {
  id: SectorId
  name: string
  icon: string
  domain: string
  ontologyTitle: string
  funnel: ProcessFunnelStage[]
  kpiLabels: { quotes: string; orders: string; conversion: string; openValue: string }
  processStages: { key: string; label: string }[]
  ontology: OntologyGraphData
  connectors: string[]
}

// Helper to build a typed property quickly
function p(name: string, type: OntologyProperty['type'], opts?: { required?: boolean; unique?: boolean; fkTarget?: string }): OntologyProperty {
  return { name, type, ...opts }
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
        { id: 'Customer',      type: 'ontologyNode', position: { x: 100,  y: 200 }, data: { label: 'Customer',      uri: 'mfg:Customer',      db_table: 'customers',          row_count: 20,   properties: [p('id','uuid',{required:true,unique:true}), p('name','string',{required:true}), p('sector','string'), p('country','string'), p('vatNumber','string',{unique:true}), p('creditLimit','decimal')] } },
        { id: 'Product',       type: 'ontologyNode', position: { x: 700,  y: 200 }, data: { label: 'Product',       uri: 'mfg:Product',       db_table: 'products',           row_count: 30,   properties: [p('id','uuid',{required:true,unique:true}), p('sku','string',{required:true,unique:true}), p('name','string',{required:true}), p('category','string'), p('unitPrice','decimal',{required:true}), p('weight','decimal'), p('active','boolean')] } },
        { id: 'Quote',         type: 'ontologyNode', position: { x: 100,  y: 450 }, data: { label: 'Quote',         uri: 'mfg:Quote',         db_table: 'quotes',             row_count: 50,   properties: [p('id','uuid',{required:true,unique:true}), p('date','date',{required:true}), p('status','string'), p('totalValue','decimal'), p('validUntil','date'), p('notes','text')] } },
        { id: 'Order',         type: 'ontologyNode', position: { x: 700,  y: 450 }, data: { label: 'Order',         uri: 'mfg:Order',         db_table: 'orders',             row_count: 13,   properties: [p('id','uuid',{required:true,unique:true}), p('date','date',{required:true}), p('status','string'), p('deliveryDate','date'), p('totalAmount','decimal'), p('priority','string')] } },
        { id: 'Supplier',      type: 'ontologyNode', position: { x: 400,  y: 50  }, data: { label: 'Supplier',      uri: 'mfg:Supplier',      db_table: 'suppliers',          row_count: 45,   properties: [p('id','uuid',{required:true,unique:true}), p('name','string',{required:true}), p('country','string'), p('rating','decimal'), p('leadTimeDays','integer'), p('certifications','text')] } },
        { id: 'WorkOrder',     type: 'ontologyNode', position: { x: 400,  y: 450 }, data: { label: 'WorkOrder',     uri: 'mfg:WorkOrder',     db_table: 'work_orders',        row_count: 28,   properties: [p('id','uuid',{required:true,unique:true}), p('startDate','date'), p('dueDate','date'), p('status','string'), p('quantity','integer'), p('priority','string')] } },
        { id: 'BillOfMaterial',type: 'ontologyNode', position: { x: 1050, y: 200 }, data: { label: 'BillOfMaterial',uri: 'mfg:BillOfMaterial',db_table: 'bills_of_material', row_count: 120,  properties: [p('id','uuid',{required:true,unique:true}), p('version','string'), p('quantity','decimal',{required:true}), p('unit','string')] } },
        { id: 'Machine',       type: 'ontologyNode', position: { x: 100,  y: 680 }, data: { label: 'Machine',       uri: 'mfg:Machine',       db_table: 'machines',           row_count: 18,   properties: [p('id','uuid',{required:true,unique:true}), p('name','string',{required:true}), p('type','string'), p('lastMaintenanceDate','date'), p('efficiency','decimal'), p('status','string')] } },
      ],
      edges: [
        { id: 'e1', source: 'Quote',         target: 'Customer',  label: 'hasCustomer',  cardinality: 'N:1', type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e2', source: 'Order',         target: 'Customer',  label: 'hasCustomer',  cardinality: 'N:1', type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e3', source: 'Order',         target: 'Quote',     label: 'fromQuote',    cardinality: '1:1', type: 'smoothstep', animated: false, style: { stroke: '#F59E0B' }, labelStyle: { fill: '#F59E0B', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e4', source: 'WorkOrder',     target: 'Order',     label: 'fulfills',     cardinality: 'N:1', type: 'smoothstep', animated: false, style: { stroke: '#6366F1' }, labelStyle: { fill: '#6366F1', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e5', source: 'BillOfMaterial',target: 'Product',   label: 'describes',    cardinality: 'N:1', type: 'smoothstep', animated: false, style: { stroke: '#6366F1' }, labelStyle: { fill: '#6366F1', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e6', source: 'Product',       target: 'Supplier',  label: 'suppliedBy',   cardinality: 'N:1', type: 'smoothstep', animated: false, style: { stroke: '#8B5CF6' }, labelStyle: { fill: '#8B5CF6', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e7', source: 'WorkOrder',     target: 'Machine',   label: 'assignedTo',   cardinality: 'N:1', type: 'smoothstep', animated: false, style: { stroke: '#EC4899' }, labelStyle: { fill: '#EC4899', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
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
      { stage: 'Site Visits',       count: 12500, value: 0 },
      { stage: 'Carts Created',     count: 1850,  value: 285000 },
      { stage: 'Checkouts Started', count: 920,   value: 162000 },
      { stage: 'Orders Paid',       count: 740,   value: 138000 },
      { stage: 'Shipped',           count: 680,   value: 128000 },
      { stage: 'Delivered',         count: 650,   value: 123000 },
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
        { id: 'Customer',  type: 'ontologyNode', position: { x: 100,  y: 200 }, data: { label: 'Customer',  uri: 'rtl:Customer',  db_table: 'customers',  row_count: 4520, properties: [p('id','uuid',{required:true,unique:true}), p('email','string',{required:true,unique:true}), p('loyaltyTier','string'), p('country','string'), p('createdAt','datetime'), p('totalSpent','decimal')] } },
        { id: 'Product',   type: 'ontologyNode', position: { x: 700,  y: 200 }, data: { label: 'Product',   uri: 'rtl:Product',   db_table: 'products',   row_count: 2840, properties: [p('id','uuid',{required:true,unique:true}), p('sku','string',{required:true,unique:true}), p('name','string',{required:true}), p('price','decimal',{required:true}), p('stockLevel','integer'), p('active','boolean')] } },
        { id: 'Cart',      type: 'ontologyNode', position: { x: 100,  y: 450 }, data: { label: 'Cart',      uri: 'rtl:Cart',      db_table: 'carts',      row_count: 1850, properties: [p('id','uuid',{required:true,unique:true}), p('createdAt','datetime'), p('totalValue','decimal'), p('itemCount','integer'), p('status','string')] } },
        { id: 'Order',     type: 'ontologyNode', position: { x: 700,  y: 450 }, data: { label: 'Order',     uri: 'rtl:Order',     db_table: 'orders',     row_count: 740,  properties: [p('id','uuid',{required:true,unique:true}), p('paidAt','datetime'), p('shippingAddress','text'), p('total','decimal',{required:true}), p('trackingNumber','string'), p('status','string')] } },
        { id: 'Category',  type: 'ontologyNode', position: { x: 400,  y: 50  }, data: { label: 'Category',  uri: 'rtl:Category',  db_table: 'categories', row_count: 84,   properties: [p('id','uuid',{required:true,unique:true}), p('name','string',{required:true}), p('slug','string',{unique:true}), p('parentCategoryId','fk',{fkTarget:'Category'})] } },
        { id: 'Inventory', type: 'ontologyNode', position: { x: 400,  y: 450 }, data: { label: 'Inventory', uri: 'rtl:Inventory', db_table: 'inventory',  row_count: 2840, properties: [p('id','uuid',{required:true,unique:true}), p('quantity','integer',{required:true}), p('reservedQty','integer'), p('location','string'), p('updatedAt','datetime')] } },
        { id: 'Promotion', type: 'ontologyNode', position: { x: 100,  y: 680 }, data: { label: 'Promotion', uri: 'rtl:Promotion', db_table: 'promotions', row_count: 32,   properties: [p('id','uuid',{required:true,unique:true}), p('code','string',{unique:true}), p('discountPct','decimal'), p('validFrom','date'), p('validTo','date'), p('active','boolean')] } },
        { id: 'Store',     type: 'ontologyNode', position: { x: 700,  y: 680 }, data: { label: 'Store',     uri: 'rtl:Store',     db_table: 'stores',     row_count: 28,   properties: [p('id','uuid',{required:true,unique:true}), p('name','string',{required:true}), p('country','string'), p('type','string'), p('active','boolean')] } },
      ],
      edges: [
        { id: 'e1', source: 'Cart',      target: 'Customer', label: 'belongsTo',      cardinality: 'N:1', type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e2', source: 'Order',     target: 'Customer', label: 'placedBy',        cardinality: 'N:1', type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e3', source: 'Order',     target: 'Cart',     label: 'convertedFrom',   cardinality: '1:1', type: 'smoothstep', animated: false, style: { stroke: '#F59E0B' }, labelStyle: { fill: '#F59E0B', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e4', source: 'Product',   target: 'Category', label: 'belongsTo',       cardinality: 'N:1', type: 'smoothstep', animated: false, style: { stroke: '#6366F1' }, labelStyle: { fill: '#6366F1', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e5', source: 'Inventory', target: 'Product',  label: 'tracks',          cardinality: 'N:1', type: 'smoothstep', animated: false, style: { stroke: '#6366F1' }, labelStyle: { fill: '#6366F1', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e6', source: 'Promotion', target: 'Product',  label: 'appliesTo',       cardinality: 'N:M', type: 'smoothstep', animated: false, style: { stroke: '#8B5CF6' }, labelStyle: { fill: '#8B5CF6', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e7', source: 'Inventory', target: 'Store',    label: 'locatedIn',       cardinality: 'N:1', type: 'smoothstep', animated: false, style: { stroke: '#EC4899' }, labelStyle: { fill: '#EC4899', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
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
        { id: 'Patient',       type: 'ontologyNode', position: { x: 100,  y: 200 }, data: { label: 'Patient',       uri: 'hc:Patient',       db_table: 'patients',       row_count: 1240, properties: [p('id','uuid',{required:true,unique:true}), p('birthDate','date',{required:true}), p('gender','string'), p('bloodType','string'), p('chronicConditions','text'), p('insuranceId','string')] } },
        { id: 'Diagnosis',     type: 'ontologyNode', position: { x: 700,  y: 200 }, data: { label: 'Diagnosis',     uri: 'hc:Diagnosis',     db_table: 'diagnoses',      row_count: 870,  properties: [p('id','uuid',{required:true,unique:true}), p('icd10','string',{required:true}), p('severity','string'), p('date','date',{required:true}), p('description','text'), p('confirmed','boolean')] } },
        { id: 'Treatment',     type: 'ontologyNode', position: { x: 100,  y: 450 }, data: { label: 'Treatment',     uri: 'hc:Treatment',     db_table: 'treatments',     row_count: 720,  properties: [p('id','uuid',{required:true,unique:true}), p('type','string',{required:true}), p('startDate','date',{required:true}), p('endDate','date'), p('protocol','text'), p('outcome','string')] } },
        { id: 'Encounter',     type: 'ontologyNode', position: { x: 700,  y: 450 }, data: { label: 'Encounter',     uri: 'hc:Encounter',     db_table: 'encounters',     row_count: 4200, properties: [p('id','uuid',{required:true,unique:true}), p('date','datetime',{required:true}), p('provider','string',{required:true}), p('location','string'), p('notes','text'), p('durationMin','integer')] } },
        { id: 'Doctor',        type: 'ontologyNode', position: { x: 400,  y: 50  }, data: { label: 'Doctor',        uri: 'hc:Doctor',        db_table: 'doctors',        row_count: 142,  properties: [p('id','uuid',{required:true,unique:true}), p('name','string',{required:true}), p('specialization','string',{required:true}), p('licenseNumber','string',{unique:true}), p('department','string')] } },
        { id: 'Prescription',  type: 'ontologyNode', position: { x: 400,  y: 450 }, data: { label: 'Prescription',  uri: 'hc:Prescription',  db_table: 'prescriptions',  row_count: 3100, properties: [p('id','uuid',{required:true,unique:true}), p('issuedAt','datetime',{required:true}), p('validUntil','date'), p('dosage','string'), p('frequency','string'), p('renewals','integer')] } },
        { id: 'Medication',    type: 'ontologyNode', position: { x: 1050, y: 200 }, data: { label: 'Medication',    uri: 'hc:Medication',    db_table: 'medications',    row_count: 580,  properties: [p('id','uuid',{required:true,unique:true}), p('name','string',{required:true}), p('activeIngredient','string'), p('dosageForm','string'), p('strength','string'), p('controlled','boolean')] } },
        { id: 'InsurancePlan', type: 'ontologyNode', position: { x: 100,  y: 680 }, data: { label: 'InsurancePlan', uri: 'hc:InsurancePlan', db_table: 'insurance_plans',row_count: 210,  properties: [p('id','uuid',{required:true,unique:true}), p('provider','string',{required:true}), p('planCode','string'), p('coverageType','string'), p('annualLimit','decimal'), p('deductible','decimal')] } },
      ],
      edges: [
        { id: 'e1', source: 'Diagnosis',    target: 'Patient',       label: 'diagnosedFor',  cardinality: 'N:1', type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e2', source: 'Treatment',    target: 'Diagnosis',     label: 'treats',         cardinality: 'N:1', type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e3', source: 'Encounter',    target: 'Patient',       label: 'involves',       cardinality: 'N:1', type: 'smoothstep', animated: false, style: { stroke: '#F59E0B' }, labelStyle: { fill: '#F59E0B', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e4', source: 'Encounter',    target: 'Doctor',        label: 'conductedBy',    cardinality: 'N:1', type: 'smoothstep', animated: false, style: { stroke: '#6366F1' }, labelStyle: { fill: '#6366F1', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e5', source: 'Prescription', target: 'Encounter',     label: 'issuedDuring',   cardinality: 'N:1', type: 'smoothstep', animated: false, style: { stroke: '#6366F1' }, labelStyle: { fill: '#6366F1', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e6', source: 'Prescription', target: 'Medication',    label: 'prescribes',     cardinality: 'N:1', type: 'smoothstep', animated: false, style: { stroke: '#8B5CF6' }, labelStyle: { fill: '#8B5CF6', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e7', source: 'Patient',      target: 'InsurancePlan', label: 'coveredBy',      cardinality: 'N:1', type: 'smoothstep', animated: false, style: { stroke: '#EC4899' }, labelStyle: { fill: '#EC4899', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
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
      { key: 'apply',    label: 'Application' },
      { key: 'kyc',      label: 'KYC' },
      { key: 'analyze',  label: 'Analysis' },
      { key: 'disburse', label: 'Disbursement' },
    ],
    connectors: ['Temenos', 'FIS', 'Murex', 'Bloomberg', 'Refinitiv'],
    ontology: {
      nodes: [
        { id: 'Applicant',    type: 'ontologyNode', position: { x: 100,  y: 200 }, data: { label: 'Applicant',    uri: 'fin:Applicant',    db_table: 'applicants',    row_count: 320,  properties: [p('id','uuid',{required:true,unique:true}), p('name','string',{required:true}), p('fiscalCode','string',{unique:true}), p('riskScore','decimal'), p('annualIncome','decimal'), p('employmentStatus','string')] } },
        { id: 'Loan',         type: 'ontologyNode', position: { x: 700,  y: 200 }, data: { label: 'Loan',         uri: 'fin:Loan',         db_table: 'loans',         row_count: 132,  properties: [p('id','uuid',{required:true,unique:true}), p('amount','decimal',{required:true}), p('rate','decimal',{required:true}), p('termMonths','integer'), p('status','string'), p('disbursedAt','date')] } },
        { id: 'Collateral',   type: 'ontologyNode', position: { x: 100,  y: 450 }, data: { label: 'Collateral',   uri: 'fin:Collateral',   db_table: 'collaterals',   row_count: 89,   properties: [p('id','uuid',{required:true,unique:true}), p('type','string',{required:true}), p('value','decimal',{required:true}), p('status','string'), p('appraisalDate','date')] } },
        { id: 'Transaction',  type: 'ontologyNode', position: { x: 700,  y: 450 }, data: { label: 'Transaction',  uri: 'fin:Transaction',  db_table: 'transactions',  row_count: 8420, properties: [p('id','uuid',{required:true,unique:true}), p('date','datetime',{required:true}), p('amount','decimal',{required:true}), p('currency','string'), p('type','string'), p('reference','string')] } },
        { id: 'RiskProfile',  type: 'ontologyNode', position: { x: 400,  y: 50  }, data: { label: 'RiskProfile',  uri: 'fin:RiskProfile',  db_table: 'risk_profiles', row_count: 320,  properties: [p('id','uuid',{required:true,unique:true}), p('score','decimal',{required:true}), p('category','string'), p('computedAt','datetime'), p('factors','text'), p('pdRate','decimal')] } },
        { id: 'KYCRecord',    type: 'ontologyNode', position: { x: 400,  y: 450 }, data: { label: 'KYCRecord',    uri: 'fin:KYCRecord',    db_table: 'kyc_records',   row_count: 280,  properties: [p('id','uuid',{required:true,unique:true}), p('status','string',{required:true}), p('completedAt','datetime'), p('documentType','string'), p('expiryDate','date'), p('riskLevel','string')] } },
        { id: 'Payment',      type: 'ontologyNode', position: { x: 1050, y: 450 }, data: { label: 'Payment',      uri: 'fin:Payment',      db_table: 'payments',      row_count: 1840, properties: [p('id','uuid',{required:true,unique:true}), p('amount','decimal',{required:true}), p('dueDate','date',{required:true}), p('paidAt','datetime'), p('lateFee','decimal'), p('installmentNo','integer')] } },
        { id: 'BankAccount',  type: 'ontologyNode', position: { x: 700,  y: 680 }, data: { label: 'BankAccount',  uri: 'fin:BankAccount',  db_table: 'bank_accounts', row_count: 445,  properties: [p('id','uuid',{required:true,unique:true}), p('iban','string',{required:true,unique:true}), p('type','string'), p('openedAt','date'), p('balance','decimal'), p('currency','string')] } },
      ],
      edges: [
        { id: 'e1', source: 'Loan',        target: 'Applicant',   label: 'grantedTo',    cardinality: 'N:1', type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e2', source: 'Loan',        target: 'Collateral',  label: 'securedBy',    cardinality: '1:1', type: 'smoothstep', animated: true,  style: { stroke: '#0D9488' }, labelStyle: { fill: '#0D9488', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e3', source: 'Transaction', target: 'Loan',        label: 'relatedTo',    cardinality: 'N:1', type: 'smoothstep', animated: false, style: { stroke: '#F59E0B' }, labelStyle: { fill: '#F59E0B', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e4', source: 'Applicant',   target: 'RiskProfile', label: 'hasProfile',   cardinality: '1:1', type: 'smoothstep', animated: false, style: { stroke: '#6366F1' }, labelStyle: { fill: '#6366F1', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e5', source: 'Applicant',   target: 'KYCRecord',   label: 'verifiedBy',   cardinality: '1:1', type: 'smoothstep', animated: false, style: { stroke: '#6366F1' }, labelStyle: { fill: '#6366F1', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e6', source: 'Payment',     target: 'Loan',        label: 'repays',       cardinality: 'N:1', type: 'smoothstep', animated: false, style: { stroke: '#8B5CF6' }, labelStyle: { fill: '#8B5CF6', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
        { id: 'e7', source: 'Applicant',   target: 'BankAccount', label: 'owns',         cardinality: '1:N', type: 'smoothstep', animated: false, style: { stroke: '#EC4899' }, labelStyle: { fill: '#EC4899', fontSize: 11 }, markerEnd: { type: 'ArrowClosed' } },
      ],
    },
  },
}
