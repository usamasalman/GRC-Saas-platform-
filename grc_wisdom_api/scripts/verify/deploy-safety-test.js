/**
 * A deploy cannot destroy the data already on the platform.
 *
 * This is not a hypothetical. Between 2026-08-04 and 2026-08-29 the API
 * container started with `prisma db push --accept-data-loss && node
 * dist/seed.js`. seed.ts opens with deleteMany() calls ending in
 * prisma.tenant.deleteMany(), and roughly forty models cascade from Tenant, so
 * every deploy, every restart and every crash-loop recovery wiped the
 * customer's database and refilled it with fictional demo tenants.
 *
 * The Dockerfile was fixed. Nothing stopped it happening again, and nothing
 * stopped a future migration from carrying a DROP COLUMN. This suite is what
 * stops both, and it is deliberately blunt: it reads the actual deploy path
 * and the actual migration SQL rather than trusting a comment.
 *
 * The four properties, each of which failed in production at least once:
 *
 *   1. Migrations only add. No DROP, no TRUNCATE, no DELETE FROM, no column
 *      made mandatory on a table that already has rows.
 *   2. The container runs `migrate deploy`, never `db push`, never the seed.
 *   3. The deploy job never invokes the seed, on any host, by any name.
 *   4. The seed refuses to run where the data could be real, and the Prisma
 *      CLI refuses to guess a database URL.
 *
 *   node scripts/verify/deploy-safety-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..');
const ROOT = path.join(API, '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const MIGRATIONS = path.join(API, 'prisma', 'migrations');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

// ─── 1. Every migration only adds ───────────────────────────────────────────
const dirs = fs.readdirSync(MIGRATIONS)
  .filter((d) => fs.existsSync(path.join(MIGRATIONS, d, 'migration.sql')));

ok(dirs.length > 0, 'there are migrations to check');

for (const d of dirs) {
  // Comments carry the words on purpose — several migrations explain what they
  // are deliberately NOT doing — so only statements count.
  const sql = read(MIGRATIONS, d, 'migration.sql')
    .replace(/^\s*--[^\n]*$/gm, '');

  ok(
    !/\bDROP\s+(TABLE|COLUMN|DATABASE|SCHEMA)\b/i.test(sql),
    `${d}: drops nothing. A dropped column takes its data with it and no `
    + 'deploy can put it back',
  );
  ok(
    !/\bTRUNCATE\b/i.test(sql) && !/\bDELETE\s+FROM\b/i.test(sql),
    `${d}: empties nothing`,
  );
  ok(
    !/\bSET\s+NOT\s+NULL\b/i.test(sql),
    `${d}: makes no existing column mandatory. Every row already there would `
    + 'have to satisfy it, and the migration fails halfway through a deploy',
  );

  // ADD COLUMN ... NOT NULL without a DEFAULT fails outright on a table that
  // has rows — which is every table on a platform in use.
  const adds = sql.match(/ADD COLUMN[^,;]*/gi) || [];
  for (const stmt of adds) {
    ok(
      !/\bNOT\s+NULL\b/i.test(stmt) || /\bDEFAULT\b/i.test(stmt),
      `${d}: "${stmt.trim().slice(0, 70)}" is NOT NULL with no DEFAULT. On an `
      + 'empty CI database this passes and on a populated one it fails',
    );
  }
}

// ─── 2. The container runs migrations, not the seed ─────────────────────────
{
  const dockerfile = read(API, 'Dockerfile');
  const cmd = (dockerfile.match(/^CMD\s+.*$/m) || [''])[0];

  ok(
    /prisma migrate deploy/.test(cmd),
    'the container applies migrations before serving. `migrate deploy` only '
    + 'applies what has not run and never rewrites what has',
  );
  ok(
    !/db push/.test(cmd) && !/accept-data-loss/.test(cmd),
    'THE PACKET: `db push --accept-data-loss` is not in the start command. It '
    + 'reshapes a live schema to match the file, dropping whatever does not fit',
  );
  ok(
    !/seed/i.test(cmd),
    'THE PACKET: the start command does not seed. This exact line, once, cost '
    + 'a customer twenty-five days of data',
  );
}

// ─── 3. The deploy job never seeds the server ───────────────────────────────
{
  const deploy = read(ROOT, '.github', 'workflows', 'deploy.yml');
  const at = deploy.indexOf('\n  deploy:');
  ok(at > 0, 'the workflow has a deploy job');

  const deployJob = deploy.slice(at);
  ok(
    !/seed/i.test(deployJob),
    'THE PACKET: nothing in the deploy job mentions seeding, under any name. '
    + 'The steps in it are the ones that run against the live database',
  );
  ok(
    /npm run provision/.test(deployJob),
    'it converges reference data with provision instead',
  );

  const provision = read(API, 'src', 'provision.ts');
  ok(
    !/\.deleteMany\(|\.delete\(/.test(provision),
    'and provision deletes nothing. It runs on every deploy, so an unguarded '
    + 'delete in it is the same bug wearing a safer name',
  );

  // Reference data converges; operator-controlled state does not get reset.
  ok(
    /already provisioned, password untouched/.test(provision),
    "provision does not reset an existing administrator's password on every deploy",
  );
}

// ─── 4. The seed and the CLI both refuse to guess ───────────────────────────
{
  const seed = read(API, 'src', 'seed.ts');
  ok(
    /REFUSING TO SEED/.test(seed),
    'the seed refuses rather than running where the data could be real',
  );
  ok(
    /process\.env\.NODE_ENV === 'production'/.test(seed),
    'NODE_ENV=production is one of the reasons it refuses',
  );
  ok(
    /--i-know-this-deletes-everything/.test(seed),
    'and an explicit argv flag is required as well, because NODE_ENV can be '
    + 'unset by accident in a container — it is a default, not a decision',
  );

  const config = read(API, 'prisma.config.ts');
  const cfgCode = config
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok(
    !/process\.env\.DATABASE_URL\s*\|\|/.test(cfgCode),
    'THE PACKET: prisma.config.ts does not fall back to a guessed URL. Its own '
    + 'docstring said there was no fallback while the line below it supplied '
    + 'one — a guessed URL is how `migrate deploy` reports success against a '
    + 'database nobody is using',
  );
  ok(
    /throw new Error\(/.test(cfgCode) && /DATABASE_URL is not set/.test(config),
    'it throws instead, naming what is missing',
  );
}

// ─── 5. The production image carries no demo credential ─────────────────────
//
// The demo seed gives every account it creates one shared password, and tsc
// compiled that seed — and the 35 demo accounts in utils/mockData.ts — into
// dist/, which the Dockerfile copied into the image whole. Nothing the server
// runs needed any of it. The image now drops them, and these checks keep it so.
//
// The password is read out of seed.ts rather than written here, so this file
// is not one more place that publishes it.
{
  const SRC = path.join(API, 'src');
  const seedSrc = read(API, 'src', 'seed.ts');
  const mockSrc = read(API, 'src', 'utils', 'mockData.ts');

  const demoPassword = (seedSrc.match(/const DEMO_PASSWORD = '([^']+)'/) || [])[1];
  ok(Boolean(demoPassword), 'the seed still declares its shared password where this check can find it');

  const secrets = new Set([demoPassword]);
  for (const m of mockSrc.matchAll(/password:\s*'([^']+)'/g)) secrets.add(m[1]);
  ok(secrets.size >= 1, 'and the demo accounts\' passwords are collected from the mock data');

  // Every source file that is compiled into the image, except the two the
  // image deletes.
  const shipped = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|json)$/.test(e.name)) shipped.push(p);
    }
  };
  walk(SRC);
  const EXCLUDED = new Set([
    path.join(SRC, 'seed.ts'),
    path.join(SRC, 'utils', 'mockData.ts'),
    path.join(SRC, 'utils', 'seedData.json'),
  ]);

  const leaks = shipped
    .filter((p) => !EXCLUDED.has(p))
    .filter((p) => [...secrets].some((s) => fs.readFileSync(p, 'utf8').includes(s)))
    .map((p) => path.relative(API, p));
  ok(
    leaks.length === 0,
    'THE PACKET: no file that ships in the image contains a demo password — not in '
    + 'code, and not in a comment either, because comments survive compiling. '
    + `Found in: ${leaks.join(', ')}`,
  );

  // Deleting them is only safe while the server never loads them.
  const importers = shipped
    .filter((p) => !EXCLUDED.has(p) && /\.ts$/.test(p))
    .filter((p) => /utils\/mockData|seedData\.json|from '\.\/seed'|from "\.\/seed"/.test(fs.readFileSync(p, 'utf8')))
    .map((p) => path.relative(API, p));
  ok(
    importers.length === 0,
    'nothing the server runs imports the demo seed or its data, so the image can '
    + `drop them without breaking a route. Imported by: ${importers.join(', ')}`,
  );

  const dockerfile = read(API, 'Dockerfile');
  const runtime = dockerfile.slice(dockerfile.indexOf('AS runner'));
  const copyAt = runtime.indexOf('COPY --from=builder /app/dist ./dist');
  const rmAt = runtime.indexOf('RUN rm -f dist/seed.js');
  ok(copyAt >= 0, 'the runtime stage copies the compiled output');
  ok(
    rmAt > copyAt,
    'THE PACKET: and then removes the demo seed from it. Removing it before the copy '
    + 'would delete nothing',
  );
  const rmLine = runtime.slice(rmAt, runtime.indexOf('\n\n', rmAt) > 0 ? runtime.indexOf('\n\n', rmAt) : undefined);
  for (const f of ['dist/seed.js', 'dist/utils/mockData.js', 'dist/utils/seedData.json']) {
    ok(rmLine.includes(f), `the image drops ${f}`);
  }
}

// ─── CI ─────────────────────────────────────────────────────────────────────
{
  const deploy = read(ROOT, '.github', 'workflows', 'deploy.yml');
  ok(
    /deploy-safety-test\.js/.test(deploy),
    'CI must run this. A rule that is not in the workflow is one the next '
    + 'packet can delete',
  );
}

console.log(
  `deploy-safety: ${checks} assertions passed (${dirs.length} migrations checked)`,
);
