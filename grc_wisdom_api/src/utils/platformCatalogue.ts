/**
 * The platform's own catalogue, as reference data.
 *
 * These lived as mutable module-scope arrays inside marketplaceController, so
 * publishing a module or toggling a flag changed process memory: lost on the
 * next restart, invisible to every other instance, and written to the WORM
 * audit log as though it had happened. An immutable trail asserting changes the
 * system silently reverted is worse than no trail at all.
 *
 * They are now seed rows for PlatformModule and FeatureFlag. This file is the
 * shipped starting point, not the live state — once seeded, the database is
 * what the product reads and writes.
 *
 * The flags previously carried `tenantOverrides: ['HOLDING_1', 'ORG_2']`,
 * identifiers that matched no tenant in any database. Overrides are now rows
 * with a real foreign key, so there is nothing to invent here.
 */

export interface ModuleSeed {
  key: string;
  name: string;
  category: string;
  maturity: string;
  readinessPhase: string;
  commercialModel: string;
  description: string;
  dependencies: string[];
  config: Record<string, unknown>;
  status: string;
}

export interface FlagSeed {
  key: string;
  description: string;
  status: string;
  owner: string;
  scope: string;
  expiryDate: string;
  rolloutPercentage: number;
}

export const MODULE_CATALOGUE: ModuleSeed[] = [] = [
  {
    key: 'MOD-DMS',
    name: 'Document Management & E-Signature (DMS)',
    category: 'Core GRC',
    maturity: 'Released',
    readinessPhase: 'General Availability',
    commercialModel: 'Entitled',
    description: 'Document authoring, multi-stage approval routing, cryptographic e-signature and version control.',
    dependencies: ['Auth', 'AuditLog', 'WorkflowEngine'],
    status: 'Active',
    config: { autoArchiveDays: 365, requireMfaSignature: true, defaultRetentionYears: 7 }
  },
  {
    key: 'MOD-RISK',
    name: 'Enterprise Risk Management (ERM)',
    category: 'Core GRC',
    maturity: 'Released',
    readinessPhase: 'General Availability',
    commercialModel: 'Entitled',
    description: 'Inherent & residual risk scoring, risk appetite alignment, KRI monitoring and treatment plans.',
    dependencies: ['Auth', 'AuditLog'],
    status: 'Active',
    config: { scoringMatrix: '5x5', autoCalculateResidual: true, appetiteAlertThreshold: 'High' }
  },
  {
    key: 'MOD-AUDIT',
    name: 'Internal Audit & Assurance',
    category: 'Core GRC',
    maturity: 'Released',
    readinessPhase: 'General Availability',
    commercialModel: 'Entitled',
    description: 'Risk-based audit planning, workpaper management, finding tracking and CAP closure verification.',
    dependencies: ['Auth', 'DMS', 'WorkflowEngine'],
    status: 'Active',
    config: { requireIndependentClosure: true, automatedReminders: true }
  },
  {
    key: 'MOD-TPRM',
    name: 'Third-Party Risk Management (TPRM)',
    category: 'Assurance',
    maturity: 'Released',
    readinessPhase: 'General Availability',
    commercialModel: 'Add-on',
    description: 'Vendor inventory, criticality assessment, questionnaire dispatch and supply chain risk tracking.',
    dependencies: ['Auth', 'Risk'],
    status: 'Active',
    config: { reviewCadenceDays: 365, requireCriticalVendorSca: true }
  },
  {
    key: 'MOD-ASM',
    name: 'Wisdom Eye — Attack Surface Management (ASM)',
    category: 'Security Services',
    maturity: 'Released',
    readinessPhase: 'General Availability',
    commercialModel: 'Add-on',
    description: 'Continuous external exposure monitoring, service discovery, vulnerability scanning and breach signals.',
    dependencies: ['Auth', 'TicketDesk'],
    status: 'Active',
    config: { scanFrequencyDays: 7, requireAuthorizationRecord: true }
  },
  {
    key: 'MOD-PHISH',
    name: 'Eye Phish — Human Risk & Phishing Simulation',
    category: 'Security Services',
    maturity: 'Released',
    readinessPhase: 'General Availability',
    commercialModel: 'Add-on',
    description: 'Multilingual phishing simulations, QR/attachment scenarios, BEC awareness and remedial training.',
    dependencies: ['Auth', 'Learning'],
    status: 'Active',
    config: { enforcePrivacyScrubbing: true, maxMonthlyCampaigns: 4 }
  },
  {
    key: 'MOD-ITSM',
    name: 'ITSM Service Desk & Escalations',
    category: 'Service Management',
    maturity: 'Released',
    readinessPhase: 'General Availability',
    commercialModel: 'Entitled',
    description: 'Incident ticketing, SLA management, queue routing, escalation policies and knowledge base.',
    dependencies: ['Auth', 'WorkflowEngine'],
    status: 'Active',
    config: { p1SlaHours: 1, p2SlaHours: 8, p3SlaHours: 72 }
  },
  {
    key: 'MOD-ZATCA',
    name: 'ZATCA E-Invoicing & Billing Gateway',
    category: 'Commercial',
    maturity: 'Released',
    readinessPhase: 'General Availability',
    commercialModel: 'Entitled',
    description: 'Phase 2 ZATCA UBL 2.1 e-invoicing compliance, ECDSA signing, TLV QR generation and VAT settlement.',
    dependencies: ['Auth', 'Billing'],
    status: 'Active',
    config: { vatRatePercent: 15, zatcaEnvironment: 'Sandbox' }
  },
  {
    key: 'MOD-AI',
    name: 'AI Compliance & Policy RAG Assistant',
    category: 'Intelligence',
    maturity: 'Beta',
    readinessPhase: 'Controlled Rollout',
    commercialModel: 'Enterprise',
    description: 'Retrieval-Augmented Generation (RAG) assistant for querying internal policies and regulatory standards.',
    dependencies: ['DMS', 'Standards'],
    status: 'Active',
    config: { rateLimitPerTenantHour: 100, privateLLmOnly: true }
  }
];

export const FEATURE_FLAG_CATALOGUE: FlagSeed[] = [
  {
    key: 'Tenant Self Sign-Up',
    description: 'Allow new customer organizations to self-register from the public site.',
    status: 'Disabled',
    owner: 'Product Operations',
    scope: 'Platform',
    expiryDate: '2026-12-31',
    rolloutPercentage: 0
  },
  {
    key: 'Beta AI Assistant',
    description: 'Expose RAG compliance query assistant to selected enterprise tenants.',
    status: 'Enabled',
    owner: 'AI R&D',
    scope: 'Selected Tenants',
    expiryDate: '2026-10-15',
    rolloutPercentage: 25
  },
  {
    key: 'Strict Branch Quota Enforcer',
    description: 'Hard-stop branch provisioning when tenant plan quota is exhausted.',
    status: 'Enabled',
    owner: 'Engineering',
    scope: 'Platform',
    expiryDate: '2026-11-30',
    rolloutPercentage: 100
  },
  {
    key: 'Maintenance Mode Banner',
    description: 'Display scheduled platform maintenance banner across all tenant dashboards.',
    status: 'Disabled',
    owner: 'DevOps',
    scope: 'Platform',
    expiryDate: '2026-09-01',
    rolloutPercentage: 0
  },
  {
    key: 'DMS Semantic Diff Viewer',
    description: 'Side-by-side version comparison with semantic change highlight for policy documents.',
    status: 'Enabled',
    owner: 'Frontend Lead',
    scope: 'Platform',
    expiryDate: '2026-12-31',
    rolloutPercentage: 100
  },
  {
    key: 'OCI Private AI Deployment',
    description: 'Dedicated private AI model option hosted exclusively in OCI Riyadh.',
    status: 'Pilot',
    owner: 'Platform Security',
    scope: 'Selected Tenants',
    expiryDate: '2026-10-31',
    rolloutPercentage: 10
  }
];
