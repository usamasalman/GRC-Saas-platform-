/**
 * In-app notifications.
 *
 * Written inside the caller's transaction, alongside the audit entry for the
 * same action — so the platform can never tell someone about a change that was
 * rolled back. Delivery is pull-based: the recipient reads their own inbox.
 */

export type NotificationInput = {
  tenantId: string;
  /** Skipped when null — callers routinely pass an optional owner or assignee. */
  recipientId: string | null | undefined;
  event: string;
  subjectType: string;
  subjectId: string;
  title: string;
  body?: string | null;
  /** Page key the UI should open, matching the app shell's navigation keys. */
  link?: string | null;
  /** Suppresses self-notification; pass the user who performed the action. */
  actorId?: string | null;
};

/**
 * Nobody needs telling about their own action, and a missing recipient is a
 * normal case rather than an error — both are skipped silently so callers stay
 * free of defensive branching.
 */
export async function notify(tx: any, input: NotificationInput | NotificationInput[]): Promise<void> {
  const entries = Array.isArray(input) ? input : [input];

  const deliverable = entries.filter(
    (e) => !!e.recipientId && e.recipientId !== e.actorId,
  );
  if (deliverable.length === 0) return;

  await tx.notification.createMany({
    data: deliverable.map((e) => ({
      tenantId: e.tenantId,
      recipientId: e.recipientId as string,
      event: e.event,
      subjectType: e.subjectType,
      subjectId: e.subjectId,
      title: e.title.trim().slice(0, 200),
      body: e.body ? String(e.body).trim().slice(0, 500) : null,
      link: e.link ?? null,
    })),
  });
}
