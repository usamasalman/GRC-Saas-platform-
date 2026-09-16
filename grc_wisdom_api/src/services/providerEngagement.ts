/**
 * Naming the organisation that delivers an engagement.
 *
 * Project.providerTenantId was copied out of the request body into the row with
 * no validation of any kind: no existence check, no scope check, no comparison
 * against the client, no mention in the audit entry. The one write site was
 * createProject, and updateProject never assigned it, so the value was also
 * write-once — an engagement created naming the wrong firm stayed that way for
 * the life of the row.
 *
 * That column is not decorative. Through projectAccess it puts the named tenant
 * into projectWhere's OR, makes canReadProject true for its users, and makes
 * sideOf return 'Provider' — which unlocks ten write paths across evidence,
 * clause mapping, impediments, the schedule and the engagement's own framework
 * scope. So a single unvalidated string handed an entire outside organisation
 * read of the client's plan, evidence files and reports, and write over its
 * traceability, with nothing telling either party it had happened.
 *
 * A bogus id did not even fail cleanly: nothing looked the tenant up, so the
 * foreign key rejected the INSERT, Prisma threw inside the transaction, and the
 * caller received 500 "Failed to create project" — indistinguishable from a
 * database outage, with no field named.
 *
 * WHAT THIS CANNOT DO, stated plainly because the alternative is pretending
 * otherwise: nothing in this schema expresses "these two organisations have a
 * commercial relationship". There is no contract, engagement letter, partner
 * agreement or acceptance row between two tenants — the tenant hierarchy and
 * SharedService are both confined to a single subtree, and the partner and
 * franchise ROLES are role names, not relationships. So the check below cannot
 * establish that a client and a consultancy have actually engaged one another.
 * What it can do is refuse the cases that are unambiguously wrong, and make the
 * nomination visible and reversible rather than silent and permanent: the
 * refusals here, an audit entry on BOTH organisations' trails, a notification
 * to the firm being named, and the ability to remove them again.
 *
 * Requiring the named firm to ACCEPT before any access is granted is the
 * complete answer, and it needs a model this schema does not have yet.
 *
 * Pure, and with no Prisma import, so every refusal runs without a database.
 */

/** Organisation types that exist to deliver work for somebody else. */
export const DELIVERY_PARTNER_TYPES = ['PARTNER', 'FRANCHISE'] as const;

export interface ProviderCandidate {
  id: string;
  name: string;
  /** SAAS | SAAS_UNIT | HOLDING | MULTIBRANCH | BRANCH | FRANCHISE | PARTNER */
  type: string;
  suspendedAt: Date | null;
}

export interface ProviderRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export interface ProviderDecision {
  ok: true;
  /** What to store. Null means the engagement is delivered by the client itself. */
  providerTenantId: string | null;
  /** What this act does, for the audit entry and the response. */
  change: 'set' | 'changed' | 'cleared' | 'unchanged';
  /** What the person doing it should be told. Not reasons to refuse. */
  warnings: string[];
}

const isDeliveryPartner = (type: string): boolean =>
  (DELIVERY_PARTNER_TYPES as readonly string[]).includes(String(type));

/**
 * Whether this organisation may be named as the deliverer, and what naming it
 * will mean.
 *
 * Refusals in order of how badly each would go wrong if allowed.
 */
export function planProviderNomination(input: {
  clientTenantId: string;
  /** The id the caller asked for. Null, undefined or empty means "nobody". */
  requested: string | null | undefined;
  /** The row found for that id. Null when no such organisation exists. */
  candidate: ProviderCandidate | null;
  /** What this engagement names today. */
  current: string | null;
  /** Tenants the caller can already see, from resolveTenantScope. */
  callerTenantIds: readonly string[];
  /** A platform operator administering the estate. */
  isPlatform: boolean;
}): ProviderRefusal | ProviderDecision {
  const requested = String(input.requested ?? '').trim();
  const current = input.current ?? null;

  // Removing the provider is always allowed. An engagement the client took back
  // in-house must be able to say so, and refusing to let it would be how an
  // organisation ends up unable to revoke access it granted by mistake.
  if (requested === '') {
    return {
      ok: true,
      providerTenantId: null,
      change: current === null ? 'unchanged' : 'cleared',
      warnings: current === null ? [] : [
        'The organisation that was delivering this engagement loses access to it — its plan, '
        + 'its evidence files and its reports — as soon as this is saved.',
      ],
    };
  }

  if (!input.candidate) {
    return {
      ok: false,
      status: 400,
      code: 'PROVIDER_NOT_FOUND',
      message: 'No organisation with that id exists, so it cannot be named as the deliverer '
        + 'of this engagement. This used to be accepted and fail in the database as a 500.',
    };
  }

  const p = input.candidate;

  // The same organisation on both sides is not a consultant-led engagement; it
  // is one row contradicting itself. sideOf resolves the tie to 'Client', so
  // nobody can ever be provider-side, while hasProvider stays true and the
  // exported reports name the client as its own independent deliverer.
  if (p.id === input.clientTenantId) {
    return {
      ok: false,
      status: 400,
      code: 'PROVIDER_IS_CLIENT',
      message: `${p.name} owns this engagement, so it cannot also be the outside firm `
        + 'delivering it. Leave the deliverer empty for a programme an organisation runs '
        + 'itself — that is the ordinary case, and the reports say so.',
    };
  }

  if (p.suspendedAt !== null) {
    return {
      ok: false,
      status: 409,
      code: 'PROVIDER_SUSPENDED',
      message: `${p.name} is suspended, so none of its people can sign in. Naming it would put `
        + 'it on every report as the deliverer of work nobody there can do.',
    };
  }

  // The relationship rule. See the header for what it can and cannot establish.
  const withinReach = input.callerTenantIds.includes(p.id);
  if (!input.isPlatform && !withinReach && !isDeliveryPartner(p.type)) {
    return {
      ok: false,
      status: 403,
      code: 'PROVIDER_NOT_ENGAGEABLE',
      message: `${p.name} is not an organisation this engagement can be delivered by. A `
        + 'deliverer is either part of your own group, or a firm registered on this platform '
        + 'to deliver work for others. Naming an unrelated customer would hand them your plan, '
        + 'your evidence and your reports.',
    };
  }

  const change: ProviderDecision['change'] = current === p.id
    ? 'unchanged'
    : current === null ? 'set' : 'changed';

  const warnings: string[] = [];

  if (change !== 'unchanged') {
    // Said plainly, because this is the sentence that would have prevented the
    // whole defect: the person doing it rarely knows how much it grants.
    warnings.push(
      `${p.name} will be able to read this engagement in full — the plan, the evidence files, `
      + 'the impediments and every exported report — and to upload evidence, map work to '
      + 'clauses, raise and clear blockers, change the schedule and change which frameworks '
      + 'the engagement is run against.',
    );
    warnings.push(
      'They are told that they have been named, the act is recorded on both organisations\' '
      + 'audit trails, and you can remove them again at any time.',
    );
  }

  if (change === 'changed') {
    warnings.push(
      'The organisation named before loses its access as soon as this is saved. Anything it '
      + 'already uploaded stays on the engagement, which is the point of keeping a record.',
    );
  }

  if (!withinReach && !isDeliveryPartner(p.type) && input.isPlatform) {
    warnings.push(
      `${p.name} is a customer organisation rather than a delivery firm. As a platform `
      + 'operator you may name it, and this entry will show that you did.',
    );
  }

  return { ok: true, providerTenantId: p.id, change, warnings };
}

/**
 * Whether an organisation can be hard-deleted, as far as delivery work goes.
 *
 * deleteTenant counted users, children, documents and invoices and stopped
 * there. A tenant delivering live engagements but holding none of those four
 * could be deleted outright — and because the foreign key is ON DELETE SET
 * NULL, every engagement it was delivering silently lost its provider. No
 * error, no log line, no audit entry: the column simply became null and every
 * reader took its "no provider" branch. Three of the five exported reports then
 * printed "Delivered by: The organisation itself", which is not a blank but an
 * affirmative false statement, while the impediments on the same engagement
 * kept exporting as "Owed by: Provider".
 */
export function deliveryBlocksDeletion(counts: {
  projects: number;
  projectsDelivered: number;
}): string | null {
  const parts: string[] = [];
  if (counts.projects > 0) {
    parts.push(`${counts.projects} delivery project(s) of its own`);
  }
  if (counts.projectsDelivered > 0) {
    parts.push(`${counts.projectsDelivered} engagement(s) it delivers for others`);
  }
  if (parts.length === 0) return null;
  return `This organisation still has ${parts.join(' and ')}. Deleting it would silently `
    + 'remove it as the deliverer of that work, and the reports would then say the client '
    + 'delivered it themselves.';
}
