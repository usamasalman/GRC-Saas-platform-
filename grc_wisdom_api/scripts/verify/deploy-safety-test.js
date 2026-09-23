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
