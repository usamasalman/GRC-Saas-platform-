import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from '../services/notificationService';
import { firmAccess, FirmAccess } from '../services/engagementFirmAccess';
import { bindingScope, registerScope, Scope } from '../services/engagementScope';
import { roleMay, roleRefusal } from '../services/engagementRules';
import { isEnded } from '../services/engagementAfterClose';
import { scoreOf, computeResidual, nextReviewFrom } from '../services/riskScoring';
import { computeCriticality } from '../services/assetRiskScoring';
import { evaluateAppetite } from '../services/riskThresholds';
import {
  checkChallenge, checkDecision, checkProposal, scoresAfter, challengeRef, proposalRef, STATUS_OF,
  Kind, RiskScores, AssetScores,
} from '../services/registerChallenges';
import { CATEGORIES } from './riskController';
import { str, send, notFound, loadEngagement, clientSide, flagFor, HELD_READ_ONLY, Engagement } from './engagementController';

/**
 * Risk and asset challenges, proposed risks and assets, and the firm's
 * drafts of risk appetite (consulting engagement, sprint 11).
 *
 * Everything works on the risks and assets the binding scope shares, and
 * only while it shares them. The firm's Lead and Consultants challenge and
 * propose; the owner of a risk or asset decides its challenges, alone or
 * many at once; the project manager or owner accepts a proposal into the
 * register. No figure in the product reads a challenge or a proposal: the
 * register's own scores stand until a decision writes new ones, and the
 * history keeps both.
 */

type Access =
  | { ok: true; e: Engagement; side: 'Client'; userId: string; leads: boolean; scope: Scope | null }
  | { ok: true; e: Engagement; side: 'Provider'; userId: string; firm: FirmAccess; scope: Scope | null }
  | { ok: false; status: number; code?: string; message: string };

async function access(req: AuthenticatedRequest): Promise<Access> {
  const e = await loadEngagement(str(req.params.projectId));
  const userId = str(req.user!.id);
  if (!e) return { ok: false, status: 404, message: 'Engagement not found' };
  if (await clientSide(req, e)) {
    const refusal = await flagFor(e);
    if (refusal) return { ok: false, ...refusal };
    return { ok: true, e, side: 'Client', userId, leads: e.managerId === userId || e.ownerId === userId, scope: await bindingScope(e.id) };
  }
  if (e.providerTenantId && e.providerTenantId === req.user!.tenantId) {
    const firm = await firmAccess(e, userId);
    if (firm.reads) {
      const refusal = await flagFor(e);
      if (refusal) return { ok: false, ...refusal };
      return { ok: true, e, side: 'Provider', userId, firm, scope: await bindingScope(e.id) };
    }
  }
  return { ok: false, status: 404, message: 'Engagement not found' };
}
type Ok = Extract<Access, { ok: true }>;

function firmRefusal(a: Ok): { status: number; code?: string; message: string } | null {
  if (a.side !== 'Provider') return { status: 403, code: 'FIRM_ACTS', message: 'Only the delivery firm does this.' };
  if (!roleMay(a.firm.role, 'assess')) return roleRefusal(a.firm.role, 'assess');
  if (!a.firm.acts) {
    if (a.e.status === 'OnHold') return HELD_READ_ONLY;
    if (isEnded(a.e.status)) return { status: 409, code: 'ENGAGEMENT_ENDED', message: `This engagement is ${a.e.status}.` };
    return { status: 403, code: 'OUTSIDE_ACCESS', message: 'Your access to this engagement is not open today.' };
  }
  return null;
}

async function bothTrails(tx: any, a: Ok, args: { action: string; subjectType: string; subjectId: string; payload: Record<string, unknown> }) {
  await writeAudit(tx, {
    tenantId: a.e.tenantId, actorId: a.userId, action: args.action, subjectType: args.subjectType, subjectId: args.subjectId,
    payload: { projectRef: a.e.ref, projectId: a.e.id, ...args.payload },
  });
  if (a.e.providerTenantId && a.e.providerTenantId !== a.e.tenantId) {
    await writeAudit(tx, {
      tenantId: a.e.providerTenantId, actorId: a.userId, action: args.action, subjectType: args.subjectType, subjectId: args.subjectId,
      payload: { projectRef: a.e.ref, clientTenantId: a.e.tenantId, ...args.payload },
    });
  }
}

const kindOf = (v: unknown): Kind | null => (v === 'Risk' || v === 'Asset' ? v : null);
const regFor = (a: Ok, kind: Kind) => registerScope(a.scope, kind === 'Risk' ? 'Risks' : 'Assets');
const riskScores = (r: { inherentLikelihood: number; inherentImpact: number }): RiskScores => ({ likelihood: r.inherentLikelihood, impact: r.inherentImpact });
const assetScores = (x: { confidentiality: number; integrity: number; availability: number }): AssetScores => ({ confidentiality: x.confidentiality, integrity: x.integrity, availability: x.availability });
const parse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** The appetite in force for each category of each organisation, for the tolerance band the screen shows. */
async function appetitesFor(tenantIds: string[]) {
  const rows = await prisma.riskAppetite.findMany({
    where: { tenantId: { in: tenantIds }, status: 'Approved', effectiveTo: null },
    select: { tenantId: true, category: true, appetiteThreshold: true, toleranceThreshold: true },
  });
  return (tenantId: string, category: string) => rows.find((r) => r.tenantId === tenantId && r.category === category) ?? null;
}

// ─── The comparison ─────────────────────────────────────────────────────────

/**
 * GET /api/engagements/:projectId/challenges?kind=Risk|Asset — the whole
 * in-scope register beside its open challenges: the register's scores, the
 * scores proposed, and what deciding would do to the tolerance band.
 */
export const listChallenges = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const kind = kindOf(req.query.kind || 'Risk');
    if (!kind) { send(res, { status: 400, message: 'Ask for Risk or Asset.' }); return; }
    const reg = regFor(a, kind);
    if (!reg) { res.json({ status: 'success', side: a.side, kind, shared: false, rows: [], can: { raise: false } }); return; }
    const challenges = await prisma.registerChallenge.findMany({
      where: { projectId: a.e.id, kind }, orderBy: { raisedAt: 'desc' }, skip: 0, take: 2000,
      select: {
        id: true, ref: true, riskId: true, assetId: true, scoresBefore: true, scoresProposed: true, scoresAfter: true, reason: true,
        restingLabel: true, status: true, raisedAt: true, decidedAt: true, decisionReason: true,
        raisedBy: { select: { name: true } }, decidedBy: { select: { name: true } },
      },
    });
    const shape = (c: (typeof challenges)[number]) => ({
      ...c, scoresBefore: parse(c.scoresBefore), scoresProposed: parse(c.scoresProposed), scoresAfter: parse(c.scoresAfter),
    });
    if (kind === 'Risk') {
      const [risks, appetite] = await Promise.all([
        prisma.risk.findMany({
          where: { tenantId: { in: reg.tenantIds } }, orderBy: [{ residualScore: 'desc' }, { ref: 'asc' }], skip: 0, take: 1000,
          select: {
            id: true, ref: true, title: true, category: true, tenantId: true, status: true, ownerId: true, owner: { select: { name: true } },
            inherentLikelihood: true, inherentImpact: true, inherentScore: true, residualScore: true,
          },
        }),
        appetitesFor(reg.tenantIds),
      ]);
      const rows = await Promise.all(risks.map(async (r) => {
        const ap = appetite(r.tenantId, r.category);
        const open = challenges.find((c) => c.riskId === r.id && c.status === 'Open');
        const proposed = open ? parse(open.scoresProposed) as RiskScores | null : null;
        // What adopting would do: the residual follows from the risk's verified controls, as it always does.
        const would = proposed ? await computeResidual(prisma, r.id, proposed.likelihood, proposed.impact) : null;
        return {
          id: r.id, ref: r.ref, title: r.title, category: r.category, owner: r.owner?.name ?? null, mine: r.ownerId === a.userId,
          scores: riskScores(r), inherentScore: r.inherentScore, residualScore: r.residualScore,
          band: ap ? evaluateAppetite(r.residualScore, ap) : null, tolerance: ap?.toleranceThreshold ?? null,
          open: open ? {
            ...shape(open), proposedScore: proposed ? proposed.likelihood * proposed.impact : null,
            wouldBe: would ? { residualScore: would.residualScore, band: ap ? evaluateAppetite(would.residualScore, ap) : null } : null,
          } : null,
          decided: challenges.filter((c) => c.riskId === r.id && c.status !== 'Open').map(shape),
        };
      }));
      res.json({ status: 'success', side: a.side, kind, shared: true, rows, can: { raise: !firmRefusal(a) } });
      return;
    }
    const assets = await prisma.asset.findMany({
      where: { tenantId: { in: reg.tenantIds }, classification: { in: reg.classifications } }, orderBy: [{ criticality: 'desc' }, { ref: 'asc' }], skip: 0, take: 1000,
      select: { id: true, ref: true, name: true, ownerId: true, owner: { select: { name: true } }, confidentiality: true, integrity: true, availability: true, criticality: true, criticalityTier: true },
    });
    const rows = assets.map((x) => {
      const open = challenges.find((c) => c.assetId === x.id && c.status === 'Open');
      return {
        id: x.id, ref: x.ref, title: x.name, owner: x.owner?.name ?? null, mine: x.ownerId === a.userId,
        scores: assetScores(x), criticality: x.criticality, tier: x.criticalityTier,
        open: open ? shape(open) : null,
        decided: challenges.filter((c) => c.assetId === x.id && c.status !== 'Open').map(shape),
      };
    });
    res.json({ status: 'success', side: a.side, kind, shared: true, rows, can: { raise: !firmRefusal(a) } });
  } catch (error: any) {
    console.error('[Challenges Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the challenges' });
  }
};

/**
 * POST /api/engagements/:projectId/challenges { kind, targetId, likelihood, impact | confidentiality, integrity, availability, reason, restingAssetId?, restingControlId? }
 */
export const raiseChallenge = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const no = firmRefusal(a);
    if (no) { send(res, no); return; }
    const b = req.body || {};
    const kind = kindOf(b.kind);
    if (!kind) { send(res, { status: 400, message: 'A challenge is to a Risk or an Asset.' }); return; }
    const reg = regFor(a, kind);
    const targetId = str(b.targetId);
    const target = !reg ? null : kind === 'Risk'
      ? await prisma.risk.findFirst({ where: { id: targetId, tenantId: { in: reg.tenantIds } }, select: { id: true, ref: true, title: true, tenantId: true, ownerId: true, owner: { select: { tenantId: true } }, inherentLikelihood: true, inherentImpact: true } })
      : await prisma.asset.findFirst({ where: { id: targetId, tenantId: { in: reg.tenantIds }, classification: { in: reg.classifications } }, select: { id: true, ref: true, name: true, tenantId: true, ownerId: true, owner: { select: { tenantId: true } }, confidentiality: true, integrity: true, availability: true } });
    if (!target) { notFound(res, kind); return; }
    const current = kind === 'Risk' ? riskScores(target as any) : assetScores(target as any);
    const checked = checkChallenge(kind, b, current);
    if (!checked.ok) { send(res, checked); return; }
    // What it rests on, if anything: an asset or a control of that organisation.
    let restingLabel: string | null = null;
    const restingAssetId = str(b.restingAssetId) || null;
    const restingControlId = str(b.restingControlId) || null;
    if (restingAssetId) {
      const ra = await prisma.asset.findFirst({ where: { id: restingAssetId, tenantId: target.tenantId }, select: { ref: true, name: true } });
      if (!ra) { notFound(res, 'Asset'); return; }
      restingLabel = `${ra.ref} ${ra.name}`;
    } else if (restingControlId) {
      const rc = await prisma.controlImplementation.findFirst({ where: { id: restingControlId, tenantId: target.tenantId }, select: { control: { select: { code: true, title: true } } } });
      if (!rc) { notFound(res, 'Control'); return; }
      restingLabel = `${rc.control.code} ${rc.control.title}`;
    }
    const label = 'title' in target ? `${target.ref} ${target.title}` : `${target.ref} ${(target as any).name}`;
    const made = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`challenges:${a.e.id}`}))`;
      const already = await tx.registerChallenge.findFirst({ where: { projectId: a.e.id, status: 'Open', ...(kind === 'Risk' ? { riskId: target.id } : { assetId: target.id }) }, select: { ref: true } });
      if (already) throw Object.assign(new Error('open'), { code: 'ALREADY_CHALLENGED', ref: already.ref });
      const ref = challengeRef((await tx.registerChallenge.count({ where: { projectId: a.e.id } })) + 1);
      const row = await tx.registerChallenge.create({
        data: {
          projectId: a.e.id, ref, tenantId: target.tenantId, kind, ...(kind === 'Risk' ? { riskId: target.id } : { assetId: target.id }),
          scoresBefore: JSON.stringify(current), scoresProposed: JSON.stringify(checked.scores), reason: checked.reason,
          restingAssetId, restingControlId, restingLabel, raisedById: a.userId,
        },
        select: { id: true, ref: true },
      });
      await bothTrails(tx, a, {
        action: 'ENGAGEMENT_CHALLENGE_RAISED', subjectType: kind, subjectId: target.id,
        payload: { ref, target: label, before: current, proposed: checked.scores },
      });
      await notify(tx, [{
        tenantId: target.owner.tenantId, recipientId: target.ownerId, actorId: a.userId, event: 'ENGAGEMENT_CHALLENGE_RAISED',
        subjectType: 'RegisterChallenge', subjectId: row.id, title: `${ref}: the firm challenges the scores of ${label}`, body: checked.reason.slice(0, 300), link: 'my-work',
      }]);
      return row;
    });
    res.status(201).json({ status: 'success', challenge: made });
  } catch (error: any) {
    if (error?.code === 'ALREADY_CHALLENGED') { send(res, { status: 409, code: 'ALREADY_CHALLENGED', message: `${error.ref} is still open on this record. Withdraw it first.` }); return; }
    console.error('[Challenge Raise Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to raise the challenge' });
  }
};

/**
 * POST /api/engagements/:projectId/challenges/decide { ids, decision: Adopt | Keep | Adjust, reason?, scores for Adjust }
 *
 * By the owner of every record decided, all or none. Adopt and Adjust write
 * the new scores to the register (a risk's residual follows from its
 * verified controls, as always) and to its history; Keep writes nothing to
 * the register and the reason goes to the firm.
 */
export const decideChallenges = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    if (a.side !== 'Client') { send(res, { status: 403, code: 'OWNER_DECIDES', message: 'The owner of the risk or asset decides.' }); return; }
    if (isEnded(a.e.status)) { send(res, { status: 409, code: 'ENGAGEMENT_ENDED', message: `This engagement is ${a.e.status}.` }); return; }
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).filter(Boolean))] as string[];
    if (!ids.length || ids.length > 200) { send(res, { status: 400, message: 'Choose between 1 and 200 challenges.' }); return; }
    const found = await prisma.registerChallenge.findMany({
      where: { id: { in: ids }, projectId: a.e.id },
      select: {
        id: true, ref: true, kind: true, status: true, riskId: true, assetId: true, scoresProposed: true, scoresBefore: true, raisedById: true,
        raisedBy: { select: { tenantId: true } },
        risk: { select: { id: true, ref: true, ownerId: true, tenantId: true, reviewCadenceMonths: true } },
        asset: { select: { id: true, ref: true, ownerId: true, tenantId: true } },
      },
    });
    if (found.length !== ids.length) { notFound(res, 'Challenge'); return; }
    const kinds = new Set(found.map((c) => c.kind));
    if (kinds.size !== 1) { send(res, { status: 400, message: 'Decide risks and assets separately.' }); return; }
    const kind = found[0].kind as Kind;
    const checked = checkDecision(kind, req.body);
    if (!checked.ok) { send(res, checked); return; }
    if (checked.decision === 'Adjust' && ids.length > 1) { send(res, { status: 400, code: 'ONE_AT_A_TIME', message: 'Adjust one record at a time: the scores are its own.' }); return; }
    const notOpen = found.filter((c) => c.status !== 'Open');
    if (notOpen.length) { send(res, { status: 409, code: 'DECIDED', message: `${notOpen.map((c) => c.ref).join(', ')} already decided or withdrawn.` }); return; }
    const notOwner = found.filter((c) => (c.risk?.ownerId ?? c.asset?.ownerId) !== a.userId);
    if (notOwner.length) {
      send(res, { status: 403, code: 'OWNER_DECIDES', message: `Only the owner decides ${notOwner.map((c) => c.ref).join(', ')}.` }); return;
    }
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      for (const c of found) {
        const proposed = parse(c.scoresProposed);
        const after = scoresAfter(checked.decision, proposed, checked.adjusted);
        const moved = await tx.registerChallenge.updateMany({
          where: { id: c.id, status: 'Open' },
          data: {
            status: STATUS_OF[checked.decision], decidedById: a.userId, decidedAt: now, decisionReason: checked.reason,
            scoresAfter: after ? JSON.stringify(after) : null,
          },
        });
        if (moved.count === 0) throw Object.assign(new Error('decided'), { code: 'DECIDED' });
        if (after && c.risk) {
          const s = after as RiskScores;
          const { l, i, score } = scoreOf(s.likelihood, s.impact);
          const residual = await computeResidual(tx, c.risk.id, l, i);
          const u = await tx.risk.update({
            where: { id: c.risk.id },
            data: {
              inherentLikelihood: l, inherentImpact: i, inherentScore: score, ...residual,
              lastReviewedAt: now, nextReviewDate: nextReviewFrom(c.risk.reviewCadenceMonths),
            },
          });
          await tx.riskScoreSnapshot.create({
            data: { tenantId: c.risk.tenantId, riskId: c.risk.id, score: u.residualScore, inherentScore: u.inherentScore, residualScore: u.residualScore, reason: `Challenge ${c.ref} ${STATUS_OF[checked.decision].toLowerCase()}` },
          });
          await writeAudit(tx, {
            tenantId: c.risk.tenantId, actorId: a.userId, action: 'RISK_UPDATED', subjectType: 'Risk', subjectId: c.risk.id,
            payload: { via: `${a.e.ref}/${c.ref}`, before: parse(c.scoresBefore), after: { likelihood: l, impact: i, inherentScore: score, residualScore: u.residualScore } },
          });
        } else if (after && c.asset) {
          const s = after as AssetScores;
          const crit = computeCriticality(s);
          await tx.asset.update({ where: { id: c.asset.id }, data: { ...s, ...crit, lastReviewedAt: now } });
          await writeAudit(tx, {
            tenantId: c.asset.tenantId, actorId: a.userId, action: 'ASSET_UPDATED', subjectType: 'Asset', subjectId: c.asset.id,
            payload: { via: `${a.e.ref}/${c.ref}`, before: parse(c.scoresBefore), after: { ...s, ...crit } },
          });
        }
        await bothTrails(tx, a, {
          action: 'ENGAGEMENT_CHALLENGE_DECIDED', subjectType: kind, subjectId: (c.risk?.id ?? c.asset?.id)!,
          payload: { ref: c.ref, decision: checked.decision, before: parse(c.scoresBefore), proposed, after, reason: checked.reason },
        });
        await notify(tx, [{
          tenantId: c.raisedBy.tenantId, recipientId: c.raisedById, actorId: a.userId, event: 'ENGAGEMENT_CHALLENGE_DECIDED',
          subjectType: 'RegisterChallenge', subjectId: c.id, title: `${c.ref} ${STATUS_OF[checked.decision].toLowerCase()} on ${c.risk?.ref ?? c.asset?.ref}`,
          body: checked.reason ?? '', link: 'project-delivery',
        }]);
      }
    });
    res.json({ status: 'success', decided: found.length });
  } catch (error: any) {
    if (error?.code === 'DECIDED') { send(res, { status: 409, code: 'DECIDED', message: 'One of those has just been decided. Reload.' }); return; }
    console.error('[Challenge Decide Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to decide the challenges' });
  }
};

/** POST /api/engagements/:projectId/challenges/:challengeId/withdraw { reason } — by whoever raised it, or the firm's Lead. */
export const withdrawChallenge = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const no = firmRefusal(a);
    if (no) { send(res, no); return; }
    const c = await prisma.registerChallenge.findFirst({ where: { id: str(req.params.challengeId), projectId: a.e.id }, select: { id: true, ref: true, status: true, raisedById: true, riskId: true, assetId: true, kind: true } });
    if (!c) { notFound(res, 'Challenge'); return; }
    if (a.side === 'Provider' && c.raisedById !== a.userId && a.firm.role !== 'Lead') {
      send(res, { status: 403, code: 'NOT_YOURS', message: 'Whoever raised it, or the firm\'s Lead, withdraws it.' }); return;
    }
    const reason = str(req.body?.reason).trim();
    if (reason.length < 10) { send(res, { status: 400, code: 'REASON_REQUIRED', message: 'Say why, in at least 10 characters.' }); return; }
    if (c.status !== 'Open') { send(res, { status: 409, code: 'DECIDED', message: `${c.ref} is ${c.status.toLowerCase()}.` }); return; }
    await prisma.$transaction(async (tx) => {
      await tx.registerChallenge.update({ where: { id: c.id }, data: { status: 'Withdrawn', decidedById: a.userId, decidedAt: new Date(), decisionReason: reason } });
      await bothTrails(tx, a, { action: 'ENGAGEMENT_CHALLENGE_WITHDRAWN', subjectType: c.kind, subjectId: (c.riskId ?? c.assetId)!, payload: { ref: c.ref, reason } });
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    console.error('[Challenge Withdraw Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to withdraw the challenge' });
  }
};

/** GET /api/engagements/challenges/mine — open challenges on the risks and assets the caller owns, for My Work. */
export const myChallenges = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = str(req.user!.id);
    const rows = await prisma.registerChallenge.findMany({
      where: { status: 'Open', OR: [{ risk: { ownerId: userId } }, { asset: { ownerId: userId } }] },
      orderBy: { raisedAt: 'asc' }, skip: 0, take: 200,
      select: {
        id: true, ref: true, kind: true, scoresBefore: true, scoresProposed: true, reason: true, raisedAt: true,
        raisedBy: { select: { name: true } }, project: { select: { id: true, ref: true, name: true } },
        risk: { select: { ref: true, title: true } }, asset: { select: { ref: true, name: true } },
      },
    });
    res.json({
      status: 'success',
      challenges: rows.map((c) => ({ ...c, scoresBefore: parse(c.scoresBefore), scoresProposed: parse(c.scoresProposed), target: c.risk ? `${c.risk.ref} ${c.risk.title}` : `${c.asset?.ref} ${c.asset?.name}` })),
    });
  } catch (error: any) {
    console.error('[My Challenges Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load your challenges' });
  }
};

// ─── Proposed risks and assets ──────────────────────────────────────────────

/** GET /api/engagements/:projectId/proposals — every proposal on this engagement and what became of it. */
export const listProposals = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const rows = await prisma.registerProposal.findMany({
      where: { projectId: a.e.id }, orderBy: { createdAt: 'desc' }, skip: 0, take: 500,
      select: {
        id: true, ref: true, tenantId: true, kind: true, title: true, description: true, reason: true, category: true,
        likelihood: true, impact: true, confidentiality: true, integrity: true, availability: true, status: true, createdAt: true,
        decidedAt: true, decisionNote: true, riskId: true, assetId: true, proposedBy: { select: { name: true } }, decidedBy: { select: { name: true } },
      },
    });
    res.json({ status: 'success', side: a.side, proposals: rows, categories: CATEGORIES, can: { propose: !firmRefusal(a), decide: a.side === 'Client' && a.leads && !isEnded(a.e.status) } });
  } catch (error: any) {
    console.error('[Proposals Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the proposals' });
  }
};

/** POST /api/engagements/:projectId/proposals { kind, tenantId, title, description?, reason, category | type, scores } */
export const proposeRecord = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const no = firmRefusal(a);
    if (no) { send(res, no); return; }
    const kind = kindOf(req.body?.kind);
    if (!kind) { send(res, { status: 400, message: 'Propose a Risk or an Asset.' }); return; }
    const reg = regFor(a, kind);
    const tenantId = str(req.body?.tenantId);
    if (!reg || !reg.tenantIds.includes(tenantId)) { notFound(res, 'Register'); return; }
    const checked = checkProposal(kind, req.body);
    if (!checked.ok) { send(res, checked); return; }
    const v = checked.value;
    if (kind === 'Risk' && !CATEGORIES.includes(v.category)) { send(res, { status: 400, code: 'BAD_CATEGORY', message: `A risk is ${CATEGORIES.join(', ')}.` }); return; }
    const made = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`proposals:${a.e.id}`}))`;
      const ref = proposalRef((await tx.registerProposal.count({ where: { projectId: a.e.id } })) + 1);
      const row = await tx.registerProposal.create({
        data: {
          projectId: a.e.id, ref, tenantId, kind, title: v.title, description: v.description, reason: v.reason,
          category: kind === 'Risk' ? v.category : v.type,
          likelihood: v.likelihood ?? null, impact: v.impact ?? null,
          confidentiality: v.confidentiality ?? null, integrity: v.integrity ?? null, availability: v.availability ?? null,
          proposedById: a.userId,
        },
        select: { id: true, ref: true, status: true },
      });
      await bothTrails(tx, a, { action: 'ENGAGEMENT_RECORD_PROPOSED', subjectType: 'RegisterProposal', subjectId: row.id, payload: { ref, kind, title: v.title, tenantId } });
      const leads = [...new Set([a.e.managerId, a.e.ownerId].filter(Boolean) as string[])];
      await notify(tx, leads.map((recipientId) => ({
        tenantId: a.e.tenantId, recipientId, actorId: a.userId, event: 'ENGAGEMENT_RECORD_PROPOSED', subjectType: 'RegisterProposal', subjectId: row.id,
        title: `${ref}: the firm proposes a ${kind.toLowerCase()}`, body: v.title, link: 'project-delivery',
      })));
      return row;
    });
    res.status(201).json({ status: 'success', proposal: made });
  } catch (error: any) {
    console.error('[Propose Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record the proposal' });
  }
};

/**
 * POST /api/engagements/:projectId/proposals/:proposalId/decide { decision: Accepted | Rejected, note?, ownerId? }
 *
 * Accepted, it enters the register as an ordinary risk or asset with its own
 * reference, owned by the person named (an active person of that
 * organisation) or by whoever accepts it.
 */
export const decideProposal = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    if (a.side !== 'Client' || !a.leads) { send(res, { status: 403, code: 'ORGANISATION_DECIDES', message: 'The project manager or owner accepts or rejects a proposal.' }); return; }
    if (isEnded(a.e.status)) { send(res, { status: 409, code: 'ENGAGEMENT_ENDED', message: `This engagement is ${a.e.status}.` }); return; }
    const p = await prisma.registerProposal.findFirst({ where: { id: str(req.params.proposalId), projectId: a.e.id }, select: { id: true, ref: true, kind: true, tenantId: true, title: true, description: true, reason: true, category: true, likelihood: true, impact: true, confidentiality: true, integrity: true, availability: true, status: true, proposedById: true, proposedBy: { select: { tenantId: true } } } });
    if (!p) { notFound(res, 'Proposal'); return; }
    if (p.status !== 'Proposed') { send(res, { status: 409, code: 'DECIDED', message: `${p.ref} is ${p.status.toLowerCase()}.` }); return; }
    const decision = str(req.body?.decision);
    const note = str(req.body?.note).trim();
    if (decision !== 'Accepted' && decision !== 'Rejected') { send(res, { status: 400, message: 'A proposal is Accepted or Rejected.' }); return; }
    if (decision === 'Rejected' && note.length < 10) { send(res, { status: 400, code: 'REASON_REQUIRED', message: 'Say why, in at least 10 characters. The firm sees it.' }); return; }
    let ownerId = a.userId;
    if (decision === 'Accepted' && req.body?.ownerId) {
      const owner = await prisma.user.findFirst({ where: { id: str(req.body.ownerId), tenantId: p.tenantId, status: 'Active' }, select: { id: true } });
      if (!owner) { send(res, { status: 400, code: 'BAD_OWNER', message: 'The owner is an active person of that organisation.' }); return; }
      ownerId = owner.id;
    }
    const result = await prisma.$transaction(async (tx) => {
      const moved = await tx.registerProposal.updateMany({ where: { id: p.id, status: 'Proposed' }, data: { status: decision, decidedById: a.userId, decidedAt: new Date(), decisionNote: note || null } });
      if (moved.count === 0) throw Object.assign(new Error('decided'), { code: 'DECIDED' });
      let made: { id: string; ref: string } | null = null;
      if (decision === 'Accepted' && p.kind === 'Risk') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`risk-ref:${p.tenantId}`}))`;
        const ref = `RSK-${String((await tx.risk.count({ where: { tenantId: p.tenantId } })) + 1).padStart(3, '0')}`;
        const { l, i, score } = scoreOf(p.likelihood ?? 1, p.impact ?? 1);
        const r = await tx.risk.create({
          data: {
            tenantId: p.tenantId, ref, title: p.title, description: p.description || p.reason, category: p.category || 'Operational', ownerId,
            identifiedVia: 'Workshop', identifiedSource: `${a.e.ref}/${p.ref}`, nextReviewDate: nextReviewFrom(6),
            inherentLikelihood: l, inherentImpact: i, inherentScore: score, residualLikelihood: l, residualImpact: i, residualScore: score,
          },
          select: { id: true, ref: true },
        });
        await tx.riskScoreSnapshot.create({ data: { tenantId: p.tenantId, riskId: r.id, score, inherentScore: score, residualScore: score, reason: 'Created' } });
        await writeAudit(tx, { tenantId: p.tenantId, actorId: a.userId, action: 'RISK_CREATED', subjectType: 'Risk', subjectId: r.id, payload: { ref, via: `${a.e.ref}/${p.ref}` } });
        await tx.registerProposal.update({ where: { id: p.id }, data: { riskId: r.id } });
        made = r;
      } else if (decision === 'Accepted') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`asset-ref:${p.tenantId}`}))`;
        const ref = `AST-${String((await tx.asset.count({ where: { tenantId: p.tenantId } })) + 1).padStart(4, '0')}`;
        const cia = { confidentiality: p.confidentiality ?? 3, integrity: p.integrity ?? 3, availability: p.availability ?? 3 };
        const x = await tx.asset.create({
          data: { tenantId: p.tenantId, ref, name: p.title, description: p.description || p.reason, type: p.category || 'Information', ownerId, ...cia, ...computeCriticality(cia) },
          select: { id: true, ref: true },
        });
        await writeAudit(tx, { tenantId: p.tenantId, actorId: a.userId, action: 'ASSET_CREATED', subjectType: 'Asset', subjectId: x.id, payload: { ref, via: `${a.e.ref}/${p.ref}` } });
        await tx.registerProposal.update({ where: { id: p.id }, data: { assetId: x.id } });
        made = x;
      }
      await bothTrails(tx, a, { action: decision === 'Accepted' ? 'ENGAGEMENT_PROPOSAL_ACCEPTED' : 'ENGAGEMENT_PROPOSAL_REJECTED', subjectType: 'RegisterProposal', subjectId: p.id, payload: { ref: p.ref, became: made?.ref ?? null, note: note || null } });
      await notify(tx, [{
        tenantId: p.proposedBy.tenantId, recipientId: p.proposedById, actorId: a.userId, event: 'ENGAGEMENT_PROPOSAL_DECIDED', subjectType: 'RegisterProposal', subjectId: p.id,
        title: `${p.ref} ${decision.toLowerCase()}${made ? `: now ${made.ref}` : ''}`, body: note, link: 'project-delivery',
      }]);
      return made;
    });
    res.json({ status: 'success', became: result });
  } catch (error: any) {
    if (error?.code === 'DECIDED') { send(res, { status: 409, code: 'DECIDED', message: 'That proposal has just been decided.' }); return; }
    console.error('[Proposal Decide Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to decide the proposal' });
  }
};

// ─── The firm's drafts of risk appetite ─────────────────────────────────────

/**
 * POST /api/engagements/:projectId/appetite-drafts { tenantId, category, statement, appetiteThreshold, toleranceThreshold }
 *
 * The firm drafts; the organisation approves on its Risk Appetite screen,
 * where whoever drafted a statement cannot approve it, and the version in
 * force stays in force until then.
 */
export const draftAppetite = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const no = firmRefusal(a);
    if (no) { send(res, no); return; }
    const b = req.body || {};
    const tenantId = str(b.tenantId);
    const reg = regFor(a, 'Risk');
    if (!reg || !reg.tenantIds.includes(tenantId)) { notFound(res, 'Register'); return; }
    const category = str(b.category);
    if (!CATEGORIES.includes(category)) { send(res, { status: 400, code: 'BAD_CATEGORY', message: `A category is ${CATEGORIES.join(', ')}.` }); return; }
    const statement = str(b.statement).trim();
    if (statement.length < 10) { send(res, { status: 400, code: 'STATEMENT_REQUIRED', message: 'Write the appetite statement, in at least 10 characters.' }); return; }
    const appetite = Number(b.appetiteThreshold);
    const tolerance = Number(b.toleranceThreshold);
    if (!Number.isInteger(appetite) || !Number.isInteger(tolerance) || appetite < 1 || tolerance > 25 || tolerance < appetite) {
      send(res, { status: 400, code: 'INVALID_THRESHOLDS', message: 'Appetite and tolerance are whole numbers from 1 to 25, and tolerance is not below appetite.' }); return;
    }
    const made = await prisma.$transaction(async (tx) => {
      const history = await tx.riskAppetite.findMany({ where: { tenantId, category }, orderBy: { version: 'desc' }, select: { id: true, version: true, status: true } });
      if (history.some((h) => h.status === 'Draft')) throw Object.assign(new Error('draft'), { code: 'DRAFT_ALREADY_OPEN' });
      const row = await tx.riskAppetite.create({
        data: { tenantId, category, statement, appetiteThreshold: appetite, toleranceThreshold: tolerance, setById: a.userId, status: 'Draft', version: (history[0]?.version ?? 0) + 1 },
        select: { id: true, version: true },
      });
      await writeAudit(tx, {
        tenantId, actorId: a.userId, action: 'RISK_APPETITE_SET', subjectType: 'RiskAppetite', subjectId: row.id,
        payload: { category, version: row.version, appetiteThreshold: appetite, toleranceThreshold: tolerance, draftedOn: a.e.ref },
      });
      if (a.e.providerTenantId) {
        await writeAudit(tx, {
          tenantId: a.e.providerTenantId, actorId: a.userId, action: 'RISK_APPETITE_SET', subjectType: 'RiskAppetite', subjectId: row.id,
          payload: { projectRef: a.e.ref, clientTenantId: tenantId, category, version: row.version },
        });
      }
      return row;
    });
    res.status(201).json({ status: 'success', message: `The ${category} appetite is drafted as version ${made.version}. The organisation approves it; until then the version in force stands.`, appetite: made });
  } catch (error: any) {
    if (error?.code === 'DRAFT_ALREADY_OPEN') { send(res, { status: 409, code: 'DRAFT_ALREADY_OPEN', message: 'A draft of that appetite is already waiting for approval.' }); return; }
    console.error('[Appetite Draft Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to draft the appetite' });
  }
};
