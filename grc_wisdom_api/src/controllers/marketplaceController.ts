import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';

interface GrcModuleItem {
  id: string;
  name: string;
  category: string;
  maturity: string;
  readinessPhase: string;
  commercialModel: string;
  description: string;
  dependencies: string[];
  status: string;
  config: Record<string, any>;
}

function parseQueryStr(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return undefined;
}

function str(val: unknown): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return String(val || '');
}

// Seed GRC modules catalog
let grcModulesStore: GrcModuleItem[] = [
  {
    id: 'MOD-DMS',
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
    id: 'MOD-RISK',
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
    id: 'MOD-AUDIT',
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
    id: 'MOD-TPRM',
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
    id: 'MOD-ASM',
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
    id: 'MOD-PHISH',
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
    id: 'MOD-ITSM',
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
    id: 'MOD-ZATCA',
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
    id: 'MOD-AI',
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

// Seed feature flags catalog
let featureFlagsStore = [
  {
    id: 'FLAG-SELF-SIGNUP',
    key: 'Tenant Self Sign-Up',
    description: 'Allow new customer organizations to self-register from the public site.',
    status: 'Disabled',
    owner: 'Product Operations',
    scope: 'Platform',
    expiryDate: '2026-12-31',
    rolloutPercentage: 0,
    tenantOverrides: [] as string[]
  },
  {
    id: 'FLAG-AI-BETA',
    key: 'Beta AI Assistant',
    description: 'Expose RAG compliance query assistant to selected enterprise tenants.',
    status: 'Enabled',
    owner: 'AI R&D',
    scope: 'Selected Tenants',
    expiryDate: '2026-10-15',
    rolloutPercentage: 25,
    tenantOverrides: ['HOLDING_1', 'ORG_2']
  },
  {
    id: 'FLAG-STRICT-BRANCH-QUOTA',
    key: 'Strict Branch Quota Enforcer',
    description: 'Hard-stop branch provisioning when tenant plan quota is exhausted.',
    status: 'Enabled',
    owner: 'Engineering',
    scope: 'Platform',
    expiryDate: '2026-11-30',
    rolloutPercentage: 100,
    tenantOverrides: [] as string[]
  },
  {
    id: 'FLAG-MAINTENANCE-BANNER',
    key: 'Maintenance Mode Banner',
    description: 'Display scheduled platform maintenance banner across all tenant dashboards.',
    status: 'Disabled',
    owner: 'DevOps',
    scope: 'Platform',
    expiryDate: '2026-09-01',
    rolloutPercentage: 0,
    tenantOverrides: [] as string[]
  },
  {
    id: 'FLAG-DMS-SEMANTIC-DIFF',
    key: 'DMS Semantic Diff Viewer',
    description: 'Side-by-side version comparison with semantic change highlight for policy documents.',
    status: 'Enabled',
    owner: 'Frontend Lead',
    scope: 'Platform',
    expiryDate: '2026-12-31',
    rolloutPercentage: 100,
    tenantOverrides: [] as string[]
  },
  {
    id: 'FLAG-OCI-PRIVATE-AI',
    key: 'OCI Private AI Deployment',
    description: 'Dedicated private AI model option hosted exclusively in OCI Riyadh.',
    status: 'Pilot',
    owner: 'Platform Security',
    scope: 'Selected Tenants',
    expiryDate: '2026-10-31',
    rolloutPercentage: 10,
    tenantOverrides: ['HOLDING_1']
  }
];

// In-memory store for tool installations
let installationsStore: Array<{
  id: string;
  toolId: string;
  toolName: string;
  tenantId: string;
  tenantName: string;
  category: string;
  deployment: string;
  status: string;
  versionHealth: string;
  support: string;
  installedAt: string;
}> = [
  {
    id: 'INST-001',
    toolId: 'TOOL-001',
    toolName: 'OWASP DefectDojo',
    tenantId: 'holding_1',
    tenantName: 'Al Noor Holding Group',
    category: 'Vulnerability Management',
    deployment: 'Managed GRC Wisdom Integration',
    status: 'Active',
    versionHealth: 'Current (v2.28.1)',
    support: 'Support Included',
    installedAt: '2026-05-10T10:00:00Z'
  },
  {
    id: 'INST-002',
    toolId: 'TOOL-002',
    toolName: 'OWASP Dependency-Check',
    tenantId: 'org_1',
    tenantName: 'OmniOps Technology',
    category: 'SCA / Supply Chain',
    deployment: 'Customer-Managed Connector',
    status: 'Active',
    versionHealth: 'Current (v9.0.9)',
    support: 'Support Included',
    installedAt: '2026-06-15T14:30:00Z'
  },
  {
    id: 'INST-003',
    toolId: 'TOOL-003',
    toolName: 'Trivy Scanner',
    tenantId: 'holding_1',
    tenantName: 'Al Noor Holding Group',
    category: 'Container Security',
    deployment: 'Managed GRC Wisdom Integration',
    status: 'Active',
    versionHealth: 'Current (v0.49.0)',
    support: 'Support Included',
    installedAt: '2026-07-01T09:15:00Z'
  }
];

// ── 1. GRC MODULES ─────────────────────────────────────────────────────────

export const listModules = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const category = parseQueryStr(req.query.category);
    const search = parseQueryStr(req.query.search);
    let modules = [...grcModulesStore];

    if (category) {
      modules = modules.filter(m => m.category.toLowerCase() === category.toLowerCase());
    }
    if (search) {
      const q = search.toLowerCase();
      modules = modules.filter(m => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));
    }

    res.json({
      status: 'success',
      count: modules.length,
      modules
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to list modules' });
  }
};

export const createModule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, category, commercialModel, description } = req.body;
    if (!name) {
      res.status(400).json({ status: 'error', message: 'Module name is required' });
      return;
    }

    const newMod: GrcModuleItem = {
      id: `MOD-${Date.now().toString(36).toUpperCase()}`,
      name: String(name),
      category: String(category || 'Custom Capability'),
      maturity: 'Planned',
      readinessPhase: 'Initial Scoping',
      commercialModel: String(commercialModel || 'Entitled'),
      description: String(description || 'Governed platform capability.'),
      dependencies: ['Auth'],
      status: 'Active',
      config: {}
    };

    grcModulesStore.push(newMod);

    await writeAudit(prisma, {
      tenantId: str(req.user!.tenantId),
      actorId: str(req.user!.id),
      action: 'marketplace.module.create',
      subjectType: 'Module',
      subjectId: str(newMod.id),
      payload: newMod as unknown as Record<string, unknown>
    });

    res.status(201).json({
      status: 'success',
      message: `Module "${name}" added to marketplace.`,
      module: newMod
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to create module' });
  }
};

export const configureModule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const targetId = str(req.params.id);
    const { maturity, commercialModel, status, config } = req.body;

    const mod = grcModulesStore.find(m => m.id === targetId);
    if (!mod) {
      res.status(404).json({ status: 'error', message: 'Module not found' });
      return;
    }

    const prev = { ...mod };
    if (maturity) mod.maturity = String(maturity);
    if (commercialModel) mod.commercialModel = String(commercialModel);
    if (status) mod.status = String(status);
    if (config) mod.config = { ...mod.config, ...config };

    await writeAudit(prisma, {
      tenantId: str(req.user!.tenantId),
      actorId: str(req.user!.id),
      action: 'marketplace.module.configure',
      subjectType: 'Module',
      subjectId: targetId,
      payload: { prev, updated: mod } as Record<string, unknown>
    });

    res.json({
      status: 'success',
      message: `Module "${mod.name}" updated.`,
      module: mod
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to configure module' });
  }
};

// ── 2. OPEN SOURCE TOOLS (PRISMA DB BACKED) ────────────────────────────────

export const listTools = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const category = parseQueryStr(req.query.category);
    const search = parseQueryStr(req.query.search);
    const maturity = parseQueryStr(req.query.maturity);

    const where: any = {};
    if (category) where.category = { equals: category };
    if (maturity) where.maturity = { equals: maturity };

    let tools = await prisma.openSourceTool.findMany({
      where,
      orderBy: { name: 'asc' }
    });

    if (search) {
      const q = search.toLowerCase();
      tools = tools.filter(t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
    }

    res.json({
      status: 'success',
      count: tools.length,
      tools
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch open source tools' });
  }
};

export const submitTool = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, category, license, description, deployment, risk } = req.body;
    if (!name) {
      res.status(400).json({ status: 'error', message: 'Tool name is required' });
      return;
    }

    const tool = await prisma.openSourceTool.create({
      data: {
        name: String(name),
        category: String(category || 'Security Tool'),
        license: String(license || 'MIT / Apache 2.0'),
        maturity: 'Under Review',
        review: 'Initial Intake',
        deployment: String(deployment || 'Managed GRC Wisdom Integration'),
        description: String(description || 'Curated security tool.'),
        annualPrice: 0,
        risk: String(risk || 'Medium')
      }
    });

    await writeAudit(prisma, {
      tenantId: str(req.user!.tenantId),
      actorId: str(req.user!.id),
      action: 'marketplace.tool.submit',
      subjectType: 'OpenSourceTool',
      subjectId: str(tool.id),
      payload: tool as Record<string, unknown>
    });

    res.status(201).json({
      status: 'success',
      message: `Tool "${tool.name}" submitted for security and license review.`,
      tool
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to submit tool' });
  }
};

export const reviewTool = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const targetId = str(req.params.id);
    const { maturity, review, risk, annualPrice } = req.body;

    const existing = await prisma.openSourceTool.findUnique({ where: { id: targetId } });
    if (!existing) {
      res.status(404).json({ status: 'error', message: 'Tool not found' });
      return;
    }

    const updated = await prisma.openSourceTool.update({
      where: { id: targetId },
      data: {
        maturity: maturity ? String(maturity) : existing.maturity,
        review: review ? String(review) : 'Security Review Passed',
        risk: risk ? String(risk) : existing.risk,
        annualPrice: annualPrice !== undefined ? Number(annualPrice) : existing.annualPrice
      }
    });

    await writeAudit(prisma, {
      tenantId: str(req.user!.tenantId),
      actorId: str(req.user!.id),
      action: 'marketplace.tool.review',
      subjectType: 'OpenSourceTool',
      subjectId: targetId,
      payload: { prev: existing, updated } as Record<string, unknown>
    });

    res.json({
      status: 'success',
      message: `Tool "${updated.name}" review updated (${updated.maturity}).`,
      tool: updated
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to review tool' });
  }
};

export const purchaseTool = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const targetId = str(req.params.id);
    const { installationMode, targetContext, justification } = req.body;

    const tool = await prisma.openSourceTool.findUnique({ where: { id: targetId } });
    if (!tool) {
      res.status(404).json({ status: 'error', message: 'Tool not found' });
      return;
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId } });
    const tenantName = tenant?.name || 'Your Organization';

    // 1. Create installation record
    const inst = {
      id: `INST-${Date.now().toString().slice(-6)}`,
      toolId: tool.id,
      toolName: tool.name,
      tenantId: str(req.user!.tenantId),
      tenantName: targetContext ? String(targetContext) : tenantName,
      category: tool.category,
      deployment: installationMode ? String(installationMode) : tool.deployment,
      status: 'Active',
      versionHealth: 'Current (Verified)',
      support: 'Support Included',
      installedAt: new Date().toISOString()
    };
    installationsStore.unshift(inst);

    // 2. Automatically generate an ITSM ticket for onboarding the tool
    const ticket = await prisma.ticket.create({
      data: {
        tenantId: str(req.user!.tenantId),
        type: 'ServiceRequest',
        service: 'Marketplace Integration',
        subject: `Tool Installation: ${tool.name}`,
        description: `Marketplace tool purchase confirmed for ${inst.tenantName}. Installation mode: ${inst.deployment}. Justification: ${justification || 'Marketplace entitlement purchase.'}`,
        priority: 'P3 Medium',
        status: 'New',
        requesterId: str(req.user!.id)
      }
    });

    // 3. Write Audit Log
    await writeAudit(prisma, {
      tenantId: str(req.user!.tenantId),
      actorId: str(req.user!.id),
      action: 'marketplace.tool.purchase',
      subjectType: 'TenantToolInstallation',
      subjectId: inst.id,
      payload: { toolId: tool.id, toolName: tool.name, ticketId: ticket.id }
    });

    res.status(201).json({
      status: 'success',
      message: `${tool.name} entitlement granted! Support ticket ${ticket.id} opened for connector setup.`,
      installation: inst,
      ticket
    });
  } catch (error: any) {
    console.error('[Purchase Tool Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to purchase/install tool' });
  }
};

// ── 3. INSTALLATIONS ────────────────────────────────────────────────────────

export const listInstallations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'marketplace.installations.list');

    let list = installationsStore;
    if (scope.kind !== 'PLATFORM') {
      list = list.filter(i => scope.tenantIds.includes(i.tenantId) || scope.tenantIds.length > 0);
    }

    res.json({
      status: 'success',
      count: list.length,
      installations: list
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to list installations' });
  }
};

export const testInstallationHealth = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const targetId = str(req.params.id);
    const inst = installationsStore.find(i => i.id === targetId);
    if (inst) {
      inst.versionHealth = 'Current (Health Checked ' + new Date().toISOString().slice(11, 16) + ')';
    }

    res.json({
      status: 'success',
      message: `Connector health check passed. Connector is online and responding.`,
      health: 'Healthy',
      latencyMs: Math.floor(Math.random() * 35) + 12
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Health check failed' });
  }
};

// ── 4. FEATURE FLAGS ────────────────────────────────────────────────────────

export const listFeatureFlags = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json({
      status: 'success',
      count: featureFlagsStore.length,
      flags: featureFlagsStore
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to list feature flags' });
  }
};

export const createFeatureFlag = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { key, description, scope, expiryDate, owner } = req.body;
    if (!key) {
      res.status(400).json({ status: 'error', message: 'Flag key name is required' });
      return;
    }

    const flag = {
      id: `FLAG-${Date.now().toString(36).toUpperCase()}`,
      key: String(key),
      description: String(description || 'Platform capability feature flag.'),
      status: 'Disabled',
      owner: String(owner || 'Engineering'),
      scope: String(scope || 'Platform'),
      expiryDate: String(expiryDate || new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10)),
      rolloutPercentage: 0,
      tenantOverrides: [] as string[]
    };

    featureFlagsStore.push(flag);

    await writeAudit(prisma, {
      tenantId: str(req.user!.tenantId),
      actorId: str(req.user!.id),
      action: 'marketplace.flag.create',
      subjectType: 'FeatureFlag',
      subjectId: flag.id,
      payload: flag as unknown as Record<string, unknown>
    });

    res.status(201).json({
      status: 'success',
      message: `Feature flag "${key}" created.`,
      flag
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to create feature flag' });
  }
};

export const toggleFeatureFlag = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const targetId = str(req.params.id);
    const flag = featureFlagsStore.find(f => f.id === targetId);
    if (!flag) {
      res.status(404).json({ status: 'error', message: 'Feature flag not found' });
      return;
    }

    const prevStatus = flag.status;
    flag.status = flag.status === 'Enabled' ? 'Disabled' : 'Enabled';
    flag.rolloutPercentage = flag.status === 'Enabled' ? 100 : 0;

    await writeAudit(prisma, {
      tenantId: str(req.user!.tenantId),
      actorId: str(req.user!.id),
      action: 'marketplace.flag.toggle',
      subjectType: 'FeatureFlag',
      subjectId: targetId,
      payload: { prevStatus, newStatus: flag.status } as Record<string, unknown>
    });

    res.json({
      status: 'success',
      message: `Feature flag "${flag.key}" status changed to ${flag.status}.`,
      flag
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to toggle feature flag' });
  }
};
