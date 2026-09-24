/**
 * The security headers the product relies on are actually configured.
 *
 * The API sets its own through helmet. The application pages are not served
 * by the API: nginx in the web image serves them and Caddy fronts both, so
 * whatever helmet says never reaches the page a person signs in on. This reads
 * all three configurations rather than trusting any one of them.
 *
 * Found this way: nothing on the web path sets X-Frame-Options or a CSP
 * frame-ancestors, so the sign-in page and every approve and publish button
 * can be framed by another site (QA-009).
 *
 *   node scripts/verify/qa-headers-test.js
 */
const path = require('path');
const q = require('./qa/lib');

const app = q.strip(q.read(path.join(q.API_SRC, 'app.ts')));
const caddy = q.read(path.join(q.ROOT, 'deploy', 'Caddyfile'));
const nginx = q.read(path.join(q.ROOT, 'Dockerfile.web'));
const web = `${caddy}\n${nginx}`;

const v = q.verdicts('qa-headers');

v.record('headers:api-helmet', /\bhelmet\(/.test(app), 'the API no longer applies helmet');
v.record('headers:api-no-powered-by', /helmet\(|x-powered-by/i.test(app), 'the API may advertise Express');
v.record('headers:edge-nosniff', /X-Content-Type-Options\s+nosniff/.test(caddy),
  'the edge no longer sets nosniff on static assets');
v.record('headers:edge-hides-server', /-Server\b/.test(caddy), 'the edge advertises its server software');
v.record(
  'headers:web-frame-protection',
  /X-Frame-Options|frame-ancestors/i.test(web),
  'no X-Frame-Options or CSP frame-ancestors on the pages nginx serves or on the Caddy edge',
);

v.finish();
