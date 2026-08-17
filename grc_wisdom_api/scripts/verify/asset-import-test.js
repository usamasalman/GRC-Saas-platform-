/**
 * Bulk asset import, end to end, against a deliberately messy file.
 *
 * Real inventories arrive as a CMDB export or a facilities spreadsheet: a title
 * block above the table, columns named whatever that team calls them, ratings
 * written as words, a blank line in the middle, and at least one row that
 * cannot be imported as it stands. If the importer only works on the template
 * it is not an importer, it is a formality.
 *
 *   node scripts/verify/asset-import-test.js
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

/** A file that looks like something a real IT team would hand over. */
async function buildMessyWorkbook() {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('CMDB Export');

  // A title block above the table — extremely common, and fatal to any parser
  // that assumes row 1 is the header.
  s.addRow(['Asset inventory — IT Operations']);
  s.addRow(['Exported 17 August 2026']);
  s.addRow([]);

  // Headers nobody would guess: "System", "Class", "Hosting", word ratings.
  s.addRow(['System', 'Class', 'Hosting', 'Sensitivity', 'Confidentiality',
    'Integrity', 'Availability', 'Business owner', 'Site', 'Supplier',
    'Replacement cost', 'Ticket queue']);

  s.addRow(['Loan origination platform', 'application', 'in-house', 'Restricted',
    'High', 'Very high', 'High', 'risk.manager@omniops.me', 'Riyadh DC-1', '',
    'SAR 3,400,000', 'QUEUE-14']);
  s.addRow(['Branch CCTV estate', 'hardware', 'on-prem', 'Internal',
    2, 3, 4, 'asset.owner@omniops.me', '38 branches', '', '1,200,000', 'QUEUE-3']);
  s.addRow(['Statement printing bureau', 'outsourcing', 'external', 'Confidential',
    4, 4, 3, 'grc.manager@omniops.me', 'Supplier premises', 'Najd Print Services',
    '450,000', 'QUEUE-8']);
  // A blank spacer line mid-table.
  s.addRow([]);
  s.addRow(['Employee records archive', 'data', '', 'Restricted',
    'Very high', 4, 2, 'hr.manager@omniops.me', 'Riyadh HQ', '', '', 'QUEUE-2']);
  // Third party with no supplier named — must block.
  s.addRow(['Cloud analytics sandbox', 'saas', 'external', 'Internal',
    3, 2, 2, 'risk.manager@omniops.me', 'Provider region', '', '90,000', 'QUEUE-9']);
  // Rating out of range — must block.
  s.addRow(['Payment switch', 'application', 'in-house', 'Restricted',
    9, 5, 5, 'risk.manager@omniops.me', 'Riyadh DC-1', '', '7,000,000', 'QUEUE-1']);
  // Owner email that does not exist in this tenant — imports, but reassigns.
  s.addRow(['Marketing website', 'application', 'external', 'Public',
    1, 2, 2, 'nobody@elsewhere.com', 'CDN', 'Regional Cloud Services Co.',
    '120,000', 'QUEUE-20']);
  // Duplicate name — must block.
  s.addRow(['Branch CCTV estate', 'hardware', 'on-prem', 'Internal',
    2, 3, 4, '', '38 branches', '', '', '']);
  // No name at all — must block.
  s.addRow(['', 'application', 'in-house', 'Internal', 3, 3, 3, '', '', '', '', 'QUEUE-99']);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

(async () => {
  const risk = await login('risk.manager@omniops.me');
  const staff = await login('hr.manager@omniops.me');
  if (!risk) { console.error('API not reachable'); process.exit(1); }

  // ── A. Template ──────────────────────────────────────────────────────────
  console.log('\nA. The template tells you what the importer understands');
  const tpl = await fetch(`${API}/api/grc/assets/import/template`, {
    headers: { Authorization: `Bearer ${risk}` },
  });
  const tplBuf = Buffer.from(await tpl.arrayBuffer());
  if (tpl.status === 200) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tplBuf);
    const cols = wb.getWorksheet('Assets').getRow(1).values.slice(1);
    const guide = wb.getWorksheet('How to fill this in');
    cols.length >= 14 && guide
      ? ok('template downloads with headers and a guide sheet', `${cols.length} columns, ${guide.rowCount} guide rows`)
      : bad('template is thin', `${cols.length} columns`);
  } else {
    bad('template did not download', `HTTP ${tpl.status}`);
  }

  // ── B. Upload a messy real-world file ────────────────────────────────────
  console.log('\nB. A messy CMDB export, not the template');
  const buf = await buildMessyWorkbook();
  const up = await api('/api/grc/assets/import', {
    token: risk, method: 'POST',
    body: { fileName: 'CMDB_export_Aug26.xlsx', fileType: 'xlsx', contentBase64: buf.toString('base64') },
  });
  const importId = up.json.import?.id;
  if (!importId) { bad('upload failed', JSON.stringify(up.json).slice(0, 200)); process.exit(1); }

  up.json.headerRow === 4
    ? ok('found the header row beneath the title block', `row ${up.json.headerRow}`)
    : bad('header row wrong', `got ${up.json.headerRow}, expected 4`);

  const used = up.json.columnsUsed || {};
  used.name === 'System' && used.type === 'Class' && used.ownership === 'Hosting'
    ? ok('mapped columns by intent, not by name', `name←"${used.name}", type←"${used.type}", ownership←"${used.ownership}"`)
    : bad('column mapping wrong', JSON.stringify(used).slice(0, 160));

  (up.json.unmappedColumns || []).includes('Ticket queue')
    ? ok('reports the column it ignored', 'Ticket queue')
    : bad('unmapped column not reported', JSON.stringify(up.json.unmappedColumns));

  // ── C. What the parser understood ────────────────────────────────────────
  console.log('\nC. Review — the parser shows its working');
  const det = await api(`/api/grc/assets/imports/${importId}`, { token: risk });
  const cands = det.json.candidates || [];
  const byName = (n) => cands.find((c) => c.parsed?.name === n);

  cands.length === 9
    ? ok('nine data rows read, blank spacer skipped', `${cands.length} rows`)
    : bad('row count wrong', `${cands.length} rows, expected 9`);

  const loan = byName('Loan origination platform');
  loan && loan.parsed.confidentiality === 4 && loan.parsed.integrity === 5 && loan.parsed.criticality === 5
    ? ok('word ratings read correctly', `"High"→4, "Very high"→5, criticality ${loan.parsed.criticality} ${loan.parsed.criticalityTier}`)
    : bad('word ratings misread', JSON.stringify(loan?.parsed).slice(0, 160));

  loan && loan.parsed.replacementValue === 3400000
    ? ok('currency and separators stripped', 'SAR 3,400,000 → 3400000')
    : bad('money parsing wrong', String(loan?.parsed?.replacementValue));

  const cctv = byName('Branch CCTV estate');
  cctv && cctv.parsed.type === 'Physical' && cctv.parsed.ownership === 'Internal'
    ? ok('vocabulary aliases resolved', `"hardware"→Physical, "on-prem"→Internal`)
    : bad('alias resolution wrong', JSON.stringify(cctv?.parsed).slice(0, 140));

  const bureau = byName('Statement printing bureau');
  bureau && bureau.parsed.ownership === 'ThirdParty' && bureau.parsed.vendorName === 'Najd Print Services'
    ? ok('third-party asset kept its supplier')
    : bad('third-party parsing wrong', JSON.stringify(bureau?.parsed).slice(0, 140));

  const archive = byName('Employee records archive');
  archive && archive.parsed.ownership === 'Internal' && archive.confidence === 'Medium'
    ? ok('blank ownership defaulted, and flagged as needing a look', `confidence ${archive.confidence}`)
    : bad('default not flagged', JSON.stringify(archive?.parsed).slice(0, 140));

  // ── D. The rows that must not import ─────────────────────────────────────
  console.log('\nD. Four rows the importer refuses');
  const blocked = cands.filter((c) => c.issue);
  blocked.length === 4
    ? ok('four rows blocked', blocked.map((b) => `row ${b.rowNumber}`).join(', '))
    : bad('wrong number blocked', `${blocked.length}: ${blocked.map((b) => b.issue).join(' | ')}`);

  const checks = [
    ['Cloud analytics sandbox', /no supplier named/i, 'third party with no supplier'],
    ['Payment switch', /must be 1 to 5/i, 'rating out of range'],
    ['Branch CCTV estate', /duplicates row/i, 'duplicate name'],
  ];
  for (const [name, pattern, label] of checks) {
    const row = cands.filter((c) => c.parsed?.name === name).find((c) => c.issue);
    row && pattern.test(row.issue)
      ? ok(label, row.issue.slice(0, 72))
      : bad(label, row ? row.issue : 'not blocked');
  }
  const noName = cands.find((c) => !c.parsed?.name);
  noName && /no asset name/i.test(noName.issue)
    ? ok('row with no name', noName.issue)
    : bad('unnamed row not blocked');

  // ── E. Blocked rows cannot be accepted ───────────────────────────────────
  console.log('\nE. A blocked row cannot be waved through');
  const tryAccept = await api(`/api/grc/asset-candidates/${blocked[0].id}`, {
    token: risk, method: 'PATCH', body: { status: 'Accepted' },
  });
  tryAccept.json.code === 'ROW_BLOCKED'
    ? ok('accepting a blocked row is refused', tryAccept.json.code)
    : bad('blocked row was accepted', `HTTP ${tryAccept.status}`);

  // ── F. Correcting a row clears the block ─────────────────────────────────
  console.log('\nF. Correct it, and the block clears');
  const sandbox = cands.filter((c) => c.parsed?.name === 'Cloud analytics sandbox').find((c) => c.issue);
  const fixed = await api(`/api/grc/asset-candidates/${sandbox.id}`, {
    token: risk, method: 'PATCH',
    body: { corrections: { vendorName: 'Regional Cloud Services Co.' }, status: 'Accepted' },
  });
  fixed.status === 200 && fixed.json.candidate?.status === 'Accepted'
    ? ok('naming the supplier cleared the block and accepted the row')
    : bad('correction did not clear the block', JSON.stringify(fixed.json).slice(0, 160));

  const switchRow = cands.filter((c) => c.parsed?.name === 'Payment switch').find((c) => c.issue);
  const reRated = await api(`/api/grc/asset-candidates/${switchRow.id}`, {
    token: risk, method: 'PATCH', body: { corrections: { confidentiality: 5 } },
  });
  reRated.json.candidate?.parsed?.criticality === 5 && !reRated.json.candidate?.issue
    ? ok('criticality re-derived from the correction', 'max(5,5,5) = 5')
    : bad('re-derivation wrong', JSON.stringify(reRated.json.candidate?.parsed).slice(0, 140));

  const badRating = await api(`/api/grc/asset-candidates/${switchRow.id}`, {
    token: risk, method: 'PATCH', body: { corrections: { integrity: 9 } },
  });
  badRating.status === 400
    ? ok('a correction cannot itself be out of range', badRating.json.message.slice(0, 60))
    : bad('bad correction accepted', `HTTP ${badRating.status}`);

  // ── G. Accept the clean rows in one action ───────────────────────────────
  console.log('\nG. Bulk-accept only what was read cleanly');
  const clean = await api(`/api/grc/assets/imports/${importId}/accept-clean`, { token: risk, method: 'POST' });
  clean.json.accepted > 0
    ? ok('clean rows accepted in one action', `${clean.json.accepted} row(s); defaulted rows still need review`)
    : bad('accept-clean did nothing', JSON.stringify(clean.json).slice(0, 140));

  // Accept the reviewed remainder by hand, the way a person would, so commit
  // exercises owner resolution and vendor linking too.
  const fresh = (await api(`/api/grc/assets/imports/${importId}`, { token: risk })).json.candidates || [];
  let acceptedByHand = 0;
  for (const c of fresh) {
    if (c.status !== 'Pending' || c.issue) continue;
    const r = await api(`/api/grc/asset-candidates/${c.id}`, { token: risk, method: 'PATCH', body: { status: 'Accepted' } });
    if (r.status === 200) acceptedByHand++;
  }
  acceptedByHand > 0
    ? ok('remaining reviewed rows accepted individually', `${acceptedByHand} row(s)`)
    : bad('nothing left to accept by hand');

  // ── H. Commit ────────────────────────────────────────────────────────────
  console.log('\nH. Commit writes the register');
  const before = (await api('/api/grc/assets', { token: risk })).json.count;
  const commit = await api(`/api/grc/assets/imports/${importId}/commit`, { token: risk, method: 'POST' });
  const after = (await api('/api/grc/assets', { token: risk })).json;

  commit.status === 200 && commit.json.committed > 0
    ? ok('assets created', `${before} → ${after.count} (${commit.json.committed} committed)`)
    : bad('commit failed', JSON.stringify(commit.json).slice(0, 180));

  (commit.json.notes || []).some((n) => /owner email/i.test(n))
    ? ok('unresolved owner emails reported, not silently swallowed', 'nobody@elsewhere.com')
    : bad('unresolved owner not reported', JSON.stringify(commit.json.notes));

  const imported = (after.assets || []).find((a) => a.name === 'Loan origination platform');
  imported && imported.criticality === 5 && imported.criticalityTier === 'Critical'
    ? ok('criticality derived on commit, not taken from the file', `${imported.ref} = Critical 5`)
    : bad('criticality wrong on the committed asset', imported ? `${imported.criticality}/${imported.criticalityTier}` : 'asset not found');

  const linkedVendor = (after.assets || []).find((a) => a.name === 'Marketing website');
  linkedVendor?.vendorId
    ? ok('a supplier name matching a vendor record was linked', 'Regional Cloud Services Co.')
    : bad('vendor not linked', `vendorId=${linkedVendor?.vendorId}`);

  const recommit = await api(`/api/grc/assets/imports/${importId}/commit`, { token: risk, method: 'POST' });
  recommit.status === 409
    ? ok('an import cannot be committed twice', recommit.json.message.slice(0, 60))
    : bad('double commit allowed', `HTTP ${recommit.status}`);

  // ── I. Authorisation ─────────────────────────────────────────────────────
  console.log('\nI. Importing needs the same capability as registering');
  if (staff) {
    const denied = await api('/api/grc/assets/import', {
      token: staff, method: 'POST',
      body: { fileName: 'x.csv', fileType: 'csv', contentBase64: Buffer.from('Asset name\nProbe').toString('base64') },
    });
    denied.status === 403
      ? ok('a role without asset, control or risk capability is refused', 'CAPABILITY_DENIED')
      : bad('capability gate', `expected 403, got ${denied.status}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('(Reseed afterwards: npx tsx src/seed.ts)\n');
  process.exit(fail === 0 ? 0 : 1);
})();
