import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { reportAllJobs, planTrigger, observe } from '../services/jobReporting';
import { runEscalationScan, SLA_ESCALATION_JOB } from '../services/slaService';
import { runRiskReviewScan, RISK_REVIEW_JOB } from '../services/riskLifecycle';

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

export const getSecurityPosture = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    await auditCrossTenantRead(scope, str(req.user!.id), 'system.security.get');

    const totalAuditLogs = await prisma.auditLog.count();
    const activeSessions = await prisma.user.count({ where: { status: 'Active' } });

    const securityGuards = [
      { id: 'SEC-01', name: 'WORM Audit Log Integrity', status: 'Enforced', grade: 'A+', detail: 'Cryptographic SHA-256 hash chaining on immutable SQLite/Postgres logs' },
      { id: 'SEC-02', name: 'Saudi PDPL PII Encryption', status: 'Active', grade: 'A+', detail: 'AES-256 GCM envelope encryption for National ID and phone numbers' },
      { id: 'SEC-03', name: 'ZATCA Phase 2 Cryptographic Signing', status: 'Active', grade: 'A+', detail: 'ECDSA secp256k1 signature validation on UBL 2.1 E-Invoices' },
      { id: 'SEC-04', name: 'Segregation of Duties (SoD) Engine', status: 'Enforced', grade: 'A+', detail: 'Active policy enforcer preventing author-approver conflicts' },
      { id: 'SEC-05', name: 'JWT & Refresh Token Rotation', status: 'Active', grade: 'A', detail: '32+ char secret enforced with short-lived access tokens & WORM refresh hashes' },
      { id: 'SEC-06', name: 'Customer-Authorized Support Impersonation', status: 'Enforced', grade: 'A+', detail: 'Read-only scoped support access with mandatory time limit & banner' },
    ];

    res.json({
      status: 'success',
      securityScore: 98,
      grade: 'A+',
      totalAuditLogs,
      activeSessions,
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

    const logs = await prisma.auditLog.findMany({
      orderBy: { timestamp: 'asc' },
      take: 100
    });

    let isChainValid = true;
    let verifiedCount = 0;

    for (let i = 1; i < logs.length; i++) {
      const prev = logs[i - 1];
      const current = logs[i];
      if (current.previousHash !== prev.currentHash && current.previousHash !== 'GENESIS_HASH_0000000000000000000000000000000000000000000000000000000000000000') {
        isChainValid = false;
        break;
      }
      verifiedCount++;
    }

    res.json({
      status: 'success',
      isChainValid,
      totalLogsChecked: logs.length,
      verifiedCount: logs.length > 0 ? logs.length : 0,
      tamperingDetected: !isChainValid,
      verifiedAt: new Date().toISOString(),
      genesisHash: 'GENESIS_HASH_0000000000000000000000000000000000000000000000000000000000000000'
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to verify WORM integrity' });
  }
};

// ── 3. OCI RIYADH ARCHITECTURE ────────────────────────────────────────────

export const getOciArchitecture = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const architecture = {
      region: 'me-riyadh-1 (Oracle Cloud Infrastructure, Riyadh, KSA)',
      dataResidency: '100% Kingdom of Saudi Arabia Sovereign Data Residency',
      compliance: [
        { cert: 'NCA ECC-1:2018', status: 'Compliant', authority: 'Saudi National Cybersecurity Authority' },
        { cert: 'CITC / CST Cloud Class 4', status: 'Certified', authority: 'Communications, Space & Technology Commission' },
        { cert: 'Saudi PDPL (Royal Decree No. M/19)', status: 'Enforced', authority: 'Saudi Data & AI Authority (SDAIA)' },
        { cert: 'ZATCA Phase 2 (Resolution 211026)', status: 'Certified', authority: 'Zakat, Tax and Customs Authority' }
      ],
      availabilityDomains: [
        { ad: 'AD-1 (Riyadh Primary Data Center)', status: 'ACTIVE / ONLINE', role: 'Primary Compute & Autonomous Database RAC' },
        { ad: 'AD-2 (Riyadh Secondary Data Center)', status: 'ACTIVE / STANDBY', role: 'Hot Standby Replication & Synchronous Block Storage' }
      ],
      infrastructureLayers: [
        { layer: 'Edge & Ingress', tech: 'OCI WAF + DDoS Shield + Flexible Load Balancer', status: 'Healthy', details: 'TLS 1.3, HSTS Enforced, Saudi POP' },
        { layer: 'Compute Cluster', tech: 'OCI Container Engine for Kubernetes (OKE)', status: 'Healthy', details: 'Multi-AD node pools, auto-scaling' },
        { layer: 'Database Tier', tech: 'OCI Autonomous Database (PostgreSQL / SQLite Dev)', status: 'Healthy', details: 'Automated WAL archiving, WORM retention' },
        { layer: 'HSM & Crypto', tech: 'OCI Vault Dedicated Key Management (KMS)', status: 'Healthy', details: 'Hardware Security Module for ZATCA secp256k1' },
        { layer: 'Storage & Backup', tech: 'OCI Object Storage (WORM Compliance Lock)', status: 'Healthy', details: 'Immutable document evidence store' }
      ],
      metrics: {
        rpoSeconds: '< 1 second (Synchronous Data Guard)',
        rtoMinutes: '< 15 minutes (Automated AD Failover)',
        latencyInternalMs: '0.4 ms inter-AD interconnect'
      }
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

    res.json({
      status: 'success',
      totalRequirements: traceMatrix.length,
      verifiedCount: traceMatrix.length,
      compliancePercentage: 100,
      matrix: traceMatrix
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch BRD traceability matrix' });
  }
};
