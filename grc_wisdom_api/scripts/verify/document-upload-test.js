/**
 * A document library upload meets the standard delivery evidence already does.
 *
 * The library had a weaker path of its own: it stored whatever content type the
 * caller declared, took any extension at any size the 50 MB body limit let
 * through, recorded a hash of the base64 text rather than of the bytes, and
 * named files `${Date.now()}_${name}`. Uploads now go through the evidence
 * checks and store (services/documentFiles). Against a real API, on create,
 * edit and check-in alike:
 *
 *   - a program or script is refused, and nothing is stored;
 *   - a file over 25 MB is refused by the application, not by the body parser;
 *   - the stored type is read from the bytes — neither the declared fileType,
 *     the data-URI prefix nor the extension decides it — and is what a
 *     download is served as;
 *   - the stored fileHash is the SHA-256 of the file a download returns;
 *   - the storage key says nothing about the file or when it arrived.
 *
 * And for files written before the change: one already in uploads/ still
 * downloads byte for byte, and a check-in that carries it forward records the
 * hash of those bytes without rewriting the row before it. Old rows cannot be
 * made over HTTP any more, so that part writes one row directly and needs
 * DATABASE_URL and the server's own filesystem — as CI has. Elsewhere it says
 * it was skipped.
 *
 *   API=http://127.0.0.1:3000 node scripts/verify/document-upload-test.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const q = require('./qa/lib');

const v = q.verdicts('document-upload');
const stamp = Date.now().toString(36);
const API_ROOT = path.join(__dirname, '..', '..');
const STORE_DIR = path.join(API_ROOT, 'evidence-store');
const UPLOADS_DIR = path.join(API_ROOT, 'uploads');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const MAX_BYTES = 25 * 1024 * 1024;

// A real 1×1 PNG, a Windows executable header, and plain text pretending.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(254, 0x90)]);
const TEXT = Buffer.from(`Board minutes ${stamp}. Not a PDF, whatever the name says.\n`);

/** The file a download actually returns, as bytes, with its headers. */
async function download(token, id) {
  const r = await fetch(`${q.API}/api/documents/${id}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const bytes = Buffer.from(await r.arrayBuffer());
  return { status: r.status, bytes, type: r.headers.get('content-type') || '' };
}

const countFiles = (dir) => {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
};

(async () => {
  const manager = await q.login('eleanor.vance@globalbank.com'); // Compliance Manager
  const as = (method, url, body) => q.call(method, url, { token: manager.token, body });
  const step = async (name, ok, detail) => { v.record(`document-upload:${name}`, ok, detail); await q.pace(); };
  const doc = async (id) => (await as('GET', `/api/documents/${id}`)).json?.document;
  const newest = (d) => (d?.versions || [])[0];
  let n = 0;
  const create = (file) => as('POST', '/api/documents', {
    code: `QA-UPL-${stamp}-${(n += 1)}`, title: `Upload standard ${n}`, category: 'Policy',
    classification: 'Internal', content: 'Body text of the record.', ...file,
  });

  // ── Refused: programs and scripts, whatever the case of the extension ────
  const storeBefore = countFiles(STORE_DIR);
  const refused = [];
  for (const fileName of ['setup.exe', 'INSTALLER.EXE', 'payload.js']) {
    const r = await create({ fileName, fileType: 'application/pdf', fileData: EXE.toString('base64') });
    if (r.status !== 400 || r.json?.code !== 'DANGEROUS_TYPE') refused.push(`${fileName}: HTTP ${r.status} ${r.json?.code || r.json?.message || ''}`);
    await q.pace();
  }
  await step('an .exe (or a script) is refused', refused.length === 0, refused.join(' | '));

  const exeCode = `QA-UPL-${stamp}-1`;
  const listed = await as('GET', `/api/documents?search=${encodeURIComponent(exeCode)}`);
  const leaked = (listed.json?.documents || []).filter((d) => d.code === exeCode);
  await step('and no document is written for it', listed.status === 200 && leaked.length === 0,
    `HTTP ${listed.status}, ${leaked.length} matching`);

  // ── Refused: one byte over the limit, well under the 50 MB body limit ────
  const big = await create({
    fileName: 'scan.pdf', fileType: 'application/pdf',
    fileData: Buffer.alloc(MAX_BYTES + 1, 0x25).toString('base64'),
  });
  await step('a file over 25 MB is refused by the application',
    big.status === 400 && big.json?.code === 'FILE_TOO_LARGE' && /25 MB/.test(big.json?.message || ''),
    `HTTP ${big.status} ${big.json?.code || ''} ${big.json?.message || big.text || ''}`);

  // What a browser's FileReader produces for a zero-byte file.
  const empty = await create({ fileName: 'empty.pdf', fileData: 'data:application/pdf;base64,' });
  await step('an empty file is refused', empty.status === 400 && empty.json?.code === 'EMPTY_FILE',
    `HTTP ${empty.status} ${empty.json?.code || empty.json?.message || ''}`);

  // ── Type from the bytes: a PNG declared, twice over, as HTML ─────────────
  const png = await create({
    fileName: 'network-diagram.png', fileType: 'text/html',
    fileData: `data:text/html;base64,${PNG.toString('base64')}`,
  });
  const pngId = png.json?.document?.id;
  await step('a real file is accepted', png.status === 201 && Boolean(pngId), `HTTP ${png.status} ${png.json?.message || ''}`);
  if (!pngId) { v.finish(); return; }

  const pngDoc = await doc(pngId);
  await step('the stored type comes from the bytes, not the declared type or the data-URI prefix',
    pngDoc?.fileType === 'image/png' && newest(pngDoc)?.fileType === 'image/png',
    `document ${pngDoc?.fileType}, version ${newest(pngDoc)?.fileType}`);

  const fake = await create({ fileName: 'board-minutes.pdf', fileType: 'application/pdf', fileData: TEXT.toString('base64') });
  const fakeDoc = fake.json?.document?.id ? await doc(fake.json.document.id) : null;
  await step('nor from the extension: text named .pdf is not stored as a PDF',
    fakeDoc?.fileType === 'application/octet-stream', `stored ${fakeDoc?.fileType} (HTTP ${fake.status})`);

  // ── The hash is of the bytes, and the download proves it ─────────────────
  const got = await download(manager.token, pngId);
  await step('the download returns the bytes that were uploaded', got.status === 200 && got.bytes.equals(PNG),
    `HTTP ${got.status}, ${got.bytes.length} bytes (sent ${PNG.length})`);
  await step('the stored fileHash is the SHA-256 of the downloaded file',
    newest(pngDoc)?.fileHash === sha256(got.bytes),
    `stored ${newest(pngDoc)?.fileHash}, downloaded ${sha256(got.bytes)}`);
  await step('the download is served as the stored type', got.type.startsWith('image/png'), `Content-Type ${got.type}`);

  const key = pngDoc?.fileUrl || '';
  await step('the storage key is opaque: no name, no timestamp',
    /^store:[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{60}$/.test(key) && !/network|diagram|png/i.test(key),
    key);

  // The suite and the server share a disk in CI. When they do, the disk is
  // checked too; when they do not, the HTTP checks above stand on their own.
  const local = fs.existsSync(path.join(STORE_DIR, key.replace(/^store:/, '')));
  if (local) {
    // The refusals above must have left nothing behind: the only files added
    // since are the PNG and the fake PDF.
    await step('a refused file leaves nothing in the store', countFiles(STORE_DIR) === storeBefore + 2,
      `${countFiles(STORE_DIR) - storeBefore} new files for 2 accepted uploads`);
  }

  // ── Edit: a refused replacement changes nothing, an accepted one is hashed
  const badEdit = await as('PUT', `/api/documents/${pngId}`, { fileName: 'update.exe', fileData: EXE.toString('base64') });
  const afterBad = await doc(pngId);
  await step('editing in an .exe is refused and the file stays as it was',
    badEdit.status === 400 && badEdit.json?.code === 'DANGEROUS_TYPE' && afterBad?.fileUrl === key,
    `HTTP ${badEdit.status} ${badEdit.json?.code || ''}`);

  const pdf = Buffer.from(`%PDF-1.4\n% upload standard ${stamp}\n%%EOF\n`);
  const edit = await as('PUT', `/api/documents/${pngId}`, { fileName: 'diagram-v2.pdf', fileType: 'image/png', fileData: pdf.toString('base64') });
  const edited = await doc(pngId);
  const gotEdit = await download(manager.token, pngId);
  await step('an edit stores the type from the bytes and the hash of the downloaded file',
    edit.status === 200 && edited?.fileType === 'application/pdf'
      && gotEdit.bytes.equals(pdf) && newest(edited)?.fileHash === sha256(gotEdit.bytes),
    `HTTP ${edit.status}, type ${edited?.fileType}, hash ${newest(edited)?.fileHash === sha256(gotEdit.bytes) ? 'matches' : 'differs'}`);

  // ── Check-in: refused, then accepted, then carried forward ───────────────
  const out = await as('POST', `/api/documents/${pngId}/checkout`);
  const badIn = await as('POST', `/api/documents/${pngId}/checkin`, { summary: 'x', fileName: 'macro.exe', fileData: EXE.toString('base64') });
  await step('checking in an .exe is refused', out.status === 200 && badIn.status === 400 && badIn.json?.code === 'DANGEROUS_TYPE',
    `checkout HTTP ${out.status}, checkin HTTP ${badIn.status} ${badIn.json?.code || ''}`);

  const xlsxLike = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`register ${stamp}`)]);
  const checkin = await as('POST', `/api/documents/${pngId}/checkin`, {
    summary: 'Register attached', fileName: 'asset-register.xlsx', fileType: 'text/plain', fileData: xlsxLike.toString('base64'),
  });
  const checkedIn = await doc(pngId);
  const gotIn = await download(manager.token, pngId);
  await step('a check-in stores the type from the bytes and the hash of the downloaded file',
    checkin.status === 200
      && checkedIn?.fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      && newest(checkedIn)?.versionNumber === '1.1'
      && gotIn.bytes.equals(xlsxLike) && newest(checkedIn)?.fileHash === sha256(gotIn.bytes),
    `HTTP ${checkin.status} ${checkin.json?.message || ''}, type ${checkedIn?.fileType}, v${newest(checkedIn)?.versionNumber}`);

  await as('POST', `/api/documents/${pngId}/checkout`);
  const carried = await as('POST', `/api/documents/${pngId}/checkin`, { summary: 'Text only', content: 'Revised body text.' });
  const carriedDoc = await doc(pngId);
  await step('a check-in that carries the file forward records the hash of those bytes',
    carried.status === 200 && newest(carriedDoc)?.versionNumber === '1.2'
      && newest(carriedDoc)?.fileHash === sha256(xlsxLike),
    `HTTP ${carried.status}, v${newest(carriedDoc)?.versionNumber} hash ${newest(carriedDoc)?.fileHash}`);

  // ── A file already in uploads/ from before the change ────────────────────
  const dbUrl = process.env.DATABASE_URL;
  if (!local || !dbUrl) {
    console.log(`document-upload: legacy uploads/ checks skipped — ${local ? 'no DATABASE_URL' : 'the API is not on this filesystem'}`);
  } else {
    const { Client } = require('pg');
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      const legacyName = `${Date.now()}_legacy-policy-${stamp}.txt`;
      const legacyBytes = Buffer.from(`Policy uploaded before the store, ${stamp}.\n`);
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      fs.writeFileSync(path.join(UPLOADS_DIR, legacyName), legacyBytes);

      const made = await create({});
      const legacyId = made.json?.document?.id;
      // The shape the old path wrote: a /uploads/ URL and a caller-declared type.
      await db.query(
        'UPDATE "Document" SET "fileUrl" = $1, "fileName" = $2, "fileSize" = $3, "fileType" = $4 WHERE "id" = $5',
        [`/uploads/${legacyName}`, 'legacy-policy.txt', legacyBytes.length, 'text/plain', legacyId],
      );
      const before = await db.query('SELECT "id", "fileHash" FROM "DocumentVersion" WHERE "documentId" = $1', [legacyId]);

      const gotLegacy = await download(manager.token, legacyId);
      await step('a file already in uploads/ still downloads, byte for byte',
        gotLegacy.status === 200 && gotLegacy.bytes.equals(legacyBytes),
        `HTTP ${gotLegacy.status}, ${gotLegacy.bytes.length} bytes, ${gotLegacy.type}`);

      await as('POST', `/api/documents/${legacyId}/checkout`);
      const legacyIn = await as('POST', `/api/documents/${legacyId}/checkin`, { summary: 'Carried forward' });
      const legacyDoc = await doc(legacyId);
      const after = await db.query('SELECT "id", "fileHash" FROM "DocumentVersion" WHERE "id" = ANY($1)', [before.rows.map((r) => r.id)]);
      await step('carrying it forward hashes its bytes, and the row before is not rewritten',
        legacyIn.status === 200 && newest(legacyDoc)?.fileHash === sha256(legacyBytes)
          && after.rows.length === before.rows.length
          && after.rows.every((r) => before.rows.find((b) => b.id === r.id)?.fileHash === r.fileHash),
        `HTTP ${legacyIn.status}, new hash ${newest(legacyDoc)?.fileHash === sha256(legacyBytes) ? 'matches' : 'differs'}`);
    } finally {
      await db.end();
    }
  }

  v.finish();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
