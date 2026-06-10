import type { SectorId } from './sectors'
import { IS_DEMO_MODE } from '../lib/demoMode'

// -- Types --
export type DataCategory = 'identification' | 'contact' | 'financial' | 'health' | 'behavioral' | 'professional' | 'transactional'
export type LawfulBasis = 'contract' | 'legal-obligation' | 'legitimate-interests' | 'consent' | 'vital-interests'
export type DataResidency = 'EU-only' | 'EU-adequacy' | 'standard-clauses'
export type AiRiskLevel = 'minimal' | 'limited' | 'high' | 'unacceptable'
export type HumanOversight = 'mandatory' | 'recommended' | 'not-required'

export interface EntityCompliance {
  entityId: string
  label: string
  personalData: boolean
  specialCategory: boolean
  categories: DataCategory[]
  lawfulBasis: LawfulBasis[]
  retention: string
  residency: DataResidency
  dataSubjects: string[]
  dpiaRequired: boolean
}

export interface AgentCompliance {
  agentId: string
  name: string
  riskLevel: AiRiskLevel
  aiActArticles: string[]
  humanOversight: HumanOversight
  dpiaRequired: boolean
  rationale: string
}

export interface SectorCompliance {
  entities: EntityCompliance[]
  agents: AgentCompliance[]
}

// -- Data --
export const COMPLIANCE: Record<SectorId, SectorCompliance> = {
  manufacturing: {
    entities: [
      {
        entityId: 'Customer',
        label: 'Customer',
        personalData: true,
        specialCategory: false,
        categories: ['identification', 'contact'],
        lawfulBasis: ['contract', 'legitimate-interests'],
        retention: '10 years',
        residency: 'EU-adequacy',
        dataSubjects: ['B2B Clients'],
        dpiaRequired: false,
      },
      {
        entityId: 'Order',
        label: 'Order',
        personalData: true,
        specialCategory: false,
        categories: ['identification', 'transactional', 'financial'],
        lawfulBasis: ['contract'],
        retention: '10 years',
        residency: 'EU-adequacy',
        dataSubjects: ['Customers'],
        dpiaRequired: false,
      },
      {
        entityId: 'Quote',
        label: 'Quote',
        personalData: true,
        specialCategory: false,
        categories: ['identification', 'financial'],
        lawfulBasis: ['legitimate-interests'],
        retention: '3 years',
        residency: 'EU-adequacy',
        dataSubjects: ['Customers'],
        dpiaRequired: false,
      },
      {
        entityId: 'Supplier',
        label: 'Supplier',
        personalData: true,
        specialCategory: false,
        categories: ['identification', 'professional'],
        lawfulBasis: ['contract'],
        retention: '10 years',
        residency: 'EU-adequacy',
        dataSubjects: ['Supplier contacts'],
        dpiaRequired: false,
      },
      {
        entityId: 'Product',
        label: 'Product',
        personalData: false,
        specialCategory: false,
        categories: [],
        lawfulBasis: [],
        retention: 'Indefinite',
        residency: 'EU-adequacy',
        dataSubjects: [],
        dpiaRequired: false,
      },
      {
        entityId: 'WorkOrder',
        label: 'WorkOrder',
        personalData: false,
        specialCategory: false,
        categories: [],
        lawfulBasis: [],
        retention: 'Indefinite',
        residency: 'EU-adequacy',
        dataSubjects: [],
        dpiaRequired: false,
      },
      {
        entityId: 'Machine',
        label: 'Machine',
        personalData: false,
        specialCategory: false,
        categories: [],
        lawfulBasis: [],
        retention: 'Indefinite',
        residency: 'EU-adequacy',
        dataSubjects: [],
        dpiaRequired: false,
      },
      {
        entityId: 'BillOfMaterial',
        label: 'BillOfMaterial',
        personalData: false,
        specialCategory: false,
        categories: [],
        lawfulBasis: [],
        retention: 'Indefinite',
        residency: 'EU-adequacy',
        dataSubjects: [],
        dpiaRequired: false,
      },
    ],
    agents: [
      {
        agentId: 'quote-review',
        name: 'Quote Review Agent',
        riskLevel: 'minimal',
        aiActArticles: [],
        humanOversight: 'not-required',
        dpiaRequired: false,
        rationale: 'Commercial analysis on quote data, no automated decisions on natural persons',
      },
      {
        agentId: 'production-scheduler',
        name: 'Production Scheduler',
        riskLevel: 'minimal',
        aiActArticles: [],
        humanOversight: 'not-required',
        dpiaRequired: false,
        rationale: 'Internal operational optimization, no direct impact on natural persons',
      },
      {
        agentId: 'supplier-monitor',
        name: 'Supplier Risk Monitor',
        riskLevel: 'minimal',
        aiActArticles: [],
        humanOversight: 'not-required',
        dpiaRequired: false,
        rationale: 'Supplier performance analysis on business data',
      },
      {
        agentId: 'delivery-alert',
        name: 'Delivery Alert Agent',
        riskLevel: 'limited',
        aiActArticles: ['Art. 22(2)(b)'],
        humanOversight: 'recommended',
        dpiaRequired: false,
        rationale: 'Automated customer notifications, must disclose AI involvement in communications',
      },
    ],
  },

  retail: {
    entities: [
      {
        entityId: 'Customer',
        label: 'Customer',
        personalData: true,
        specialCategory: false,
        categories: ['identification', 'contact', 'behavioral'],
        lawfulBasis: ['consent', 'contract', 'legitimate-interests'],
        retention: '3 years from last purchase',
        residency: 'EU-adequacy',
        dataSubjects: ['Customers'],
        dpiaRequired: true,
      },
      {
        entityId: 'Order',
        label: 'Order',
        personalData: true,
        specialCategory: false,
        categories: ['identification', 'transactional', 'financial'],
        lawfulBasis: ['contract'],
        retention: '10 years',
        residency: 'EU-adequacy',
        dataSubjects: ['Customers'],
        dpiaRequired: false,
      },
      {
        entityId: 'Cart',
        label: 'Cart',
        personalData: true,
        specialCategory: false,
        categories: ['behavioral'],
        lawfulBasis: ['legitimate-interests', 'consent'],
        retention: '30 days',
        residency: 'EU-adequacy',
        dataSubjects: ['Visitors'],
        dpiaRequired: false,
      },
      {
        entityId: 'Promotion',
        label: 'Promotion',
        personalData: false,
        specialCategory: false,
        categories: [],
        lawfulBasis: [],
        retention: 'Indefinite',
        residency: 'EU-adequacy',
        dataSubjects: [],
        dpiaRequired: false,
      },
      {
        entityId: 'Inventory',
        label: 'Inventory',
        personalData: false,
        specialCategory: false,
        categories: [],
        lawfulBasis: [],
        retention: 'Indefinite',
        residency: 'EU-adequacy',
        dataSubjects: [],
        dpiaRequired: false,
      },
      {
        entityId: 'Store',
        label: 'Store',
        personalData: false,
        specialCategory: false,
        categories: [],
        lawfulBasis: [],
        retention: 'Indefinite',
        residency: 'EU-adequacy',
        dataSubjects: [],
        dpiaRequired: false,
      },
    ],
    agents: [
      {
        agentId: 'cart-recovery',
        name: 'Cart Recovery Agent',
        riskLevel: 'limited',
        aiActArticles: ['Art. 22(2)(b)', 'GDPR Art. 13'],
        humanOversight: 'recommended',
        dpiaRequired: false,
        rationale: 'Behavioral profiling + automated marketing messages',
      },
      {
        agentId: 'stock-replenishment',
        name: 'Stock Replenishment Agent',
        riskLevel: 'minimal',
        aiActArticles: [],
        humanOversight: 'not-required',
        dpiaRequired: false,
        rationale: 'Inventory management, no personal data involved',
      },
      {
        agentId: 'churn-detector',
        name: 'Churn Risk Detector',
        riskLevel: 'limited',
        aiActArticles: ['Art. 22(1)', 'GDPR Art. 13'],
        humanOversight: 'recommended',
        dpiaRequired: true,
        rationale: 'Churn propensity scoring on customer profiles — falls under GDPR Art. 22 profiling',
      },
      {
        agentId: 'promo-optimizer',
        name: 'Promotion Optimizer',
        riskLevel: 'limited',
        aiActArticles: ['Art. 22(2)(b)'],
        humanOversight: 'recommended',
        dpiaRequired: false,
        rationale: 'Automated A/B testing on promotions, impact on consumer experience',
      },
    ],
  },

  healthcare: {
    entities: [
      {
        entityId: 'Patient',
        label: 'Patient',
        personalData: true,
        specialCategory: true,
        categories: ['identification', 'contact', 'health'],
        lawfulBasis: ['consent', 'vital-interests'],
        retention: '10 years (medical record)',
        residency: 'EU-only',
        dataSubjects: ['Patients'],
        dpiaRequired: true,
      },
      {
        entityId: 'Encounter',
        label: 'Encounter',
        personalData: true,
        specialCategory: true,
        categories: ['health', 'identification'],
        lawfulBasis: ['vital-interests'],
        retention: '10 years',
        residency: 'EU-only',
        dataSubjects: ['Patients'],
        dpiaRequired: true,
      },
      {
        entityId: 'Doctor',
        label: 'Doctor',
        personalData: true,
        specialCategory: false,
        categories: ['identification', 'professional'],
        lawfulBasis: ['contract'],
        retention: 'Contract duration + 5 years',
        residency: 'EU-adequacy',
        dataSubjects: ['Doctors/Employees'],
        dpiaRequired: false,
      },
      {
        entityId: 'Prescription',
        label: 'Prescription',
        personalData: true,
        specialCategory: true,
        categories: ['health', 'transactional'],
        lawfulBasis: ['vital-interests'],
        retention: '10 years',
        residency: 'EU-only',
        dataSubjects: ['Patients'],
        dpiaRequired: true,
      },
      {
        entityId: 'Medication',
        label: 'Medication',
        personalData: false,
        specialCategory: false,
        categories: [],
        lawfulBasis: [],
        retention: 'Indefinite',
        residency: 'EU-adequacy',
        dataSubjects: [],
        dpiaRequired: false,
      },
      {
        entityId: 'InsurancePlan',
        label: 'InsurancePlan',
        personalData: true,
        specialCategory: false,
        categories: ['identification', 'financial'],
        lawfulBasis: ['contract'],
        retention: '10 years',
        residency: 'EU-adequacy',
        dataSubjects: ['Patients'],
        dpiaRequired: false,
      },
      {
        entityId: 'Treatment',
        label: 'Treatment',
        personalData: true,
        specialCategory: true,
        categories: ['health'],
        lawfulBasis: ['vital-interests'],
        retention: '10 years',
        residency: 'EU-only',
        dataSubjects: ['Patients'],
        dpiaRequired: true,
      },
    ],
    agents: [
      {
        agentId: 'followup-scheduler',
        name: 'Follow-up Scheduler',
        riskLevel: 'high',
        aiActArticles: ['EU AI Act Art. 6(a)', 'MDR 2017/745'],
        humanOversight: 'mandatory',
        dpiaRequired: true,
        rationale: 'Automated prioritization of access to care — direct health impact',
      },
      {
        agentId: 'drug-interaction',
        name: 'Drug Interaction Checker',
        riskLevel: 'high',
        aiActArticles: ['EU AI Act Art. 6(a)', 'MDR 2017/745', 'GDPR Art. 9'],
        humanOversight: 'mandatory',
        dpiaRequired: true,
        rationale: 'Patient safety, adjacent to medical device classification',
      },
      {
        agentId: 'insurance-preauth',
        name: 'Insurance Pre-authorizer',
        riskLevel: 'high',
        aiActArticles: ['EU AI Act Art. 6(a)', 'Art. 22(1)'],
        humanOversight: 'mandatory',
        dpiaRequired: true,
        rationale: "Decisioni automatizzate sull'accesso a prestazioni sanitarie",
      },
      {
        agentId: 'noshow-predictor',
        name: 'No-show Predictor',
        riskLevel: 'limited',
        aiActArticles: ['EU AI Act Art. 6(e)'],
        humanOversight: 'recommended',
        dpiaRequired: false,
        rationale: 'Ottimizzazione schedulazione, il decisore finale rimane umano',
      },
    ],
  },

  finance: {
    entities: [
      {
        entityId: 'Applicant',
        label: 'Applicant',
        personalData: true,
        specialCategory: false,
        categories: ['identification', 'financial'],
        lawfulBasis: ['contract', 'legal-obligation'],
        retention: '7 years (AML)',
        residency: 'EU-only',
        dataSubjects: ['Applicants'],
        dpiaRequired: true,
      },
      {
        entityId: 'Transaction',
        label: 'Transaction',
        personalData: true,
        specialCategory: false,
        categories: ['financial', 'behavioral'],
        lawfulBasis: ['legal-obligation', 'contract'],
        retention: '10 years',
        residency: 'EU-only',
        dataSubjects: ['Customers'],
        dpiaRequired: false,
      },
      {
        entityId: 'KYCRecord',
        label: 'KYCRecord',
        personalData: true,
        specialCategory: false,
        categories: ['identification'],
        lawfulBasis: ['legal-obligation'],
        retention: '5 years from end of relationship',
        residency: 'EU-only',
        dataSubjects: ['Applicants'],
        dpiaRequired: true,
      },
      {
        entityId: 'RiskProfile',
        label: 'RiskProfile',
        personalData: true,
        specialCategory: false,
        categories: ['financial'],
        lawfulBasis: ['legal-obligation'],
        retention: 'Relationship duration + 5 years',
        residency: 'EU-only',
        dataSubjects: ['Applicants'],
        dpiaRequired: true,
      },
      {
        entityId: 'Loan',
        label: 'Loan',
        personalData: true,
        specialCategory: false,
        categories: ['financial'],
        lawfulBasis: ['contract'],
        retention: '10 years',
        residency: 'EU-adequacy',
        dataSubjects: ['Applicants'],
        dpiaRequired: false,
      },
      {
        entityId: 'Payment',
        label: 'Payment',
        personalData: true,
        specialCategory: false,
        categories: ['financial', 'transactional'],
        lawfulBasis: ['contract', 'legal-obligation'],
        retention: '10 years',
        residency: 'EU-adequacy',
        dataSubjects: ['Customers'],
        dpiaRequired: false,
      },
      {
        entityId: 'BankAccount',
        label: 'BankAccount',
        personalData: true,
        specialCategory: false,
        categories: ['financial', 'identification'],
        lawfulBasis: ['contract'],
        retention: '10 years',
        residency: 'EU-adequacy',
        dataSubjects: ['Customers'],
        dpiaRequired: false,
      },
    ],
    agents: [
      {
        agentId: 'kyc-agent',
        name: 'KYC Completion Agent',
        riskLevel: 'high',
        aiActArticles: ['EU AI Act Art. 6(c)', 'AMLD6 Dir. 2018/843'],
        humanOversight: 'mandatory',
        dpiaRequired: true,
        rationale: 'Accesso ai servizi finanziari — Art. 22(1) GDPR, perimetro AML',
      },
      {
        agentId: 'risk-scoring',
        name: 'Risk Scoring Agent',
        riskLevel: 'high',
        aiActArticles: ['EU AI Act Art. 6(a)', 'Art. 22(1) GDPR', 'Basilea III'],
        humanOversight: 'mandatory',
        dpiaRequired: true,
        rationale: 'Valutazione merito creditizio automatizzata — esplicito perimetro GDPR Art. 22',
      },
      {
        agentId: 'payment-alert',
        name: 'Overdue Payment Agent',
        riskLevel: 'high',
        aiActArticles: ['EU AI Act Art. 6(c)', 'Dir. 2008/48/CE'],
        humanOversight: 'mandatory',
        dpiaRequired: true,
        rationale: 'Recupero crediti automatizzato con conseguenze legali',
      },
      {
        agentId: 'aml-monitor',
        name: 'AML Transaction Monitor',
        riskLevel: 'high',
        aiActArticles: ['EU AI Act Art. 6(d)', 'AMLD6', 'FATF 40'],
        humanOversight: 'mandatory',
        dpiaRequired: true,
        rationale: 'Monitoraggio AML, segnalazioni STR automatizzate, cooperazione con autorità',
      },
      {
        agentId: 'sdi-monitor',
        name: 'SDI Invoice Monitor',
        riskLevel: 'minimal',
        aiActArticles: [],
        humanOversight: 'not-required',
        dpiaRequired: false,
        rationale: 'Monitoraggio fatture elettroniche, nessun dato personale sensibile coinvolto',
      },
    ],
  },
}

// -- Helpers --
export function getSectorCompliance(sectorId: SectorId): SectorCompliance {
  // Live workspaces must not present the fabricated demo GDPR/AI Act register
  // as if it described the user's own data — they start empty and populate as
  // the user classifies their ontology entities.
  if (!IS_DEMO_MODE) return { entities: [], agents: [] }
  return COMPLIANCE[sectorId]
}

export function computeComplianceScore(compliance: SectorCompliance): {
  overall: number
  gdprScore: number
  aiActScore: number
  highRiskCount: number
  dpiaRequired: number
  specialCategoryCount: number
} {
  const dpiaRequired = compliance.entities.filter(e => e.dpiaRequired).length
  const specialCategoryCount = compliance.entities.filter(e => e.specialCategory).length
  const highRiskCount = compliance.agents.filter(a => a.riskLevel === 'high').length
  const limitedRiskCount = compliance.agents.filter(a => a.riskLevel === 'limited').length
  const gdprScore = Math.max(50, 100 - dpiaRequired * 6 - specialCategoryCount * 3)
  const aiActScore = Math.max(50, 100 - highRiskCount * 8 - limitedRiskCount * 2)
  const overall = Math.round((gdprScore + aiActScore) / 2)
  return { overall, gdprScore, aiActScore, highRiskCount, dpiaRequired, specialCategoryCount }
}
