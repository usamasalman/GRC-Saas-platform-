/**
 * Journey: support access to a customer, authorised by the customer.
 *
 *   The platform operator requests read-only access to a customer's user
 *   → the customer's administrators are notified, by name
 *   → one of them approves; the operator is told
 *   → the operator starts a time-boxed session and can read
 *   → but cannot write
 *   → the session ends and its token stops working.
 *
 * The refusals: the operator cannot approve their own request, and a session
 * cannot be started before it is approved.
 *
 * Requirements: REQ-09 (customer-authorised support impersonation), REQ-01
 * (tenant isolation), REQ-02 (WORM audit). See docs/qa/traceability.md.
 *
 *   API=http://127.0.0.1:3000 node scripts/verify/journey-impersonation-test.js
 */
const q = require('./qa/lib');

(async () => {
  const v = q.verdicts('journey-impersonation');
  const step = async (name, ok, detail) => { v.record(`journey:impersonation:${name}`, ok, detail); await q.pace(); };

  const admin = q.adminCredentials();
  const operator = await q.login(admin.email, admin.password);
  const subject = await q.login('alex.rivera@globalbank.com');

  const requested = await q.call('POST', '/api/impersonation', {
    token: operator.token,
    body: { subjectUserId: subject.user.id, reason: 'QA journey: investigating a reported export failure', durationMins: 15 },
  });
  const session = requested.json?.session;
  const approvers = requested.json?.approvers || [];
  await step('the operator requests access', requested.status === 201 && Boolean(session?.id),
    `HTTP ${requested.status} ${requested.json?.message || ''}`);
  if (!session?.id) return v.finish();
  await step('and is told which customer administrators were notified', approvers.length > 0,
    requested.json?.message || '');
  if (!approvers.length) return v.finish();

  const approver = await q.login(approvers[0].email);
  const inbox = await q.call('GET', '/api/notifications', { token: approver.token });
  await step('the customer administrator has the request in their notifications',
    (inbox.json?.notifications || []).some((n) => n.event === 'IMPERSONATION_REQUESTED' && n.subjectId === session.id),
    `${(inbox.json?.notifications || []).length} notification(s)`);

  const early = await q.call('POST', `/api/impersonation/${session.id}/start`, { token: operator.token });
  await step('a session cannot start before it is approved', early.status >= 400, `HTTP ${early.status}`);

  const selfApprove = await q.call('POST', `/api/impersonation/${session.id}/approve`, { token: operator.token, body: {} });
  await step('the operator cannot approve their own request', selfApprove.status === 403, `HTTP ${selfApprove.status}`);

  const approved = await q.call('POST', `/api/impersonation/${session.id}/approve`, { token: approver.token, body: { note: 'Approved for the export issue' } });
  await step('the customer approves', approved.status === 200, `HTTP ${approved.status} ${approved.json?.message || ''}`);

  const opInbox = await q.call('GET', '/api/notifications', { token: operator.token });
  await step('and the operator is told', (opInbox.json?.notifications || [])
    .some((n) => n.event === 'IMPERSONATION_APPROVED' && n.subjectId === session.id), '');

  const started = await q.call('POST', `/api/impersonation/${session.id}/start`, { token: operator.token });
  const imp = started.json?.impersonationToken;
  await step('the operator starts the session', started.status === 200 && Boolean(imp), `HTTP ${started.status}`);
  if (!imp) return v.finish();

  const reads = await q.call('GET', '/api/documents', { token: imp });
  await step('and can read as the customer', reads.status === 200, `HTTP ${reads.status}`);

  const writes = await q.call('POST', '/api/itsm/tickets', {
    token: imp, body: { subject: 'Written during impersonation', description: 'x', impact: 'Low', urgency: 'Low' },
  });
  await step('but cannot write anything', writes.status === 403, `HTTP ${writes.status} ${writes.json?.message || ''}`);

  const ended = await q.call('POST', `/api/impersonation/${session.id}/end`, { token: operator.token, body: { reason: 'QA journey complete' } });
  await step('the session ends', ended.status === 200, `HTTP ${ended.status}`);

  const after = await q.call('GET', '/api/documents', { token: imp });
  await step('and its token stops working', [401, 403].includes(after.status), `HTTP ${after.status}`);

  v.finish();
})().catch((e) => { console.error(e); process.exit(1); });
