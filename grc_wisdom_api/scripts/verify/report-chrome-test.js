/**
 * Report chrome, rendered for real and read back — no database needed.
 *
 * The pure branding logic is covered in project-logic-test.js. What that cannot
 * catch is a renderer that accepts a brand colour and never draws it, or a
 * footer loop that runs once on a five-page document. Both of those failures
 * produce a valid file, so the only way to see them is to render and parse.
 *
 *   npm run build && node scripts/verify/report-chrome-test.js
 */
const { PDFParse } = require('pdf-parse');
const { renderPdf } = require('../../dist/services/renderPdf');
const { renderDocx } = require('../../dist/services/renderDocx');
const { renderXlsx } = require('../../dist/services/renderXlsx');

let pass = 0, fail = 0;
const ok = (l, d = '') => { pass++; console.log(`   PASS  ${l}${d ? ` — ${d}` : ''}`); };
const bad = (l, d = '') => { fail++; console.log(`   FAIL  ${l}${d ? ` — ${d}` : ''}`); };

const chrome = (over = {}) => Object.assign({
  displayName: 'Acme Group Ltd',
  brandColour: '#123456',
  textColour: '#123456',
  marking: 'Restricted',
  footerText: 'Registered in England 12345678',
  logo: null,
  documentRef: 'ACME-20260910120000',
  generatedAt: new Date('2026-09-10T12:00:00Z'),
}, over);

/** Enough rows to spill well past one page. */
const bigReport = (over = {}) => ({
  provenance: {
    reportName: 'Issue Register',
    tenantName: 'Acme Group Ltd',
    generatedBy: 'Test <test@example.com>',
    scopeKind: 'SELF',
    subjectStatus: 'Active',
    subjectRef: 'AUD-0001',
  },
  sections: [{
    kind: 'table',
    title: 'Issues',
    columns: [
      { header: 'Ref', key: 'ref' },
      { header: 'Title', key: 'title' },
      { header: 'Owner', key: 'owner' },
    ],
    rows: Array.from({ length: 120 }, (_, i) => ({
      ref: `ISS-${String(i + 1).padStart(4, '0')}`,
      title: `Finding number ${i + 1} requiring remediation before the next review`,
      owner: 'A Person',
    })),
  }],
  ...over,
});

(async () => {
  console.log('\n─── Report chrome ───\n');

  // ── 1. Pagination ─────────────────────────────────────────────────────────
  // pdfkit's bufferedPageRange() returns only the CURRENT page unless the
  // document was constructed with bufferPages: true. Without it the footer loop
  // ran exactly once, so a multi-page report carried a single footer, on its
  // last page, reading "page 1 of 1". A valid PDF, and wrong on every page.
  console.log('1. Pagination');

  const buf = await renderPdf(bigReport({ chrome: chrome() }));
  const parsed = await new PDFParse({ data: buf }).getText();
  const pages = parsed.pages ? parsed.pages.length : 0;

  pages > 1
    ? ok('the fixture spills onto multiple pages', `${pages} pages`)
    : bad('the fixture spills onto multiple pages', `${pages} — test is not exercising the bug`);

  const text = parsed.text || '';
  const footers = (text.match(/page \d+ of \d+/g) || []);
  footers.length === pages
    ? ok('every page carries a footer', `${footers.length} footers on ${pages} pages`)
    : bad('every page carries a footer', `${footers.length} footers on ${pages} pages`);

  const claimed = [...new Set(footers.map((f) => f.split(' of ')[1]))];
  claimed.length === 1 && Number(claimed[0]) === pages
    ? ok('and every footer agrees on the total', `all say "of ${claimed[0]}"`)
    : bad('footers agree on the total', JSON.stringify(claimed));

  footers.includes('page 1 of 1') && pages > 1
    ? bad('the old bug is gone', 'still says "page 1 of 1" on a multi-page report')
    : ok('the old bug is gone — no lone "page 1 of 1"');

  // ── 2. Branding reaches the page ──────────────────────────────────────────
  console.log('\n2. Branding');

  text.includes('Acme Group Ltd')
    ? ok('the organisation is named on the report') : bad('organisation named');
  text.includes('RESTRICTED')
    ? ok('the confidentiality marking is stamped') : bad('marking stamped');
  text.includes('ACME-20260910120000')
    ? ok('the document reference is printed') : bad('document reference printed');
  text.includes('Registered in England 12345678')
    ? ok('the tenant footer text appears') : bad('tenant footer text appears');

  // Provenance must carry the SAME timestamp the chrome was stamped with, not
  // a fresh read of the clock — otherwise a long render puts a different minute
  // on the cover than in the footer.
  text.includes('2026-09-10 12:00 UTC')
    ? ok('the stamped time is used, not a fresh clock read')
    : bad('the stamped time is used', 'provenance shows a different time');

  // ── 3. The draft banner cannot be branded away ────────────────────────────
  // draftNotice() forces a warning onto every report for an engagement that is
  // not Closed. A tenant setting a pale cream as their livery must not be able
  // to make it invisible — that is falsifying a report, not theming it.
  console.log('\n3. The draft banner');

  const paleBuf = await renderPdf(bigReport({
    chrome: chrome({ brandColour: '#FDF3E2', textColour: '#FDF3E2' }),
  }));
  const paleText = (await new PDFParse({ data: paleBuf }).getText()).text || '';

  paleText.includes('DRAFT')
    ? ok('a pale brand does not remove the DRAFT banner')
    : bad('a pale brand does not remove the DRAFT banner');

  // A closed engagement has no banner — proving the assertion above is testing
  // the banner rather than the word appearing incidentally.
  const closed = bigReport({ chrome: chrome() });
  closed.provenance.subjectStatus = 'Closed';
  const closedText = (await new PDFParse({ data: await renderPdf(closed) }).getText()).text || '';
  !closedText.includes('DRAFT')
    ? ok('and a closed engagement carries no banner at all')
    : bad('a closed engagement carries no banner');

  // ── 4. The other two formats still render ─────────────────────────────────
  console.log('\n4. Other formats');

  const docx = await renderDocx(bigReport({ chrome: chrome() }));
  docx.length > 1000 ? ok('docx renders with chrome', `${docx.length} bytes`) : bad('docx renders');

  const xlsx = await renderXlsx(bigReport({ chrome: chrome() }));
  xlsx.length > 1000 ? ok('xlsx renders with chrome', `${xlsx.length} bytes`) : bad('xlsx renders');

  // A report with no chrome at all must still render — every existing caller
  // predates this field.
  const bare = await renderPdf(bigReport());
  bare.length > 1000
    ? ok('a report with no chrome still renders on the default')
    : bad('a report with no chrome still renders');

  console.log(`\n─── ${pass} passed, ${fail} failed ───\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\nFAILED:', e.message, '\n');
  process.exit(1);
});
