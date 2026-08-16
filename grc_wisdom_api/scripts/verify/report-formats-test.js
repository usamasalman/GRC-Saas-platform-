/**
 * Verifies every report renders in every format, and that each file actually
 * opens in a reader for that format — not merely that bytes were produced.
 *
 *   node scripts/verify/report-formats-test.js
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');

const API = process.env.API || 'http://localhost:3000';
const TMP = path.join(__dirname, '_tmp_reports');

const out = (s) => console.log(`   ${s}`);

async function api(p, { token, raw } = {}) {
  const res = await fetch(API + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (raw) return { res, buffer: Buffer.from(await res.arrayBuffer()) };
  const t = await res.text();
  try { return JSON.parse(t); } catch { return { message: t.slice(0, 120) }; }
}
async function login(email) {
  const res = await fetch(API + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Demo@2026' }),
  });
  return (await res.json()).token;
}

/** Opens the file with a real reader and returns something about its content. */
async function inspect(file, format) {
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    return `${wb.worksheets.length} sheet(s): ${wb.worksheets.map((w) => `${w.name}(${w.rowCount})`).join(', ')}`;
  }
  if (format === 'pdf') {
    const parser = new PDFParse({ data: fs.readFileSync(file) });
    try {
      const r = await parser.getText();
      const words = String(r.text || '').split(/\s+/).filter(Boolean).length;
      return `${r.total} page(s), ${words} words`;
    } finally { await parser.destroy?.(); }
  }
  const r = await mammoth.extractRawText({ buffer: fs.readFileSync(file) });
  const words = String(r.value || '').split(/\s+/).filter(Boolean).length;
  return `${words} words`;
}

/** The provenance block has to survive into every format. */
async function textOf(file, format) {
  if (format === 'pdf') {
    const parser = new PDFParse({ data: fs.readFileSync(file) });
    try { return String((await parser.getText()).text || ''); } finally { await parser.destroy?.(); }
  }
  if (format === 'docx') {
    return String((await mammoth.extractRawText({ buffer: fs.readFileSync(file) })).value || '');
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  let t = '';
  wb.worksheets.forEach((w) => w.eachRow((r) => { t += r.values.join(' ') + '\n'; }));
  return t;
}

(async () => {
  if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
  const grc = await login('grc.manager@omniops.me');
  const aud = await login('internal.audit@omniops.me');
  if (!grc) { console.error('API not reachable'); process.exit(1); }

  const audits = await api('/api/grc/audits', { token: aud });
  const eng = (audits.audits || [])[0];
  const plans = await api('/api/grc/plans', { token: aud });
  const plan = (plans.plans || [])[0];

  const reports = [
    ['RCM', `/api/grc/audits/${eng?.id}/export/rcm`],
    ['Audit report', `/api/grc/audits/${eng?.id}/export/report`],
    ['Issue register', '/api/grc/reports/issues'],
    ['Framework coverage', '/api/grc/reports/framework-coverage'],
  ];
  if (plan) reports.push(['Annual plan', `/api/grc/plans/${plan.id}/export`]);

  let pass = 0, fail = 0;

  for (const [name, url] of reports) {
    console.log(`\n${name}`);
    for (const format of ['xlsx', 'pdf', 'docx']) {
      const { res, buffer } = await api(`${url}?format=${format}`, { token: grc, raw: true });
      if (res.status !== 200) {
        let m = '';
        try { m = JSON.parse(buffer.toString()).message; } catch { m = buffer.toString().slice(0, 80); }
        out(`${format.padEnd(5)} FAILED HTTP ${res.status} — ${m}`);
        fail++;
        continue;
      }
      const file = path.join(TMP, `${name.replace(/\s+/g, '_')}.${format}`);
      fs.writeFileSync(file, buffer);
      try {
        const detail = await inspect(file, format);
        const disp = res.headers.get('content-disposition') || '';
        const fn = (disp.match(/filename="(.+?)"/) || [])[1] || '';
        out(`${format.padEnd(5)} ${(buffer.length / 1024).toFixed(1).padStart(6)} KB  ${detail.padEnd(46)} ${fn}`);
        pass++;
      } catch (e) {
        out(`${format.padEnd(5)} UNREADABLE — ${e.message.slice(0, 70)}`);
        fail++;
      }
    }
  }

  console.log('\nProvenance survives into every format:');
  for (const format of ['xlsx', 'pdf', 'docx']) {
    const f = path.join(TMP, `RCM.${format}`);
    if (!fs.existsSync(f)) continue;
    const t = await textOf(f, format);
    const has = (s) => (t.includes(s) ? 'yes' : 'NO');
    out(`${format.padEnd(5)} organisation:${has('OmniOps')}  generated-by:${has('grc.manager@omniops.me')}  draft-notice:${has('DRAFT')}`);
  }

  console.log('\nAn unknown format is refused:');
  const { res: bad, buffer: bb } = await api('/api/grc/reports/issues?format=rtf', { token: grc, raw: true });
  let bm = '';
  try { const j = JSON.parse(bb.toString()); bm = `${j.code}: ${j.message}`; } catch { bm = bb.toString().slice(0, 60); }
  out(`HTTP ${bad.status} — ${bm}`);

  console.log(`\n${pass} rendered and opened cleanly, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
