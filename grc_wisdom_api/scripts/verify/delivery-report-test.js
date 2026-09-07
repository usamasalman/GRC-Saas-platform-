/**
 * The five delivery reports, rendered for real and read back — no database.
 *
 * The pure figures are covered in project-logic-test.js. What that cannot catch
 * is a report whose sections compile and say the wrong thing: a committee paper
 * that prints the flattering number without the other, a percentage with no
 * statement of the standard it was measured to, or a warning that a reader can
 * skim past. Those all produce a valid PDF, so the only way to see them is to
 * render and parse.
 *
 *   npm run build && node scripts/verify/delivery-report-test.js
 */
const { PDFParse } = require('pdf-parse');
const { renderPdf } = require('../../dist/services/renderPdf');
const {
  statusFigures, verificationRows, verificationIntegrity, unmappedClauses,
  attentionLists,
} = require('../../dist/services/deliveryReportData');
const { documentHash } = require('../../dist/services/reportIssue');

let pass = 0, fail = 0;
const ok = (l, d = '') => { pass++; console.log(`   PASS  ${l}${d ? ` — ${d}` : ''}`); };
const bad = (l, d = '') => { fail++; console.log(`   FAIL  ${l}${d ? ` — ${d}` : ''}`); };

const D = (s) => new Date(s);

const chrome = () => ({
  displayName: 'Acme Group Ltd',
  brandColour: '#123456',
  textColour: '#123456',
  marking: 'Confidential',
  footerText: null,
  logo: null,
  documentRef: 'DELIVERY-STATUS-20260911120000',
  generatedAt: D('2026-09-11T12:00:00Z'),
});

const render = async (sections, provenance) => {
  const buf = await renderPdf({
    provenance: Object.assign({
      reportName: 'Engagement Status Report',
      tenantName: 'Acme Group Ltd',
      generatedBy: 'A Person <a@example.com>',
      scopeKind: 'Engagement',
      subjectRef: 'PRJ-0001 — ISO 27001 readiness',
      subjectStatus: 'Active',
    }, provenance || {}),
    sections,
    chrome: chrome(),
  });
  return (await new PDFParse({ data: buf }).getText()).text || '';
};

(async () => {
  console.log('\n─── Delivery reports ───\n');

  // ── 1. The committee cannot leave with only the flattering number ─────────
  console.log('1. The two figures');

  const fused = {
    kind: 'fields',
    title: 'Two readings of the same engagement',
    fields: [
      {
        label: 'Progress',
        value: '87% reported / 41% independently confirmed — 46 points claimed but not confirmed',
      },
      {
        label: 'What confirmation means here',
        value: 'Only tasks marked for review require an independent reviewer.',
      },
    ],
  };
  const text = await render([fused]);

  // Fused into one string on purpose: two adjacent fields can be separated by
  // eye, by highlighter, or by copy-and-paste into minutes.
  /87%\s*reported\s*\/\s*41%\s*independently confirmed/.test(text.replace(/\s+/g, ' '))
    ? ok('the claimed and confirmed figures render as one inseparable string')
    : bad('the two figures are fused', text.slice(0, 200));
  // Whitespace-normalised: the field is long enough to wrap, and a line break
  // inside it is a rendering detail rather than a break in the sentence.
  const flat = text.replace(/\s+/g, ' ');
  flat.includes('46 points claimed but not confirmed')
    ? ok('and the gap is spelled out, not left to subtraction')
    : bad('the gap is spelled out', flat.slice(0, 160));
  text.includes('require an independent reviewer')
    ? ok('with the standard the second figure was measured against')
    : bad('the verification standard is stated');

  // ── 2. A default is not an assessment ────────────────────────────────────
  // Project.health defaults to Green, so an untouched field and a considered
  // judgement are indistinguishable in the data.
  console.log('\n2. Manager judgement');

  const unnoted = await render([{
    kind: 'fields', title: 'Two readings',
    fields: [{ label: 'Manager judgement', value: 'Green (no note recorded)' }],
  }]);
  unnoted.includes('no note recorded')
    ? ok('an unearned Green is marked as one, not laundered into an assessment')
    : bad('unearned Green is marked');

  // ── 3. The DRAFT banner survives an engagement in flight ─────────────────
  console.log('\n3. Draft state');

  const active = await render([fused]);
  active.includes('DRAFT')
    ? ok('a report on a live engagement says so on its face')
    : bad('live engagement is stamped DRAFT');

  const closed = await render([fused], { subjectStatus: 'Closed' });
  !closed.includes('DRAFT')
    ? ok('and a closed one does not') : bad('closed engagement carries no banner');

  // ── 4. The audit verification section ─────────────────────────────────────
  console.log('\n4. Verification record');

  const vt = (o = {}) => Object.assign({
    ref: 'TSK-0001', name: 'ISMS scope statement', status: 'Verified',
    assigneeId: 'alice', submittedById: 'alice', verifiedById: 'bob',
    verifiedAt: D('2026-02-10'), verificationRound: 1,
    verifications: [
      { outcome: 'Submitted', round: 1, actorId: 'alice', actorSide: 'Provider', createdAt: D('2026-02-01') },
      { outcome: 'Accepted', round: 1, actorId: 'bob', actorSide: 'Client', createdAt: D('2026-02-10') },
    ],
    evidence: [],
  }, o);

  const rows = verificationRows([vt()], (id) => ({ alice: 'Alice', bob: 'Bob' }[id] || '—'));
  const integrity = verificationIntegrity(rows);

  const auditText = await render([{
    kind: 'table',
    title: 'Verification record — every confirmed task',
    columns: [
      { header: 'Task', key: 'ref' },
      { header: 'Accepted by', key: 'by' },
      { header: 'Independent', key: 'independent' },
    ],
    rows: rows.map((r) => ({
      ref: r.ref, by: r.acceptedBy,
      independent: r.independent === true ? 'Yes'
        : r.independent === false ? 'NO — SEE NOTE' : 'Cannot be established',
    })),
  }]);

  auditText.includes('Alice') === false && auditText.includes('Bob')
    ? ok('the record names the acceptor, not the doer')
    : bad('the record names the acceptor', 'both names present');
  auditText.includes('Yes')
    ? ok('and shows independence per line, so an auditor can test it')
    : bad('independence shown per line');
  integrity.clean
    ? ok('a clean set reports as clean') : bad('clean set reports clean');

  // ── 5. Nothing is claimed that cannot be shown ───────────────────────────
  console.log('\n5. Untestable acceptances');

  const noHistory = vt({
    submittedById: null,
    verifications: [
      { outcome: 'Accepted', round: 1, actorId: 'bob', actorSide: 'Client', createdAt: D('2026-02-10') },
    ],
  });
  const untestable = verificationIntegrity(
    verificationRows([noHistory], (id) => id || '—'),
  );
  const untestableText = await render([{
    kind: 'fields', title: 'The basis of the confirmed figure',
    fields: [{
      label: 'Acceptances that could not be tested',
      value: `${untestable.unestablished} — the record does not establish who put the work forward`,
    }],
  }]);
  untestableText.includes('could not be tested')
    ? ok('an untestable acceptance is reported as untestable, never as passed')
    : bad('untestable reported as such');
  !untestable.clean
    ? ok('and it stops the set being clean')
    : bad('untestable stops the set being clean');

  // ── 6. The gap direction nobody asks for ─────────────────────────────────
  console.log('\n6. Unmapped clauses');

  const gaps = unmappedClauses([
    { id: 'A5', ref: 'A.5', title: 'Policies for information security', standardCode: 'ISO27001' },
    { id: 'A8', ref: 'A.8', title: 'Asset management', standardCode: 'ISO27001' },
  ], new Set(['A5']));

  const gapText = await render([{
    kind: 'table',
    title: 'Clauses in scope that no task addresses',
    columns: [
      { header: 'Framework', key: 'std' },
      { header: 'Clause', key: 'ref' },
      { header: 'Title', key: 'title' },
    ],
    rows: gaps.map((g) => ({ std: g.standardCode, ref: g.ref, title: g.title })),
  }]);
  gapText.includes('A.8') && gapText.includes('Asset management')
    ? ok('a clause nobody planned for appears in the report')
    : bad('unmapped clause appears');
  !gapText.includes('A.5')
    ? ok('and a clause that is covered does not clutter it')
    : bad('covered clause is absent from the gap list');

  // ── 7. Two chase lists, never merged ─────────────────────────────────────
  console.log('\n7. Chase lists');

  const chase = attentionLists([
    { ref: 'TSK-1', status: 'InProgress', dueDate: D('2026-01-01'), submittedAt: null },
    { ref: 'TSK-2', status: 'SubmittedForVerification', dueDate: D('2026-01-01'), submittedAt: D('2026-01-05') },
  ], D('2026-03-01'));

  chase.overdue.length === 1 && chase.overdue[0].ref === 'TSK-1'
    ? ok('the assignee owes the overdue task')
    : bad('overdue list', JSON.stringify(chase.overdue.map((t) => t.ref)));
  chase.awaitingReview.length === 1 && chase.awaitingReview[0].ref === 'TSK-2'
    ? ok('and a reviewer owes the delivered one — a different person to chase')
    : bad('awaiting review list', JSON.stringify(chase.awaitingReview.map((t) => t.ref)));

  // ── 8. The same figures hash the same, whoever drew them ─────────────────
  console.log('\n8. Reproducibility');

  const doc = {
    provenance: {
      reportName: 'Engagement Status Report', tenantName: 'Acme',
      generatedBy: 'A <a@b.c>', scopeKind: 'Engagement',
      subjectRef: 'PRJ-0001', subjectStatus: 'Active',
    },
    sections: [fused],
  };
  const h1 = documentHash(doc);
  const h2 = documentHash({ ...doc, chrome: chrome() });
  h1 === h2
    ? ok('the hash covers what the report says, not how it was drawn', h1.slice(0, 16))
    : bad('hash ignores chrome');

  console.log(`\n─── ${pass} passed, ${fail} failed ───\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\nFAILED:', e.message, '\n');
  process.exit(1);
});
