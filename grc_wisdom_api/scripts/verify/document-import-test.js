/**
 * Verifies PDF and Word clause extraction behind the staging gate.
 *
 * The generated test documents deliberately include the things that break a
 * naive line scan: a running header on every page, page numbers, a table of
 * contents whose entries look like clauses, and clauses whose text wraps.
 *
 *   node scripts/verify/document-import-test.js
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, HeadingLevel } = require('docx');

const API = process.env.API || 'http://localhost:3000';
const TMP = path.join(__dirname, '_tmp');

const step = (n, s) => console.log(`\n${n}. ${s}`);
const out = (s) => console.log(`   ${s}`);
const say = (r) => out((r.code ? `${r.code}: ` : '') + (r.message || JSON.stringify(r).slice(0, 140)));

async function api(p, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  try { return JSON.parse(t); } catch { return { status: 'error', message: t.slice(0, 140) }; }
}
const login = async (email) =>
  (await api('/api/auth/login', { method: 'POST', body: { email, password: 'Demo@2026' } })).token;

const CLAUSES = [
  ['5.1', 'Leadership and commitment',
   'Top management shall demonstrate leadership and commitment with respect to the information security management system by ensuring the policy and objectives are established and are compatible with the strategic direction of the organization.'],
  ['5.2', 'Policy',
   'Top management shall establish an information security policy that is appropriate to the purpose of the organization and includes information security objectives.'],
  ['6.1.2', 'Information security risk assessment',
   'The organization shall define and apply an information security risk assessment process that establishes and maintains criteria including risk acceptance criteria.'],
  ['7.2', 'Competence',
   'The organization shall determine the necessary competence of persons doing work under its control that affects its information security performance.'],
  ['8.1', 'Operational planning and control',
   'The organization shall plan, implement and control the processes needed to meet requirements and to implement the actions determined in Clause 6.'],
];

function buildPdf(file) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(file);
    doc.pipe(stream);

    // Cover and a contents page whose entries mimic clause lines.
    doc.fontSize(18).text('Information Security Management Standard', { align: 'center' });
    doc.moveDown().fontSize(10).text('Internal framework, version 3.1', { align: 'center' });
    doc.addPage();
    doc.fontSize(14).text('Contents');
    doc.moveDown().fontSize(10);
    CLAUSES.forEach(([ref, title], i) => {
      doc.text(`${ref} ${title} ${'.'.repeat(Math.max(4, 60 - title.length))} ${i + 3}`);
    });

    CLAUSES.forEach(([ref, title, text]) => {
      doc.addPage();
      // A running header repeated on every content page.
      doc.fontSize(8).fillColor('#666').text('Information Security Management Standard — v3.1', { align: 'right' });
      doc.moveDown().fillColor('#000');
      doc.fontSize(12).text(`${ref} ${title}`);
      doc.moveDown(0.4).fontSize(10).text(text, { align: 'justify' });
      doc.moveDown(2).fontSize(8).fillColor('#666').text(String(doc.bufferedPageRange().count + 1), { align: 'center' });
    });

    doc.end();
    stream.on('finish', resolve);
  });
}

async function buildDocx(file) {
  const children = [
    new Paragraph({ text: 'Information Security Management Standard', heading: HeadingLevel.TITLE }),
    new Paragraph({ text: 'Internal framework, version 3.1' }),
    new Paragraph({ text: '' }),
  ];
  for (const [ref, title, text] of CLAUSES) {
    children.push(new Paragraph({ text: `${ref} ${title}`, heading: HeadingLevel.HEADING_2 }));
    children.push(new Paragraph({ text }));
  }
  const doc = new Document({ sections: [{ children }] });
  fs.writeFileSync(file, await Packer.toBuffer(doc));
}

async function runImport(token, file, name, code) {
  const up = await api('/api/grc/imports', {
    method: 'POST', token,
    body: {
      kind: 'Clause', fileName: name,
      fileData: fs.readFileSync(file).toString('base64'),
      newStandardCode: code, newStandardTitle: 'Information Security Management',
      newStandardAuthority: 'Internal', newStandardVersion: '3.1',
    },
  });
  say(up);
  if (!up.import) return null;
  if (up.source) out(`source: ${JSON.stringify(up.source)}`);
  (up.warnings || []).forEach((w) => out(`warning: ${w}`));

  const review = await api(`/api/grc/imports/${up.import.id}`, { token });
  out(`extracted ${review.totals.extracted} · needs attention ${review.totals.needsAttention}`);
  for (const c of review.candidates) {
    out(`  ${c.confidence.padEnd(6)} ${(c.ref || '(none)').padEnd(10)} ${(c.title || '(no title)').slice(0, 44).padEnd(44)} ${c.issue ? '! ' + c.issue.slice(0, 46) : ''}`);
  }
  return { id: up.import.id, review };
}

(async () => {
  if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
  const pdf = path.join(TMP, 'isms.pdf');
  const docx = path.join(TMP, 'isms.docx');
  await buildPdf(pdf);
  await buildDocx(docx);

  const grc = await login('grc.manager@omniops.me');
  if (!grc) { console.error('API not reachable'); process.exit(1); }

  console.log('=== PDF ===');
  step(1, 'Upload a PDF with cover, contents, running headers and page numbers:');
  const pdfRun = await runImport(grc, pdf, 'isms.pdf', 'ISMS-PDF');

  if (pdfRun) {
    step(2, 'Accept the clean clauses and commit:');
    say(await api(`/api/grc/imports/${pdfRun.id}/accept-clean`, { method: 'POST', token: grc, body: {} }));
    say(await api(`/api/grc/imports/${pdfRun.id}/commit`, { method: 'POST', token: grc, body: {} }));
  }

  console.log('\n=== WORD ===');
  step(3, 'Upload the same standard as .docx:');
  const docxRun = await runImport(grc, docx, 'isms.docx', 'ISMS-DOCX');

  step(4, 'A control set cannot be imported from prose:');
  say(await api('/api/grc/imports', {
    method: 'POST', token: grc,
    body: { kind: 'Control', fileName: 'isms.pdf', fileData: fs.readFileSync(pdf).toString('base64') },
  }));

  step(5, 'A file with no recognisable clause numbering:');
  const junk = path.join(TMP, 'junk.docx');
  const d = new Document({ sections: [{ children: [new Paragraph({ text: 'This memo has no clause numbering at all, only prose about the weather.' })] }] });
  fs.writeFileSync(junk, await Packer.toBuffer(d));
  say(await api('/api/grc/imports', {
    method: 'POST', token: grc,
    body: {
      kind: 'Clause', fileName: 'junk.docx', fileData: fs.readFileSync(junk).toString('base64'),
      newStandardCode: 'JUNK', newStandardTitle: 'Junk',
    },
  }));

  step(6, 'What actually landed in the library:');
  const stds = await api('/api/grc/standards', { token: grc });
  for (const c of ['ISMS-PDF', 'ISMS-DOCX', 'JUNK']) {
    const s = (stds.standards || []).find((x) => x.code === c);
    out(s ? `${s.code}: ${s.clauseCount} clauses` : `${c}: not created`);
  }
  console.log('');
})();
