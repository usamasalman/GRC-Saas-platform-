import { Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

/**
 * Segregation of Duties violation. The express catch handler maps this to
 * HTTP 403 with a clean, non-leaky message.
 */
export class SodViolation extends Error {
  readonly httpStatus = 403;
  readonly code = 'SOD_VIOLATION';
  constructor(
    public readonly ruleKey: string,
    public readonly conflictAction: string,
    public readonly ruleDescription: string,
  ) {
    super(`${ruleDescription} (conflicting prior action: ${conflictAction})`);
    this.name = 'SodViolation';
  }
}

/**
 * Enforce all SoD rules that guard `guardedAction` on records of `subjectType`.
 *
 * MUST be called inside the same prisma.$transaction as the guarded write,
 * so a rule change or a concurrent write can't race the check.
 *
 * Rule resolution: tenant-scoped rules AND platform-wide rules (tenantId=null)
 * both apply. A rule fires when the same user has ever committed one of the
 * `conflictingActions` against the same subjectId in the tenant's audit log.
 */
export async function checkSod(
  tx: TxClient,
  args: {
    tenantId: string;
    actorId: string;
    guardedAction: string;
    subjectType: string;
    subjectId: string;
  },
): Promise<void> {
  const { tenantId, actorId, guardedAction, subjectType, subjectId } = args;

  const rules = await tx.sodRule.findMany({
    where: {
      OR: [{ tenantId }, { tenantId: null }],
      guardedAction,
      subjectType,
      isActive: true,
    },
    select: {
      key: true,
      description: true,
      conflictingActions: true,
    },
  });
  if (rules.length === 0) return;

  for (const rule of rules) {
    let conflictingActions: string[];
    try {
      conflictingActions = JSON.parse(rule.conflictingActions);
    } catch {
      // Malformed rule — fail closed. Better to block than to silently allow.
      throw new SodViolation(
        rule.key,
        'malformed-rule',
        `SoD rule "${rule.key}" is misconfigured (invalid conflictingActions JSON)`,
      );
    }
    if (!Array.isArray(conflictingActions) || conflictingActions.length === 0) continue;

    const conflict = await tx.auditLog.findFirst({
      where: {
        tenantId,
        actorId,
        subjectType,
        subjectId,
        action: { in: conflictingActions },
      },
      select: { action: true },
    });
    if (conflict) {
      throw new SodViolation(rule.key, conflict.action, rule.description);
    }
  }
}
