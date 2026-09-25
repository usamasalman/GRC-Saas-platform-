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
// The one verifier, shared by the database console and the security screen.
const verifierSrc = read(API, 'services', 'auditChain.ts');
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
  const fn = verifier.slice(verifier.indexOf('export async function verifyTenantChain'));

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
    /chainValid = false;[\s\S]{0,200}?tamperedLogId = log\.id;\s*break( batches)?;/.test(afterLegacy),
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

// ─── One verifier (QA-027) ──────────────────────────────────────────────────
//
// The platform security screen had its own check: the oldest 100 rows on the
// platform, organisations interleaved, each row's link compared with whatever
// row preceded it and no digest recomputed. Measured on a freshly seeded
// database it reported TAMPERING after 8 rows, while this verifier found all
// 18 organisations' chains VALID. Two verifiers disagreed; one had to go.
{
  const bodyOf = (file, fnName) => {
    const src = code(read(API, 'controllers', file));
    const at = src.indexOf(`export const ${fnName}`);
    const next = src.indexOf('\nexport ', at + 1);
    return at < 0 ? '' : src.slice(at, next > 0 ? next : src.length);
  };
  for (const [file, fnName] of [['dbAdminController.ts', 'verifyAuditTrail'], ['systemController.ts', 'verifyWormIntegrity']]) {
    const body = bodyOf(file, fnName);
    ok(/verifyTenantChain\(/.test(body), `${fnName} verifies through the shared verifyTenantChain`);
    ok(!/previousHash|generateHash|auditLog\.findMany/.test(body),
      `and ${fnName} walks no chain of its own, so the two cannot disagree about one trail`);
  }
  const worm = bodyOf('systemController.ts', 'verifyWormIntegrity');
  ok(/scope\.tenantIds/.test(worm.slice(0, worm.indexOf('verifyTenantChain('))),
    'the security screen verifies the organisations in the caller\'s scope, each chain on its own');
  ok(!/take:\s*\d+/.test(worm),
    'and reads every row rather than a sample of the oldest hundred');
}

// ─── One append at a time per organisation (QA-029) ─────────────────────────
//
// Two requests arriving together both read the same last entry and both
// chained to it. Each entry was intact and every verifier called the trail
// tampered. Pinned behaviourally by audit-concurrency-test; the shape is
// pinned here so a refactor cannot quietly drop a piece of it.
{
  const fn = writer.slice(writer.indexOf('export async function writeAudit'));
  const lockAt = fn.search(/pg_advisory_xact_lock\(hashtextextended\(\$\{entry\.tenantId\}/);
  const readAt = fn.indexOf('tx.auditLog.findFirst');
  ok(lockAt > 0 && readAt > lockAt,
    'THE PACKET: writeAudit takes a per-organisation advisory lock BEFORE it reads the last '
    + 'entry. A lock taken after the read serialises nothing');
  ok(/if \(\(tx as unknown\) === prisma\) \{\s*return prisma\.\$transaction\(/.test(fn),
    'called with the client rather than a transaction, it opens one: a transaction-scoped lock '
    + 'taken outside a transaction ends with its own statement and guards nothing. The client is '
    + 'recognised by identity: a transaction client carries a $transaction too, and testing for '
    + 'the method nested every write in a second transaction until the pool starved');
  ok(/where: \{ tenantId: entry\.tenantId, chainSeq: \{ not: null \} \},\s*orderBy: \{ chainSeq: 'desc' \}/.test(fn),
    'the predecessor is the entry with the highest position — not the latest landing time, and '
    + 'never an unpositioned row, which Postgres sorts first when descending');
  ok(/const chainSeq = \(lastLog\?\.chainSeq \?\? 0\) \+ 1;/.test(fn) && /\bchainSeq,\n/.test(fn),
    'and the new entry takes the next position');
  ok(/@@unique\(\[tenantId, chainSeq\]\)/.test(schema),
    'two entries at one position fail on the unique index rather than fork quietly');

  ok(/orderBy: \{ chainSeq: 'asc' \}/.test(verifier) && /chainSeq: \{ gt: after \}/.test(verifier),
    'the verifier reads in position order, by position range: a cursor over a nullable sort '
    + 'column can stop early at a NULL without saying so');
  ok(/const forkParent = log\.orderInferred && recent\.has\(log\.previousHash\)/.test(verifier),
    'a fork is forgiven only among entries whose order was inferred at migration, and only '
    + 'onto an entry just read; anywhere else it is tampering');
  ok(/'FORKED'/.test(verifier) && /forkedCount: forked/.test(verifier),
    'and it is reported as FORKED, with a count, rather than folded into VALID');

  const seq = fs.readdirSync(MIGRATIONS).find((d) => /audit_chain_sequence$/.test(d));
  const sql = seq ? read(MIGRATIONS, seq, 'migration.sql').replace(/^\s*--[^\n]*$/gm, '') : '';
  ok(/ROW_NUMBER\(\) OVER \(PARTITION BY "tenantId" ORDER BY "timestamp", "id"\)/.test(sql)
    && /"orderInferred" = true/.test(sql),
    'existing entries are numbered in the order the verifier already read them, and marked as '
    + 'inferred, so a chain that verified before verifies the same way');
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
