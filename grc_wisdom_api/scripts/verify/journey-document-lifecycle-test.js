/**
 * Journey: a policy goes from draft to read, by the people whose job each step is.
 *
 *   Compliance Manager drafts it  →  submits it to an approver
 *   → the approver signs it off (re-entering their password: the e-signature)
 *   → the manager publishes it to its audience
 *   → a member of staff reads it and acknowledges it
 *   → the manager can see who acknowledged and who read.
 *
 * And the refusals that make each step mean something: staff cannot approve,
 * the author cannot approve their own, a wrong password signs nothing, a
 * published document is not edited in place, and an acknowledgement counts once.
 *
 * Requirements: REQ-02 (WORM audit), REQ-03 (capability-based authorisation),
 * REQ-04 (segregation of duties). See docs/qa/traceability.md.
 *
 *   API=http://127.0.0.1:3000 node scripts/verify/journey-document-lifecycle-test.js
 */
const q = require('./qa/lib');

(async () => {
  const v = q.verdicts('journey-document-lifecycle');
  const step = async (name, ok, detail) => { v.record(`journey:document:${name}`, ok, detail); await q.pace(); };

  const manager = await q.login('eleanor.vance@globalbank.com');   // Compliance Manager
  const approver = await q.login('sarah.jenkins@globalbank.com');  // Compliance Approver
  const staff = await q.login('alex.rivera@globalbank.com');       // Staff Employee
  const pw = q.demoPassword();

  const code = `QA-POL-${Date.now()}`;
  const created = await q.call('POST', '/api/documents', {
    token: manager.token,
    body: { code, title: 'Acceptable Use Policy (QA journey)', category: 'Policy', classification: 'Internal', content: 'Staff must use company systems responsibly.' },
  });
  const id = created.json?.document?.id;
  await step('the manager drafts a policy', created.status === 201 && Boolean(id), `HTTP ${created.status} ${created.json?.message || ''}`);
  if (!id) return v.finish();

  const sub = await q.call('POST', `/api/documents/${id}/submit`, { token: manager.token, body: { approverIds: [approver.user.id] } });
  await step('and submits it to an approver', sub.status === 200, `HTTP ${sub.status} ${sub.json?.message || ''}`);

  const staffApprove = await q.call('POST', `/api/documents/${id}/approve`, { token: staff.token, body: { password: pw, decision: 'APPROVE' } });
  await step('staff cannot approve', staffApprove.status === 403, `HTTP ${staffApprove.status}`);

  const selfApprove = await q.call('POST', `/api/documents/${id}/approve`, { token: manager.token, body: { password: pw, decision: 'APPROVE' } });
  await step('the author cannot approve their own', [403, 404].includes(selfApprove.status), `HTTP ${selfApprove.status} ${selfApprove.json?.message || ''}`);

  const wrongPw = await q.call('POST', `/api/documents/${id}/approve`, { token: approver.token, body: { password: `${pw}-wrong`, decision: 'APPROVE' } });
  await step('a wrong password signs nothing', wrongPw.status === 401, `HTTP ${wrongPw.status}`);

  const approved = await q.call('POST', `/api/documents/${id}/approve`, { token: approver.token, body: { password: pw, decision: 'APPROVE' } });
  const afterApprove = await q.call('GET', `/api/documents/${id}`, { token: manager.token });
  await step('the approver signs it off', approved.status === 200 && afterApprove.json?.document?.status === 'APPROVED',
    `HTTP ${approved.status}, status now ${afterApprove.json?.document?.status}`);

  const published = await q.call('POST', `/api/documents/${id}/publish`, { token: manager.token, body: { audienceKind: 'Everyone' } });
  await step('the manager publishes it to everyone', published.status === 200, `HTTP ${published.status} ${published.json?.message || ''}`);

  const read = await q.call('GET', `/api/documents/${id}`, { token: staff.token });
  await step('staff can read the published policy', read.status === 200 && read.json?.document?.status === 'PUBLISHED',
    `HTTP ${read.status} ${read.json?.document?.status || read.json?.message || ''}`);

  const ack = await q.call('POST', `/api/documents/${id}/acknowledge`, { token: staff.token });
  await step('and acknowledge it', ack.status === 200, `HTTP ${ack.status} ${ack.json?.message || ''}`);
  const ackAgain = await q.call('POST', `/api/documents/${id}/acknowledge`, { token: staff.token });
  await step('an acknowledgement counts once', ackAgain.status === 409, `HTTP ${ackAgain.status}`);

  const acks = await q.call('GET', `/api/documents/${id}/acknowledgements`, { token: manager.token });
  const ackList = acks.json?.acknowledgements || acks.json?.records || [];
  await step('the manager sees who acknowledged', acks.status === 200
    && JSON.stringify(ackList).includes(staff.user.id), `HTTP ${acks.status}, ${ackList.length} acknowledgement(s)`);

  const access = await q.call('GET', `/api/documents/${id}/access`, { token: manager.token });
  await step('and who read it', access.status === 200 && JSON.stringify(access.json || {}).includes(staff.user.id),
    `HTTP ${access.status}`);

  const edit = await q.call('PUT', `/api/documents/${id}`, { token: manager.token, body: { title: 'Edited after publication' } });
  await step('a published policy is not edited in place', edit.status === 400, `HTTP ${edit.status} ${edit.json?.message || ''}`);

  const staffEdit = await q.call('PUT', `/api/documents/${id}`, { token: staff.token, body: { title: 'Staff edit' } });
  await step('staff cannot edit it at all', staffEdit.status === 403, `HTTP ${staffEdit.status}`);

  v.finish();
})().catch((e) => { console.error(e); process.exit(1); });
