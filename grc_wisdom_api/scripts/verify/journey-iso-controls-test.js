/**
 * Journey: an ISO 27001 control goes from not implemented to independently validated.
 *
 *   The GRC manager implements a control, naming an owner and an operator
 *   → marks it implemented
 *   → the operator attaches evidence
 *   → an independent reviewer judges the evidence
 *   → an independent validator rates the control's effectiveness
 *   → the framework coverage report can be produced for an auditor.
 *
 * The separations an ISO certification auditor looks for are the refusals:
 * nothing is validated before it is implemented or without evidence, whoever
 * uploaded evidence cannot review it, and the control's own owner cannot
 * validate it.
 *
 * The audit side of the lifecycle — plan, engagement, workpapers, findings,
 * corrective action, closure — is walked end to end by audit-tabs-test, and
 * the programme side by project-delivery-test. This covers the part between.
 *
 * Requirements: REQ-05 (standards, controls & evidence), REQ-04 (segregation
 * of duties). See docs/qa/traceability.md.
 *
 *   API=http://127.0.0.1:3000 node scripts/verify/journey-iso-controls-test.js
 */
const q = require('./qa/lib');

(async () => {
  const v = q.verdicts('journey-iso-controls');
  const step = async (name, ok, detail) => { v.record(`journey:iso:${name}`, ok, detail); await q.pace(); };

  const manager = await q.login('grc.manager@omniops.me');     // owner
  const operator = await q.login('risk.manager@omniops.me');   // does the work, uploads evidence
  const assessor = await q.login('internal.audit@omniops.me'); // independent

  const controls = (await q.call('GET', '/api/grc/controls', { token: manager.token })).json?.controls || [];
  await q.pace();
  const impls = (await q.call('GET', '/api/grc/implementations', { token: manager.token })).json?.implementations || [];
  await q.pace();
  const taken = new Set(impls.filter((i) => i.tenantId === manager.user.tenantId).map((i) => i.controlId || i.control?.id));
  const control = controls.find((c) => !taken.has(c.id));
  await step('there is a control this organisation has not implemented yet', Boolean(control), `${controls.length} controls, ${taken.size} implemented`);
  if (!control) return v.finish();

  const created = await q.call('POST', '/api/grc/implementations', {
    token: manager.token,
    body: {
      controlId: control.id, title: `${control.code} — QA journey`, ownerId: manager.user.id, operatorId: operator.user.id,
      frequency: 'Quarterly', successCriteria: 'Quarterly access review completed and signed off.',
    },
  });
  const impl = created.json?.implementation;
  await step('the manager implements the control', created.status === 201 && Boolean(impl?.id), `HTTP ${created.status} ${created.json?.message || ''}`);
  if (!impl?.id) return v.finish();

  const dup = await q.call('POST', '/api/grc/implementations', {
    token: manager.token, body: { controlId: control.id, successCriteria: 'again', frequency: 'Quarterly' },
  });
  await step('the same control cannot be implemented twice', dup.status === 409, `HTTP ${dup.status}`);

  const tooEarly = await q.call('POST', `/api/grc/implementations/${impl.id}/validate`, {
    token: assessor.token, body: { effectiveness: 'Effective', note: 'early' },
  });
  await step('nothing is validated before it is implemented', tooEarly.status === 409, `HTTP ${tooEarly.status}`);

  const done = await q.call('PATCH', `/api/grc/implementations/${impl.id}`, { token: manager.token, body: { status: 'Implemented' } });
  await step('the control is marked implemented', done.status === 200, `HTTP ${done.status} ${done.json?.message || ''}`);

  const noEvidence = await q.call('POST', `/api/grc/implementations/${impl.id}/validate`, {
    token: assessor.token, body: { effectiveness: 'Effective', note: 'no evidence yet' },
  });
  await step('nothing is validated without evidence', noEvidence.status === 409, `HTTP ${noEvidence.status}`);

  const ev = await q.call('POST', `/api/grc/implementations/${impl.id}/evidence`, {
    token: operator.token, body: { title: 'Q3 access review sign-off', description: 'Signed review of all privileged accounts.' },
  });
  const evidenceId = ev.json?.evidence?.id;
  await step('the operator attaches evidence', ev.status === 201 && Boolean(evidenceId), `HTTP ${ev.status}`);
  if (!evidenceId) return v.finish();

  const judgement = { relevance: 'Yes', sufficiency: 'Yes', authenticity: 'Yes', currency: 'Yes', reviewNote: 'Complete and current.' };
  const selfReview = await q.call('POST', `/api/grc/evidence/${evidenceId}/review`, { token: operator.token, body: judgement });
  await step('whoever uploaded evidence cannot review it', selfReview.status === 403, `HTTP ${selfReview.status} ${selfReview.json?.code || ''}`);

  const reviewed = await q.call('POST', `/api/grc/evidence/${evidenceId}/review`, { token: assessor.token, body: judgement });
  await step('an independent reviewer judges the evidence', reviewed.status === 200, `HTTP ${reviewed.status} ${reviewed.json?.message || ''}`);

  const ownerValidates = await q.call('POST', `/api/grc/implementations/${impl.id}/validate`, {
    token: manager.token, body: { effectiveness: 'Effective', note: 'marking my own work' },
  });
  await step('the control\'s owner cannot validate it', ownerValidates.status === 403, `HTTP ${ownerValidates.status}`);

  const validated = await q.call('POST', `/api/grc/implementations/${impl.id}/validate`, {
    token: assessor.token, body: { effectiveness: 'Effective', note: 'Operating effectively on the sample reviewed.' },
  });
  await step('an independent validator rates its effectiveness', validated.status === 200, `HTTP ${validated.status} ${validated.json?.message || ''}`);

  const r = await fetch(`${q.API}/api/grc/reports/framework-coverage?format=xlsx`, { headers: { Authorization: `Bearer ${manager.token}` } });
  const bytes = Buffer.from(await r.arrayBuffer());
  await step('the framework coverage report is produced for the auditor',
    r.status === 200 && bytes.length > 1000 && bytes.slice(0, 2).toString() === 'PK',
    `HTTP ${r.status}, ${bytes.length} bytes, ${r.headers.get('content-type')}`);

  v.finish();
})().catch((e) => { console.error(e); process.exit(1); });
