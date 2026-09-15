/**
 * The browser hides a control on the same rule the server refuses it.
 *
 * Until now no button in the frontend read capabilities at all. Every action
 * rendered for every role and failed at the API, which is what the owner
 * described as the product creating "hallucinations and misconception": a
 * Platform Security Admin was shown Delete on a control, pressed it, and was
 * told the permission was not granted -- while signed in as the role the
 * message named.
 *
 * Can.tsx fixes the symptom by reading MAY from navCapabilities. That helps
 * only while MAY still describes what grcRoutes.ts actually enforces, and the
 * two files are edited by different work for different reasons. Drift either
 * way is a defect the product cannot explain to the person in front of it:
 *
 *   - A route widened while MAY stays narrow hides a control from someone
 *     entitled to use it. The screen simply has no button and says nothing.
 *   - A route narrowed while MAY stays wide puts the 403 back, which is the
 *     bug this packet exists to remove.
 *
 * So this reads both files and compares them. It resolves named guards
 * (MAY_MAINTAIN_ASSETS and friends) as well as inline requireCapability and
 * requireAnyCapability calls, and compares capability *values*, not constant
 * names -- nav-capabilities-test.js already pins the names to the engine.
 *
 *   node scripts/verify/guarded-actions-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROUTES = path.join(__dirname, '..', '..', 'src', 'routes', 'grcRoutes.ts');
const PROJECT_ROUTES = path.join(__dirname, '..', '..', 'src', 'routes', 'projectRoutes.ts');
const NAV = path.join(__dirname, '..', '..', '..', 'src', 'pages', 'navCapabilities.ts');

// Two route files now. MAY describes rules wherever they are enforced, and a
// key pinned against a file it does not live in would silently verify nothing.
const routes = [ROUTES, PROJECT_ROUTES].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const nav = fs.readFileSync(NAV, 'utf8');

/**
 * One representative write per MAY entry.
 *
 * Representative, not exhaustive: every route in a group carries the same
 * guard, and pinning one of each keeps this readable. Anything that gives a
 * group a second rule needs its own entry here and its own MAY key, because a
 * single button cannot honour two different rules.
 */
const ANCHOR = {
  MANAGE_RISK: "router.post('/risks',",
  MAINTAIN_ASSET: "router.post('/assets',",
  MANAGE_VENDOR: "router.post('/vendors',",
  MANAGE_ISSUE: "router.delete('/issues/:id',",
  RESPOND_TO_ISSUE: "router.post('/issues/:id/respond',",
  ASSIGN_CAP: "router.post('/issues/:id/cap',",
  CLOSE_ISSUE: "router.post('/issues/:id/close',",
  AUTHOR_STANDARD: "router.post('/standards',",
  AUTHOR_CONTROL: "router.post('/controls',",
  MANAGE_IMPLEMENTATION: "router.post('/implementations',",
  MANAGE_SHARED_SERVICE: "router.post('/shared-services',",
  MANAGE_PROJECT: "router.post('/:id/members',",
};

let checks = 0;

// ── The capability constants, by name ──────────────────────────────────────
const capBlock = nav.match(/export const CAP = \{([\s\S]*?)\} as const;/);
assert.ok(capBlock, 'CAP block not found in navCapabilities.ts');
const capValue = {};
for (const m of capBlock[1].matchAll(/^\s*(\w+):\s*'([^']+)'/gm)) capValue[m[1]] = m[2];

// ── What the frontend believes, from MAY ───────────────────────────────────
const mayBlock = nav.match(/export const MAY = \{([\s\S]*?)\n\} as const;/);
checks += 1;
assert.ok(mayBlock, 'MAY block not found in navCapabilities.ts');

const declared = {};
for (const m of mayBlock[1].matchAll(/^\s{2}(\w+):\s*\[([^\]]*)\]/gm)) {
  const names = [...m[2].matchAll(/CAP\.(\w+)/g)].map((c) => c[1]);
  checks += 1;
  assert.ok(names.length > 0, `MAY.${m[1]} lists no capability`);
  for (const n of names) {
    checks += 1;
    assert.ok(n in capValue, `MAY.${m[1]} names CAP.${n}, which CAP does not define`);
  }
  declared[m[1]] = new Set(names.map((n) => capValue[n]));
}

// Every entry is anchored, and every anchor is an entry. An unanchored MAY key
// is an unverified claim about the server.
checks += 1;
assert.deepStrictEqual(
  Object.keys(declared).sort(), Object.keys(ANCHOR).sort(),
  'MAY and ANCHOR disagree about which registers are covered. Add the route '
  + 'anchor for a new MAY entry, or remove the stale anchor.',
);

// ── What the server enforces ───────────────────────────────────────────────
/** Capability values inside a guard expression, following one named guard. */
function capsIn(expr) {
  const direct = [...expr.matchAll(/CAP\.(\w+)/g)].map((m) => m[1]);
  if (direct.length > 0) return direct;
  const named = expr.match(/\b(MAY_[A-Z_]+)\b/);
  if (!named) return [];
  // Sliced rather than matched with a built RegExp: the guard spans lines, and
  // a pattern assembled from a template literal is one escape away from
  // matching nothing and reporting it as an unguarded route.
  const at = routes.indexOf(`const ${named[1]} = require`);
  if (at < 0) return [];
  const end = routes.indexOf(");", at);
  if (end < 0) return [];
  return [...routes.slice(at, end).matchAll(/CAP\.(\w+)/g)].map((m) => m[1]);
}

for (const [key, anchor] of Object.entries(ANCHOR)) {
  const at = routes.indexOf(anchor);
  checks += 1;
  assert.ok(at >= 0, `Route anchor for MAY.${key} not found in grcRoutes.ts: ${anchor}`);

  // The guard is what sits between the path and the controller.
  const line = routes.slice(at, routes.indexOf('\n', at));
  const args = line.slice(anchor.length, line.lastIndexOf(','));
  const names = capsIn(args);

  checks += 1;
  assert.ok(
    names.length > 0,
    `${anchor} has no capability guard, but the frontend hides its controls behind `
    + `MAY.${key}. Either guard the route or stop pretending it is guarded.`,
  );
  for (const n of names) {
    checks += 1;
    assert.ok(n in capValue, `${anchor} guards on CAP.${n}, unknown to the frontend's CAP`);
  }

  const enforced = new Set(names.map((n) => capValue[n]));
  const missing = [...enforced].filter((c) => !declared[key].has(c));
  const extra = [...declared[key]].filter((c) => !enforced.has(c));

  checks += 1;
  assert.deepStrictEqual(
    { missing, extra }, { missing: [], extra: [] },
    `MAY.${key} does not match ${anchor}\n`
    + `  the server accepts but the browser hides from: ${missing.join(', ') || '(none)'}\n`
    + `  the browser shows but the server refuses:      ${extra.join(', ') || '(none)'}\n`
    + 'Update MAY in src/pages/navCapabilities.ts to match the route.',
  );
}

// ── Can.tsx must not fail closed on a missing capability list ──────────────
// An older token, a changed response shape or a parse failure all arrive as
// "unknown". Rendering nothing in that case turns one bad deploy into a product
// nobody can operate, and the server is enforcing either way.
{
  const can = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'Can.tsx'), 'utf8',
  );
  checks += 1;
  assert.ok(
    /if \(!held\) return true;/.test(can),
    'Can.tsx must treat an unknown capability list as permitted. Hiding every '
    + 'control when the list cannot be read locks out real users to no benefit.',
  );
  checks += 1;
  assert.ok(
    !/\bimport\b[^\n]*\bapiClient\b/.test(can),
    'Can.tsx must not call the API. It reads the stored user; the capability list '
    + 'is refreshed once by AppShell from /api/auth/me.',
  );
}

// ── The registers actually use the guard ───────────────────────────────────
// A screen can lose its guards to an ordinary refactor without anything
// failing: the buttons come back, the API still refuses them, and the product
// is back to showing a Delete that cannot work. Pin the screens this packet
// covered so that removing a guard has to be deliberate.
{
  const SRC = path.join(__dirname, '..', '..', '..', 'src', 'pages', 'grc');
  const GUARDED = {
    'RiskRegister.tsx': ['MAY.MANAGE_RISK'],
    'AssetRegister.tsx': ['MAY.MAINTAIN_ASSET', 'MAY.MANAGE_RISK'],
    'VendorRegister.tsx': ['MAY.MANAGE_VENDOR'],
    'FrameworkAuthoring.tsx': ['MAY.AUTHOR_STANDARD', 'MAY.AUTHOR_CONTROL'],
    'StandardsLibrary.tsx': ['MAY.AUTHOR_STANDARD'],
    'TenantStandardEnablement.tsx': ['MAY.AUTHOR_STANDARD'],
    'project/ProjectTeam.tsx': ['MAY.MANAGE_PROJECT'],
    'project/ProjectPlan.tsx': ['MAY.MANAGE_PROJECT'],
    'audit/IssueRegister.tsx': [
      'MAY.MANAGE_ISSUE', 'MAY.RESPOND_TO_ISSUE', 'MAY.ASSIGN_CAP', 'MAY.CLOSE_ISSUE',
    ],
  };

  for (const [file, expected] of Object.entries(GUARDED)) {
    const code = fs.readFileSync(path.join(SRC, ...file.split('/')), 'utf8');

    checks += 1;
    assert.ok(
      /from '(?:\.\.\/)+components\/Can'/.test(code),
      `${file} no longer imports the capability guard. Every write control on a `
      + 'register must be behind Can or can().',
    );
    for (const e of expected) {
      checks += 1;
      assert.ok(
        code.includes(e),
        `${file} no longer guards anything with ${e}. If the screen changed, update `
        + 'GUARDED here; do not leave the control ungated.',
      );
    }
  }
}

// ── Named write controls are individually guarded ─────────────────────────
// The check above only asks whether a file MENTIONS a MAY constant, and that
// turned out to be far too weak: FrameworkAuthoring passed it while its enable,
// rename, disable and delete controls were gated on isOwnedHere and
// isEnabledHere -- facts about the record, not about the reader -- because the
// file used MAY.AUTHOR_STANDARD somewhere else entirely.
//
// So each write handler that must never render unguarded is named here, and the
// check is positional: the onClick that invokes it has to sit inside a <Can>
// region, or have a can(MAY...) within the preceding 240 characters, which is
// the whole JSX condition it belongs to.
//
// This is a proximity heuristic and it is honest about that. It cannot prove a
// control is guarded; it does catch a guard being dropped, which is the
// regression that happened.
{
  const SRC = path.join(__dirname, '..', '..', '..', 'src', 'pages', 'grc');
  const MUST_BE_GUARDED = {
    'FrameworkAuthoring.tsx': [
      'removeStandard', 'renameStandard', 'addClauses',
      'cloneControl', 'remapControl', 'removeControl',
    ],
    'StandardsLibrary.tsx': ['setEnabling'],
    'TenantStandardEnablement.tsx': ['runBatch', 'setConfirming'],
    'project/ProjectTeam.tsx': ['openEdit', 'openRemove', 'openAdd'],
    'project/ProjectPlan.tsx': ['openNewPhase', 'openEditPhase', 'openNewTask', 'openDeletePhase', 'openDeleteTask'],
    'RiskRegister.tsx': ['openEdit', 'openCreate', 'accept'],
    'AssetRegister.tsx': ['openEdit', 'openCreate', 'setLinking', 'setReviewing'],
    'VendorRegister.tsx': ['openEdit', 'openCreate', 'setAssessing'],
    'audit/IssueRegister.tsx': ['openEdit', 'openRespond', 'openAssignCap', 'openClose'],
  };

  /** Depth of <Can> nesting at every character offset. */
  function canDepths(code) {
    const depth = new Array(code.length).fill(0);
    let d = 0;
    for (let i = 0; i < code.length; i += 1) {
      if (code.startsWith('<Can', i) && !code.startsWith('<Can>', i + 4)) {
        if (!/[A-Za-z]/.test(code[i + 4] || '')) d += 1;
      } else if (code.startsWith('</Can>', i)) {
        d = Math.max(0, d - 1);
      }
      depth[i] = d;
    }
    return depth;
  }

  const unguarded = [];
  for (const [file, handlers] of Object.entries(MUST_BE_GUARDED)) {
    const code = fs.readFileSync(path.join(SRC, ...file.split('/')), 'utf8');
    const depth = canDepths(code);
    for (const h of handlers) {
      // Plain scanning rather than a built RegExp: a pattern assembled from a
      // template literal is one escape away from matching nothing and passing.
      // Both call shapes in this codebase: an arrow that passes the record, and
      // a bare reference where the control needs no argument.
      const needles = ["onClick={() => " + h + "(", "onClick={" + h + "}"];
      let seen = 0;
      for (const needle of needles) {
        for (let at = code.indexOf(needle); at >= 0; at = code.indexOf(needle, at + 1)) {
          seen += 1;
          const inCan = depth[at] > 0;
          const nearby = code.slice(Math.max(0, at - 240), at).includes("can(MAY.");
          if (!inCan && !nearby) {
            const line = code.slice(0, at).split("\n").length;
            unguarded.push(`${file}:${line} — ${h}`);
          }
        }
      }
      checks += 1;
      assert.ok(
        seen > 0,
        `${file} no longer has an onClick calling ${h}. If the control was renamed or removed, `
        + 'update MUST_BE_GUARDED; do not silently drop the coverage.',
      );
    }
  }

  checks += 1;
  assert.deepStrictEqual(
    unguarded, [],
    'These write controls render without a capability guard nearby:\n'
    + `${unguarded.map((u) => `  ${u}`).join('\n')}\n`
    + 'Wrap them in <Can do={MAY.X}> or add can(MAY.X) && to their condition. A condition on the '
    + 'record (isOwnedHere, isEnabledHere, status) says what the record allows, not what the reader may do.',
  );
}

console.log(
  `guarded-actions: ${checks} assertions passed `
  + `(${Object.keys(ANCHOR).length} registers pinned to their route guards)`,
);
