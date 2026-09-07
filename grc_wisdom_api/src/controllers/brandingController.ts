import { Response } from 'express';
import fs from 'fs';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, canWriteToTenant } from '../services/scopeResolver';
import {
  REPORT_MARKINGS, MAX_LOGO_BYTES, LOGO_TYPES,
  normaliseHex, normaliseMarking, checkLogo, logoType,
  resolveBranding, ancestorsOf, contrastRatio, MIN_TEXT_CONTRAST, PAPER,
} from '../services/tenantBranding';
import { decodeUpload, putEvidence, resolveEvidencePath } from '../services/evidenceStore';

/**
 * A tenant's identity on its own reports.
 *
 * Until this existed, renderPdf and renderDocx each hardcoded the vendor's
 * green, so every customer's report went to their board and their external
 * auditor in GRC Wisdom's livery.
 *
 * One access rule worth stating because getting it wrong would be quiet and
 * bad: branding is authorised through TENANT scope, never through project
 * access. `canReadProject` and `sideOf` deliberately admit a delivery partner
 * to its client's engagement — that is the point of them — so routing a
 * branding write through the project check would let a consultancy rewrite its
 * client's logo and legal name. A partner is never inside its client's
 * `scope.tenantIds`, which is exactly the property relied on here.
 */

const str = (v: unknown): string => String(v ?? '');

/** What a caller may see and set. Never exposes the storage key. */
const shape = (row: any, resolved: any) => ({
  tenantId: row?.tenantId ?? null,
  displayName: row?.displayName ?? null,
  brandColour: row?.brandColour ?? null,
  marking: row?.marking ?? null,
  footerText: row?.footerText ?? null,
  inheritsFromParent: row?.inheritsFromParent ?? true,
  hasLogo: !!row?.logoKey,
  logoFileName: row?.logoFileName ?? null,
  logoBytes: row?.logoBytes ?? null,
  updatedAt: row?.updatedAt ?? null,
  /** What a report would actually use, after inheritance. */
  effective: resolved,
});

/**
 * Resolve the branding that applies to a tenant, in one query.
 *
 * `Tenant.path` already holds the ancestry as slash-separated IDs, so the whole
 * chain is a primary-key IN-lookup rather than one query per level. This runs
 * on every report render, at the depth of the tree, so the difference matters.
 */
export async function brandingFor(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, path: true },
  });
  if (!tenant) return null;

  const ancestry = ancestorsOf(tenant.path);
  const rows = await prisma.tenantBranding.findMany({
    where: { tenantId: { in: [tenantId, ...ancestry] } },
    select: {
      tenantId: true, displayName: true, brandColour: true, marking: true,
      footerText: true, logoKey: true, inheritsFromParent: true,
    },
  });

  return {
    tenant,
    resolved: resolveBranding(tenantId, ancestry, rows, tenant.name),
    rows,
  };
}

/**
 * The logo bytes a renderer should embed, following the same inheritance.
 *
 * Read from disk here rather than handed to the renderer as a path, because
 * pdfkit's doc.image() treats a string as a filesystem path and a Buffer as
 * bytes — passing base64 fails with ENOENT rather than anything that reads
 * like a type error.
 */
export async function logoBytesFor(tenantId: string): Promise<Buffer | null> {
  const b = await brandingFor(tenantId);
  // The key comes from the SAME resolution as the name and the colour. Walking
  // the chain a second time here would be a second chance to disagree, and a
  // report carrying one organisation's name above another's mark is worse than
  // one carrying no mark at all.
  const key = b?.resolved.logoKey;
  if (!key) return null;

  const full = resolveEvidencePath(key);
  // A missing file is not a reason to fail the whole report. The cover simply
  // carries no mark, which a reader can see; a 500 on export is a report
  // nobody gets.
  if (!full) return null;
  try { return fs.readFileSync(full); } catch { return null; }
}

// ─── Read ───────────────────────────────────────────────────────────────────

export const getBranding = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(str(req.user!.tenantId));
    const tenantId = str(req.params.tenantId || req.user!.tenantId);

    if (!scope.tenantIds.includes(tenantId)) {
      res.status(404).json({ status: 'error', message: 'Organisation not found' });
      return;
    }

    const b = await brandingFor(tenantId);
    if (!b) { res.status(404).json({ status: 'error', message: 'Organisation not found' }); return; }

    const own = b.rows.find((r) => r.tenantId === tenantId) || null;

    res.json({
      status: 'success',
      branding: shape(own, b.resolved),
      vocabulary: {
        markings: REPORT_MARKINGS,
        logoTypes: LOGO_TYPES,
        maxLogoBytes: MAX_LOGO_BYTES,
      },
    });
  } catch (error: any) {
    console.error('[Branding Read Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load branding' });
  }
};

// ─── Write ──────────────────────────────────────────────────────────────────

export const updateBranding = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(str(req.user!.tenantId));
    const tenantId = str(req.params.tenantId || req.user!.tenantId);

    // Tenant scope, never project access — see the note at the top of this file.
    if (!canWriteToTenant(scope, tenantId)) {
      res.status(404).json({ status: 'error', message: 'Organisation not found' });
      return;
    }

    const b = req.body || {};
    const data: any = {};

    if (b.displayName !== undefined) {
      data.displayName = b.displayName ? str(b.displayName).trim().slice(0, 160) : null;
    }
    if (b.footerText !== undefined) {
      data.footerText = b.footerText ? str(b.footerText).trim().slice(0, 300) : null;
    }
    if (b.inheritsFromParent !== undefined) data.inheritsFromParent = !!b.inheritsFromParent;

    if (b.brandColour !== undefined) {
      if (b.brandColour === null || b.brandColour === '') {
        data.brandColour = null;
      } else {
        const hex = normaliseHex(str(b.brandColour));
        if (!hex) {
          res.status(400).json({
            status: 'error',
            code: 'BAD_COLOUR',
            message: 'A brand colour must be a six-digit hex value such as #0F7A5A.',
          });
          return;
        }
        data.brandColour = hex;
      }
    }

    if (b.marking !== undefined) {
      if (!(REPORT_MARKINGS as readonly string[]).includes(str(b.marking))) {
        res.status(400).json({
          status: 'error',
          message: `marking must be one of: ${REPORT_MARKINGS.join(', ')}`,
        });
        return;
      }
      data.marking = normaliseMarking(str(b.marking));
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No changes supplied' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.tenantBranding.upsert({
        where: { tenantId },
        create: { tenantId, ...data, updatedById: str(req.user!.id) },
        update: { ...data, updatedById: str(req.user!.id) },
      });
      await writeAudit(tx, {
        tenantId,
        actorId: str(req.user!.id),
        action: 'TENANT_BRANDING_UPDATED',
        subjectType: 'TenantBranding',
        subjectId: tenantId,
        payload: { changed: Object.keys(data) },
      });
    });

    const after = await brandingFor(tenantId);
    const own = after?.rows.find((r) => r.tenantId === tenantId) || null;

    // A pale corporate colour is a legitimate brand and an illegitimate
    // heading. It is accepted, and the renderer draws text in ink instead —
    // but saying so here is better than the customer discovering it on a
    // report they have already sent to their board.
    const warning = data.brandColour
      && contrastRatio(data.brandColour, PAPER) < MIN_TEXT_CONTRAST
      ? 'That colour is too light to read as text on white, so headings will be '
        + 'drawn in ink. It is still used for rules and on the cover.'
      : null;

    res.json({ status: 'success', branding: shape(own, after?.resolved), warning });
  } catch (error: any) {
    console.error('[Branding Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update branding' });
  }
};

// ─── Logo ───────────────────────────────────────────────────────────────────

/**
 * Store a logo in the private store, never in the public uploads directory.
 *
 * `uploads/` is served by express.static with no authentication and
 * `Access-Control-Allow-Origin: *`, outside the rate limiter. Writing logos
 * there would publish an enumerable list of who the customers are, and customer
 * identity is confidential in this product.
 */
export const uploadLogo = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(str(req.user!.tenantId));
    const tenantId = str(req.params.tenantId || req.user!.tenantId);

    if (!canWriteToTenant(scope, tenantId)) {
      res.status(404).json({ status: 'error', message: 'Organisation not found' });
      return;
    }

    const { fileData, fileName } = req.body || {};
    if (!fileData || !fileName) {
      res.status(400).json({
        status: 'error', message: 'fileData (base64) and fileName are required',
      });
      return;
    }

    let bytes: Buffer;
    try {
      bytes = decodeUpload(str(fileData));
    } catch {
      res.status(400).json({ status: 'error', message: 'fileData is not valid base64' });
      return;
    }

    const head = Array.from(bytes.subarray(0, 8));
    const refusal = checkLogo(head, bytes.length);
    if (refusal) {
      res.status(400).json({ status: 'error', code: refusal.code, message: refusal.message });
      return;
    }

    const stored = putEvidence(bytes);
    const mime = logoType(head)!;

    await prisma.$transaction(async (tx) => {
      await tx.tenantBranding.upsert({
        where: { tenantId },
        create: {
          tenantId,
          logoKey: stored.storageKey,
          logoFileName: str(fileName),
          logoMimeType: mime,
          logoBytes: stored.byteLength,
          logoSha256: stored.sha256,
          updatedById: str(req.user!.id),
        },
        update: {
          logoKey: stored.storageKey,
          logoFileName: str(fileName),
          logoMimeType: mime,
          logoBytes: stored.byteLength,
          logoSha256: stored.sha256,
          updatedById: str(req.user!.id),
        },
      });
      await writeAudit(tx, {
        tenantId,
        actorId: str(req.user!.id),
        action: 'TENANT_LOGO_UPLOADED',
        subjectType: 'TenantBranding',
        subjectId: tenantId,
        payload: { fileName: str(fileName), bytes: stored.byteLength, sha256: stored.sha256 },
      });
    });

    const after = await brandingFor(tenantId);
    const own = after?.rows.find((r) => r.tenantId === tenantId) || null;
    res.status(201).json({ status: 'success', branding: shape(own, after?.resolved) });
  } catch (error: any) {
    console.error('[Logo Upload Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to store the logo' });
  }
};

/** Serve a logo to an authenticated caller who can see the organisation. */
export const getLogo = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(str(req.user!.tenantId));
    const tenantId = str(req.params.tenantId || req.user!.tenantId);

    if (!scope.tenantIds.includes(tenantId)) {
      res.status(404).json({ status: 'error', message: 'Organisation not found' });
      return;
    }

    const row = await prisma.tenantBranding.findUnique({
      where: { tenantId },
      select: { logoKey: true, logoMimeType: true, logoFileName: true },
    });
    if (!row?.logoKey) {
      res.status(404).json({ status: 'error', message: 'No logo set' });
      return;
    }

    const full = resolveEvidencePath(row.logoKey);
    if (!full) { res.status(410).json({ status: 'error', message: 'Logo file is missing' }); return; }

    res.setHeader('Content-Type', row.logoMimeType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(full);
  } catch (error: any) {
    console.error('[Logo Read Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the logo' });
  }
};
