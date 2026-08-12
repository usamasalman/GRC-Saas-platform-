import { PrismaClient } from '@prisma/client';
import { PrismaNodeSQLite } from 'prisma-adapter-node-sqlite';
import bcrypt from 'bcrypt';
import { GW_DATA } from './utils/mockData';
import SEED from './utils/seedData.json';
import RBAC from './utils/rbacData.json';
import { generateMaterializedPath } from './utils/treeUtils';
import { computePriority, DEFAULT_SLA } from './services/slaService';
import { STANDARDS, CONTROLS } from './utils/grcSeedData';
import { computeEntityRisk, suggestedBudgetHours } from './services/auditRiskScoring';

/**
 * Roles present on seeded users that TRD Appendix A does not define.
 * Created as editable tenant-scoped custom roles (TRD §3.1 custom role builder)
 * rather than silently leaving those users with zero capabilities.
 */
const CUSTOM_ROLE_GRANTS: Record<string, string[]> = {
  'Support Coordinator': [
    'create-an-itsm-ticket', 'manage-and-resolve-support-tickets', 'generate-and-distribute-a-report',
  ],
  'Group Support Manager': [
    'create-an-itsm-ticket', 'manage-and-resolve-support-tickets',
    'create-an-approval-or-automation-workflow', 'add-a-user-with-role-based-access',
    'generate-and-distribute-a-report',
  ],
  'Executive Sponsor': [
    'create-an-itsm-ticket', 'acknowledge-or-monitor-a-policy', 'generate-and-distribute-a-report',
  ],
  'Patient Experience User': [
    'create-an-itsm-ticket', 'acknowledge-or-monitor-a-policy', 'assign-or-complete-learning',
  ],
  'Business Development User': [
    'create-an-itsm-ticket', 'create-or-select-a-commercial-plan',
    'manage-partner-client-workspaces-and-engagements', 'generate-and-distribute-a-report',
  ],
  'Relationship Solutions Manager': [
    'create-an-itsm-ticket', 'manage-partner-client-workspaces-and-engagements',
    'manage-a-subscription', 'generate-and-distribute-a-report',
  ],
};

function roleSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const adapter = new PrismaNodeSQLite({ url: 'file:dev.db' });
const prisma = new PrismaClient({ adapter });

const BCRYPT_ROUNDS = 10;
const DEMO_PASSWORD = 'Demo@2026';

// Tenant type inferred from the context (organization) name.
function tenantTypeFor(ctx: string): string {
  if (ctx === 'GRC Wisdom SaaS Control Plane') return 'SAAS';
  if (ctx.startsWith('GRC Wisdom') || ctx === 'Wisdom Eye Security Services') return 'SAAS_UNIT';
  if (ctx === 'Al Noor Holding Group') return 'HOLDING';
  if (ctx === 'OmniOps') return 'MULTIBRANCH';
  if (ctx === 'GRC Consulting Partners') return 'PARTNER';
  if (ctx === 'RetailCo Franchise Network') return 'FRANCHISE';
  return 'BRANCH';
}

async function main() {
  console.log('Seeding database…');
  const data = GW_DATA as any;
  const seed = SEED as any;

  // ── Wipe in FK-safe order ────────────────────────────────────────────────
  await prisma.kriReading.deleteMany();
  await prisma.kri.deleteMany();
  await prisma.lossEvent.deleteMany();
  await prisma.rcsaAssessment.deleteMany();
  await prisma.rcsaCampaign.deleteMany();
  await prisma.riskAppetite.deleteMany();
  await prisma.riskTreatmentAction.deleteMany();
  await prisma.riskControlLink.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.auditPlanItem.deleteMany();
  await prisma.auditPlan.deleteMany();
  await prisma.auditableEntity.deleteMany();
  await prisma.audit.deleteMany();
  await prisma.risk.deleteMany();
  await prisma.evidence.deleteMany();
  await prisma.controlImplementation.deleteMany();
  await prisma.controlClauseLink.deleteMany();
  await prisma.control.deleteMany();
  await prisma.tenantStandardEnablement.deleteMany();
  await prisma.standardClause.deleteMany();
  await prisma.standard.deleteMany();
  await prisma.sodRule.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.acknowledgement.deleteMany();
  await prisma.approvalQueue.deleteMany();
  await prisma.documentVersion.deleteMany();
  await prisma.document.deleteMany();
  await prisma.ticketComment.deleteMany();
  await prisma.ticketWorkNote.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.workflowStepRun.deleteMany();
  await prisma.workflowRun.deleteMany();
  await prisma.serviceCatalogItem.deleteMany();
  await prisma.workflowDefinition.deleteMany();
  await prisma.slaPolicy.deleteMany();
  await prisma.knowledgeArticle.deleteMany();
  await prisma.asmAsset.deleteMany();
  await prisma.phishCampaign.deleteMany();
  await prisma.openSourceTool.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.passwordResetRequest.deleteMany();
  await prisma.impersonationSession.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.capability.deleteMany();
  await prisma.tenant.deleteMany();

  // ── 1. Tenants (union of every context referenced by any seed source) ────
  const platformUsers: any[] = seed.SEED_PLATFORM_USERS || [];
  const accounts: any[] = data.accounts || [];

  const contexts = Array.from(new Set([
    ...platformUsers.map((u) => u.context),
    ...accounts.map((a) => a.context),
    ...(seed.SEED_TICKETS || []).map((t: any) => t.context),
    ...(seed.SEED_ASM_ASSETS || []).map((a: any) => a.context),
    ...(seed.SEED_PHISH_CAMPAIGNS || []).map((c: any) => c.context),
    ...(seed.SEED_INVOICES_V3 || []).map((i: any) => i.context),
  ].filter(Boolean))) as string[];

  const tenantMap: Record<string, string> = {};
  for (const ctx of contexts) {
    const tenant = await prisma.tenant.create({
      data: { name: ctx, type: tenantTypeFor(ctx) },
    });
    tenantMap[ctx] = tenant.id;
  }
  const fallbackTenantId = tenantMap['GRC Wisdom SaaS Control Plane'] || Object.values(tenantMap)[0];

  // ── 1b. Wire the hierarchy + materialized paths ─────────────────────────
  // Child → parent by context name. Anything absent stays a root.
  const PARENT_OF: Record<string, string> = {
    'GRC Wisdom Commercial Operations': 'GRC Wisdom SaaS Control Plane',
    'GRC Wisdom Service Operations': 'GRC Wisdom SaaS Control Plane',
    'GRC Wisdom Product Marketplace': 'GRC Wisdom SaaS Control Plane',
    'GRC Wisdom Customer Operations': 'GRC Wisdom SaaS Control Plane',
    'Wisdom Eye Security Services': 'GRC Wisdom SaaS Control Plane',
    'Al Noor Holding — KSA Region': 'Al Noor Holding Group',
    'OmniOps Security Operations': 'OmniOps',
    'Global Bank — Legal & Compliance': 'Global Bank — Information Security',
    'Global Bank — Technology': 'Global Bank — Information Security',
    'Global Bank ISO 27001 Audit Room': 'Global Bank — Information Security',
    'RetailCo — Riyadh North': 'RetailCo Franchise Network',
  };

  // Roots first, then children — so a parent's path always exists before its child's.
  const pathById: Record<string, string> = {};
  const roots = contexts.filter((c) => !PARENT_OF[c]);
  for (const ctx of roots) {
    const id = tenantMap[ctx];
    const path = generateMaterializedPath(null, id);
    await prisma.tenant.update({ where: { id }, data: { path } });
    pathById[id] = path;
  }
  for (const ctx of contexts.filter((c) => PARENT_OF[c])) {
    const id = tenantMap[ctx];
    const parentId = tenantMap[PARENT_OF[ctx]];
    const path = generateMaterializedPath(pathById[parentId] || null, id);
    await prisma.tenant.update({ where: { id }, data: { parentId, path } });
    pathById[id] = path;
  }
  console.log(`  tenants: ${contexts.length} (${roots.length} roots, ${contexts.length - roots.length} children)`);

  // ── 1c. Capabilities + roles (TRD §5 catalogue, Appendix A matrix) ───────
  const rbac = RBAC as any;
  await prisma.capability.createMany({
    data: rbac.capabilities.map((c: any) => ({
      key: c.key, name: c.name, module: c.module,
      number: c.number, tenancySpecific: c.tenancySpecific,
    })),
  });

  // Platform roles: tenantId null, read-only.
  const roleIdByName: Record<string, string> = {};
  for (const r of rbac.roles) {
    const created = await prisma.role.create({
      data: {
        tenantId: null,
        key: r.key,
        name: r.name,
        portal: r.portal,
        scopeDescription: r.scopeDescription,
        capabilityGrants: JSON.stringify(r.capabilities),
        isSystem: true,
      },
    });
    roleIdByName[r.name.toLowerCase()] = created.id;
  }
  console.log(`  capabilities: ${rbac.capabilities.length}  ·  system roles: ${rbac.roles.length}`);

  // ── 2. Users (SEED_PLATFORM_USERS is the full directory; accounts adds any extras) ──
  const demoHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
  const hashCache = new Map<string, string>([[DEMO_PASSWORD, demoHash]]);

  const accountByEmail = new Map(
    accounts.map((a) => [String(a.email).trim().toLowerCase(), a])
  );

  // Union keyed on email so the two sources can't create duplicates.
  const mergedUsers = new Map<string, any>();
  for (const u of platformUsers) {
    mergedUsers.set(String(u.email).trim().toLowerCase(), u);
  }
  for (const a of accounts) {
    const key = String(a.email).trim().toLowerCase();
    if (!mergedUsers.has(key)) mergedUsers.set(key, a);
  }

  // Custom tenant-scoped roles for role names TRD Appendix A does not define.
  // Created once per (tenant, role name) pair actually in use.
  const customRoleId: Record<string, string> = {};
  for (const [, u] of mergedUsers) {
    const grants = CUSTOM_ROLE_GRANTS[u.role];
    if (!grants) continue;
    const tenantId = tenantMap[u.context] || fallbackTenantId;
    const cacheKey = `${tenantId}::${u.role}`;
    if (customRoleId[cacheKey]) continue;
    const created = await prisma.role.create({
      data: {
        tenantId,
        key: roleSlug(u.role),
        name: u.role,
        portal: 'Tenant',
        scopeDescription: `Custom role scoped to ${u.context}`,
        businessPurpose: 'Created during seeding — not defined in TRD Appendix A.',
        capabilityGrants: JSON.stringify(grants),
        isSystem: false,
        needsReview: true,
      },
    });
    customRoleId[cacheKey] = created.id;
  }
  console.log(`  custom tenant roles: ${Object.keys(customRoleId).length}`);

  const userIdByName: Record<string, string> = {};
  let userCount = 0;
  let linkedToSystem = 0;
  let linkedToCustom = 0;
  let unlinked = 0;
  for (const [email, u] of mergedUsers) {
    const tenantId = tenantMap[u.context] || fallbackTenantId;
    // accounts[] carries the demo password; platformUsers[] does not.
    const raw = accountByEmail.get(email)?.password || DEMO_PASSWORD;
    let passwordHash = hashCache.get(raw);
    if (!passwordHash) {
      passwordHash = await bcrypt.hash(raw, BCRYPT_ROUNDS);
      hashCache.set(raw, passwordHash);
    }

    // Link to a capability-granting Role: system role by name, else custom.
    const systemRoleId = roleIdByName[String(u.role).toLowerCase()];
    const roleId = systemRoleId || customRoleId[`${tenantId}::${u.role}`] || null;
    if (systemRoleId) linkedToSystem++;
    else if (roleId) linkedToCustom++;
    else unlinked++;

    const created = await prisma.user.create({
      data: {
        email,
        name: u.name,
        passwordHash,
        tenantId,
        role: u.role,
        roleId,
        profile: u.profile || null,
        context: u.context || null,
        branch: u.branch || null,
        department: u.department || null,
        status: u.status || 'Active',
        mfaEnabled: false,
      },
    });
    userIdByName[u.name] = created.id;
    userCount++;
  }
  console.log(`  users: ${userCount} (${linkedToSystem} system role, ${linkedToCustom} custom role, ${unlinked} unlinked)`);

  // ── 3. Commercial plans (TRD §4 tiers) ──────────────────────────────────
  const PLANS = [
    { name: 'Essentials', priceMonthly: 5625, maxUsers: 25, features: ['DMS', 'ITSM', 'GRC Core'] },
    { name: 'Professional', priceMonthly: 16875, maxUsers: 100, features: ['DMS', 'ITSM', 'GRC Core', 'TPRM', 'Reporting'] },
    { name: 'Assurance', priceMonthly: 33750, maxUsers: 300, features: ['DMS', 'ITSM', 'GRC Core', 'TPRM', 'Reporting', 'Wisdom Eye', 'Eye Phish'] },
    { name: 'Enterprise Intelligence', priceMonthly: 45000, maxUsers: 1000, features: ['All modules', 'AI assistant', 'Public API', 'Webhooks'] },
  ];
  const planIdByName: Record<string, string> = {};
  for (const p of PLANS) {
    const plan = await prisma.plan.create({
      data: {
        name: p.name,
        priceMonthly: p.priceMonthly,
        maxUsers: p.maxUsers,
        features: JSON.stringify(p.features),
      },
    });
    planIdByName[p.name] = plan.id;
  }
  console.log(`  plans: ${PLANS.length}`);

  // ── 4. Subscriptions — one active subscription per customer tenant ───────
  const CUSTOMER_PLAN: Record<string, string> = {
    'Al Noor Holding Group': 'Enterprise Intelligence',
    'OmniOps': 'Assurance',
    'Hayat National Hospital — Madinah': 'Professional',
    'Global Bank — Information Security': 'Enterprise Intelligence',
    'GRC Consulting Partners': 'Assurance',
    'RetailCo Franchise Network': 'Professional',
  };
  let subCount = 0;
  for (const [ctx, planName] of Object.entries(CUSTOMER_PLAN)) {
    const tenantId = tenantMap[ctx];
    const planId = planIdByName[planName];
    if (!tenantId || !planId) continue;
    await prisma.subscription.create({
      data: { tenantId, planId, status: 'ACTIVE', startDate: new Date('2026-01-01') },
    });
    subCount++;
  }
  console.log(`  subscriptions: ${subCount}`);

  // ── 5. Invoices (totals computed from line items + VAT) ──────────────────
  let invCount = 0;
  for (const inv of seed.SEED_INVOICES_V3 || []) {
    const tenantId = tenantMap[inv.context];
    if (!tenantId) continue;
    const subtotal = (inv.lines || []).reduce(
      (sum: number, l: any) => sum + Number(l.qty || 0) * Number(l.unit || 0), 0
    );
    const total = subtotal * (1 + Number(inv.vatRate || 15) / 100);
    await prisma.invoice.create({
      data: {
        tenantId,
        amount: Number(total.toFixed(2)),
        currency: inv.currency || 'SAR',
        status: String(inv.status || 'UNPAID').toUpperCase(),
        isCleared: String(inv.status).toLowerCase() === 'paid',
      },
    });
    invCount++;
  }
  console.log(`  invoices: ${invCount}`);

  // ── 6. Documents ────────────────────────────────────────────────────────
  let docCount = 0, approvalCount = 0;
  for (const d of seed.SEED_DOCS || []) {
    const ownerId = userIdByName[d.owner] || Object.values(userIdByName)[0];
    if (!ownerId) continue;
    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) continue;
    // Map the mock engine's status labels onto the DMS state machine.
    const status =
      d.status === 'Published' ? 'PUBLISHED' :
      d.status === 'Pending Approval' ? 'IN_REVIEW' :
      d.status === 'Approved' ? 'APPROVED' :
      d.status === 'Archived' ? 'ARCHIVED' : 'DRAFT';
    const doc = await prisma.document.create({
      data: {
        code: d.code,
        tenantId: owner.tenantId,
        ownerId,
        title: d.title,
        category: d.category,
        classification: d.classification,
        status,
        version: d.version || '1.0',
        content: d.content || '',
      },
    });
    await prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNumber: doc.version,
        changeType: 'Major',
        summary: 'Seeded baseline version',
        content: doc.content,
        createdById: ownerId,
      },
    });

    // A document in review must have someone to review it. Without the queue
    // rows the assigned approver is refused at signing time, because approval
    // is granted by an ApprovalQueue row rather than by role alone.
    if (status === 'IN_REVIEW') {
      const approvers = await prisma.user.findMany({
        where: {
          tenantId: owner.tenantId,
          id: { not: ownerId },
          status: 'Active',
          // Approving is a signing act — pick people whose role reflects that
          // rather than whoever happens to come first in the table.
          role: { in: ['Compliance Approver', 'Compliance Manager', 'Organization GRC Manager'] },
        },
        select: { id: true },
        take: 2,
      });
      if (approvers.length > 0) {
        await prisma.approvalQueue.createMany({
          data: approvers.map((a, idx) => ({
            documentId: doc.id,
            approverId: a.id,
            sequenceOrder: idx + 1,
            status: 'PENDING',
          })),
        });
        approvalCount += approvers.length;
      }
    }
    docCount++;
  }
  console.log(`  documents: ${docCount} (${approvalCount} pending approval${approvalCount === 1 ? '' : 's'})`);

  // ── 7. Tickets ──────────────────────────────────────────────────────────
  let ticketCount = 0;
  for (const t of seed.SEED_TICKETS || []) {
    const tenantId = tenantMap[t.context] || fallbackTenantId;
    const requesterId = userIdByName[t.requester] || Object.values(userIdByName)[0];
    if (!requesterId) continue;
    // Derive impact/urgency from the legacy priority label, then recompute
    // priority through the matrix so seeded data obeys the same rule as new
    // tickets (TRD §7.3 — priority is never taken as given).
    const legacy = String(t.priority || '');
    const impact = legacy.startsWith('P1') ? 'High' : legacy.startsWith('P2') ? 'High' : legacy.startsWith('P3') ? 'Medium' : 'Low';
    const urgency = legacy.startsWith('P1') ? 'High' : legacy.startsWith('P2') ? 'Medium' : legacy.startsWith('P3') ? 'Medium' : 'Low';
    const priority = computePriority(impact, urgency);
    const target = DEFAULT_SLA[priority] || DEFAULT_SLA['P4 Low'];
    const created = t.createdAt ? new Date(t.createdAt) : new Date();
    const closed = ['Resolved', 'Closed', 'Cancelled'].includes(t.status);

    await prisma.ticket.create({
      data: {
        tenantId,
        requesterId,
        assigneeId: userIdByName[t.agent] || null,
        type: t.type,
        service: t.service,
        subject: t.subject,
        description: t.description,
        impact,
        urgency,
        priority,
        status: t.status,
        assignedTeam: t.assignedTeam || null,
        sla: t.sla || null,
        slaResponseAt: new Date(created.getTime() + target.responseMins * 60000),
        slaResolveAt: new Date(created.getTime() + target.resolveMins * 60000),
        resolvedAt: closed ? new Date(created.getTime() + target.resolveMins * 30000) : null,
        createdAt: created,
        dueAt: t.dueAt ? new Date(t.dueAt) : new Date(created.getTime() + target.resolveMins * 60000),
      },
    });
    ticketCount++;
  }
  console.log(`  tickets: ${ticketCount}`);

  // ── 8. Open-source marketplace tools ────────────────────────────────────
  let toolCount = 0;
  for (const t of seed.SEED_OPEN_SOURCE_TOOLS || []) {
    await prisma.openSourceTool.create({
      data: {
        name: t.name,
        category: t.category,
        license: t.license,
        maturity: t.maturity,
        review: t.review,
        deployment: t.deployment,
        description: t.description,
        annualPrice: Number(t.annualPrice || 0),
        risk: t.risk,
      },
    });
    toolCount++;
  }
  console.log(`  tools: ${toolCount}`);

  // ── 9. Wisdom Eye ASM assets ────────────────────────────────────────────
  let asmCount = 0;
  for (const a of seed.SEED_ASM_ASSETS || []) {
    const tenantId = tenantMap[a.context] || fallbackTenantId;
    await prisma.asmAsset.create({
      data: {
        tenantId,
        asset: a.asset,
        type: a.type,
        owner: a.owner,
        authorization: a.authorization,
        score: Number(a.score || 0),
        critical: Number(a.critical || 0),
        high: Number(a.high || 0),
        lastScan: new Date(a.lastScan),
        branch: a.branch,
      },
    });
    asmCount++;
  }
  console.log(`  asm assets: ${asmCount}`);

  // ── 10. Eye Phish campaigns ─────────────────────────────────────────────
  let phishCount = 0;
  for (const c of seed.SEED_PHISH_CAMPAIGNS || []) {
    const tenantId = tenantMap[c.context] || fallbackTenantId;
    await prisma.phishCampaign.create({
      data: {
        tenantId,
        name: c.name,
        scope: c.scope,
        scenario: c.scenario,
        language: c.language,
        targets: Number(c.targets || 0),
        status: c.status,
        failureRate: Number(c.failureRate || 0),
        reportRate: Number(c.reportRate || 0),
        remediation: Number(c.remediation || 0),
      },
    });
    phishCount++;
  }
  console.log(`  phish campaigns: ${phishCount}`);

  // ── 10b. SLA policies (TRD §7.3 defaults, tenant-overridable) ───────────
  const SLA_DEFAULTS = [
    { priority: 'P1 Critical', responseMins: 15, resolveMins: 60 },
    { priority: 'P2 High', responseMins: 60, resolveMins: 480 },
    { priority: 'P3 Medium', responseMins: 240, resolveMins: 4320 },
    { priority: 'P4 Low', responseMins: 480, resolveMins: 7200 },
  ];
  await prisma.slaPolicy.createMany({
    data: SLA_DEFAULTS.map((p) => ({ tenantId: null, ...p })),
  });
  console.log(`  sla policies: ${SLA_DEFAULTS.length}`);

  // ── 10c. Workflow definitions (TRD §6.6) ────────────────────────────────
  // Steps are data, not code — routing changes without a deploy.
  const WORKFLOWS = [
    {
      key: 'access-request-approval',
      name: 'Access request approval',
      description: 'Line-manager review followed by security sign-off.',
      subjectType: 'Ticket',
      steps: [
        { key: 'submit', type: 'submit', name: 'Request submitted' },
        {
          key: 'manager-review', type: 'review', name: 'Manager review',
          requiredCapability: 'add-a-user-with-role-based-access', dueInHours: 24,
        },
        {
          key: 'security-approval', type: 'approve', name: 'Security approval',
          requiredCapability: 'monitor-security-and-handle-incidents', dueInHours: 24,
          sodGuardedAction: 'ACCESS_APPROVED',
        },
        { key: 'notify', type: 'notify', name: 'Notify requester', message: 'Access request decided' },
      ],
    },
    {
      key: 'standard-change-approval',
      name: 'Standard change approval',
      description: 'CAB-style review for changes to production services.',
      subjectType: 'Ticket',
      steps: [
        { key: 'submit', type: 'submit', name: 'Change submitted' },
        {
          key: 'technical-review', type: 'review', name: 'Technical review',
          requiredCapability: 'manage-and-resolve-support-tickets', dueInHours: 48,
        },
        {
          key: 'change-approval', type: 'approve', name: 'Change approval',
          requiredCapability: 'create-an-approval-or-automation-workflow', dueInHours: 48,
        },
        { key: 'notify', type: 'notify', name: 'Notify stakeholders' },
      ],
    },
    {
      key: 'security-event-triage',
      name: 'Security event triage',
      description: 'Single security sign-off for reported security events.',
      subjectType: 'Ticket',
      steps: [
        { key: 'submit', type: 'submit', name: 'Event reported' },
        {
          key: 'triage', type: 'approve', name: 'Security triage',
          requiredCapability: 'monitor-security-and-handle-incidents', dueInHours: 4,
        },
      ],
    },
  ];

  const workflowIdByKey: Record<string, string> = {};
  for (const w of WORKFLOWS) {
    const created = await prisma.workflowDefinition.create({
      data: {
        tenantId: null,
        key: w.key,
        name: w.name,
        description: w.description,
        subjectType: w.subjectType,
        steps: JSON.stringify(w.steps),
        isSystem: true,
        isActive: true,
      },
    });
    workflowIdByKey[w.key] = created.id;
  }
  console.log(`  workflow definitions: ${WORKFLOWS.length}`);

  // ── 10d. Service catalog — the workflow link is the point ────────────────
  const CATALOG = [
    {
      key: 'production-access', name: 'Request production access',
      description: 'Elevated access to a production system or database.',
      category: 'Access', ticketType: 'AccessRequest',
      defaultImpact: 'High', defaultUrgency: 'Medium',
      assignmentGroup: 'Identity & Access', workflow: 'access-request-approval',
    },
    {
      key: 'new-starter-accounts', name: 'New starter account setup',
      description: 'Provision accounts, mailbox and group membership for a joiner.',
      category: 'Access', ticketType: 'ServiceRequest',
      defaultImpact: 'Medium', defaultUrgency: 'Medium',
      assignmentGroup: 'Identity & Access', workflow: 'access-request-approval',
    },
    {
      key: 'production-change', name: 'Production change request',
      description: 'Any change affecting a production service.',
      category: 'Change', ticketType: 'Change',
      defaultImpact: 'High', defaultUrgency: 'Medium',
      assignmentGroup: 'Application Support', workflow: 'standard-change-approval',
    },
    {
      key: 'report-security-event', name: 'Report a security event',
      description: 'Suspected phishing, data exposure or unauthorized access.',
      category: 'Security', ticketType: 'SecurityEvent',
      defaultImpact: 'High', defaultUrgency: 'High',
      assignmentGroup: 'Security Operations', workflow: 'security-event-triage',
    },
    // No workflow — straight to the queue.
    {
      key: 'password-vpn-reset', name: 'Password or VPN reset',
      description: 'Reset a forgotten credential or re-enrol a VPN token.',
      category: 'Support', ticketType: 'ServiceRequest',
      defaultImpact: 'Low', defaultUrgency: 'High',
      assignmentGroup: 'Service Desk', workflow: null,
    },
    {
      key: 'report-an-incident', name: 'Report an incident',
      description: 'Something is broken or degraded.',
      category: 'Support', ticketType: 'Incident',
      defaultImpact: 'Medium', defaultUrgency: 'High',
      assignmentGroup: 'Service Desk', workflow: null,
    },
    {
      key: 'reporting-export-issue', name: 'Reporting or export issue',
      description: 'A report or bilingual export is failing or incorrect.',
      category: 'Support', ticketType: 'Incident',
      defaultImpact: 'Medium', defaultUrgency: 'Medium',
      assignmentGroup: 'Application Support', workflow: null,
    },
  ];

  for (const c of CATALOG) {
    await prisma.serviceCatalogItem.create({
      data: {
        tenantId: null,
        key: c.key, name: c.name, description: c.description,
        category: c.category, ticketType: c.ticketType,
        defaultImpact: c.defaultImpact, defaultUrgency: c.defaultUrgency,
        assignmentGroup: c.assignmentGroup,
        workflowDefinitionId: c.workflow ? workflowIdByKey[c.workflow] : null,
        isActive: true,
      },
    });
  }
  console.log(`  catalog items: ${CATALOG.length} (${CATALOG.filter((c) => c.workflow).length} workflow-routed)`);

  // ── 10e. Knowledge base ─────────────────────────────────────────────────
  const ARTICLES = [
    {
      title: 'Resolving bilingual Word export timeouts',
      category: 'Reporting',
      body: 'Large consolidated board packs can exceed the export timeout when Arabic and English are rendered together.\n\nWorkaround: export each language separately, or narrow the reporting scope to a single entity before exporting. A permanent fix is tracked in the reporting backlog.',
      tags: ['export', 'reporting', 'arabic', 'timeout'],
      linkedTicketTypes: ['Incident'],
    },
    {
      title: 'Requesting production access',
      category: 'Access',
      body: 'Production access is never granted directly. Raise "Request production access" from the service catalog.\n\nThe request routes to your line manager, then to Security. Both must approve before access is provisioned. Segregation of duties prevents you approving your own request.',
      tags: ['access', 'production', 'approval'],
      linkedTicketTypes: ['AccessRequest'],
    },
    {
      title: 'What the SLA priorities mean',
      category: 'Service levels',
      body: 'Priority is calculated by the system from Impact and Urgency — it cannot be set directly.\n\nP1 Critical: respond 15m / resolve 1h\nP2 High: respond 1h / resolve 8h\nP3 Medium: respond 4h / resolve 3 days\nP4 Low: respond 8h / resolve 5 days\n\nIf Impact or Urgency is changed later, the clock is recalculated from the original creation time.',
      tags: ['sla', 'priority', 'escalation'],
      linkedTicketTypes: ['Incident', 'ServiceRequest'],
    },
    {
      title: 'Enrolling a new MFA device',
      category: 'Access',
      body: 'Go to your profile and start MFA setup. Scan the QR code with an authenticator app, then enter the six-digit code to confirm.\n\nMFA is not active until that confirmation succeeds. If you lose the device, raise a "Password or VPN reset" request — an administrator must verify your identity out-of-band before it can be reset.',
      tags: ['mfa', 'authentication', 'security'],
      linkedTicketTypes: ['ServiceRequest'],
    },
  ];

  for (const a of ARTICLES) {
    await prisma.knowledgeArticle.create({
      data: {
        tenantId: null,
        title: a.title, body: a.body, category: a.category,
        tags: JSON.stringify(a.tags),
        linkedTicketTypes: JSON.stringify(a.linkedTicketTypes),
        status: 'PUBLISHED',
        authorId: null,
      },
    });
  }
  console.log(`  knowledge articles: ${ARTICLES.length}`);


  // -- 10f. GRC Core: standards, clauses, controls, implementations --------
  const clauseIdByKey: Record<string, string> = {};
  for (const st of STANDARDS) {
    const std = await prisma.standard.create({
      data: {
        code: st.code, title: st.title, authority: st.authority,
        version: st.version, description: st.description, isSystem: true,
      },
    });
    for (const c of st.clauses) {
      const clause = await prisma.standardClause.create({
        data: { standardId: std.id, ref: c.ref, title: c.title, text: c.text || null },
      });
      clauseIdByKey[`${st.code}:${c.ref}`] = clause.id;
    }
  }
  const clauseCount = STANDARDS.reduce((a, s) => a + s.clauses.length, 0);
  console.log(`  standards: ${STANDARDS.length} (${clauseCount} clauses)`);

  const controlIdByCode: Record<string, string> = {};
  let mappingCount = 0;
  for (const c of CONTROLS) {
    const ctrl = await prisma.control.create({
      data: { tenantId: null, code: c.code, title: c.title, objective: c.objective, domain: c.domain },
    });
    controlIdByCode[c.code] = ctrl.id;
    for (const m of c.mappings) {
      const clauseId = clauseIdByKey[m];
      if (!clauseId) continue;
      await prisma.controlClauseLink.create({ data: { controlId: ctrl.id, clauseId } });
      mappingCount++;
    }
  }
  console.log(`  controls: ${CONTROLS.length} (${mappingCount} clause mappings)`);

  // Enable standards and instantiate implementations for the customer tenants
  // that actually run a GRC programme.
  const GRC_TENANTS = [
    'Al Noor Holding Group', 'OmniOps', 'Hayat National Hospital - Madinah',
    'Global Bank - Information Security', 'RetailCo Franchise Network',
  ];
  const STATUS_CYCLE = ['Verified', 'Implemented', 'InProgress', 'NotStarted'];
  const EFFECT_CYCLE = ['Effective', 'PartiallyEffective', 'NotAssessed', 'NotAssessed'];
  const FREQ_CYCLE = ['Quarterly', 'Monthly', 'Annual', 'Semi-Annual'];

  let enableCount = 0, implCount = 0, evidenceCount = 0;
  for (const ctxName of Object.keys(tenantMap)) {
    if (!GRC_TENANTS.some((g) => ctxName.replace(/[^A-Za-z ]/g, '').trim() === g.replace(/[^A-Za-z ]/g, '').trim())) continue;
    const tid = tenantMap[ctxName];
    if (!tid) continue;

    const tenantUsers = await prisma.user.findMany({
      where: { tenantId: tid, status: 'Active' },
      select: { id: true }, take: 6,
    });
    if (tenantUsers.length === 0) continue;

    const codes = ['ISO27001', 'PDPL'];
    if (!ctxName.startsWith('Global Bank')) codes.push('NCA-ECC');
    for (const code of codes) {
      const std = await prisma.standard.findFirst({ where: { tenantId: null, code } });
      if (!std) continue;
      await prisma.tenantStandardEnablement.create({
        data: { tenantId: tid, standardId: std.id, applicability: 'Full', ownerId: tenantUsers[0].id },
      });
      enableCount++;
    }

    const picked = CONTROLS.slice(0, 12);
    for (let i = 0; i < picked.length; i++) {
      const c = picked[i];
      const status = STATUS_CYCLE[i % STATUS_CYCLE.length];
      const owner = tenantUsers[i % tenantUsers.length];
      // Operator differs from owner so independent validation is demonstrable.
      const operator = tenantUsers[(i + 1) % tenantUsers.length];
      const validator = tenantUsers[(i + 2) % tenantUsers.length];

      const impl = await prisma.controlImplementation.create({
        data: {
          tenantId: tid,
          controlId: controlIdByCode[c.code],
          title: c.title,
          ownerId: owner.id,
          operatorId: operator.id === owner.id ? null : operator.id,
          frequency: FREQ_CYCLE[i % FREQ_CYCLE.length],
          successCriteria: `Evidence demonstrates ${c.title.toLowerCase()} operated as designed for the review period.`,
          status,
          effectiveness: status === 'Verified' ? EFFECT_CYCLE[i % EFFECT_CYCLE.length] : 'NotAssessed',
          nextDueDate: new Date(Date.now() + ((i % 6) - 1) * 30 * 86400000),
          submittedAt: ['Implemented', 'Verified'].includes(status) ? new Date(Date.now() - 7 * 86400000) : null,
          validatedById: status === 'Verified' && validator.id !== owner.id ? validator.id : null,
          validatedAt: status === 'Verified' ? new Date(Date.now() - 3 * 86400000) : null,
          lastReviewedAt: status === 'Verified' ? new Date(Date.now() - 3 * 86400000) : null,
        },
      });
      implCount++;

      if (['Implemented', 'Verified'].includes(status)) {
        await prisma.evidence.create({
          data: {
            tenantId: tid,
            implementationId: impl.id,
            title: `${c.code} operating evidence - current period`,
            description: 'System-generated extract demonstrating the control operated.',
            classification: 'Internal',
            uploadedById: operator.id,
            relevance: status === 'Verified' ? 'Yes' : 'NotAssessed',
            sufficiency: status === 'Verified' ? 'Yes' : 'NotAssessed',
            authenticity: status === 'Verified' ? 'Yes' : 'NotAssessed',
            currency: status === 'Verified' ? 'Yes' : 'NotAssessed',
            reviewedById: status === 'Verified' && validator.id !== operator.id ? validator.id : null,
            reviewedAt: status === 'Verified' ? new Date(Date.now() - 3 * 86400000) : null,
          },
        });
        evidenceCount++;
      }
    }
  }
  console.log(`  standard enablements: ${enableCount}  implementations: ${implCount}  evidence: ${evidenceCount}`);


  // -- 10g. Risk register + audit programme -------------------------------
  const RISK_SEED = [
    { title: 'Excessive privileged access to production systems', category: 'Technology', l: 4, i: 5, treatment: 'Mitigate' },
    { title: 'Personal data processed without recorded lawful basis', category: 'Compliance', l: 3, i: 5, treatment: 'Mitigate' },
    { title: 'Third-party cloud provider outage disrupts service', category: 'Third-Party', l: 3, i: 4, treatment: 'Transfer' },
    { title: 'Phishing leads to credential compromise', category: 'Operational', l: 4, i: 4, treatment: 'Mitigate' },
    { title: 'Key person dependency in security operations', category: 'People', l: 3, i: 3, treatment: 'Mitigate' },
    { title: 'Unpatched externally-facing application', category: 'Technology', l: 4, i: 4, treatment: 'Mitigate' },
    { title: 'Cross-border data transfer without assessment', category: 'Compliance', l: 2, i: 5, treatment: 'Avoid' },
    { title: 'Inadequate backup restoration testing', category: 'Operational', l: 2, i: 4, treatment: 'Mitigate' },
  ];

  const AUDIT_SEED = [
    {
      title: 'Access Management Review', objective: 'Assess the design and operating effectiveness of access controls.',
      auditScope: 'Joiner-mover-leaver, privileged access and quarterly recertification.',
      criteria: 'ISO 27001 A.5.15 / A.5.16, NCA ECC 2-2-1', status: 'Reporting',
      findings: [
        { criterion: 'Quarterly access recertification is required.', condition: 'Q2 recertification was not completed for two systems.', cause: 'No automated reminder; owners unaware of the due date.', recommendation: 'Automate recertification reminders and track completion.', rating: 'High', cap: true, close: true },
        { criterion: 'Privileged access requires MFA.', condition: 'Two service accounts had MFA disabled.', cause: 'Exception granted during migration and never revisited.', recommendation: 'Re-enable MFA and remove standing exceptions.', rating: 'Medium', cap: true, close: false },
      ],
    },
    {
      title: 'Data Protection Compliance Audit', objective: 'Verify PDPL compliance for personal data processing.',
      auditScope: 'Lawful basis register, data subject rights, cross-border transfers.',
      criteria: 'Saudi PDPL Art. 4, 11, 19, 29', status: 'Fieldwork',
      findings: [
        { criterion: 'Every processing activity records its lawful basis.', condition: 'Three activities in the marketing workspace lack a recorded basis.', cause: 'Register not updated when new campaigns launched.', recommendation: 'Update the register and add a launch checklist gate.', rating: 'High', cap: true, close: false },
      ],
    },
    {
      title: 'Business Continuity Readiness', objective: 'Assess ICT continuity and recovery testing.',
      auditScope: 'Backup, restoration testing, RTO/RPO adherence.',
      criteria: 'ISO 27001 A.5.30', status: 'Planned', findings: [],
    },
  ];

  let riskCount = 0, treatmentCount = 0, auditCount = 0, findingCount = 0;
  for (const ctxName of Object.keys(tenantMap)) {
    if (!GRC_TENANTS.some((g) => ctxName.replace(/[^A-Za-z ]/g, '').trim() === g.replace(/[^A-Za-z ]/g, '').trim())) continue;
    const tid = tenantMap[ctxName];
    if (!tid) continue;

    const users = await prisma.user.findMany({ where: { tenantId: tid, status: 'Active' }, select: { id: true }, take: 6 });
    if (users.length < 2) continue;
    const implsForTenant = await prisma.controlImplementation.findMany({
      where: { tenantId: tid, status: 'Verified' }, select: { id: true }, take: 4,
    });

    // Risks
    for (let r = 0; r < RISK_SEED.length; r++) {
      const rs = RISK_SEED[r];
      const owner = users[r % users.length];
      const il = rs.l, ii = rs.i;
      const iscore = il * ii;
      // Link a couple of verified controls to the first few risks so residual < inherent.
      const links = r < 4 ? implsForTenant.slice(0, 2) : [];
      let rl = il;
      if (links.length >= 2) rl = Math.max(1, il - 3);
      else if (links.length === 1) rl = Math.max(1, il - 2);
      const rscore = rl * ii;

      const risk = await prisma.risk.create({
        data: {
          tenantId: tid, ref: `RSK-${String(r + 1).padStart(3, '0')}`,
          title: rs.title,
          description: `Cause: gap in ${rs.category.toLowerCase()} controls. Event: ${rs.title.toLowerCase()}. Impact: material exposure to the entity.`,
          category: rs.category, ownerId: owner.id,
          treatmentType: rs.treatment,
          status: r < 4 ? 'UnderTreatment' : (r === 6 ? 'Accepted' : 'Open'),
          inherentLikelihood: il, inherentImpact: ii, inherentScore: iscore,
          residualLikelihood: rl, residualImpact: ii, residualScore: rscore,
          acceptedById: r === 6 ? users[(r + 1) % users.length].id : null,
          acceptedUntil: r === 6 ? new Date(Date.now() + 90 * 86400000) : null,
          acceptanceReason: r === 6 ? 'Residual within appetite; revisit at next cycle.' : null,
        },
      });
      riskCount++;
      await prisma.riskScoreSnapshot.create({ data: { tenantId: tid, riskId: risk.id, score: rscore, inherentScore: iscore, residualScore: rscore } });
      for (const link of links) {
        await prisma.riskControlLink.create({ data: { riskId: risk.id, implementationId: link.id } });
      }
      if (r < 4) {
        await prisma.riskTreatmentAction.create({
          data: {
            riskId: risk.id, title: `Remediate: ${rs.title.toLowerCase()}`,
            ownerId: users[(r + 1) % users.length].id,
            dueDate: new Date(Date.now() + ((r % 3) - 1) * 30 * 86400000),
            status: r === 0 ? 'Done' : 'Open',
            doneAt: r === 0 ? new Date() : null,
          },
        });
        treatmentCount++;
      }
    }

    // Audits + findings (only for the two GRC-heavy tenants to keep volume sane)
    if (['OmniOps', 'Al Noor Holding Group'].some((n) => ctxName.startsWith(n.split(' ')[0]))) {
      for (let a = 0; a < AUDIT_SEED.length; a++) {
        const as = AUDIT_SEED[a];
        const lead = users[a % users.length];
        const audit = await prisma.audit.create({
          data: {
            tenantId: tid, ref: `AUD-2026-${String(a + 1).padStart(2, '0')}`,
            title: as.title, objective: as.objective, scope: as.auditScope, criteria: as.criteria,
            leadAuditorId: lead.id, status: as.status,
            startDate: new Date(Date.now() - 30 * 86400000),
            endDate: as.status === 'Closed' ? new Date(Date.now() - 5 * 86400000) : null,
          },
        });
        auditCount++;
        for (let f = 0; f < as.findings.length; f++) {
          const ff = as.findings[f];
          const raiser = users[(a + 1) % users.length];
          const capOwner = users[(a + 2) % users.length];
          const closer = users[(a + 3) % users.length];
          const isClosed = ff.close && closer.id !== raiser.id;
          await prisma.issue.create({
            data: {
              auditId: audit.id, tenantId: tid, ref: `${audit.ref}-F${f + 1}`,
              source: 'InternalAudit',
              title: ff.condition.slice(0, 120),
              criterion: ff.criterion, condition: ff.condition, cause: ff.cause,
              recommendation: ff.recommendation, riskRating: ff.rating,
              raisedById: raiser.id,
              identifiedDate: new Date(Date.now() - (35 + f * 12) * 86400000),
              status: isClosed ? 'Closed' : (ff.cap ? 'CAPAssigned' : 'Open'),
              // A CAP only exists once management has accepted the finding.
              responseType: ff.cap || isClosed ? 'Agree' : null,
              responseNarrative: ff.cap || isClosed
                ? 'Management accepts the finding and will remediate within the agreed window.'
                : null,
              managementActionPlan: ff.cap || isClosed ? `Remediation: ${ff.recommendation}` : null,
              respondedById: ff.cap || isClosed ? capOwner.id : null,
              respondedAt: ff.cap || isClosed ? new Date(Date.now() - 20 * 86400000) : null,
              capOwnerId: ff.cap ? capOwner.id : null,
              capDueDate: ff.cap ? new Date(Date.now() + 30 * 86400000) : null,
              capDescription: ff.cap ? `Corrective action: ${ff.recommendation}` : null,
              closedById: isClosed ? closer.id : null,
              closedAt: isClosed ? new Date(Date.now() - 2 * 86400000) : null,
              closureNote: isClosed ? 'Retested; corrective action operating effectively.' : null,
            },
          });
          findingCount++;
        }
      }
    }
  }
  console.log(`  risks: ${riskCount}  treatments: ${treatmentCount}  audits: ${auditCount}  findings: ${findingCount}`);


  // -- 10h. Audit universe + risk-based annual plan (IIA Std 9.4) ----------
  const UNIVERSE = [
    { name: 'Identity and access management', type: 'Process', fm: 4, re: 5, cx: 4, cv: 4, pf: 5, fe: 4, months: 8 },
    { name: 'Procure to pay', type: 'Process', fm: 5, re: 3, cx: 4, cv: 2, pf: 4, fe: 5, months: 14 },
    { name: 'Order to cash', type: 'Process', fm: 5, re: 3, cx: 3, cv: 2, pf: 3, fe: 4, months: 20 },
    { name: 'Payroll and HR operations', type: 'Process', fm: 4, re: 4, cx: 3, cv: 2, pf: 2, fe: 4, months: 30 },
    { name: 'Personal data processing', type: 'Process', fm: 3, re: 5, cx: 4, cv: 4, pf: 4, fe: 2, months: null },
    { name: 'Third-party and cloud management', type: 'ThirdParty', fm: 4, re: 4, cx: 5, cv: 5, pf: 4, fe: 3, months: null },
    { name: 'Change and release management', type: 'Process', fm: 3, re: 3, cx: 4, cv: 5, pf: 3, fe: 2, months: 18 },
    { name: 'Business continuity and recovery', type: 'Process', fm: 4, re: 3, cx: 3, cv: 2, pf: 3, fe: 1, months: 40 },
    { name: 'Core banking platform', type: 'System', fm: 5, re: 5, cx: 5, cv: 3, pf: 3, fe: 4, months: 12 },
    { name: 'Treasury and cash management', type: 'Process', fm: 5, re: 4, cx: 4, cv: 2, pf: 2, fe: 5, months: 26 },
    { name: 'Physical and environmental security', type: 'Process', fm: 2, re: 2, cx: 2, cv: 1, pf: 1, fe: 2, months: 22 },
    { name: 'Security operations centre', type: 'BusinessUnit', fm: 3, re: 4, cx: 4, cv: 4, pf: 3, fe: 2, months: 10 },
  ];

  let entityCount = 0, planCount = 0, planItemCount = 0;
  const planYear = new Date().getFullYear();

  for (const ctxName of Object.keys(tenantMap)) {
    if (!GRC_TENANTS.some((g) => ctxName.replace(/[^A-Za-z ]/g, '').trim() === g.replace(/[^A-Za-z ]/g, '').trim())) continue;
    const tid = tenantMap[ctxName];
    if (!tid) continue;

    // Owners and the audit lead must be people who actually hold the capability.
    const tenantUsers = await prisma.user.findMany({
      where: { tenantId: tid, status: 'Active' },
      include: { roleRef: { select: { capabilityGrants: true } } },
      take: 12,
    });
    const auditors = tenantUsers.filter((u) => {
      try { return JSON.parse(u.roleRef?.capabilityGrants || '[]').includes('plan-and-execute-an-audit'); }
      catch { return false; }
    });
    if (tenantUsers.length === 0) continue;
    const lead = auditors[0] || tenantUsers[0];
    const approver = auditors[1] || tenantUsers.find((u) => u.id !== lead.id) || tenantUsers[0];

    const created: any[] = [];
    for (let i = 0; i < UNIVERSE.length; i++) {
      const u = UNIVERSE[i];
      const factors = {
        financialMateriality: u.fm, regulatoryExposure: u.re, complexity: u.cx,
        changeVolatility: u.cv, priorFindings: u.pf, fraudExposure: u.fe,
      };
      const last = u.months === null ? null : new Date(Date.now() - u.months * 30 * 86400000);
      const calc = computeEntityRisk(factors, last, 24);
      const e = await prisma.auditableEntity.create({
        data: {
          tenantId: tid,
          ref: `AE-${String(i + 1).padStart(3, '0')}`,
          name: u.name,
          type: u.type,
          description: `Auditable ${u.type.toLowerCase()} within the annual audit universe.`,
          ownerId: tenantUsers[i % tenantUsers.length].id,
          ...factors,
          riskScore: calc.riskScore,
          riskTier: calc.riskTier,
          lastAuditedAt: last,
          auditCycleMonths: 24,
        },
      });
      created.push({ ...e, calc });
      entityCount++;
    }

    // Only the two GRC-heavy tenants get a full approved plan.
    if (!['OmniOps', 'Al Noor'].some((n) => ctxName.startsWith(n))) continue;

    const plan = await prisma.auditPlan.create({
      data: {
        tenantId: tid,
        year: planYear,
        title: `${planYear} Internal Audit Plan`,
        totalBudgetHours: 1200,
        preparedById: lead.id,
        status: 'Draft',
      },
    });
    planCount++;

    // Risk-based selection: take the highest-scoring entities that fit capacity.
    const ranked = [...created].sort((a, b) => b.riskScore - a.riskScore);
    let allocated = 0;
    for (let i = 0; i < ranked.length; i++) {
      const e = ranked[i];
      const hours = suggestedBudgetHours(e.riskTier);
      if (allocated + hours > 1200) break;
      allocated += hours;
      await prisma.auditPlanItem.create({
        data: {
          planId: plan.id,
          auditableEntityId: e.id,
          plannedQuarter: (i % 4) + 1,
          budgetHours: hours,
          rationale: `Risk tier ${e.riskTier} (score ${e.riskScore}).${e.lastAuditedAt ? '' : ' Never audited.'}`,
          assignedLeadId: lead.id,
          status: 'Planned',
        },
      });
      planItemCount++;
    }

    // Walk the plan through submit -> committee approval so the demo starts live.
    await prisma.auditPlan.update({
      where: { id: plan.id },
      data: {
        status: 'Approved',
        submittedAt: new Date(Date.now() - 20 * 86400000),
        approvedById: approver.id,
        approvedAt: new Date(Date.now() - 14 * 86400000),
        approvalNote: 'Approved by the audit committee. Coverage of all high-risk entities confirmed.',
      },
    });
  }
  console.log(`  audit universe: ${entityCount} entities · plans: ${planCount} · plan items: ${planItemCount}`);


  // -- 10i. Risk appetite, RCSA, KRIs and loss events ----------------------
  const APPETITE = [
    { category: 'Compliance',   appetite: 6,  tolerance: 12, statement: 'Minimal appetite for regulatory breach; any PDPL or NCA exposure is escalated.' },
    { category: 'Technology',   appetite: 9,  tolerance: 15, statement: 'Moderate appetite where compensating controls and monitoring are in place.' },
    { category: 'Operational',  appetite: 9,  tolerance: 16, statement: 'Accepts operational variability that does not affect client delivery.' },
    { category: 'Financial',    appetite: 6,  tolerance: 12, statement: 'Low appetite for financial misstatement or unbudgeted loss.' },
    { category: 'Third-Party',  appetite: 8,  tolerance: 14, statement: 'Vendor risk accepted only with a current assessment and contractual remedies.' },
    { category: 'Strategic',    appetite: 12, tolerance: 20, statement: 'Higher appetite where the upside is aligned to Vision 2030 growth.' },
    { category: 'People',       appetite: 8,  tolerance: 14, statement: 'Low appetite for key-person dependency in regulated functions.' },
  ];

  const KRI_SEED = [
    { name: 'Privileged accounts without recent review', unit: '', direction: 'Higher', amber: 5,  red: 12, freq: 'Monthly',   series: [3, 6, 9, 14] },
    { name: 'Critical patches outstanding past SLA',     unit: '', direction: 'Higher', amber: 10, red: 25, freq: 'Monthly',   series: [4, 8, 11, 9] },
    { name: 'Phishing simulation pass rate',             unit: '%', direction: 'Lower', amber: 85, red: 70, freq: 'Quarterly', series: [92, 88, 83] },
    { name: 'Vendor assessments overdue',                unit: '', direction: 'Higher', amber: 3,  red: 8,  freq: 'Monthly',   series: [1, 2, 4] },
  ];

  const LOSS_SEED = [
    { title: 'Duplicate supplier payment', category: 'ExecutionDeliveryProcessManagement', gross: 84000, recovered: 61000, daysAgo: 120, lagDays: 18,
      description: 'A supplier invoice was paid twice after a manual re-key into the payment file.' },
    { title: 'Business email compromise attempt', category: 'ExternalFraud', gross: 22000, recovered: 0, daysAgo: 75, lagDays: 2,
      description: 'A spoofed vendor bank-change request was actioned before verification.' },
    { title: 'Datacentre cooling failure', category: 'BusinessDisruptionSystemFailure', gross: 145000, recovered: 30000, daysAgo: 210, lagDays: 0,
      description: 'A cooling unit failure forced an unplanned shutdown of two racks for eleven hours.' },
    { title: 'Payroll overpayment in Q3', category: 'ExecutionDeliveryProcessManagement', gross: 31000, recovered: 27500, daysAgo: 45, lagDays: 31,
      description: 'An allowance was applied to a leaver cohort for one extra cycle.' },
  ];

  const LOSS_CATEGORY_RISK: Record<string, string> = {
    ExecutionDeliveryProcessManagement: 'Operational',
    ExternalFraud: 'Financial',
    BusinessDisruptionSystemFailure: 'Technology',
  };

  let appetiteCount = 0, campaignCount = 0, assessmentCount = 0;
  let kriCount = 0, readingCount = 0, lossCount = 0, autoIssueCount = 0;

  for (const ctxName of Object.keys(tenantMap)) {
    const tid = tenantMap[ctxName];
    if (!tid) continue;
    const users = await prisma.user.findMany({
      where: { tenantId: tid, status: 'Active' }, select: { id: true }, take: 6,
    });
    if (users.length < 3) continue;
    const setter = users[0], approver = users[1];

    for (const a of APPETITE) {
      await prisma.riskAppetite.create({
        data: {
          tenantId: tid, category: a.category, statement: a.statement,
          appetiteThreshold: a.appetite, toleranceThreshold: a.tolerance,
          setById: setter.id, status: 'Approved',
          approvedById: approver.id, approvedAt: new Date(Date.now() - 60 * 86400000),
        },
      });
      appetiteCount++;
    }

    // Only the GRC-heavy tenants get the full ERM data set, to keep volume sane.
    if (!['OmniOps', 'Al Noor Holding Group'].some((n) => ctxName.startsWith(n.split(' ')[0]))) continue;

    const tenantRisks = await prisma.risk.findMany({ where: { tenantId: tid }, select: { id: true, category: true } });
    const riskByCategory = (c: string) => tenantRisks.find((r) => r.category === c)?.id ?? null;

    for (let k = 0; k < KRI_SEED.length; k++) {
      const ks = KRI_SEED[k];
      const kri = await prisma.kri.create({
        data: {
          tenantId: tid, name: ks.name, unit: ks.unit, direction: ks.direction,
          amberThreshold: ks.amber, redThreshold: ks.red, frequency: ks.freq,
          ownerId: users[k % users.length].id,
          riskId: riskByCategory(k % 2 === 0 ? 'Technology' : 'Operational'),
        },
      });
      kriCount++;

      for (let r = 0; r < ks.series.length; r++) {
        const value = ks.series[r];
        const level = ks.direction === 'Lower'
          ? (value <= ks.red ? 'Red' : value <= ks.amber ? 'Amber' : 'Green')
          : (value >= ks.red ? 'Red' : value >= ks.amber ? 'Amber' : 'Green');
        const month = 3 + r;
        await prisma.kriReading.create({
          data: {
            kriId: kri.id, tenantId: tid,
            periodLabel: `2026-${String(month).padStart(2, '0')}`,
            value, breachLevel: level,
            recordedById: users[(k + 1) % users.length].id,
            recordedAt: new Date(Date.now() - (ks.series.length - r) * 30 * 86400000),
          },
        });
        readingCount++;
      }
    }

    for (let l = 0; l < LOSS_SEED.length; l++) {
      const ls = LOSS_SEED[l];
      const occurred = new Date(Date.now() - ls.daysAgo * 86400000);
      await prisma.lossEvent.create({
        data: {
          tenantId: tid, ref: `LOSS-2026-${String(l + 1).padStart(3, '0')}`,
          title: ls.title, description: ls.description, category: ls.category,
          occurredAt: occurred,
          discoveredAt: new Date(occurred.getTime() + ls.lagDays * 86400000),
          grossAmount: ls.gross, recoveredAmount: ls.recovered, currency: 'SAR',
          status: l === 0 ? 'Closed' : l === 1 ? 'UnderInvestigation' : 'Open',
          reportedById: users[l % users.length].id,
          riskId: riskByCategory(LOSS_CATEGORY_RISK[ls.category] ?? 'Operational'),
        },
      });
      lossCount++;
    }

    // One launched campaign, part-completed, with a self-identified issue from
    // the control the respondent marked ineffective.
    const impls = await prisma.controlImplementation.findMany({
      where: { tenantId: tid }, take: 6,
      include: { control: { select: { code: true, title: true } } },
    });
    if (impls.length === 0) continue;

    const campaign = await prisma.rcsaCampaign.create({
      data: {
        tenantId: tid, ref: 'RCSA-2026-01', title: 'H1 2026 control self-assessment',
        period: '2026-H1', dueDate: new Date(Date.now() + 21 * 86400000),
        status: 'Launched', launchedById: users[0].id,
        launchedAt: new Date(Date.now() - 10 * 86400000),
      },
    });
    campaignCount++;

    for (let a = 0; a < impls.length; a++) {
      const impl = impls[a];
      const respondent = impl.ownerId ?? users[a % users.length].id;
      // First two submitted clean, third ineffective, the rest still pending.
      const submitted = a < 3;
      const ineffective = a === 2;

      let issueId: string | null = null;
      if (ineffective) {
        const existing = await prisma.issue.count({ where: { tenantId: tid, source: 'SelfIdentified' } });
        const issue = await prisma.issue.create({
          data: {
            tenantId: tid,
            ref: `ISS-2026-${String(existing + 1).padStart(3, '0')}`,
            source: 'SelfIdentified', sourceReference: campaign.ref,
            title: `Self-assessed ineffective control: ${impl.control.code}`,
            condition: 'The control has not operated for two consecutive periods owing to a vacant role.',
            recommendation: `Remediate ${impl.control.code} - ${impl.control.title}.`,
            riskRating: 'Medium', raisedById: respondent, status: 'Open',
            identifiedDate: new Date(Date.now() - 8 * 86400000),
          },
        });
        issueId = issue.id;
        autoIssueCount++;
      }

      await prisma.rcsaAssessment.create({
        data: {
          campaignId: campaign.id, tenantId: tid,
          implementationId: impl.id, respondentId: respondent,
          designRating: submitted ? (ineffective ? 'PartiallyEffective' : 'Effective') : null,
          operatingRating: submitted ? (ineffective ? 'Ineffective' : 'Effective') : null,
          narrative: ineffective ? 'The control has not operated for two consecutive periods owing to a vacant role.' : null,
          status: submitted ? 'Submitted' : 'Pending',
          submittedAt: submitted ? new Date(Date.now() - 6 * 86400000) : null,
          issueId,
        },
      });
      assessmentCount++;
    }
  }
  console.log(`  risk appetite: ${appetiteCount} categories · rcsa: ${campaignCount} campaigns / ${assessmentCount} assessments`);
  console.log(`  kris: ${kriCount} (${readingCount} readings) · loss events: ${lossCount} · auto-raised issues: ${autoIssueCount}`);

  // ── 11. SoD platform-default rules (TRD §6.4) ───────────────────────────
  await prisma.sodRule.createMany({
    data: [
      {
        tenantId: null,
        key: 'dms-author-approver',
        description: 'A document author cannot approve their own document.',
        subjectType: 'Document',
        conflictingActions: JSON.stringify(['DOCUMENT_CREATED', 'DOCUMENT_CHECKED_IN']),
        guardedAction: 'DOCUMENT_APPROVED',
        isActive: true,
      },
      {
        tenantId: null,
        key: 'iam-access-request',
        description: 'A user cannot approve their own access request.',
        subjectType: 'AccessRequest',
        conflictingActions: JSON.stringify(['ACCESS_REQUESTED']),
        guardedAction: 'ACCESS_APPROVED',
        isActive: true,
      },
      {
        tenantId: null,
        key: 'audit-finding-closure',
        description: 'Whoever raised an issue cannot independently close it.',
        subjectType: 'Issue',
        conflictingActions: JSON.stringify(['ISSUE_RAISED']),
        guardedAction: 'ISSUE_CLOSED',
        isActive: true,
      },
      {
        tenantId: null,
        key: 'grc-implementer-validator',
        description: 'The owner or operator of a control cannot independently validate it.',
        subjectType: 'ControlImplementation',
        conflictingActions: JSON.stringify(['CONTROL_IMPLEMENTATION_CREATED', 'CONTROL_IMPLEMENTATION_UPDATED', 'EVIDENCE_ATTACHED']),
        guardedAction: 'CONTROL_VALIDATED',
        isActive: true,
      },
      {
        tenantId: null,
        key: 'billing-invoice-approver',
        description: 'The user who submits an invoice adjustment cannot approve it.',
        subjectType: 'Invoice',
        conflictingActions: JSON.stringify(['INVOICE_SUBMITTED']),
        guardedAction: 'INVOICE_APPROVED',
        isActive: true,
      },
    ],
  });
  console.log(`  sod rules: ${await prisma.sodRule.count()}`);

  console.log('Seeding complete. All users log in with: ' + DEMO_PASSWORD);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
