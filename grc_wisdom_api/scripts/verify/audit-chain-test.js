/**
 * The audit chain has to be able to verify itself.
 *
 * writeAudit hashed `previousHash:action:payload:timestampStr`, where
 * timestampStr came from the Node clock, and then inserted the row without it.
 * `timestamp` took its @default(now()) from Postgres a few milliseconds later,
 * so verifyAuditTrail — which recomputed the digest from the stored timestamp
 * — could never reproduce it.
 *
 * Measured against a database this product wrote itself: the first row of the
 * busiest tenant verified only against a timestamp 5 ms earlier than the one
 * stored, and every tenant holding audit rows was reported TAMPERED. That is
 * the one control a GRC platform exists to provide, accusing its own customers
 * of forging their compliance record.
 *
 * Two rules, and they are a pair:
 *   1. the writer stores the instant the digest covers, and
 *   2. the verifier checks the digest against that instant.
 * Either alone leaves the chain unverifiable, so both are pinned here.
 *
 *   node scripts/verify/audit-chain-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const writerSrc = read(API, 'middlewares', 'auditMiddleware.ts');
const writer = code(writerSrc);
const verifierSrc = read(API, 'controllers', 'dbAdminController.ts');
const verifier = code(verifierSrc);
const schema = read(API, '..', 'prisma', 'schema.prisma');
const deploy = read(API, '..', '..', '.github', 'workflows', 'deploy.yml');

const MIGRATIONS = path.join(__dirname, '..', '..', 'prisma', 'migrations');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

// ─── The writer stores what it hashed ───────────────────────────────────────
{
  const fn = writer.slice(writer.indexOf('export async function writeAudit'));

  ok(
    /const timestampStr = new Date\(\)\.toISOString\(\);/.test(fn),
    'writeAudit seals the entry at a single instant',
  );
  ok(
    /generateHash\(\s*`\$\{previousHash\}:\$\{entry\.action\}:\$\{payloadString\}:\$\{timestampStr\}`/.test(fn),
    'and that instant is the last field of the digest',
  );

  // THE RULE. The value in the digest and the value in the row are the same
  // variable. Asserting only that hashedAt is written would pass a second
  // new Date(), which is the bug wearing a different name.
  ok(
    /hashedAt: new Date\(timestampStr\),/.test(fn),
    'THE PACKET: the row stores the instant the digest covers, from the same '
    + 'variable. A second new Date() here is milliseconds later and the chain '
    + 'stops verifying again',
  );

  ok(
    /previousHash = lastLog\?\.currentHash \|\| GENESIS_HASH/.test(fn),
    'the chain starts from the shared genesis constant',
  );
}

// ─── The schema keeps the two facts apart ───────────────────────────────────
{
  const model = schema.slice(schema.indexOf('model AuditLog {'));
  const body = model.slice(0, model.indexOf('\n}'));

  ok(
    /hashedAt\s+DateTime\?/.test(body),
    'hashedAt is nullable — rows written before it existed never stored what '
    + 'they hashed, and a NOT NULL column would have had to invent a value for them',
  );
  ok(
    /timestamp\s+DateTime @default\(now\(\)\)/.test(body),
    'timestamp still records when the row landed. They are two different facts '
    + 'and collapsing them is what hid the defect',
  );
  ok(
    /currentHash\s+String\s+@unique/.test(body),
    'and currentHash stays unique, so a replayed row cannot be inserted twice',
  );
}

// ─── The migration is additive ──────────────────────────────────────────────
{
  const dir = fs.readdirSync(MIGRATIONS).find((d) => d.endsWith('_audit_hashed_at'));
  ok(Boolean(dir), 'the column arrives through a migration, not a db push');

  const sql = read(MIGRATIONS, dir, 'migration.sql');
  ok(
    /ADD COLUMN "hashedAt" TIMESTAMP\(3\);/.test(sql),
    'the column is added',
  );
  ok(
    !/DROP |TRUNCATE|DELETE FROM|NOT NULL/i.test(sql),
    'and nothing is dropped, emptied or made mandatory. This runs against a '
    + 'database in use',
  );
}

// ─── The verifier checks against the sealed instant ─────────────────────────
{
  const fn = verifier.slice(verifier.indexOf('export const verifyAuditTrail'));

  ok(
    /const sealed = log\.hashedAt \?\? log\.timestamp;/.test(fn),
    'THE PACKET: the verifier recomputes against hashedAt. Falling back to '
    + 'timestamp keeps the legacy rows that did store what they hashed',
  );
  ok(
    /generateHash\(\s*`\$\{expectedHash\}:\$\{log\.action\}:\$\{log\.payload\}:\$\{new Date\(sealed\)\.toISOString\(\)\}`/.test(fn),
    'and the digest it rebuilds is the one the writer built',
  );
  ok(
    !/new Date\(log\.timestamp\)\.toISOString\(\)/.test(fn),
    'the old form — verifying against the landing time alone — is gone',
  );

  ok(
    /import \{ GENESIS_HASH \} from '\.\.\/middlewares\/auditMiddleware'/.test(verifierSrc),
    'the genesis constant is imported from the writer rather than retyped. Two '
    + 'copies of a 72-character literal agree until one of them does not',
  );

  // A legacy row that does not reproduce proves nothing. Saying TAMPERED about
  // it is a false accusation about a compliance record nobody touched.
  ok(
    /if \(!log\.hashedAt\) \{[\s\S]{0,400}?unverifiable \+= 1;[\s\S]{0,200}?expectedHash = log\.currentHash;[\s\S]{0,120}?continue;/.test(fn),
    'THE PACKET: an unreproducible row with no hashedAt is counted as '
    + 'unverifiable and the chain carries on through it, so one legacy row at '
    + 'the start of a tenant\'s history cannot hide everything written since',
  );

  // But a row that DID store what it hashed and still fails has been changed.
  const afterLegacy = fn.slice(fn.indexOf('if (!log.hashedAt)'));
  ok(
    // `break batches;` since the chain is read in batches (QA-022): it leaves
    // the batch loop as well as the row loop, so nothing after it is read.
    /chainValid = false;[\s\S]{0,200}?overallIntegrity = false;[\s\S]{0,200}?tamperedLogId = log\.id;\s*break( batches)?;/.test(afterLegacy),
    'and a sealed row that does not reproduce still stops the chain and names '
    + 'itself. Without this the endpoint reports nothing but good news',
  );

  ok(
    /unverifiableCount: unverifiable/.test(fn) && /verifiedCount: verified/.test(fn),
    'both counts are reported. "142 rows, 3 of them unverifiable" is a finding '
    + 'somebody has to explain to an assessor, and a single VALID would bury it',
  );
  ok(
    /'VALID_SINCE'/.test(fn) && /'UNVERIFIABLE'/.test(fn) && /'TAMPERED'/.test(fn),
    'and the three outcomes are distinguishable: intact, unverifiable, changed',
  );
}

// ─── CI ─────────────────────────────────────────────────────────────────────
{
  ok(
    /audit-chain-test\.js/.test(deploy),
    'CI must run this. A rule that is not in the workflow is one the next '
    + 'packet can delete',
  );
}

console.log(`audit-chain: ${checks} assertions passed`);
