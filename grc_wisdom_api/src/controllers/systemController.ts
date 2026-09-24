import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit, GENESIS_HASH } from '../middlewares/auditMiddleware';
import { verifyTenantChain, ChainResult } from '../services/auditChain';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { reportAllJobs, planTrigger, observe } from '../services/jobReporting';
import { runEscalationScan, SLA_ESCALATION_JOB } from '../services/slaService';
import { runRiskReviewScan, RISK_REVIEW_JOB } from '../services/riskLifecycle';
import knownDefects from '../qa/known-defects.json';

function str(val: unknown): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return String(val || '');
}

// ── 1. HEALTH, JOBS & API STATUS ─────────────────────────────────────────

export const getSystemHealth = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    await auditCrossTenantRead(scope, str(req.user!.id), 'system.health.get');

    const dbStart = Date.now();
    const userCount = await prisma.user.count();
    const dbLatencyMs = Date.now() - dbStart;

    const memoryUsage = process.memoryUsage();

    // Nine services, each Healthy, each with a latency and an uptime figure.
    // Every one of those numbers was a literal in this array. 99.95% uptime is
    // a claim about the last year, from a process that cannot see past its own
    // boot, and they were served unchanged while the database was unreachable.
    //
    // What is actually knowable from in here is: these routers are mounted in
    // this build, and the database answered a query just now in dbLatencyMs.
    // So that is what is reported. There is no uptimePercent, because nothing
    // measures uptime — adding a monitor is a piece of work, and printing a
    // number in its place was the thing that made the work look done.
    const services = [
      '/api/auth — authentication and sessions',
      '/api/documents — document management',
      '/api/iam — SoD and capability engine',
      '/api/itsm — ITSM and workflow',
      '/api/grc — GRC core and risk register',
      '/api/marketplace — modules and entitlements',
      '/api/billing — subscriptions and billing',
      '/api/usage — usage and automation',
      '/api/audit-logs — WORM audit log',
    ].map((name) => ({ name, status: 'Mounted' as const }));

    // Five rows, three of which described work nothing performed.
    //
    // JOB-SYS-04 "Evidence Expiry & Retention Reminder Worker" went first: it
    // reported Idle with a last run eight hours ago and a duration of 890ms,
    // and no such worker existed, so an operator asking whether retention was
    // running was told it ran at six that morning. JOB-SYS-01 (WORM chain
    // audit), -03 (standards sync) and -05 (ZATCA signer) were the same thing
    // — `lastRun: Date.now() - 1800000` is a number that moves every time the
    // page is refreshed, which is what made them look live.
    //
    // Meanwhile the two workers this API genuinely starts, in server.ts, were
    // not on the list at all. The register is now those two, and each row is
    // built from what the worker actually did in this process.
    const jobs = reportAllJobs();

    res.json({
      status: 'success',
      systemStatus: 'Operational',
      uptimeSeconds: Math.floor(process.uptime()),
      dbLatencyMs,
      activeUsersCount: userCount,
      memory: {
        rssMb: Math.round(memoryUsage.rss / 1024 / 1024),
        heapTotalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        heapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      },
      // Said plainly, because a job list that resets on restart is otherwise
      // read as a claim that nothing has ever run.
      jobsNote:
        'Job history is held in the running process. A restart clears it, so a '
        + 'worker showing "not run since restart" has not necessarily missed a run.',
      services,
      jobs
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch system health' });
  }
};

/** The two scans a person may start by hand, by the id the register uses. */
const RUNNABLE: Record<string, () => Promise<Record<string, number>>> = {
  [SLA_ESCALATION_JOB]: runEscalationScan,
  [RISK_REVIEW_JOB]: runRiskReviewScan,
};

/**
 * Run a background scan now.
 *
 * This used to run nothing. It took any string as a job id, wrote a
 * SYSTEM_JOB_TRIGGERED entry into the WORM audit log, and answered
 *
 *   { status: 'Success', durationMs: Math.floor(Math.random() * 300) + 150 }
 *
 * — a random number presented to an operator as a measurement, and a claim of
 * success for work that never happened, written permanently into the record
 * the product exists to keep. "JOB-SYS-99" executed successfully too.
 *
 * Now: an unknown id is refused, the scan actually runs, the duration is the
 * elapsed time of that run, and the audit entry records what the scan did —
 * including when it failed, which the old shape had no way to express.
 */
export const triggerSystemJob = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const plan = planTrigger(req.body?.jobId);
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    // Outside the transaction, deliberately. The scan opens transactions of
    // its own for every ticket or risk it touches, and holding one open across
    // all of them would make a manual run lock the tables it is scanning.
    const run = await observe(plan.id, RUNNABLE[plan.id], { manual: true });

    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        tenantId: str(req.user!.tenantId),
        actorId: str(req.user!.id),
        action: 'SYSTEM_JOB_TRIGGERED',
        subjectType: 'SystemJob',
        subjectId: plan.id,
        payload: {
          jobId: plan.id,
          outcome: run.outcome,
          durationMs: run.durationMs,
          // What it actually changed. An entry saying a scan ran is worth
          // little; one saying it breached four tickets is the record.
          counts: run.counts ?? null,
          error: run.error ?? null,
          startedAt: run.startedAt,
        },
      });
    });

    if (run.outcome === 'Failed') {
      res.status(500).json({
        status: 'error',
        code: 'JOB_FAILED',
        result: run,
        message: `${plan.id} failed after ${run.durationMs}ms: ${run.error}`,
      });
      return;
    }

    res.json({
      status: 'success',
      result: run,
      message: `${plan.id} ran in ${run.durationMs}ms.`,
    });
  } catch (error: any) {
    console.error('[System Job Trigger Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to execute system job' });
  }
};

// ── 2. PLATFORM SECURITY ─────────────────────────────────────────────────

type OpenDefect = { id: string; severity: string; title: string };

/**
 * The open defects in the register that name any of these requirements.
 *
 * The register is the file the build's own QA suites read, so a screen that
 * takes its status from here cannot disagree with the build about what is
 * known to be broken. The BRD page, the security posture and the architecture
 * page all ask it; none of them states a status of its own.
 */
function openDefectsFor(requirementIds: string[]): OpenDefect[] {
  const register: Record<string, { severity: string; title: string; requirements?: string[] }> = knownDefects;
  return Object.entries(register)
    .filter(([, d]) => (d.requirements || []).some((r) => requirementIds.includes(r)))
    .map(([id, d]) => ({ id, severity: d.severity, title: d.title }));
}

/**
 * The security guards, each with the requirement that states it.
 *
 * This answered a fixed score of 98 and grade A+, and graded every guard A or
 * A+, including PDPL field encryption and ZATCA signing while the register held
 * open High defects saying neither is in use (QA-017, QA-011). Nothing computed
 * any of those grades. A guard now reads as claimed only while no open defect
 * names its requirement; otherwise it says Not verified and which defects.
 */
const SECURITY_GUARDS = [
  { id: 'SEC-01', name: 'WORM Audit Log Integrity', claimed: 'Enforced', requirements: ['REQ-02'], detail: 'SHA-256 hash chain per organisation. Verify WORM Chain recomputes every entry.' },
  { id: 'SEC-02', name: 'Saudi PDPL PII Encryption', claimed: 'Active', requirements: ['REQ-08'], detail: 'AES-256-GCM encryption of national ID and phone fields' },
  { id: 'SEC-03', name: 'ZATCA Phase 2 Cryptographic Signing', claimed: 'Active', requirements: ['REQ-07'], detail: 'ECDSA secp256k1 signatures on UBL 2.1 e-invoices' },
  { id: 'SEC-04', name: 'Segregation of Duties (SoD) Engine', claimed: 'Enforced', requirements: ['REQ-04'], detail: 'Refuses an author approving their own document or invoice' },
  { id: 'SEC-05', name: 'JWT Secret Strength', claimed: 'Enforced', requirements: [] as string[], detail: 'The API refuses to start with a signing secret under 32 characters' },
  { id: 'SEC-06', name: 'Customer-Authorized Support Impersonation', claimed: 'Enforced', requirements: ['REQ-09'], detail: 'Read-only scoped support access with a time limit and a banner' },
];

export const getSecurityPosture = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    await auditCrossTenantRead(scope, str(req.user!.id), 'system.security.get');

    const totalAuditLogs = await prisma.auditLog.count();
    // Accounts, not sessions: this counts users whose status is Active, and
    // was labelled "Active User Sessions", which nothing here tracks.
    const activeAccounts = await prisma.user.count({ where: { status: 'Active' } });

    const securityGuards = SECURITY_GUARDS.map((g) => {
      const openDefects = openDefectsFor(g.requirements);
      return {
        id: g.id, name: g.name, detail: g.detail, requirements: g.requirements,
        claimedStatus: g.claimed,
        status: openDefects.length ? 'Not verified' : g.claimed,
        openDefects,
      };
    });

    res.json({
      status: 'success',
      // Counted, where a score of 98 and an A+ used to be written.
      verifiedGuards: securityGuards.filter((g) => g.openDefects.length === 0).length,
      totalGuards: securityGuards.length,
      totalAuditLogs,
      activeAccounts,
      securityGuards
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch security posture' });
  }
};

export const verifyWormIntegrity = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    await auditCrossTenantRead(scope, str(req.user!.id), 'system.security.verifyWorm');

    // Every organisation's chain, every row, each digest recomputed — the same
    // check the database console runs (QA-027). This read the oldest 100 rows
    // on the platform with organisations interleaved, so it reported tampering
    // on a clean trail and never looked past row 100.
    const tenants = await prisma.tenant.findMany({
      where: { id: { in: scope.tenantIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const results: ChainResult[] = [];
    for (const t of tenants) results.push(await verifyTenantChain(t));

    const sum = (pick: (r: ChainResult) => number) => results.reduce((n, r) => n + pick(r), 0);
    const tampered = results.filter((r) => r.status === 'TAMPERED');

    res.json({
      status: 'success',
      isChainValid: tampered.length === 0,
      tamperingDetected: tampered.length > 0,
      organisations: results.length,
      totalLogs: sum((r) => r.logCount),
      // Rows actually examined: all of them, unless a chain broke, where the
      // check stops at the first changed row.
      totalLogsChecked: sum((r) => r.verifiedCount + r.unverifiableCount) + tampered.length,
      verifiedCount: sum((r) => r.verifiedCount),
      unverifiableCount: sum((r) => r.unverifiableCount),
      tampered: tampered.map((r) => ({
        tenantId: r.tenantId, tenantName: r.tenantName, firstTamperedLogId: r.firstTamperedLogId,
      })),
      verifiedAt: new Date().toISOString(),
      genesisHash: GENESIS_HASH,
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to verify WORM integrity' });
  }
};

// ── 3. OCI RIYADH ARCHITECTURE ────────────────────────────────────────────

/**
 * The intended production architecture, said to be intended.
 *
 * This reported itself as the running deployment: two Riyadh availability
 * domains ACTIVE, every layer Healthy, a hardware key store holding the ZATCA
 * key, "100% Kingdom of Saudi Arabia Sovereign Data Residency", ZATCA and CITC
 * Class 4 Certified, an RPO under a second — while the pipeline deploys to one
 * Contabo server and the register holds open High defects against residency,
 * ZATCA and PDPL (QA-018, QA-011, QA-017). Nothing here measures a data
 * centre, a failover or a certificate, so nothing here says one is running or
 * held (QA-028). Where a line has a requirement, the register's open defects
 * against it are attached, as on the BRD page.
 */
export const getOciArchitecture = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const residencyDefects = openDefectsFor(['REQ-12']);
    const architecture = {
      kind: 'target',
      statement: 'The intended production architecture. It is not a report on the running '
        + 'deployment: nothing here measures a data centre, a failover or a certificate.',
      region: 'me-riyadh-1 (Oracle Cloud Infrastructure, Riyadh, KSA)',
      dataResidency: 'All customer data held in the Kingdom of Saudi Arabia',
      residency: {
        status: residencyDefects.length ? 'Not verified' : 'Verified',
        openDefects: residencyDefects,
      },
      compliance: [
        { cert: 'NCA ECC-1:2018', authority: 'Saudi National Cybersecurity Authority', requirements: [] as string[] },
        { cert: 'CITC / CST Cloud Class 4', authority: 'Communications, Space & Technology Commission', requirements: [] as string[] },
        { cert: 'Saudi PDPL (Royal Decree No. M/19)', authority: 'Saudi Data & AI Authority (SDAIA)', requirements: ['REQ-08'] },
        { cert: 'ZATCA Phase 2 (Resolution 211026)', authority: 'Zakat, Tax and Customs Authority', requirements: ['REQ-07'] },
      ].map((c) => ({
        ...c,
        // A certificate is held or it is not, and this server holds no record
        // of one. The absence of known defects is not a certificate either.
        status: 'Target',
        openDefects: openDefectsFor(c.requirements),
      })),
      availabilityDomains: [
        { ad: 'AD-1 (Riyadh Primary Data Center)', status: 'Target', role: 'Primary compute and database' },
        { ad: 'AD-2 (Riyadh Secondary Data Center)', status: 'Target', role: 'Standby replication' },
      ],
      infrastructureLayers: [
        { layer: 'Edge & Ingress', tech: 'OCI WAF + DDoS protection + load balancer', status: 'Target', details: 'TLS 1.3, HSTS' },
        { layer: 'Compute Cluster', tech: 'OCI Container Engine for Kubernetes (OKE)', status: 'Target', details: 'Node pools across both domains' },
        { layer: 'Database Tier', tech: 'PostgreSQL', status: 'Target', details: 'WAL archiving and point-in-time recovery' },
        { layer: 'HSM & Crypto', tech: 'OCI Vault key management', status: 'Target', details: 'Keys for ZATCA signing and PDPL field encryption' },
        { layer: 'Storage & Backup', tech: 'OCI Object Storage with retention lock', status: 'Target', details: 'Evidence and backups' },
      ],
      // Objectives, not measurements: nothing here has timed a failover.
      metrics: {
        rpoSeconds: 'Objective: under 1 second',
        rtoMinutes: 'Objective: under 15 minutes',
        latencyInternalMs: 'Not measured',
      },
    };

    res.json({ status: 'success', architecture });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch OCI architecture' });
  }
};

// ── 4. BRD TRACEABILITY ──────────────────────────────────────────────────

export const getBrdTraceability = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const traceMatrix = [
      { id: 'REQ-01', trdRef: 'TRD §1.1', section: 'Trust Foundation', title: 'Multi-Tenant Isolation', requirement: 'Strict tenant scope isolation ensuring customer data never leaks across boundaries.', implementation: 'scopeResolver.ts + resolveTenantScope() middleware', status: 'Verified' },
      { id: 'REQ-02', trdRef: 'TRD §2.1', section: 'Audit Logging', title: 'Cryptographic WORM Audit Chains', requirement: 'Immutable Write-Once-Read-Many audit logs chained with SHA-256 hashes.', implementation: 'auditMiddleware.ts + writeAudit() transaction hook', status: 'Verified' },
      { id: 'REQ-03', trdRef: 'TRD §3.1', section: 'IAM & RBAC', title: 'Capability-Based Authorization', requirement: '42 canonical business capabilities mapped to system and tenant custom roles.', implementation: 'RoleMatrix.tsx + Capability model in Prisma', status: 'Verified' },
      { id: 'REQ-04', trdRef: 'TRD §6.4', section: 'Governance Engine', title: 'Segregation of Duties (SoD)', requirement: 'Enforces dual-control guards preventing authors from approving their own documents/invoices.', implementation: 'sodEngine.ts + SodRule enforcer', status: 'Verified' },
      { id: 'REQ-05', trdRef: 'TRD §7.2', section: 'GRC Core', title: 'Standards, Controls & Evidence', requirement: 'Library controls linked to ISO 27001, NCA ECC and PDPL requirements with evidence review.', implementation: 'StandardsLibrary.tsx + ControlLibrary.tsx', status: 'Verified' },
      { id: 'REQ-06', trdRef: 'TRD §7.3', section: 'ITSM Engine', title: 'Workflow-Engine Backed ITSM', requirement: 'Service desk, ticket queues, SLA auto-escalation based on impact & urgency matrix.', implementation: 'ServiceDesk.tsx + TicketQueues.tsx + SlaEscalations.tsx', status: 'Verified' },
      { id: 'REQ-07', trdRef: 'TRD §8.1', section: 'Saudi Compliance', title: 'ZATCA Phase 2 E-Invoicing', requirement: 'UBL 2.1 e-invoicing XML generation, cryptographic ECDSA signatures, and QR code rendering.', implementation: 'billingController.ts + PaymentGatewayTax.tsx', status: 'Verified' },
      { id: 'REQ-08', trdRef: 'TRD §8.2', section: 'Saudi Compliance', title: 'PDPL Encrypted PII Fields', requirement: 'Envelope encryption for sensitive personal identification numbers and contact fields.', implementation: 'cryptoUtils.ts + User model encrypted fields', status: 'Verified' },
      { id: 'REQ-09', trdRef: 'TRD §9.1', section: 'Platform Operations', title: 'Customer-Authorized Support Impersonation', requirement: 'Support operators assume customer views only with tenant admin approval & sticky banner.', implementation: 'ImpersonationSessions.tsx + ImpersonationBanner component', status: 'Verified' },
      { id: 'REQ-10', trdRef: 'TRD §10.2', section: 'Platform Services', title: 'Usage & Quota Management', requirement: 'Tenant-level resource quota tracking, automated usage threshold monitoring, and import jobs.', implementation: 'ResourceUsageQuotas.tsx + RulesJobsExecution.tsx + ImportsMigration.tsx', status: 'Verified' },
      { id: 'REQ-11', trdRef: 'TRD §11.1', section: 'Security Services', title: 'Wisdom Eye & Eye Phish', requirement: 'External attack surface management (ASM) & 360° human risk phishing simulation.', implementation: 'wisdomEyePage() + eyePhishPage()', status: 'Verified' },
      { id: 'REQ-12', trdRef: 'TRD §12.3', section: 'Infrastructure', title: 'OCI Riyadh Sovereign Cloud', requirement: 'Data residency guaranteed in Kingdom of Saudi Arabia OCI Riyadh Region (me-riyadh-1).', implementation: 'systemController.ts + OciRiyadhArchitecture.tsx', status: 'Verified' },
    ];

    // The status on each row above is what the requirement claims. What this
    // returns is that claim less anything the checks have found against it:
    // a requirement is Verified only while no open defect in the register
    // names it. All twelve used to be Verified by string, with a compliance
    // figure of 100, while failing checks contradicted six of them. The
    // register is the file the build's own QA suites read, so the screen and
    // the build cannot disagree about what is known to be broken.
    const matrix = traceMatrix.map((m) => {
      const openDefects = openDefectsFor([m.id]);
      return { ...m, claimedStatus: m.status, status: openDefects.length ? 'Not verified' : m.status, openDefects };
    });
    const verifiedCount = matrix.filter((m) => m.status === 'Verified').length;

    res.json({
      status: 'success',
      totalRequirements: matrix.length,
      verifiedCount,
      compliancePercentage: matrix.length ? Math.round((verifiedCount / matrix.length) * 100) : 0,
      matrix,
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch BRD traceability matrix' });
  }
};
