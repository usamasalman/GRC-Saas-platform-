/**
 * Bulk risk import, end to end, against a register that looks like a real one.
 *
 * Almost every organisation arrives with its register already in Excel, written
 * by someone who called the columns whatever made sense to them, scored in words
 * rather than numbers, and filed things under categories this platform has never
 * heard of. It will also contain a risk that is already on the register under a
 * slightly different name — which is the case that matters most.
 *
 *   node scripts/verify/risk-import-test.js
 */
const ExcelJS = require('exceljs');

const API = process.env.API || 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (l, d = '') => { pass++; console.log(`   PASS  ${l}${d ? ` — ${d}` : ''}`); };
const bad = (l, d = '') => { fail++; console.log(`   FAIL  ${l}${d ? ` — ${d}` : ''}`); };

async function login(email) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Demo@2026' }),
  });
  return (await r.json()).token;
}
async function api(path, { token, method = 'GET', body } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { message: t.slice(0, 200) }; }
  return { status: r.status, json: j };
}

async function buildMessyRegister() {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('Risk Register 2026');

  s.addRow(['Enterprise Risk Register — FY2026']);
  s.addRow(['Owner: Risk & Compliance', 'Last reviewed 12 Aug 2026']);
  s.addRow([]);

  // Columns named the way a business writes them, not the way the API does.
  s.addRow(['Risk event', 'Risk detail', 'Risk area', 'Nature', 'Probability',
    'Consequence', 'Risk response', 'Accountable', 'How identified',
    'Related asset', 'RAG']);

  s.addRow(['Ransomware encrypts the core ledger',
    'Cause: untested restores. Event: ransomware. Impact: multi-day outage.',
    'cyber', 'Threat', 'Likely', 'Severe', 'reduce',
    'risk.manager@omniops.me', 'internal audit', 'Core banking platform', 'Red']);

  s.addRow(['Cross-border transfer without an adequacy assessment',
    'PDPL exposure on data leaving the Kingdom.',
    'regulatory', 'downside', 3, 5, 'terminate',
    'grc.manager@omniops.me', 'regulator', '', 'Amber']);

  s.addRow(['Single specialist holds all switch knowledge',
    '', 'hr', 'Threat', 'Possible', 'Major', 'Mitigate',
    'asset.owner@omniops.me', 'risk workshop', '', 'Amber']);

  s.addRow([]);

  // Upside — ISO 31000 counts it, so the importer must too.
  s.addRow(['Automating evidence collection frees assurance capacity',
    'Reduces manual effort across the quarterly cycle.',
    'process', 'upside', 4, 3, 'pursue',
    'grc.manager@omniops.me', 'workshop', '', 'Green']);

  // Opportunity treated as a threat — a misunderstanding, not a typo.
  s.addRow(['Regional expansion opens a new deposit market',
    'Growth opportunity aligned to the strategy.',
    'strategy', 'Opportunity', 3, 4, 'Avoid',
    'risk.manager@omniops.me', 'workshop', '', 'Green']);

  // Score out of range.
  s.addRow(['Unpatched perimeter appliance',
    'Known CVE unremediated past SLA.',
    'cyber', 'Threat', 7, 4, 'Mitigate',
    'risk.manager@omniops.me', 'scan', '', 'Red']);

  // Near-duplicate of a seeded register risk.
  s.addRow(['Excessive privileged access to production',
    'Standing admin rights with no recertification.',
    'cyber', 'Threat', 4, 5, 'Mitigate',
    'risk.manager@omniops.me', 'internal audit', '', 'Red']);

  // Duplicate within the file itself.
  s.addRow(['Ransomware encrypts the core ledger',
    'Duplicate line left in by the previous owner.',
    'cyber', 'Threat', 4, 5, 'Mitigate', '', 'workshop', '', 'Red']);

  // Unknown owner, and an asset reference that matches nothing.
  s.addRow(['Third-party statement printing exposes customer data',
    'Bureau handles statements containing account detail.',
    'supplier', 'Threat', 2, 4, 'Transfer',
    'nobody@elsewhere.com', 'workshop', 'AST-9999', 'Amber']);

  // No title.
  s.addRow(['', 'orphan detail with no risk named', 'cyber', 'Threat', 3, 3, 'Mitigate', '', '', '', '']);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

(async () => {
  const risk = await login('risk.manager@omniops.me');
  const staff = await login('hr.manager@omniops.me');
  if (!risk) { console.error('API not reachable'); process.exit(1); }

  // ── A. Template ──────────────────────────────────────────────────────────
  console.log('\nA. The template states what the importer understands');
  const tpl = await fetch(`${API}/api/grc/risks/import/template`, {
    headers: { Authorization: `Bearer ${risk}` },
  });
  if (tpl.status === 200) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await tpl.arrayBuffer()));
    const cols = wb.getWorksheet('Risks').getRow(1).values.slice(1);
    const guide = wb.getWorksheet('How to fill this in');
    cols.length >= 12 && guide
      ? ok('template downloads with headers and a guide sheet', `${cols.length} columns, ${guide.rowCount} guide rows`)
      : bad('template is thin', `${cols.length} columns`);
  } else {
    bad('template did not download', `HTTP ${tpl.status}`);
  }

  // ── B. Upload ────────────────────────────────────────────────────────────
  console.log('\nB. A register written by a person, not by the template');
  const buf = await buildMessyRegister();
  const up = await api('/api/grc/risks/import', {
    token: risk, method: 'POST',
    body: { fileName: 'Risk_register_FY2026.xlsx', fileType: 'xlsx', contentBase64: buf.toString('base64') },
  });
  const importId = up.json.import?.id;
  if (!importId) { bad('upload failed', JSON.stringify(up.json).slice(0, 200)); process.exit(1); }

  up.json.headerRow === 4
    ? ok('header found beneath the title block', `row ${up.json.headerRow}`)
    : bad('header row wrong', `got ${up.json.headerRow}, expected 4`);

  const used = up.json.columnsUsed || {};
  used.title === 'Risk event' && used.category === 'Risk area' && used.likelihood === 'Probability'
    ? ok('columns mapped by intent', `title←"${used.title}", category←"${used.category}", likelihood←"${used.likelihood}"`)
    : bad('column mapping wrong', JSON.stringify(used).slice(0, 180));

  (up.json.unmappedColumns || []).includes('RAG')
    ? ok('reports the column it ignored', 'RAG')
    : bad('unmapped column not reported', JSON.stringify(up.json.unmappedColumns));

  // ── C. What the parser understood ────────────────────────────────────────
  console.log('\nC. Review');
  const det = await api(`/api/grc/risks/imports/${importId}`, { token: risk });
  const cands = det.json.candidates || [];
  const byTitle = (t) => cands.filter((c) => c.parsed?.title === t);
  /** The importable one, where a title appears twice (the twin is blocked). */
  const importable = (t) => byTitle(t).find((c) => !c.issue) || byTitle(t)[0];

  cands.length === 10
    ? ok('ten data rows read, blank spacer skipped', `${cands.length} rows`)
    : bad('row count wrong', `${cands.length}, expected 10`);

  const rw = importable('Ransomware encrypts the core ledger');
  rw && rw.parsed.likelihood === 4 && rw.parsed.impact === 5 && rw.parsed.inherentScore === 20
    ? ok('word scales read', `"Likely"→4, "Severe"→5, inherent ${rw.parsed.inherentScore}`)
    : bad('word scales misread', JSON.stringify(rw?.parsed).slice(0, 160));

  rw && rw.parsed.category === 'Technology' && rw.parsed.treatmentType === 'Mitigate'
    ? ok('category and treatment aliases resolved', '"cyber"→Technology, "reduce"→Mitigate')
    : bad('alias resolution wrong', JSON.stringify(rw?.parsed).slice(0, 160));

  rw && rw.parsed.identifiedVia === 'InternalAudit'
    ? ok('provenance resolved', '"internal audit"→InternalAudit')
    : bad('provenance wrong', rw?.parsed?.identifiedVia);

  const upside = importable('Automating evidence collection frees assurance capacity');
  upside && upside.parsed.direction === 'Opportunity' && upside.parsed.treatmentType === 'Exploit'
    ? ok('an upside row is read as an opportunity', '"upside"→Opportunity, "pursue"→Exploit')
    : bad('opportunity parsing wrong', JSON.stringify(upside?.parsed).slice(0, 160));

  const pdpl = importable('Cross-border transfer without an adequacy assessment');
  pdpl && pdpl.parsed.category === 'Compliance' && pdpl.parsed.treatmentType === 'Avoid'
    ? ok('regulatory row filed correctly', '"regulatory"→Compliance, "terminate"→Avoid')
    : bad('regulatory row wrong', JSON.stringify(pdpl?.parsed).slice(0, 160));

  // ── D. Rows that must not import ─────────────────────────────────────────
  console.log('\nD. Four rows refused');
  const blocked = cands.filter((c) => c.issue);
  blocked.length === 4
    ? ok('four rows blocked', blocked.map((b) => `row ${b.rowNumber}`).join(', '))
    : bad('wrong number blocked', `${blocked.length}: ${blocked.map((b) => b.issue).join(' | ')}`);

  const mismatch = byTitle('Regional expansion opens a new deposit market').find((c) => c.issue);
  mismatch && /threat response.*opportunity|opportunity/i.test(mismatch.issue)
    ? ok('avoiding an opportunity is refused', mismatch.issue.slice(0, 80))
    : bad('direction/treatment mismatch not caught', mismatch ? mismatch.issue : 'not blocked');

  const outOfRange = byTitle('Unpatched perimeter appliance').find((c) => c.issue);
  outOfRange && /must be 1 to 5/i.test(outOfRange.issue)
    ? ok('likelihood of 7 refused', outOfRange.issue.slice(0, 66))
    : bad('range check missing', outOfRange ? outOfRange.issue : 'not blocked');

  const inFileDupe = byTitle('Ransomware encrypts the core ledger').find((c) => c.issue);
  inFileDupe && /duplicates row/i.test(inFileDupe.issue)
    ? ok('duplicate inside the file refused', inFileDupe.issue)
    : bad('in-file duplicate not caught');

  const noTitle = cands.find((c) => !c.parsed?.title);
  noTitle && /no risk title/i.test(noTitle.issue)
    ? ok('row with no title refused', noTitle.issue)
    : bad('untitled row not blocked');

  // ── E. The check that matters most ───────────────────────────────────────
  console.log('\nE. A risk already on the register is flagged, not silently added');
  const nearDupe = importable('Excessive privileged access to production');
  nearDupe && nearDupe.possibleDuplicates.length > 0
    ? ok('near-duplicate against the live register surfaced',
      `resembles "${nearDupe.possibleDuplicates[0]}"`)
    : bad('near-duplicate not detected', JSON.stringify(nearDupe?.possibleDuplicates));
  nearDupe && !nearDupe.issue
    ? ok('flagged for judgement rather than rejected', 'a person decides, not the parser')
    : bad('near-duplicate was wrongly blocked');

  // ── F. Blocked rows cannot be waved through ──────────────────────────────
  console.log('\nF. Correction');
  const tryAccept = await api(`/api/grc/risk-candidates/${blocked[0].id}`, {
    token: risk, method: 'PATCH', body: { status: 'Accepted' },
  });
  tryAccept.json.code === 'ROW_BLOCKED'
    ? ok('a blocked row cannot be accepted', tryAccept.json.code)
    : bad('blocked row accepted', `HTTP ${tryAccept.status}`);

  const fixTreat = await api(`/api/grc/risk-candidates/${mismatch.id}`, {
    token: risk, method: 'PATCH',
    body: { corrections: { treatmentType: 'Exploit' }, status: 'Accepted' },
  });
  fixTreat.status === 200 && fixTreat.json.candidate?.status === 'Accepted'
    ? ok('correcting the treatment cleared the block and accepted in one action')
    : bad('correction did not clear the block', JSON.stringify(fixTreat.json).slice(0, 160));

  const stillWrong = await api(`/api/grc/risk-candidates/${outOfRange.id}`, {
    token: risk, method: 'PATCH', body: { corrections: { treatmentType: 'Avoid' } },
  });
  stillWrong.status === 200
    ? ok('a threat may be avoided', 'direction and treatment agree')
    : bad('valid treatment refused', JSON.stringify(stillWrong.json).slice(0, 120));

  const badTreat = await api(`/api/grc/risk-candidates/${upside.id}`, {
    token: risk, method: 'PATCH', body: { corrections: { treatmentType: 'Mitigate' } },
  });
  badTreat.json.code === 'TREATMENT_DIRECTION_MISMATCH'
    ? ok('a correction cannot itself mismatch', badTreat.json.code)
    : bad('bad correction accepted', `HTTP ${badTreat.status}`);

  const reScore = await api(`/api/grc/risk-candidates/${outOfRange.id}`, {
    token: risk, method: 'PATCH', body: { corrections: { likelihood: 4 }, status: 'Accepted' } });
  reScore.json.candidate?.parsed?.inherentScore === 16
    ? ok('inherent score re-derived from the correction', '4 × 4 = 16')
    : bad('re-derivation wrong', JSON.stringify(reScore.json.candidate?.parsed).slice(0, 140));

  // ── G. Accept-clean leaves the judgement calls alone ──────────────────────
  console.log('\nG. Bulk accept excludes anything needing judgement');
  const clean = await api(`/api/grc/risks/imports/${importId}/accept-clean`, { token: risk, method: 'POST' });
  const afterClean = (await api(`/api/grc/risks/imports/${importId}`, { token: risk })).json.candidates || [];
  const dupeNow = afterClean.find((c) => c.parsed?.title === 'Excessive privileged access to production');
  clean.json.accepted > 0
    ? ok('clean rows accepted', `${clean.json.accepted} row(s)`)
    : bad('accept-clean did nothing', JSON.stringify(clean.json).slice(0, 140));
  dupeNow && dupeNow.status === 'Pending'
    ? ok('the possible duplicate was left for a person', 'still Pending after bulk accept')
    : bad('possible duplicate was bulk-accepted', dupeNow?.status);

  // ── H. Commit ────────────────────────────────────────────────────────────
  console.log('\nH. Commit');
  const before = (await api('/api/grc/risks', { token: risk })).json.count;
  const commit = await api(`/api/grc/risks/imports/${importId}/commit`, { token: risk, method: 'POST' });
  const after = (await api('/api/grc/risks', { token: risk })).json;

  commit.status === 200 && commit.json.committed > 0
    ? ok('risks created', `${before} → ${after.count} (${commit.json.committed} committed)`)
    : bad('commit failed', JSON.stringify(commit.json).slice(0, 180));

  const madeRw = (after.risks || []).find((r) => r.title === 'Ransomware encrypts the core ledger');
  madeRw && madeRw.inherentScore === 20 && madeRw.residualScore === 20
    ? ok('residual opens equal to inherent', 'no control linked yet, so nothing is credited')
    : bad('residual wrong on import', madeRw ? `${madeRw.inherentScore}/${madeRw.residualScore}` : 'risk not found');

  madeRw && madeRw.identifiedVia === 'InternalAudit' && madeRw.nextReviewDate
    ? ok('provenance and review clock set', `via ${madeRw.identifiedVia}, next review ${String(madeRw.nextReviewDate).slice(0, 10)}`)
    : bad('provenance or review date missing', madeRw ? String(madeRw.identifiedVia) : 'risk not found');

  commit.json.assetLinks > 0
    ? ok('a risk naming an asset was linked to it', `${commit.json.assetLinks} link(s)`)
    : bad('asset link not made', String(commit.json.assetLinks));

  (commit.json.notes || []).some((n) => /owner email/i.test(n))
    ? ok('unresolved owner reported', 'nobody@elsewhere.com')
    : bad('unresolved owner not reported', JSON.stringify(commit.json.notes));
  (commit.json.notes || []).some((n) => /asset reference/i.test(n))
    ? ok('unmatched asset reference reported', 'AST-9999')
    : bad('unmatched asset not reported', JSON.stringify(commit.json.notes));

  const recommit = await api(`/api/grc/risks/imports/${importId}/commit`, { token: risk, method: 'POST' });
  recommit.status === 409
    ? ok('an import cannot be committed twice', recommit.json.message.slice(0, 56))
    : bad('double commit allowed', `HTTP ${recommit.status}`);

  // ── I. Authorisation ─────────────────────────────────────────────────────
  console.log('\nI. Importing needs the risk capability');
  if (staff) {
    const denied = await api('/api/grc/risks/import', {
      token: staff, method: 'POST',
      body: { fileName: 'x.csv', fileType: 'csv', contentBase64: Buffer.from('Risk title\nProbe').toString('base64') },
    });
    denied.status === 403
      ? ok('a role without assess-and-treat-a-risk is refused', 'CAPABILITY_DENIED')
      : bad('capability gate', `expected 403, got ${denied.status}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('(Reseed afterwards: npx tsx src/seed.ts)\n');
  process.exit(fail === 0 ? 0 : 1);
})();
