import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { computeAging } from './issueController';
import {
  ReportDocument, ReportSection, ReportFormat, FORMATS, MIME, Provenance, fileNameFor,
} from '../services/reportDocument';
import { renderXlsx } from '../services/renderXlsx';
import { renderPdf } from '../services/renderPdf';
import { renderDocx } from '../services/renderDocx';

/**
 * Report export.
 *
 * Every report is scope-resolved before rendering and the export itself is
 * audit-logged. An export is a disclosure — without the same scoping every
 * other read obeys, it becomes the way around tenant isolation.
 */

/** The requested format, defaulting to the working one. */
function formatOf(req: AuthenticatedRequest): ReportFormat | null {
  const raw = String((req.query.format ?? 'xlsx')).toLowerCase();
  return (FORMATS as string[]).includes(raw) ? (raw as ReportFormat) : null;
}

/** Content is decided once; the format only chooses how it is drawn. */
async function send(
  res: Response, report: ReportDocument, format: ReportFormat, name: string, ref?: string,
) {
  const buf =
    format === 'pdf' ? await renderPdf(report)
    : format === 'docx' ? await renderDocx(report)
    : await renderXlsx(report);

  res.setHeader('Content-Type', MIME[format]);
  res.setHeader('Content-Disposition', `attachment; filename="${fileNameFor(name, format, ref)}"`);
  res.send(buf);
}

function badFormat(res: Response) {
  res.status(400).json({
    status: 'error',
    code: 'UNSUPPORTED_FORMAT',
    message: `format must be one of: ${FORMATS.join(', ')}`,
  });
}

async function provenanceFor(req: AuthenticatedRequest, reportName: string, scopeKind: string): Promise<Provenance> {
  const [tenant, user] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: req.user!.tenantId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: req.user!.id }, select: { name: true, email: true } }),
  ]);
  return {
    reportName,
    tenantName: tenant?.name ?? 'Unknown',
    generatedBy: `${user?.name ?? 'Unknown'} <${user?.email ?? ''}>`,
    scopeKind,
  };
}

async function logExport(req: AuthenticatedRequest, report: string, detail: Record<string, any>) {
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      tenantId: req.user!.tenantId, actorId: req.user!.id, action: 'REPORT_EXPORTED',
      subjectType: 'Report', subjectId: report,
      payload: { report, format: 'xlsx', ...detail },
    });
  });
}

/**
 * Risk and Control Matrix for one engagement — the working paper an auditor
 * actually wants in a spreadsheet.
 */
export const exportRcm = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const format = formatOf(req);
    if (!format) { badFormat(res); return; }
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const audit = await prisma.audit.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: {
        leadAuditor: { select: { name: true } },
        engagementRisks: {
          include: {
            implementation: { include: { control: { select: { code: true, title: true } } } },
            procedures: {
              include: {
                assignedTo: { select: { name: true } },
                result: { include: { testedBy: { select: { name: true } } } },
              },
              orderBy: { ref: 'asc' },
            },
          },
          orderBy: { ref: 'asc' },
        },
      },
    });
    if (!audit) { res.status(404).json({ status: 'error', message: 'Engagement not found' }); return; }

    const prov = await provenanceFor(req, 'Risk & Control Matrix', scope.kind);
    prov.subjectRef = `${audit.ref} — ${audit.title}`;
    prov.subjectStatus = audit.status;

    const rows: Record<string, any>[] = [];
    for (const r of audit.engagementRisks) {
      if (r.procedures.length === 0) {
        rows.push({
          riskRef: r.ref, risk: r.title, riskRating: r.riskRating,
          control: r.implementation?.control.code ?? '(none linked)',
          controlTitle: r.implementation?.control.title ?? '',
          controlType: r.controlType, controlNature: r.controlNature,
          procRef: '', objective: '', procedure: '', testType: '', sampling: '',
          population: '', sample: '', assignee: '', tested: '', exceptions: '',
          conclusion: 'Not yet tested', narrative: '',
        });
        continue;
      }
      for (const p of r.procedures) {
        rows.push({
          riskRef: r.ref, risk: r.title, riskRating: r.riskRating,
          control: r.implementation?.control.code ?? '(none linked)',
          controlTitle: r.implementation?.control.title ?? '',
          controlType: r.controlType, controlNature: r.controlNature,
          procRef: p.ref, objective: p.objective, procedure: p.procedure,
          testType: p.testType, sampling: p.samplingMethod,
          population: p.populationSize ?? '', sample: p.sampleSize ?? '',
          assignee: p.assignedTo?.name ?? '',
          tested: p.result?.itemsTested ?? '',
          exceptions: p.result?.exceptionsFound ?? '',
          conclusion: p.result?.conclusion ?? 'Not yet tested',
          narrative: p.result?.narrative ?? '',
        });
      }
    }

    const sections: ReportSection[] = [{ kind: 'table', title: 'RCM', columns: [
      { header: 'Risk ref', key: 'riskRef', width: 10 },
      { header: 'Risk', key: 'risk', width: 38 },
      { header: 'Rating', key: 'riskRating', width: 10 },
      { header: 'Control', key: 'control', width: 12 },
      { header: 'Control title', key: 'controlTitle', width: 32 },
      { header: 'Type', key: 'controlType', width: 12 },
      { header: 'Nature', key: 'controlNature', width: 12 },
      { header: 'Proc ref', key: 'procRef', width: 10 },
      { header: 'Objective', key: 'objective', width: 38 },
      { header: 'Procedure', key: 'procedure', width: 44 },
      { header: 'Test type', key: 'testType', width: 18 },
      { header: 'Sampling', key: 'sampling', width: 14 },
      { header: 'Population', key: 'population', width: 11 },
      { header: 'Sample', key: 'sample', width: 9 },
      { header: 'Assigned to', key: 'assignee', width: 18 },
      { header: 'Tested', key: 'tested', width: 9 },
      { header: 'Exceptions', key: 'exceptions', width: 11 },
      { header: 'Conclusion', key: 'conclusion', width: 22 },
      { header: 'Narrative', key: 'narrative', width: 50 },
    ], rows }];

    await logExport(req, 'RCM', { auditRef: audit.ref, rows: rows.length, engagementStatus: audit.status, format });
    await send(res, { provenance: prov, sections }, format, 'RCM', audit.ref);
  } catch (error: any) {
    console.error('[RCM Export Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to build the RCM export' });
  }
};

/** The engagement report: conclusion first, then findings in IIA structure. */
export const exportAuditReport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const format = formatOf(req);
    if (!format) { badFormat(res); return; }
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const audit = await prisma.audit.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: {
        leadAuditor: { select: { name: true, email: true } },
        concludedBy: { select: { name: true } },
        issues: {
          include: {
            raisedBy: { select: { name: true } },
            capOwner: { select: { name: true } },
            respondedBy: { select: { name: true } },
            closedBy: { select: { name: true } },
          },
          orderBy: { ref: 'asc' },
        },
        workpapers: { select: { ref: true, title: true, section: true, status: true } },
      },
    });
    if (!audit) { res.status(404).json({ status: 'error', message: 'Engagement not found' }); return; }

    const prov = await provenanceFor(req, 'Internal Audit Report', scope.kind);
    prov.subjectRef = `${audit.ref} — ${audit.title}`;
    prov.subjectStatus = audit.status;

    const summary = [
      { k: 'Reference', v: audit.ref },
      { k: 'Title', v: audit.title },
      { k: 'Lead auditor', v: audit.leadAuditor?.name ?? '' },
      { k: 'Status', v: audit.status },
      { k: 'Objective', v: audit.objective },
      { k: 'Scope', v: audit.scope },
      { k: 'Criteria', v: audit.criteria },
      { k: 'Conclusion', v: audit.conclusion ?? 'Not yet concluded' },
      { k: 'Basis for conclusion', v: audit.conclusionNarrative ?? '' },
      { k: 'Concluded by', v: audit.concludedBy?.name ?? '' },
      { k: 'Findings raised', v: audit.issues.length },
      { k: 'Findings closed', v: audit.issues.filter((i) => i.status === 'Closed').length },
      { k: 'Workpapers', v: `${audit.workpapers.length} (${audit.workpapers.filter((w) => w.status === 'Reviewed').length} reviewed)` },
    ];

    const sections: ReportSection[] = [
      {
        kind: 'fields',
        title: 'Engagement',
        fields: summary.map((r) => ({ label: r.k, value: String(r.v) })),
      },
      { kind: 'table', title: 'Findings', columns: [
      { header: 'Ref', key: 'ref', width: 16 },
      { header: 'Rating', key: 'rating', width: 10 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Criterion', key: 'criterion', width: 42 },
      { header: 'Condition', key: 'condition', width: 42 },
      { header: 'Cause', key: 'cause', width: 38 },
      { header: 'Recommendation', key: 'recommendation', width: 42 },
      { header: 'Management response', key: 'response', width: 16 },
      { header: 'Management position', key: 'narrative', width: 42 },
      { header: 'Action plan', key: 'plan', width: 42 },
      { header: 'CAP owner', key: 'capOwner', width: 18 },
      { header: 'CAP due', key: 'capDue', width: 12 },
      { header: 'Raised by', key: 'raisedBy', width: 18 },
      { header: 'Closed by', key: 'closedBy', width: 18 },
      { header: 'Days open', key: 'age', width: 10 },
      ], rows: audit.issues.map((i) => {
      const aging = computeAging(i);
      return {
        ref: i.ref, rating: i.riskRating, status: i.status,
        criterion: i.criterion ?? '', condition: i.condition ?? '', cause: i.cause ?? '',
        recommendation: i.recommendation,
        response: i.responseType ?? 'Awaited',
        narrative: i.responseNarrative ?? '',
        plan: i.managementActionPlan ?? '',
        capOwner: i.capOwner?.name ?? '',
        capDue: i.capDueDate ? i.capDueDate.toISOString().slice(0, 10) : '',
        raisedBy: i.raisedBy?.name ?? '',
        closedBy: i.closedBy?.name ?? '',
        age: aging.ageDays,
        };
      }) },
      { kind: 'table', title: 'Workpaper index', columns: [
        { header: 'Ref', key: 'ref', width: 12 },
        { header: 'Section', key: 'section', width: 20 },
        { header: 'Title', key: 'title', width: 50 },
        { header: 'Status', key: 'status', width: 14 },
      ], rows: audit.workpapers.map((w) => ({ ref: w.ref, section: w.section, title: w.title, status: w.status })) },
    ];

    await logExport(req, 'AuditReport', {
      auditRef: audit.ref, findings: audit.issues.length,
      conclusion: audit.conclusion, engagementStatus: audit.status, format,
    });
    await send(res, { provenance: prov, sections }, format, 'Audit_Report', audit.ref);
  } catch (error: any) {
    console.error('[Audit Report Export Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to build the audit report' });
  }
};

/** Cross-source issue register with aging. */
export const exportIssueRegister = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const format = formatOf(req);
    if (!format) { badFormat(res); return; }
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'report.issues.export');

    const issues = await prisma.issue.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      include: {
        raisedBy: { select: { name: true } },
        capOwner: { select: { name: true } },
        tenant: { select: { name: true } },
        audit: { select: { ref: true } },
      },
      orderBy: [{ status: 'asc' }, { identifiedDate: 'asc' }],
    });

    const prov = await provenanceFor(req, 'Issue Register', scope.kind);
    const sections: ReportSection[] = [{ kind: 'table', title: 'Issues', columns: [
      { header: 'Ref', key: 'ref', width: 16 },
      { header: 'Entity', key: 'tenant', width: 24 },
      { header: 'Source', key: 'source', width: 16 },
      { header: 'Source reference', key: 'sourceRef', width: 22 },
      { header: 'Engagement', key: 'audit', width: 14 },
      { header: 'Title', key: 'title', width: 46 },
      { header: 'Rating', key: 'rating', width: 10 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Raised by', key: 'raisedBy', width: 18 },
      { header: 'CAP owner', key: 'capOwner', width: 18 },
      { header: 'Identified', key: 'identified', width: 12 },
      { header: 'Target', key: 'target', width: 12 },
      { header: 'Age (days)', key: 'age', width: 11 },
      { header: 'Overdue by', key: 'overdue', width: 11 },
      { header: 'Escalation', key: 'escalation', width: 11 },
    ], rows: issues.map((i) => {
      const a = computeAging(i);
      return {
        ref: i.ref, tenant: i.tenant.name, source: i.source,
        sourceRef: i.sourceReference ?? '', audit: i.audit?.ref ?? '',
        title: i.title, rating: i.riskRating, status: i.status,
        raisedBy: i.raisedBy?.name ?? '', capOwner: i.capOwner?.name ?? '',
        identified: i.identifiedDate.toISOString().slice(0, 10),
        target: a.targetDate.toISOString().slice(0, 10),
        age: a.ageDays, overdue: a.daysOverdue || '',
        escalation: i.escalationLevel || '',
      };
    }) }];

    await logExport(req, 'IssueRegister', { rows: issues.length, format });
    await send(res, { provenance: prov, sections }, format, 'Issue_Register');
  } catch (error: any) {
    console.error('[Issue Export Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to build the issue register' });
  }
};

/** Framework library with the controls mapped to each clause — and the gaps. */
export const exportFrameworkCoverage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const format = formatOf(req);
    if (!format) { badFormat(res); return; }
    const scope = await resolveTenantScope(req.user!.tenantId);
    const standards = await prisma.standard.findMany({
      where: { OR: [{ tenantId: null }, { tenantId: { in: scope.tenantIds } }] },
      include: {
        clauses: {
          include: { links: { include: { control: { select: { code: true, title: true } } } } },
          orderBy: { ref: 'asc' },
        },
      },
      orderBy: { code: 'asc' },
    });

    const prov = await provenanceFor(req, 'Framework Coverage', scope.kind);
    const rows = standards.flatMap((s) =>
      s.clauses.map((c) => ({
        standard: s.code, version: s.version, ref: c.ref, title: c.title,
        text: c.text ?? '',
        controls: c.links.map((l) => l.control.code).join(', '),
        controlCount: c.links.length,
        covered: c.links.length > 0 ? 'Yes' : 'NO — unmapped',
      })),
    );

    const sections: ReportSection[] = [{ kind: 'table', title: 'Coverage', columns: [
      { header: 'Standard', key: 'standard', width: 14 },
      { header: 'Version', key: 'version', width: 10 },
      { header: 'Clause', key: 'ref', width: 14 },
      { header: 'Clause title', key: 'title', width: 44 },
      { header: 'Clause text', key: 'text', width: 60 },
      { header: 'Mapped controls', key: 'controls', width: 28 },
      { header: 'Count', key: 'controlCount', width: 8 },
      { header: 'Covered', key: 'covered', width: 15 },
    ], rows }];

    const gaps = rows.filter((r) => r.controlCount === 0);
    sections.push({ kind: 'table', title: 'Unmapped clauses', columns: [
      { header: 'Standard', key: 'standard', width: 14 },
      { header: 'Clause', key: 'ref', width: 14 },
      { header: 'Clause title', key: 'title', width: 60 },
    ], rows: gaps.map((g) => ({ standard: g.standard, ref: g.ref, title: g.title })) });

    await logExport(req, 'FrameworkCoverage', { standards: standards.length, clauses: rows.length, unmapped: gaps.length, format });
    await send(res, { provenance: prov, sections }, format, 'Framework_Coverage');
  } catch (error: any) {
    console.error('[Coverage Export Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to build the coverage report' });
  }
};

/** Annual plan with the universe scores behind it. */
export const exportAnnualPlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const format = formatOf(req);
    if (!format) { badFormat(res); return; }
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const plan = await prisma.auditPlan.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: {
        preparedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        items: {
          include: {
            auditableEntity: true,
            assignedLead: { select: { name: true } },
          },
          orderBy: { plannedQuarter: 'asc' },
        },
      },
    });
    if (!plan) { res.status(404).json({ status: 'error', message: 'Plan not found' }); return; }

    const prov = await provenanceFor(req, 'Annual Audit Plan', scope.kind);
    prov.subjectRef = `${plan.title} (${plan.year}) — ${plan.status}`;

    const sections: ReportSection[] = [{ kind: 'table', title: 'Plan', columns: [
      { header: 'Quarter', key: 'q', width: 9 },
      { header: 'Entity', key: 'entity', width: 40 },
      { header: 'Type', key: 'type', width: 14 },
      { header: 'Risk score', key: 'score', width: 11 },
      { header: 'Tier', key: 'tier', width: 10 },
      { header: 'Budget hours', key: 'hours', width: 13 },
      { header: 'Lead', key: 'lead', width: 20 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Rationale', key: 'rationale', width: 50 },
    ], rows: plan.items.map((i) => ({
      q: `Q${i.plannedQuarter}`,
      entity: i.auditableEntity.name,
      type: i.auditableEntity.type,
      score: i.auditableEntity.riskScore,
      tier: i.auditableEntity.riskTier,
      hours: i.budgetHours,
      lead: i.assignedLead?.name ?? '',
      status: i.status,
      rationale: i.rationale ?? '',
    })) }];

    await logExport(req, 'AnnualPlan', { year: plan.year, items: plan.items.length, planStatus: plan.status, format });
    await send(res, { provenance: prov, sections }, format, 'Annual_Plan', String(plan.year));
  } catch (error: any) {
    console.error('[Plan Export Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to build the plan export' });
  }
};
