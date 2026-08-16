/**
 * Walks the full internal-audit lifecycle through exactly the endpoints the
 * five audit tabs call, in the order a user would hit them:
 *
 *   universe → score → plan → approve → instantiate → RCM → procedure →
 *   result → workpaper → review → finding → response → CAP → close
 *
 * Every payload key the components bind to is asserted present, so a rename on
 * the server surfaces here rather than as a blank panel in the browser.
 *
 *   node scripts/verify/audit-tabs-test.js
 */
const API = process.env.API || 'http://localhost:3000';

let pass = 0, fail = 0;
const ok = (label, detail = '') => { pass++; console.log(`   PASS  ${label}${detail ? ` — ${detail}` : ''}`); };
const bad = (label, detail = '') => { fail++; console.log(`   FAIL  ${label}${detail ? ` — ${detail}` : ''}`); };

async function login(email) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Demo@2026' }),
  });
  const j = await res.json();
  return j.token;
}
async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { message: text.slice(0, 160) }; }
  return { status: res.status, json };
}
/** Asserts every key a tab component reads is actually in the payload. */
function keys(label, obj, expected) {
  const missing = expected.filter((k) => obj?.[k] === undefined);
  if (missing.length === 0) ok(label, expected.join(', '));
  else bad(label, `missing: ${missing.join(', ')}`);
}

(async () => {
  // Closure needs four distinct people — raiser, responder, CAP owner and an
  // independent validator — because each of the first three is barred by SoD.
  const cae = await login('internal.audit@omniops.me');   // raises
  const admin = await login('company.admin@omniops.me');  // responds for management
  const owner = await login('asset.owner@omniops.me');    // owns the corrective action
  const grc = await login('grc.manager@omniops.me');      // validates and closes
  if (!cae || !grc || !admin || !owner) { console.error('API not reachable, or seed users are missing.'); process.exit(1); }

  // ── Tab 1: Universe & Plan ──────────────────────────────────────────────
  console.log('\nTab 1 — Universe & Plan');
  const uni = await api('/api/grc/universe', { token: cae });
  keys('GET /universe payload', uni.json, ['totals', 'entities', 'factorLabels', 'entityTypes', 'weights']);
  keys('universe totals', uni.json.totals, ['total', 'high', 'neverAudited', 'overdue', 'inPlan']);

  const ent = await api('/api/grc/universe', {
    token: cae, method: 'POST',
    body: { name: 'Payment Operations (tab test)', type: 'Process', description: 'Outbound payment execution.' },
  });
  ent.status === 201 ? ok('POST /universe creates an entity') : bad('POST /universe', ent.json.message);
  const entityId = ent.json?.entity?.id;

  const factorKeys = Object.keys(uni.json.factorLabels || {});
  const score = await api(`/api/grc/universe/${entityId}/score`, {
    token: cae, method: 'PATCH',
    body: Object.fromEntries(factorKeys.map((k) => [k, 5])),
  });
  const scored = score.json?.entity;
  scored?.riskTier === 'High'
    ? ok('PATCH /score derives the tier', `score ${scored.riskScore} → ${scored.riskTier}`)
    : bad('PATCH /score', JSON.stringify(score.json).slice(0, 120));

  // A tenant holds one plan per year, so pick a free one — the script has to be
  // re-runnable without a reseed between attempts.
  const existing = await api('/api/grc/plans', { token: cae });
  const year = Math.max(2030, ...(existing.json.plans || []).map((p) => p.year)) + 1;
  const plan = await api('/api/grc/plans', {
    token: cae, method: 'POST',
    body: { year, title: `Tab test plan ${year}`, totalBudgetHours: 500 },
  });
  const planId = plan.json?.plan?.id;
  planId ? ok('POST /plans creates a draft plan') : bad('POST /plans', plan.json.message);

  const item = await api(`/api/grc/plans/${planId}/items`, {
    token: cae, method: 'POST',
    body: { auditableEntityId: entityId, plannedQuarter: 1, budgetHours: 80, rationale: 'Highest scored entity.' },
  });
  const itemId = item.json?.item?.id;
  itemId ? ok('POST /plans/:id/items adds an entity') : bad('POST items', JSON.stringify(item.json).slice(0, 140));

  // The gate the Engagements tab depends on: no engagement before approval.
  const early = await api(`/api/grc/plan-items/${itemId}/instantiate`, { token: cae, method: 'POST', body: {} });
  early.status === 409
    ? ok('instantiate is refused on an unapproved plan', early.json.message.slice(0, 70))
    : bad('unapproved plan gate', `expected 409, got ${early.status}`);

  await api(`/api/grc/plans/${planId}/submit`, { token: cae, method: 'POST', body: {} });
  const selfApprove = await api(`/api/grc/plans/${planId}/approve`, { token: cae, method: 'POST', body: { approvalNote: 'self' } });
  selfApprove.status >= 400
    ? ok('preparer cannot approve their own plan', `${selfApprove.status} ${selfApprove.json.code || ''}`)
    : bad('plan SoD', 'the preparer was allowed to approve');

  const approve = await api(`/api/grc/plans/${planId}/approve`, { token: grc, method: 'POST', body: { approvalNote: 'Approved for tab test.' } });
  approve.status === 200 ? ok('a second approver can approve') : bad('approve', approve.json.message);

  const plans = await api('/api/grc/plans', { token: cae });
  const loaded = (plans.json.plans || []).find((p) => p.id === planId);
  keys('plan row payload', loaded, ['status', 'year', 'title', 'totalBudgetHours', 'allocatedHours', 'items', 'preparedBy']);

  // ── Tab 2: Engagements ──────────────────────────────────────────────────
  console.log('\nTab 2 — Engagements');
  const inst = await api(`/api/grc/plan-items/${itemId}/instantiate`, { token: cae, method: 'POST', body: {} });
  const auditId = inst.json?.audit?.id;
  auditId ? ok('instantiate creates the engagement', inst.json.audit.ref) : bad('instantiate', JSON.stringify(inst.json).slice(0, 140));

  const noReason = await api('/api/grc/audits', {
    token: cae, method: 'POST',
    body: { title: 'Ad-hoc', objective: 'o', scope: 's', criteria: 'c' },
  });
  noReason.json?.code === 'UNPLANNED_REASON_REQUIRED'
    ? ok('an engagement outside the plan needs a written reason', noReason.json.code)
    : bad('unplanned gate', `expected UNPLANNED_REASON_REQUIRED, got ${noReason.status} ${noReason.json.code || ''}`);

  const special = await api('/api/grc/audits', {
    token: cae, method: 'POST',
    body: {
      title: 'Payments incident investigation', objective: 'Establish what happened.',
      scope: 'Outbound payments, Jan–Feb.', criteria: 'ISO 27001 A.8.16',
      unplannedReason: 'Requested by the Audit Committee following the payments incident.',
    },
  });
  special.json?.audit?.unplannedReason
    ? ok('a special engagement records and keeps its reason')
    : bad('special engagement', JSON.stringify(special.json).slice(0, 140));

  await api(`/api/grc/audits/${auditId}`, { token: cae, method: 'PATCH', body: { status: 'Fieldwork' } });

  // ── Tab 3: RCM & Testing ────────────────────────────────────────────────
  console.log('\nTab 3 — RCM & Testing');
  const impls = await api('/api/grc/implementations', { token: cae });
  const implId = (impls.json.implementations || [])[0]?.id;

  const row = await api(`/api/grc/audits/${auditId}/matrix`, {
    token: cae, method: 'POST',
    body: {
      title: 'Unauthorised payment release', description: 'A payment is released without a second approval.',
      riskRating: 'High', implementationId: implId, controlType: 'Preventive', controlNature: 'Manual',
    },
  });
  const rowId = row.json?.row?.id;
  rowId ? ok('POST /matrix adds a risk row', row.json.row.ref) : bad('add matrix row', row.json.message);

  const proc = await api(`/api/grc/matrix/${rowId}/procedures`, {
    token: cae, method: 'POST',
    body: { objective: 'Confirm dual approval operated.', procedure: 'Select 25 payments and inspect approvals.', testType: 'OperatingEffectiveness', samplingMethod: 'Judgmental', sampleSize: 25 },
  });
  const procId = proc.json?.procedure?.id;
  procId ? ok('POST /procedures adds a procedure', proc.json.procedure.ref) : bad('add procedure', proc.json.message);

  const inconsistent = await api(`/api/grc/procedures/${procId}/result`, {
    token: cae, method: 'POST',
    body: { itemsTested: 25, exceptionsFound: 3, conclusion: 'Satisfactory', narrative: 'Inspected 25 payment approvals.' },
  });
  inconsistent.json?.code === 'CONCLUSION_INCONSISTENT'
    ? ok('exceptions and conclusion must agree', inconsistent.json.code)
    : bad('conclusion consistency', `expected CONCLUSION_INCONSISTENT, got ${inconsistent.status}`);

  const result = await api(`/api/grc/procedures/${procId}/result`, {
    token: cae, method: 'POST',
    body: { itemsTested: 25, exceptionsFound: 3, conclusion: 'SatisfactoryWithExceptions', narrative: 'Inspected 25 payment approvals; 3 lacked a second approver.' },
  });
  result.status === 201 ? ok('a consistent result is accepted', result.json.message.slice(0, 60)) : bad('record result', result.json.message);

  const second = await api(`/api/grc/procedures/${procId}/result`, {
    token: cae, method: 'POST',
    body: { itemsTested: 25, exceptionsFound: 0, conclusion: 'Satisfactory', narrative: 'Re-tested, all fine now.' },
  });
  second.status === 409 ? ok('a recorded result is immutable') : bad('result immutability', `expected 409, got ${second.status}`);

  const matrix = await api(`/api/grc/audits/${auditId}/matrix`, { token: cae });
  keys('GET /matrix payload', matrix.json, ['audit', 'totals', 'matrix']);
  keys('matrix totals', matrix.json.totals, ['rows', 'withoutControl', 'procedures', 'completed', 'notStarted', 'exceptions', 'unsatisfactory']);
  const mRow = matrix.json.matrix?.[0];
  keys('matrix row', mRow, ['ref', 'title', 'description', 'riskRating', 'procedures', 'implementation']);
  keys('matrix procedure', mRow?.procedures?.[0], ['ref', 'objective', 'testType', 'samplingMethod', 'sampleSize', 'status', 'result']);

  // ── Tab 4: Workpapers ───────────────────────────────────────────────────
  console.log('\nTab 4 — Workpapers');
  const wp = await api(`/api/grc/audits/${auditId}/workpapers`, {
    token: cae, method: 'POST',
    body: { title: 'Dual approval testing', section: 'Fieldwork', content: 'Sample selection, testing and exceptions.', procedureId: procId },
  });
  const wpId = wp.json?.workpaper?.id;
  wpId ? ok('POST /workpapers creates a draft', wp.json.workpaper.ref) : bad('create workpaper', wp.json.message);

  await api(`/api/grc/workpapers/${wpId}/submit`, { token: cae, method: 'POST', body: {} });

  const selfReview = await api(`/api/grc/workpapers/${wpId}/review`, { token: cae, method: 'POST', body: { conclusion: 'Fine.' } });
  selfReview.json?.code === 'SOD_VIOLATION'
    ? ok('the preparer cannot sign off their own workpaper', selfReview.json.code)
    : bad('workpaper SoD', `expected SOD_VIOLATION, got ${selfReview.status}`);

  const note = await api(`/api/grc/workpapers/${wpId}/notes`, {
    token: grc, method: 'POST', body: { note: 'State the population source and the selection basis.' },
  });
  const noteId = note.json?.note?.id;
  noteId ? ok('a reviewer note returns the paper to the preparer') : bad('review note', note.json.message);

  await api(`/api/grc/workpapers/${wpId}/submit`, { token: cae, method: 'POST', body: {} });
  const blocked = await api(`/api/grc/workpapers/${wpId}/review`, { token: grc, method: 'POST', body: { conclusion: 'Accepted.' } });
  blocked.json?.code === 'OPEN_REVIEW_NOTES'
    ? ok('an open note blocks sign-off', blocked.json.code)
    : bad('open-note gate', `expected OPEN_REVIEW_NOTES, got ${blocked.status} ${blocked.json.code || ''}`);

  await api(`/api/grc/review-notes/${noteId}/clear`, { token: cae, method: 'POST', body: { response: 'Population is the Jan–Feb payment ledger; selection was judgmental over high-value items.' } });
  await api(`/api/grc/workpapers/${wpId}/submit`, { token: cae, method: 'POST', body: {} });
  const signed = await api(`/api/grc/workpapers/${wpId}/review`, { token: grc, method: 'POST', body: { conclusion: 'Reviewed and accepted.' } });
  signed.status === 200 ? ok('sign-off succeeds once notes are cleared') : bad('sign-off', signed.json.message);

  const file = await api(`/api/grc/audits/${auditId}/workpapers`, { token: cae });
  keys('GET /workpapers payload', file.json, ['audit', 'totals', 'workpapers', 'fileReadyForReporting']);
  keys('workpaper totals', file.json.totals, ['total', 'draft', 'awaitingReview', 'reviewed', 'returned', 'openReviewNotes']);
  file.json.fileReadyForReporting === true
    ? ok('fileReadyForReporting flips true once every paper is signed off')
    : bad('fileReadyForReporting', `still ${file.json.fileReadyForReporting}`);

  // ── Tab 5: Issues & CAP ─────────────────────────────────────────────────
  console.log('\nTab 5 — Issues & CAP');
  const finding = await api(`/api/grc/audits/${auditId}/findings`, {
    token: cae, method: 'POST',
    body: {
      criterion: 'Payments policy §4.2 requires dual approval.',
      condition: '3 of 25 payments were released with a single approval.',
      cause: 'The approval limit was not enforced in the payment tool.',
      recommendation: 'Enforce the dual-approval threshold in the tool.',
      riskRating: 'High',
    },
  });
  const issueId = finding.json?.issue?.id || finding.json?.finding?.id;
  issueId ? ok('a finding is raised against the engagement') : bad('raise finding', JSON.stringify(finding.json).slice(0, 140));

  const link = await api(`/api/grc/procedures/${procId}/link-finding`, { token: cae, method: 'POST', body: { findingId: issueId } });
  link.status === 200 ? ok('the test result links to the finding', link.json.message) : bad('link finding', link.json.message);

  const selfRespond = await api(`/api/grc/issues/${issueId}/respond`, {
    token: cae, method: 'POST', body: { responseType: 'Agree', responseNarrative: 'We agree.', managementActionPlan: 'Fix it.' },
  });
  selfRespond.status >= 400
    ? ok('the auditor cannot write management’s own response', `${selfRespond.status}`)
    : bad('response SoD', 'the raiser was allowed to respond');

  const respond = await api(`/api/grc/issues/${issueId}/respond`, {
    token: admin, method: 'POST',
    body: { responseType: 'Agree', responseNarrative: 'Accepted; the threshold was mis-configured.', managementActionPlan: 'Enforce dual approval above SAR 50k by 31 March.' },
  });
  respond.json?.issue?.status === 'Responded'
    ? ok('management response moves the issue to Responded')
    : bad('respond', JSON.stringify(respond.json).slice(0, 140));

  const users = await api('/api/iam/users', { token: grc });
  const capOwner = (users.json.users || []).find((u) => u.email === 'asset.owner@omniops.me');
  const cap = await api(`/api/grc/issues/${issueId}/cap`, {
    token: cae, method: 'POST',
    body: { capOwnerId: capOwner?.id, capDueDate: '2031-03-31', capDescription: 'Enforce the dual-approval threshold.' },
  });
  cap.json?.issue?.status === 'CAPAssigned' ? ok('a CAP can be assigned once management has responded') : bad('assign CAP', cap.json.message);

  const submitted = await api(`/api/grc/issues/${issueId}/submit-closure`, {
    token: owner, method: 'POST', body: { evidenceNote: 'Threshold enforced; screenshot and change ticket CHG-4471 attached.' },
  });
  submitted.json?.issue?.status === 'PendingClosure'
    ? ok('the CAP owner submits the remediation for validation')
    : bad('submit for closure', JSON.stringify(submitted.json).slice(0, 140));

  const selfClose = await api(`/api/grc/issues/${issueId}/close`, { token: cae, method: 'POST', body: { note: 'Verified.' } });
  selfClose.json?.code === 'SOD_VIOLATION'
    ? ok('whoever raised an issue cannot close it', selfClose.json.code)
    : bad('closure SoD', `expected SOD_VIOLATION, got ${selfClose.status} ${selfClose.json.code || ''}`);

  const close = await api(`/api/grc/issues/${issueId}/close`, {
    token: grc, method: 'POST', body: { note: 'Re-tested 15 payments post-change; dual approval enforced on all.' },
  });
  close.json?.issue?.status === 'Closed'
    ? ok('a fourth, independent party can close it')
    : bad('close', JSON.stringify(close.json).slice(0, 140));

  const register = await api('/api/grc/issues', { token: cae });
  keys('GET /issues payload', register.json, ['totals', 'bySource', 'issues']);
  keys('issue totals', register.json.totals, ['total', 'open', 'overdue', 'awaitingResponse', 'disputed', 'escalated', 'highOpen', 'closureRate']);
  keys('issue row', register.json.issues?.[0], ['ref', 'title', 'source', 'status', 'riskRating', 'aging', 'raisedBy']);
  keys('derived aging', register.json.issues?.[0]?.aging, ['ageDays', 'targetDate', 'isOverdue', 'daysOverdue', 'ageBucket']);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
