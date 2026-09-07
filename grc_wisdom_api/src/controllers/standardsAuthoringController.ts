import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';

/**
 * Authoring frameworks you can audit against.
 *
 * A standard is either published by the platform (tenantId null — ISO 27001,
 * PDPL and the rest, read-only for everyone) or authored by an organisation
 * for itself: an internal policy set, a customer contract schedule, a
 * regulator's letter turned into clauses you can test.
 */

const SUBJ_STANDARD = 'Standard';

/** A framework nobody can test against is a document, not a standard. */
function cleanClauses(raw: any): { rows: { ref: string; title: string; text: string | null }[]; error: string | null } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { rows: [], error: 'clauses must be a non-empty array' };
  }
  const rows: { ref: string; title: string; text: string | null }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] || {};
    const ref = String(c.ref ?? '').trim();
    const title = String(c.title ?? '').trim();
    if (!ref || !title) {
      return { rows: [], error: `clause ${i + 1} needs both a ref and a title` };
    }
    if (seen.has(ref)) {
      return { rows: [], error: `clause reference "${ref}" appears more than once` };
    }
    seen.add(ref);
    rows.push({ ref, title, text: c.text ? String(c.text).trim() : null });
  }
  return { rows, error: null };
}

/**
 * Create a framework, optionally with its whole clause set in one call —
 * which is the practical path, since a real standard has dozens of clauses.
 */
export const createStandard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { code, title, authority, version, description, clauses, scope: publishScope } = req.body || {};
    if (!code || !title || !authority || !version) {
      res.status(400).json({
        status: 'error',
        message: 'code, title, authority and version are all required',
      });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    // Only the operator publishes platform-wide; everyone else authors their own.
    const wantsPlatform = publishScope === 'platform';
    if (wantsPlatform && scope.kind !== 'PLATFORM') {
      res.status(403).json({
        status: 'error',
        code: 'PLATFORM_PUBLISH_DENIED',
        message: 'Only the platform operator can publish a standard to every tenant. Omit "scope" to author it for your own organisation.',
      });
      return;
    }
    const owningTenantId = wantsPlatform ? null : req.user!.tenantId;

    const cleanCode = String(code).trim().toUpperCase();
    const clash = await prisma.standard.findFirst({
      where: { tenantId: owningTenantId, code: cleanCode },
    });
    if (clash) {
      res.status(409).json({
        status: 'error',
        message: `A standard with code "${cleanCode}" already exists in this scope`,
      });
      return;
    }

    let clauseRows: { ref: string; title: string; text: string | null }[] = [];
    if (clauses !== undefined) {
      const parsed = cleanClauses(clauses);
      if (parsed.error) {
        res.status(400).json({ status: 'error', code: 'INVALID_CLAUSES', message: parsed.error });
        return;
      }
      clauseRows = parsed.rows;
    }

    const created = await prisma.$transaction(async (tx) => {
      const std = await tx.standard.create({
        data: {
          tenantId: owningTenantId,
          code: cleanCode,
          title: String(title).trim(),
          authority: String(authority).trim(),
          version: String(version).trim(),
          description: description ? String(description).trim() : null,
          isSystem: false,
        },
      });
      if (clauseRows.length > 0) {
        await tx.standardClause.createMany({
          data: clauseRows.map((c) => ({ standardId: std.id, ...c })),
        });
      }
      await writeAudit(tx, {
        tenantId: req.user!.tenantId, actorId: req.user!.id, action: 'STANDARD_CREATED',
        subjectType: SUBJ_STANDARD, subjectId: std.id,
        payload: { code: cleanCode, authority, version, clauses: clauseRows.length, platformWide: owningTenantId === null },
      });
      return std;
    });

    res.status(201).json({
      status: 'success',
      message: `${cleanCode} created with ${clauseRows.length} clause(s)${owningTenantId === null ? ', published platform-wide' : ''}. Enable it for a tenant to start assessing against it.`,
      standard: { ...created, clauseCount: clauseRows.length },
    });
  } catch (error: any) {
    console.error('[Standard Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create standard' });
  }
};

/** Add clauses to a framework you authored. Existing refs are rejected, not overwritten. */
export const addClauses = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const parsed = cleanClauses((req.body || {}).clauses);
    if (parsed.error) {
      res.status(400).json({ status: 'error', code: 'INVALID_CLAUSES', message: parsed.error });
      return;
    }

    const std = await prisma.standard.findUnique({ where: { id } });
    if (!std) { res.status(404).json({ status: 'error', message: 'Standard not found' }); return; }

    const denied = await refuseIfNotYours(req, std);
    if (denied) { res.status(denied.status).json(denied.body); return; }

    const existing = await prisma.standardClause.findMany({
      where: { standardId: id, ref: { in: parsed.rows.map((c) => c.ref) } },
      select: { ref: true },
    });
    if (existing.length > 0) {
      res.status(409).json({
        status: 'error',
        code: 'CLAUSE_EXISTS',
        message: `These clause references already exist: ${existing.map((c) => c.ref).join(', ')}. Edit them individually rather than re-importing.`,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.standardClause.createMany({
        data: parsed.rows.map((c) => ({ standardId: id, ...c })),
      });
      await writeAudit(tx, {
        tenantId: req.user!.tenantId, actorId: req.user!.id, action: 'STANDARD_CLAUSES_ADDED',
        subjectType: SUBJ_STANDARD, subjectId: id,
        payload: { code: std.code, added: parsed.rows.length, refs: parsed.rows.map((c) => c.ref).slice(0, 20) },
      });
    });

    const total = await prisma.standardClause.count({ where: { standardId: id } });
    res.status(201).json({
      status: 'success',
      message: `${parsed.rows.length} clause(s) added to ${std.code}. It now has ${total}.`,
      clauseCount: total,
    });
  } catch (error: any) {
    console.error('[Add Clauses Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to add clauses' });
  }
};

export const updateStandard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const std = await prisma.standard.findUnique({ where: { id } });
    if (!std) { res.status(404).json({ status: 'error', message: 'Standard not found' }); return; }

    const denied = await refuseIfNotYours(req, std);
    if (denied) { res.status(denied.status).json(denied.body); return; }

    const { title, authority, version, description } = req.body || {};
    const data: any = {};
    if (title) data.title = String(title).trim();
    if (authority) data.authority = String(authority).trim();
    if (version) data.version = String(version).trim();
    if (description !== undefined) data.description = description ? String(description).trim() : null;
    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.standard.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId: req.user!.tenantId, actorId: req.user!.id, action: 'STANDARD_UPDATED',
        subjectType: SUBJ_STANDARD, subjectId: id,
        payload: { code: std.code, before: { version: std.version }, after: data },
      });
      return u;
    });

    res.json({ status: 'success', standard: updated });
  } catch (error: any) {
    console.error('[Standard Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update standard' });
  }
};

/** Deleting a framework somebody is assessing against would erase their evidence trail. */
export const deleteStandard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const std = await prisma.standard.findUnique({
      where: { id },
      include: { _count: { select: { enablements: true, clauses: true } } },
    });
    if (!std) { res.status(404).json({ status: 'error', message: 'Standard not found' }); return; }

    const denied = await refuseIfNotYours(req, std);
    if (denied) { res.status(denied.status).json(denied.body); return; }

    if (std._count.enablements > 0) {
      res.status(409).json({
        status: 'error',
        code: 'STANDARD_IN_USE',
        message: `${std.code} is enabled for ${std._count.enablements} tenant(s). Disable it everywhere before deleting, or the assessment history loses its frame of reference.`,
      });
      return;
    }
    // Both kinds of mapping have to be counted. StandardClause cascades from
    // Standard, so a delete that only checked control mappings would silently
    // take a delivery project's traceability with it — the clause rows vanish,
    // the ProjectTaskClause rows cascade behind them, and the engagement quietly
    // stops being able to say which framework it was delivered against.
    const [mapped, delivered] = await Promise.all([
      prisma.controlClauseLink.count({ where: { clause: { standardId: id } } }),
      prisma.projectTaskClause.count({ where: { clause: { standardId: id } } }),
    ]);
    if (mapped > 0 || delivered > 0) {
      const parts = [
        mapped > 0 ? `${mapped} control mapping(s)` : null,
        delivered > 0 ? `${delivered} delivery task link(s)` : null,
      ].filter(Boolean);
      res.status(409).json({
        status: 'error',
        code: 'STANDARD_MAPPED',
        message: `${parts.join(' and ')} point at this standard's clauses. Unmap them first.`,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.standard.delete({ where: { id } });
      await writeAudit(tx, {
        tenantId: req.user!.tenantId, actorId: req.user!.id, action: 'STANDARD_DELETED',
        subjectType: SUBJ_STANDARD, subjectId: id,
        payload: { code: std.code, clauses: std._count.clauses },
      });
    });

    res.json({ status: 'success', message: `${std.code} deleted` });
  } catch (error: any) {
    console.error('[Standard Delete Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete standard' });
  }
};

/**
 * Map a control to the clauses it satisfies. This is what makes a standard
 * auditable — without mappings the clauses are text nobody is accountable for.
 * One control may satisfy clauses across several frameworks at once.
 */
/**
 * Map many controls to the same clauses in one act.
 *
 * The single-control endpoint replaces a mapping wholesale, which is right when
 * a request describes one control's end state. Across a selection it would be
 * destructive: controls in a batch rarely share a mapping, and "set all of
 * these to A.5.1" would silently discard whatever else each of them already
 * satisfied.
 *
 * So this ADDS. The clauses given are unioned into each control's existing set,
 * and `mode: 'replace'` is available for the case where someone genuinely means
 * to overwrite — but it is never the default, because the default is what gets
 * clicked by someone who has not read this.
 *
 * Written because 731 imported controls arrived with no mappings at all: the
 * bulk import path creates controls with createMany and never touches
 * ControlClauseLink, and the only way to map one was a dialog nobody can drive
 * 731 times.
 */
export const bulkMapControlsToClauses = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const { controlIds, clauseIds, mode } = req.body || {};
    if (!Array.isArray(controlIds) || controlIds.length === 0) {
      res.status(400).json({ status: 'error', message: 'controlIds must be a non-empty array' });
      return;
    }
    if (!Array.isArray(clauseIds)) {
      res.status(400).json({ status: 'error', message: 'clauseIds must be an array' });
      return;
    }
    if (mode && mode !== 'add' && mode !== 'replace') {
      res.status(400).json({ status: 'error', message: "mode must be 'add' or 'replace'" });
      return;
    }
    const replacing = mode === 'replace';

    // A ceiling, so one request cannot rewrite an entire library by accident.
    // Generous enough for a filtered page of controls, small enough that a
    // mistake is recoverable by hand.
    if (controlIds.length > 500) {
      res.status(400).json({
        status: 'error',
        code: 'TOO_MANY',
        message: 'Map at most 500 controls at a time. Filter the list and work through it.',
      });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);

    const controls = await prisma.control.findMany({
      where: {
        id: { in: controlIds },
        OR: [{ tenantId: null }, { tenantId: { in: scope.tenantIds } }],
      },
      select: { id: true, code: true, tenantId: true },
    });
    if (controls.length !== controlIds.length) {
      res.status(400).json({
        status: 'error',
        message: 'One or more controls do not exist in your scope',
      });
      return;
    }

    // A library control is shared by every tenant, so remapping one here would
    // rewrite it for all of them. Refused by name rather than skipped silently:
    // a caller who selected 40 controls and had 6 quietly ignored would believe
    // all 40 were mapped.
    const library = controls.filter((c) => c.tenantId === null);
    if (library.length > 0 && scope.kind !== 'PLATFORM') {
      res.status(403).json({
        status: 'error',
        code: 'LIBRARY_CONTROL',
        message: `${library.length} of the selected controls come from the shared library `
          + `(${library.slice(0, 3).map((c) => c.code).join(', ')}`
          + `${library.length > 3 ? ', …' : ''}) and are the same for every tenant. `
          + 'Copy them into your own set first, or deselect them.',
        controlCodes: library.map((c) => c.code),
      });
      return;
    }

    const clauses = await prisma.standardClause.findMany({
      where: { id: { in: clauseIds } },
      include: { standard: { select: { code: true, tenantId: true } } },
    });
    if (clauses.length !== clauseIds.length) {
      res.status(400).json({ status: 'error', message: 'One or more clauseIds do not exist' });
      return;
    }
    const unreachable = clauses.filter(
      (c) => c.standard.tenantId !== null && !scope.tenantIds.includes(c.standard.tenantId),
    );
    if (unreachable.length > 0) {
      res.status(403).json({
        status: 'error',
        code: 'CLAUSE_OUT_OF_SCOPE',
        message: 'You cannot map to clauses from another organisation\'s private framework '
          + `(${[...new Set(unreachable.map((c) => c.standard.code))].join(', ')}).`,
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      if (replacing) {
        await tx.controlClauseLink.deleteMany({ where: { controlId: { in: controlIds } } });
      }

      let created = 0;
      if (clauseIds.length > 0) {
        // skipDuplicates carries the whole "add" semantic: a control already
        // mapped to one of these keeps its single link rather than erroring on
        // the (controlId, clauseId) unique constraint. It also makes the whole
        // operation idempotent, so running it twice is not a way to break it.
        const links = controlIds.flatMap((controlId: string) =>
          clauseIds.map((clauseId: string) => ({ controlId, clauseId })));
        const done = await tx.controlClauseLink.createMany({
          data: links,
          skipDuplicates: true,
        });
        created = done.count;
      }

      // One audit entry for one act. Writing one per control would bury the
      // fact that this was a single deliberate decision under 500 rows.
      await writeAudit(tx, {
        tenantId: req.user!.tenantId,
        actorId: req.user!.id,
        action: replacing ? 'CONTROL_CLAUSES_BULK_REPLACED' : 'CONTROL_CLAUSES_BULK_MAPPED',
        subjectType: 'Control',
        subjectId: controlIds[0],
        payload: {
          controls: controls.length,
          clauses: clauseIds.length,
          linksCreated: created,
          mode: replacing ? 'replace' : 'add',
          controlCodes: controls.slice(0, 20).map((c) => c.code),
        },
      });

      return created;
    });

    res.json({
      status: 'success',
      // The link count rather than the control count, because with skipDuplicates
      // they differ whenever something was already mapped — and a caller told
      // "40 controls mapped" when 12 already were has been told the wrong thing.
      message: `${controls.length} control(s) mapped — ${result} new link(s)`,
      controls: controls.length,
      linksCreated: result,
    });
  } catch (error: any) {
    console.error('[Bulk Map Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to map the controls' });
  }
};

export const mapControlToClauses = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const controlId = req.params.controlId as string;
    const { clauseIds } = req.body || {};
    if (!Array.isArray(clauseIds)) {
      res.status(400).json({ status: 'error', message: 'clauseIds must be an array' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const control = await prisma.control.findFirst({
      // Library controls (tenantId null) are visible to everyone, so they have
      // to be fetched before we can judge whether this caller may remap one.
      where: { id: controlId, OR: [{ tenantId: null }, { tenantId: { in: scope.tenantIds } }] },
    });
    if (!control) { res.status(404).json({ status: 'error', message: 'Control not found in your scope' }); return; }

    // A library control is shared by every tenant. Letting one organisation
    // remap it would rewrite the mapping for all of them — and pointing it at
    // a private clause would expose that framework platform-wide.
    if (control.tenantId === null && scope.kind !== 'PLATFORM') {
      res.status(403).json({
        status: 'error',
        code: 'LIBRARY_CONTROL',
        message: `${control.code} comes from the shared control library and its mapping is the same for every tenant. Copy it into your own control set to map it against your framework.`,
      });
      return;
    }

    // Every clause must belong to a standard this tenant can actually see.
    const clauses = await prisma.standardClause.findMany({
      where: { id: { in: clauseIds } },
      include: { standard: { select: { code: true, tenantId: true } } },
    });
    if (clauses.length !== clauseIds.length) {
      res.status(400).json({ status: 'error', message: 'One or more clauseIds do not exist' });
      return;
    }
    const unreachable = clauses.filter(
      (c) => c.standard.tenantId !== null && !scope.tenantIds.includes(c.standard.tenantId),
    );
    if (unreachable.length > 0) {
      res.status(403).json({
        status: 'error',
        code: 'CLAUSE_OUT_OF_SCOPE',
        message: `You cannot map to clauses from another organisation's private framework (${unreachable.map((c) => c.standard.code).join(', ')}).`,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Replace the mapping wholesale so the request describes the end state.
      await tx.controlClauseLink.deleteMany({ where: { controlId } });
      if (clauseIds.length > 0) {
        await tx.controlClauseLink.createMany({
          data: clauseIds.map((clauseId: string) => ({ controlId, clauseId })),
        });
      }
      await writeAudit(tx, {
        tenantId: control.tenantId ?? req.user!.tenantId, actorId: req.user!.id, action: 'CONTROL_CLAUSES_MAPPED',
        subjectType: 'Control', subjectId: controlId,
        payload: { control: control.code, clauses: clauseIds.length, standards: [...new Set(clauses.map((c) => c.standard.code))] },
      });
    });

    res.json({
      status: 'success',
      message: `${control.code} now satisfies ${clauseIds.length} clause(s) across ${new Set(clauses.map((c) => c.standard.code)).size} standard(s)`,
    });
  } catch (error: any) {
    console.error('[Map Control Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to map control to clauses' });
  }
};

/** Platform standards are read-only, and a private one belongs to its author. */
async function refuseIfNotYours(
  req: AuthenticatedRequest,
  std: { isSystem: boolean; tenantId: string | null; code: string },
): Promise<{ status: number; body: any } | null> {
  if (std.isSystem) {
    return {
      status: 403,
      body: {
        status: 'error',
        code: 'SYSTEM_STANDARD',
        message: `${std.code} is a published standard and cannot be edited. Author your own framework if you need different clauses.`,
      },
    };
  }
  const scope = await resolveTenantScope(req.user!.tenantId);
  if (std.tenantId === null && scope.kind !== 'PLATFORM') {
    return {
      status: 403,
      body: {
        status: 'error',
        code: 'PLATFORM_STANDARD',
        message: `${std.code} is published platform-wide; only the operator can change it.`,
      },
    };
  }
  if (std.tenantId !== null && !scope.tenantIds.includes(std.tenantId)) {
    return {
      status: 403,
      body: { status: 'error', message: 'That standard belongs to another organisation' },
    };
  }
  return null;
}
