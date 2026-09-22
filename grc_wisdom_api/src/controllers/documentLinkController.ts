import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import {
  planDocumentLinks, summariseLinks, targetOf, LINK_TARGETS, LinkCandidate,
} from '../services/documentLinks';
import {
  loadReadable, viewerFor, audienceMembership, decideRead,
} from '../services/documentReadGuard';

/**
 * Tying a policy to what it governs.
 *
 * The rules are in services/documentLinks and run without a database. This does
 * the loading, the writing and the audit entry.
 */

const str = (v: unknown): string => String(v ?? '');
const SUBJECT = 'Document';

const LINK_SELECT = {
  id: true,
  note: true,
  linkedAt: true,
  linkedBy: { select: { id: true, name: true } },
  control: {
    select: { id: true, code: true, title: true, domain: true, tenantId: true },
  },
  risk: { select: { id: true, ref: true, title: true, category: true } },
  clause: {
    select: {
      id: true, ref: true, title: true,
      standard: { select: { id: true, code: true, title: true } },
    },
  },
} as const;

/** Shapes a row for the screen, saying which kind of thing it points at. */
const shape = (l: any) => ({
  id: l.id,
  target: targetOf(l),
  note: l.note,
  linkedAt: l.linkedAt,
  linkedBy: l.linkedBy,
  control: l.control,
  risk: l.risk,
  clause: l.clause,
});

// ─── Read ───────────────────────────────────────────────────────────────────

/**
 * What this document governs, and what it could govern.
 *
 * Both halves in one response, for the same reason listProjectStandards serves
 * both: a picker that offers nothing is indistinguishable from one that failed
 * to load, and the difference is whether the organisation has any controls,
 * risks or enabled frameworks at all.
 */
export const listDocumentLinks = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const id = str(req.params.id);

    // Same reach decision as opening the document. What a Restricted policy
    // governs is a statement about that policy, and a listing that answered it
    // for someone who cannot read the document would put the enforcement in
    // one handler and the disclosure in another.
    //
    // Not recorded as an access: this is loaded by the page that already
    // recorded the view, and counting it again would make one read look like
    // two in the history.
    const gate = await loadReadable(id, req.user!.id, tenantId);
    if (!gate) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }

    const links = await prisma.documentLink.findMany({
      where: { documentId: id },
      select: LINK_SELECT,
      orderBy: { linkedAt: 'asc' },
    });

    res.json({
      status: 'success',
      documentId: id,
      targets: LINK_TARGETS,
      summary: summariseLinks(links.map((l) => ({
        controlId: l.control?.id ?? null,
        riskId: l.risk?.id ?? null,
        clauseId: l.clause?.id ?? null,
      }))),
      links: links.map(shape),
    });
  } catch (error: any) {
    console.error('[Document Links Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load what this document governs' });
  }
};

/**
 * The controls, risks and clauses this document could be linked to.
 *
 * Served rather than assembled in the browser from three separate list
 * endpoints, because the rule about which ones are reachable — own-tenant rows
 * plus platform library entries — belongs in one place, and the write path
 * enforces exactly the same rule.
 */
export const linkOptions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const reach = { OR: [{ tenantId: null }, { tenantId }] };

    const [controls, risks, clauses] = await Promise.all([
      prisma.control.findMany({
        where: reach,
        select: { id: true, code: true, title: true, domain: true },
        orderBy: { code: 'asc' },
        take: 500,
      }),
      prisma.risk.findMany({
        where: { tenantId },
        select: { id: true, ref: true, title: true, category: true },
        orderBy: { ref: 'asc' },
        take: 500,
      }),
      // Only clauses of frameworks this organisation has enabled. Offering
      // every clause in the library would bury the ones that apply.
      prisma.standardClause.findMany({
        where: { standard: { enablements: { some: { tenantId } } } },
        select: {
          id: true, ref: true, title: true,
          standard: { select: { id: true, code: true } },
        },
        orderBy: [{ standard: { code: 'asc' } }, { ref: 'asc' }],
        take: 1000,
      }),
    ]);

    res.json({
      status: 'success',
      controls,
      risks,
      clauses: clauses.map((c) => ({
        id: c.id,
        ref: c.ref,
        title: c.title,
        standardId: c.standard.id,
        standardCode: c.standard.code,
      })),
      // An empty clause list means one of two different things and the screen
      // has to say which: no framework enabled, or frameworks with no clauses.
      enabledFrameworks: [...new Set(clauses.map((c) => c.standard.code))].length,
    });
  } catch (error: any) {
    console.error('[Link Options Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load linkable records' });
  }
};

// ─── Write ──────────────────────────────────────────────────────────────────

/** Loads the candidate rows for one target kind, with the tenancy each carries. */
async function loadCandidates(
  target: string, ids: string[], tenantId: string,
): Promise<LinkCandidate[]> {
  if (ids.length === 0) return [];

  if (target === 'control') {
    const rows = await prisma.control.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, tenantId: true },
    });
    return rows.map((r) => ({ id: r.id, label: r.code, tenantId: r.tenantId }));
  }

  if (target === 'risk') {
    const rows = await prisma.risk.findMany({
      where: { id: { in: ids } },
      select: { id: true, ref: true, tenantId: true },
    });
    return rows.map((r) => ({ id: r.id, label: r.ref, tenantId: r.tenantId }));
  }

  if (target === 'clause') {
    const rows = await prisma.standardClause.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, ref: true,
        standard: { select: { code: true, tenantId: true } },
      },
    });
    // A clause inherits its tenancy from its standard: a platform framework is
    // available to everyone, a privately authored one is not.
    return rows.map((r) => ({
      id: r.id,
      label: `${r.standard.code} ${r.ref}`,
      tenantId: r.standard.tenantId,
    }));
  }

  // Unknown target. planDocumentLinks refuses it by name; returning nothing
  // here would make it look like the ids did not exist.
  void tenantId;
  return [];
}

export const addDocumentLinks = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = str(req.params.id);

    const doc = await prisma.document.findFirst({
      where: { id, tenantId },
      select: { id: true, code: true, title: true, status: true },
    });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }

    const target = str(req.body?.target);
    const raw = req.body?.ids;
    const requested: string[] = Array.isArray(raw) ? raw.map(str).filter(Boolean) : [];
    const note = req.body?.note ? str(req.body.note).trim() : null;

    const [found, existing] = await Promise.all([
      loadCandidates(target, requested, tenantId),
      prisma.documentLink.findMany({
        where: { documentId: id },
        select: { controlId: true, riskId: true, clauseId: true },
      }),
    ]);

    const existingIds = existing
      .map((l) => (target === 'control' ? l.controlId
        : target === 'risk' ? l.riskId
          : target === 'clause' ? l.clauseId : null))
      .filter(Boolean) as string[];

    const plan = planDocumentLinks({
      documentTenantId: tenantId,
      documentStatus: doc.status,
      target,
      requested,
      found,
      existing: existingIds,
    });

    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    if (plan.add.length === 0) {
      res.json({
        status: 'success',
        message: 'Nothing changed — all of those were already linked.',
        added: 0,
        warnings: plan.warnings,
      });
      return;
    }

    const labelOf = new Map(found.map((c) => [c.id, c.label]));

    await prisma.$transaction(async (tx) => {
      await tx.documentLink.createMany({
        data: plan.add.map((targetId) => ({
          documentId: id,
          controlId: plan.target === 'control' ? targetId : null,
          riskId: plan.target === 'risk' ? targetId : null,
          clauseId: plan.target === 'clause' ? targetId : null,
          note,
          linkedById: userId,
        })),
        // Idempotent rather than an error: the caller's intent — "this policy
        // governs these" — is already true for a row that exists.
        skipDuplicates: true,
      });

      await writeAudit(tx, {
        tenantId,
        actorId: userId,
        action: 'DOCUMENT_LINKS_ADDED',
        subjectType: SUBJECT,
        subjectId: id,
        // Codes and refs, not uuids. An entry nobody can read without three
        // more queries is an entry nobody reads.
        payload: {
          code: doc.code,
          target: plan.target,
          linked: plan.add.map((x) => labelOf.get(x) || x),
        },
      });
    });

    res.status(201).json({
      status: 'success',
      message: `Linked ${plan.add.length} ${plan.target}${plan.add.length === 1 ? '' : 's'}.`,
      added: plan.add.length,
      warnings: plan.warnings,
    });
  } catch (error: any) {
    console.error('[Document Link Add Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to link' });
  }
};

export const removeDocumentLink = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const linkId = str(req.params.linkId);

    const link = await prisma.documentLink.findFirst({
      // Scoped through the document, which is where tenancy lives. No link
      // table in this schema carries its own tenantId.
      where: { id: linkId, document: { tenantId } },
      select: {
        id: true,
        document: { select: { id: true, code: true, status: true } },
        control: { select: { code: true } },
        risk: { select: { ref: true } },
        clause: { select: { ref: true, standard: { select: { code: true } } } },
        controlId: true, riskId: true, clauseId: true,
      },
    });
    if (!link) { res.status(404).json({ status: 'error', message: 'Link not found' }); return; }

    if (link.document.status === 'ARCHIVED') {
      res.status(409).json({
        status: 'error',
        code: 'DOCUMENT_ARCHIVED',
        message: 'This document is archived. What it governed is part of the record.',
      });
      return;
    }

    const label = link.control?.code
      || link.risk?.ref
      || (link.clause ? `${link.clause.standard.code} ${link.clause.ref}` : linkId);

    await prisma.$transaction(async (tx) => {
      await tx.documentLink.delete({ where: { id: linkId } });
      await writeAudit(tx, {
        tenantId,
        actorId: userId,
        action: 'DOCUMENT_LINK_REMOVED',
        subjectType: SUBJECT,
        subjectId: link.document.id,
        payload: { code: link.document.code, target: targetOf(link), unlinked: label },
      });
    });

    res.json({ status: 'success', message: `${label} is no longer governed by this document.` });
  } catch (error: any) {
    console.error('[Document Link Remove Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to remove the link' });
  }
};

// ─── The reverse direction ──────────────────────────────────────────────────

/**
 * Which policies govern a control, a risk or a clause.
 *
 * The direction an auditor actually asks in, and the one ControlClauseLink
 * forgot to index. Without it the link is write-only from the document's side
 * and the control screen still cannot answer "what says we must do this".
 */
export const governingDocuments = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const target = str(req.params.target);
    const targetId = str(req.params.targetId);

    if (!(LINK_TARGETS as readonly string[]).includes(target)) {
      res.status(400).json({
        status: 'error',
        code: 'BAD_LINK_TARGET',
        message: `target must be one of: ${LINK_TARGETS.join(', ')}.`,
      });
      return;
    }

    const where: any = { document: { tenantId } };
    if (target === 'control') where.controlId = targetId;
    if (target === 'risk') where.riskId = targetId;
    if (target === 'clause') where.clauseId = targetId;

    const links = await prisma.documentLink.findMany({
      where,
      select: {
        id: true,
        note: true,
        linkedAt: true,
        document: {
          select: {
            id: true, code: true, title: true, category: true, status: true,
            version: true, publishedVersion: true, publishedAt: true,
            // For the reach decision below, not for the response.
            tenantId: true, ownerId: true, classification: true, audienceKind: true,
          },
        },
      },
      orderBy: { linkedAt: 'asc' },
    });

    // The reverse direction leaked what the forward one protects: this answers
    // "which policies govern this control", and a Restricted policy's code and
    // title would reach anyone who could open the control it mandates. The
    // withheld rows are dropped silently and not counted — saying "and two
    // more you may not see" discloses exactly what the marking exists to keep
    // back.
    const [viewer, audience, approvals] = await Promise.all([
      viewerFor(req.user!.id, tenantId),
      audienceMembership(req.user!.id, links.map((l) => l.document.id)),
      prisma.approvalQueue.findMany({
        where: { documentId: { in: links.map((l) => l.document.id) }, approverId: req.user!.id },
        select: { documentId: true },
      }),
    ]);
    const approvingIds = new Set(approvals.map((a) => a.documentId));

    const visible = links.filter((l) => decideRead(
      viewer,
      l.document,
      approvingIds.has(l.document.id) ? [req.user!.id] : [],
      audience.has(l.document.id),
    ).allowed);

    res.json({
      status: 'success',
      target,
      targetId,
      count: visible.length,
      documents: visible.map((l) => ({
        linkId: l.id,
        note: l.note,
        linkedAt: l.linkedAt,
        ...l.document,
        // A draft policy claiming to govern a live control is worth seeing as
        // distinct from a published one that does.
        live: l.document.status === 'PUBLISHED',
      })),
    });
  } catch (error: any) {
    console.error('[Governing Documents Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load governing documents' });
  }
};
