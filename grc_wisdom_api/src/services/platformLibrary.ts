import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';

/**
 * Publishes the library content the platform wrote before QA-031 (QA-033).
 *
 * Until 25 September a framework or a control the platform wrote was filed
 * under the platform's own organisation. The platform could still enable such
 * a framework for a customer, and the customer's package counted it, but
 * nothing a customer reads lists content filed under another organisation: the
 * framework, its clauses and the controls mapped to them stayed invisible to
 * the very customers they were enabled for ("1 of 10 frameworks" used, and an
 * empty Standards screen). QA-031 fixed what is written from then on; this
 * moves what was written before into the shared library, where frameworks and
 * the platform's controls belong.
 *
 * Run by `npm run provision` on every deploy. Idempotent: content already in
 * the library is never touched, so a second run publishes nothing. A code the
 * library already holds is left where it is and reported rather than published
 * a second time: two "ISO-27001"s in one library would leave every customer
 * guessing which one it is held to, and the database would not stop it (a
 * unique key on a nullable owner treats every library row as distinct).
 * Nothing is deleted, and every enablement, clause, mapping, implementation
 * and piece of evidence keeps pointing at the same rows.
 */

/** The platform's own organisations: the operator and its internal units. */
const PLATFORM_TYPES = ['SAAS', 'SAAS_UNIT'];

export interface LibraryReport {
  standards: string[];
  controls: string[];
  /** Left with their owner because the library already holds the code. */
  skipped: { kind: 'Standard' | 'Control'; code: string }[];
}

export async function publishPlatformLibrary(db: typeof prisma = prisma): Promise<LibraryReport> {
  const report: LibraryReport = { standards: [], controls: [], skipped: [] };
  const platform = (await db.tenant.findMany({
    where: { type: { in: PLATFORM_TYPES } }, select: { id: true },
  })).map((t) => t.id);
  if (platform.length === 0) return report;

  // Frameworks first, oldest first: if two platform organisations both wrote a
  // code, the earlier one is published and the later one reported.
  const standards = await db.standard.findMany({
    where: { tenantId: { in: platform } }, select: { id: true, code: true, tenantId: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const takenStandards = new Set((await db.standard.findMany({ where: { tenantId: null }, select: { code: true } })).map((s) => s.code));
  for (const s of standards) {
    if (takenStandards.has(s.code)) { report.skipped.push({ kind: 'Standard', code: s.code }); continue; }
    await db.$transaction(async (tx) => {
      await tx.standard.update({ where: { id: s.id }, data: { tenantId: null, isSystem: false } });
      await writeAudit(tx, {
        tenantId: s.tenantId!, actorId: null, action: 'STANDARD_PUBLISHED_TO_LIBRARY',
        subjectType: 'Standard', subjectId: s.id,
        payload: { code: s.code, reason: 'Written by the platform before QA-031 and filed under its own organisation (QA-033)' },
      });
    });
    takenStandards.add(s.code);
    report.standards.push(s.code);
  }

  const controls = await db.control.findMany({
    where: { tenantId: { in: platform } }, select: { id: true, code: true, tenantId: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const takenControls = new Set((await db.control.findMany({ where: { tenantId: null }, select: { code: true } })).map((c) => c.code));
  for (const c of controls) {
    if (takenControls.has(c.code)) { report.skipped.push({ kind: 'Control', code: c.code }); continue; }
    await db.$transaction(async (tx) => {
      await tx.control.update({ where: { id: c.id }, data: { tenantId: null } });
      await writeAudit(tx, {
        tenantId: c.tenantId!, actorId: null, action: 'CONTROL_PUBLISHED_TO_LIBRARY',
        subjectType: 'Control', subjectId: c.id,
        payload: { code: c.code, reason: 'Written by the platform before QA-031 and filed under its own organisation (QA-033)' },
      });
    });
    takenControls.add(c.code);
    report.controls.push(c.code);
  }
  return report;
}
