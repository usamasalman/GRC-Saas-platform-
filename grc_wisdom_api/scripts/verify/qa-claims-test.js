/**
 * What the product says about itself is true.
 *
 * The BRD Traceability screen (GET /api/system/brd) shows each requirement
 * with a status, and every one of the twelve says "Verified". A customer's
 * auditor reads that screen as a statement of fact. For the requirements that
 * are compliance claims, this checks the claim against the code or the
 * deployment it rests on — not against the screen's own text.
 *
 * Found this way: PDPL field encryption (REQ-08) has an encrypt function that
 * nothing calls, with its key written into the source (QA-017); and the
 * residency claim (REQ-12, OCI Riyadh) sits beside a pipeline whose only
 * deploy job ships to a Contabo server (QA-018).
 *
 * ZATCA (REQ-07) and quotas (REQ-10) are checked where they can be checked
 * properly: journey-billing-test issues a real invoice, and qa-write-guards
 * follows the usage reads into their controllers.
 *
 *   node scripts/verify/qa-claims-test.js
 */
const fs = require('fs');
const path = require('path');
const q = require('./qa/lib');

const v = q.verdicts('qa-claims');

// The claims, as the screen makes them.
const system = q.read(path.join(q.API_SRC, 'controllers', 'systemController.ts'));
const claim = (id) => {
  const line = system.split('\n').find((l) => l.includes(`id: '${id}'`)) || '';
  return { verified: /status:\s*'Verified'/.test(line), text: line };
};

// All source files, comments stripped, so a mention in a comment proves nothing.
const sources = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.ts$/.test(e.name)) sources.push({ file: path.relative(q.API_SRC, p).replace(/\\/g, '/'), src: q.strip(q.read(p)) });
  }
}(q.API_SRC));

// ─── REQ-08: PDPL-encrypted PII fields ─────────────────────────────────────
{
  const c = claim('REQ-08');
  const helper = sources.find((s) => s.file === 'utils/pdplUtils.ts');
  const callers = sources.filter((s) => s.file !== 'utils/pdplUtils.ts' && /\bencryptPii\s*\(/.test(s.src)).map((s) => s.file);
  const writers = sources.filter((s) => /encryptedNationalId\s*:|encryptedPhone\s*:/.test(s.src)).map((s) => s.file);
  v.record('claims:REQ-08 PII is encrypted when it is stored', !c.verified || (callers.length > 0 && writers.length > 0),
    `the screen says Verified, but encryptPii() is called from ${callers.length ? callers.join(', ') : 'nowhere'} `
    + `and the encrypted fields are written by ${writers.length ? writers.join(', ') : 'nothing'}`);
  v.record('claims:REQ-08 the encryption key comes from configuration', !helper || /process\.env\./.test(helper.src),
    'utils/pdplUtils.ts derives its key from a string in the source; anyone with the repository can decrypt');
}

// ─── REQ-12: data residency in OCI Riyadh ───────────────────────────────────
{
  const c = claim('REQ-12');
  const deploy = q.read(path.join(q.ROOT, '.github', 'workflows', 'deploy.yml'));
  const target = (deploy.match(/name:\s*(Deploy to [^\n]+)/) || [])[1] || 'no deploy job found';
  const riyadh = /me-riyadh-1|ocir\.io|oraclecloud/i.test(deploy);
  v.record('claims:REQ-12 the deployment is in OCI Riyadh', !c.verified || riyadh,
    `the screen says Verified for OCI Riyadh (me-riyadh-1), but the pipeline's deploy job is "${target}"`);
}

// ─── Dashboards show figures they computed ─────────────────────────────────
// A number with a literal fallback (`|| 84`) or a trend written into the markup
// ("+4 this quarter", "+18.7% YoY") reads as a measurement and is not one
// (QA-024). A dashboard that cannot compute a figure shows a dash.
{
  const dir = path.join(q.WEB_SRC, 'pages', 'dashboard');
  const invented = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
    const lines = q.read(path.join(dir, f)).split('\n');
    lines.forEach((line, n) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      const hit = line.match(new RegExp([
        /(\|\||\?\?)\s*\d{2,}\s*\}/.source, // a literal fallback for a count
        /[+-]\d+(\.\d+)?%?\s+(this|vs|from last)\s+(quarter|month|week|year)/.source, // a trend
        /\d+(\.\d+)?%\s+(active|YoY)|%\s*YoY/.source,
        /\b\d+\s+(open\s+)?(tickets|users|tools|organi[sz]ations|expiries|subscriptions)\b/.source, // a count in prose
        /points="\d/.source, // a chart drawn from fixed points
        />\s*\d+(\.\d+)?%\s*</.source, // a percentage written into the markup
        /\[\s*'[A-Z][\w &]+',\s*\d+\s*\]/.source, // a fixed label/number series
      ].join('|')));
      if (hit) invented.push(`${f}:${n + 1} "${hit[0].trim()}"`);
    });
  }
  v.record('claims:dashboards show only figures they computed', invented.length === 0,
    `${invented.length} invented figure(s): ${invented.join(', ')}`);
}

v.finish(`${['REQ-08', 'REQ-12'].filter((id) => claim(id).verified).length} of 2 claims checked are marked Verified`);
