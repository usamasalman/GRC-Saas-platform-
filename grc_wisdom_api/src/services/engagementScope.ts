import { prisma } from '../db';
import { CLASSIFICATIONS, classificationRank } from './documentAccess';
import { hierarchyOf } from './scopeResolver';
import { DAY_MS } from './engagementRules';

/**
 * What an engagement shares with its delivery firm (consulting engagement,
 * sprint 6).
 *
 * Scope is rules, not lists: the organisations in the client's own hierarchy,
 * the frameworks, the registers (services), a classification ceiling and
 * dates. It is versioned like risk appetite: drafted, approved by a second
 * person of the organisation, then binding until a newer version is approved.
 * The records a firm may see are worked out from the binding version on each
 * request, so a scope never goes stale as the client adds or reclassifies
 * records, and nothing outside it is ever reachable.
 */

/** The registers a scope may share. */
export const SCOPE_SERVICES = ['Documents', 'Controls', 'Risks', 'Assets', 'Vendors'] as const;
export type ScopeService = (typeof SCOPE_SERVICES)[number];

/**
 * Never part of an engagement's scope, whatever is asked: a consulting firm
 * gets no Audit Programme rights (independence) and no view of billing.
 */
export const NEVER_SHARED = ['AuditProgramme', 'Billing'] as const;

export type ScopeStatus = 'Draft' | 'Binding' | 'Superseded' | 'Discarded';

export interface Scope {
  id: string;
  version: number;
  status: string;
  entityIds: string[];
  frameworkIds: string[];
  services: string[];
  classificationCeiling: string;
  validFrom: Date | null;
  validTo: Date | null;
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map((x) => String(x ?? '').trim()).filter(Boolean))] : []);
const fromJson = (s: string | null | undefined): string[] => {
  try { return asList(JSON.parse(String(s ?? '[]'))); } catch { return []; }
};

export function readScope(row: {
  id: string; version: number; status: string; entityIds: string; frameworkIds: string; services: string;
  classificationCeiling: string; validFrom: Date | null; validTo: Date | null;
}): Scope {
  return {
    id: row.id, version: row.version, status: row.status,
    entityIds: fromJson(row.entityIds), frameworkIds: fromJson(row.frameworkIds), services: fromJson(row.services),
    classificationCeiling: row.classificationCeiling, validFrom: row.validFrom, validTo: row.validTo,
  };
}

export interface ScopeDraft {
  entityIds: string[];
  frameworkIds: string[];
  services: string[];
  classificationCeiling: string;
  validFrom: Date | null;
  validTo: Date | null;
  note: string | null;
}

type Checked = { ok: true; value: ScopeDraft } | { ok: false; code: string; message: string };

const parseDate = (v: unknown): Date | null | 'bad' => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? 'bad' : d;
};

/**
 * A draft checked against the client's own hierarchy and frameworks. Every
 * refusal says what to change; nothing outside the client's estate, and
 * neither Audit Programme nor Billing, can be put in a scope.
 */
export async function checkScopeDraft(clientTenantId: string, body: any): Promise<Checked> {
  const services = asList(body?.services);
  const never = services.filter((s) => (NEVER_SHARED as readonly string[]).includes(s));
  if (never.length > 0) {
    return { ok: false, code: 'NEVER_SHARED', message: 'Audit Programme and Billing are never shared with a consulting firm.' };
  }
  const unknown = services.filter((s) => !(SCOPE_SERVICES as readonly string[]).includes(s));
  if (unknown.length > 0) {
    return { ok: false, code: 'UNKNOWN_SERVICE', message: `Registers that can be shared: ${SCOPE_SERVICES.join(', ')}.` };
  }
  const ceiling = String(body?.classificationCeiling ?? 'Internal');
  if (!(CLASSIFICATIONS as readonly string[]).includes(ceiling)) {
    return { ok: false, code: 'BAD_CEILING', message: `The ceiling is one of ${CLASSIFICATIONS.join(', ')}.` };
  }
  const entityIds = asList(body?.entityIds);
  if (entityIds.length === 0) {
    return { ok: false, code: 'NO_ENTITIES', message: 'Choose at least one organisation in scope.' };
  }
  const hierarchy = new Set(await hierarchyOf(clientTenantId));
  if (entityIds.some((id) => !hierarchy.has(id))) {
    return { ok: false, code: 'OUTSIDE_HIERARCHY', message: 'A scope reaches only the organisation and the entities beneath it.' };
  }
  const frameworkIds = asList(body?.frameworkIds);
  if (frameworkIds.length > 0) {
    const enabled = await prisma.tenantStandardEnablement.findMany({
      where: { tenantId: { in: entityIds }, standardId: { in: frameworkIds } },
      select: { standardId: true },
    });
    const ok = new Set(enabled.map((e) => e.standardId));
    if (frameworkIds.some((id) => !ok.has(id))) {
      return { ok: false, code: 'FRAMEWORK_NOT_ENABLED', message: 'Choose frameworks enabled for the organisations in scope.' };
    }
  }
  const validFrom = parseDate(body?.validFrom);
  const validTo = parseDate(body?.validTo);
  if (validFrom === 'bad' || validTo === 'bad') return { ok: false, code: 'BAD_DATE', message: 'Give valid dates.' };
  if (validFrom && validTo && validTo.getTime() + DAY_MS <= validFrom.getTime()) {
    return { ok: false, code: 'BAD_DATE', message: 'The scope must end on or after it starts.' };
  }
  const note = body?.note ? String(body.note).trim().slice(0, 500) : null;
  return { ok: true, value: { entityIds, frameworkIds, services, classificationCeiling: ceiling, validFrom, validTo, note } };
}

const SCOPE_SELECT = {
  id: true, version: true, status: true, entityIds: true, frameworkIds: true, services: true,
  classificationCeiling: true, validFrom: true, validTo: true,
} as const;

/** The version binding now, if the organisation has approved one. */
export async function bindingScope(projectId: string): Promise<Scope | null> {
  const row = await prisma.engagementScopeVersion.findFirst({
    where: { projectId, status: 'Binding' }, orderBy: { version: 'desc' }, select: SCOPE_SELECT,
  });
  return row ? readScope(row) : null;
}

/** The classifications at or below a ceiling, as stored. */
export const classificationsUpTo = (ceiling: string): string[] => CLASSIFICATIONS.slice(0, classificationRank(ceiling) + 1);

/**
 * What a scope lets the firm see of one register now: the organisations and
 * the classifications, or null when the register is not shared or the scope
 * is outside its dates (the end date counts in full).
 */
export function registerScope(scope: Scope | null, service: ScopeService, now: Date = new Date()): { tenantIds: string[]; classifications: string[] } | null {
  if (!scope || !scope.services.includes(service)) return null;
  if (scope.validFrom && now.getTime() < scope.validFrom.getTime()) return null;
  if (scope.validTo && now.getTime() >= scope.validTo.getTime() + DAY_MS) return null;
  return { tenantIds: scope.entityIds, classifications: classificationsUpTo(scope.classificationCeiling) };
}
