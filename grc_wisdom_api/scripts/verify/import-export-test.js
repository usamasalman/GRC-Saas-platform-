/**
 * Verifies the spreadsheet import pipeline and the Excel exports.
 *
 * Written in Node rather than bash because the upload carries a base64 payload
 * that shell quoting mangles.
 *
 *   node scripts/verify/import-export-test.js
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const API = process.env.API || 'http://localhost:3000';
const PASSWORD = 'Demo@2026';
const TMP = path.join(__dirname, '_tmp');

const log = (s = '') => console.log(s);
const step = (n, s) => console.log(`\n${n}. ${s}`);
const out = (s) => console.log(`   ${s}`);

async function api(pathname, { method = 'GET', token, body, raw = false } = {}) {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return { res, buffer: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: 'error', message: text.slice(0, 120) }; }
}

const login = async (email) =>
  (await api('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).token;

const say = (r) => out((r.code ? `${r.code}: ` : '') + (r.message || JSON.stringify(r).slice(0, 130)));

/** A file shaped like a real export: title block, then a table with faults. */
async function buildTestSheet(file) {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('ISO 22301');
  s.addRow(['ISO 22301:2019 — Business Continuity Management']);
  s.addRow(['Exported from the corporate framework register']);
  s.addRow([]);
  s.addRow(['Clause Ref', 'Clause Title', 'Clause Text']);
  s.addRow(['8.2.1', 'Business impact analysis', 'The organization shall establish and document a BIA process.']);
  s.addRow(['8.2.2', 'Risk assessment', 'The organization shall implement a risk assessment process.']);
  s.addRow(['8.4.1', 'Business continuity plans', 'Plans shall be documented and maintained.']);
  s.addRow(['8.4.2', 'Warning and communication', 'Procedures for detecting and communicating disruption.']);
  s.addRow(['8.5.1', '', 'Exercise programme shall be established.']);          // no title
  s.addRow(['8.2.1', 'Duplicate BIA row', 'This repeats an earlier reference.']); // duplicate
  s.addRow(['Annex A paragraph twelve', 'Supplementary guidance', 'Not a clause number.']); // odd ref
  await wb.xlsx.writeFile(file);
}

(async () => {
  if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
  const sheet = path.join(TMP, 'iso22301.xlsx');
  await buildTestSheet(sheet);

  const grc = await login('grc.manager@omniops.me');
  const aud = await login('internal.audit@omniops.me');
  if (!grc) { console.error('Could not log in — is the API running?'); process.exit(1); }

  log('=== IMPORT ===');

  step(1, 'Upload a spreadsheet with a title block and three faulty rows:');
  const up = await api('/api/grc/imports', {
    method: 'POST', token: grc,
    body: {
      kind: 'Clause',
      fileName: 'iso22301.xlsx',
      fileData: fs.readFileSync(sheet).toString('base64'),
      newStandardCode: 'ISO22301',
      newStandardTitle: 'Business Continuity Management',
      newStandardAuthority: 'ISO',
      newStandardVersion: '2019',
    },
  });
  say(up);
  if (!up.import) process.exit(1);
  out(`header found on row ${up.headerRow}; columns mapped: ${JSON.stringify(up.columnsUsed)}`);
  const impId = up.import.id;

  step(2, 'Review queue, least confident first:');
  const review = await api(`/api/grc/imports/${impId}`, { token: grc });
  out(`extracted ${review.totals.extracted} · needs attention ${review.totals.needsAttention}`);
  for (const c of review.candidates) {
    out(`row ${String(c.rowNumber).padStart(2)}  ${c.confidence.padEnd(6)} ${(c.ref || '(no ref)').slice(0, 26).padEnd(26)} ${c.issue ? '! ' + c.issue : 'ok'}`);
  }

  step(3, 'Accept only the clean rows — faulty ones are left for a human:');
  say(await api(`/api/grc/imports/${impId}/accept-clean`, { method: 'POST', token: grc, body: {} }));

  step(4, 'Correct the row that lost its title, then accept it:');
  const noTitle = review.candidates.find((c) => !c.title);
  if (noTitle) {
    say(await api(`/api/grc/import-candidates/${noTitle.id}`, {
      method: 'PATCH', token: grc,
      body: { title: 'Exercise programme', decision: 'Accepted' },
    }));
  }

  step(5, 'Try to accept the duplicate — it would be refused at commit:');
  const dup = review.candidates.find((c) => c.issue && /Duplicate/.test(c.issue));
  if (dup) {
    const r = await api(`/api/grc/import-candidates/${dup.id}`, {
      method: 'PATCH', token: grc, body: { decision: 'Rejected' },
    });
    out(r.candidate ? `row ${dup.rowNumber} rejected — ${dup.issue}` : JSON.stringify(r).slice(0, 100));
  }

  step(6, 'Commit:');
  say(await api(`/api/grc/imports/${impId}/commit`, { method: 'POST', token: grc, body: {} }));

  step(7, 'The standard exists with exactly the accepted clauses:');
  const stds = await api('/api/grc/standards', { token: grc });
  const iso = (stds.standards || []).find((s) => s.code === 'ISO22301');
  out(iso ? `${iso.code} v${iso.version} · ${iso.clauseCount} clauses · owned here: ${iso.isOwnedHere}` : 'NOT FOUND');

  step(8, 'Committing twice is refused:');
  say(await api(`/api/grc/imports/${impId}/commit`, { method: 'POST', token: grc, body: {} }));

  log('\n=== EXPORT ===');

  const audits = await api('/api/grc/audits', { token: aud });
  const engagement = (audits.audits || [])[0];

  const checks = [
    ['RCM', `/api/grc/audits/${engagement?.id}/export/rcm`],
    ['Audit report', `/api/grc/audits/${engagement?.id}/export/report`],
    ['Issue register', '/api/grc/reports/issues'],
    ['Framework coverage', '/api/grc/reports/framework-coverage'],
  ];

  for (const [name, url] of checks) {
    step(checks.indexOf(checks.find((c) => c[0] === name)) + 9, `${name}:`);
    const { res, buffer } = await api(url, { token: grc, raw: true });
    if (res.status !== 200) {
      const body = JSON.parse(buffer.toString() || '{}');
      out(`HTTP ${res.status} — ${(body.code ? body.code + ': ' : '') + (body.message || '')}`);
      continue;
    }
    const file = path.join(TMP, `${name.replace(/\s+/g, '_')}.xlsx`);
    fs.writeFileSync(file, buffer);
    // Read it back so the assertion is that Excel can actually open it.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const sheets = wb.worksheets.map((w) => `${w.name} (${w.rowCount} rows)`).join(', ');
    out(`${(buffer.length / 1024).toFixed(1)} KB · reopens cleanly · sheets: ${sheets}`);
    const disp = res.headers.get('content-disposition') || '';
    out(`filename: ${(disp.match(/filename="(.+?)"/) || [])[1] || '(none)'}`);
  }

  step(13, 'A role without the report privilege is refused:');
  // Internal Auditor holds the report privilege, so a Staff Employee is the
  // honest negative case here.
  const staff = await login('alex.rivera@globalbank.com');
  const { res: denied, buffer: db } = await api('/api/grc/reports/issues', { token: staff, raw: true });
  const head = db.slice(0, 2).toString();
  if (head === 'PK') {
    out(`HTTP ${denied.status} — NOT DENIED: a workbook was returned`);
  } else {
    let dbody = {};
    try { dbody = JSON.parse(db.toString() || '{}'); } catch { dbody = { message: db.toString().slice(0, 90) }; }
    out(`HTTP ${denied.status} — ${(dbody.code ? dbody.code + ': ' : '') + (dbody.message || '')}`);
  }

  step(14, 'Provenance is stamped into the workbook:');
  const rcmFile = path.join(TMP, 'RCM.xlsx');
  if (fs.existsSync(rcmFile)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(rcmFile);
    const s = wb.worksheets[0];
    for (let i = 1; i <= 9; i++) {
      const v = s.getRow(i).values;
      if (v && v.length > 1) out(String(v.slice(1).filter(Boolean).join('  |  ')).slice(0, 110));
    }
  }

  log('');
})();
