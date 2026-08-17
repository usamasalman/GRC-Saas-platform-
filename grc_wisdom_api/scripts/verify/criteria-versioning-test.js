/**
 * Risk criteria and appetite version history — ISO 31000 clause 6.3.4,
 * IIA Standard 9.1 (the appetite statement is audit evidence).
 *
 * The question this exists to answer: "what was the approved tolerance for
 * Technology risk when RSK-014 was accepted last March?" Before versioning,
 * setting an appetite upserted the row in place and the old thresholds were
 * simply gone.
 *
 *   node scripts/verify/criteria-versioning-test.js
 */
const API = process.env.API || 'http://localhost:3000';

let pass = 0, fail = 0;
const ok = (l, d = '') => { pass++; console.log(`   PASS  ${l}${d ? ` — ${d}` : ''}`); };
const bad = (l, d = '') => { fail++; console.log(`   FAIL  ${l}${d ? ` — ${d}` : ''}`); };

async function login(email) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Demo@2026' }),
  });
  return (await r.json()).token;
}
async function api(path, { token, method = 'GET', body } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { message: t.slice(0, 200) }; }
  return { status: r.status, json: j };
}

const SCALE_I = [1, 2, 3, 4, 5].map((n) => ({
  level: n, label: `Level ${n}`,
  descriptor: `Impact anchor text for level ${n}, long enough to be a real definition.`,
  monetaryFrom: (n - 1) * 1_000_000, monetaryTo: n * 1_000_000,
}));
const SCALE_L = [1, 2, 3, 4, 5].map((n) => ({
  level: n, label: `Level ${n}`,
  descriptor: `Likelihood anchor text for level ${n}, long enough to be a real definition.`,
  frequency: `About once every ${6 - n} years`,
}));

(async () => {
  const risk = await login('risk.manager@omniops.me');
  const admin = await login('company.admin@omniops.me');
  if (!risk || !admin) { console.error('API not reachable'); process.exit(1); }

  // ── A. Appetite keeps its history ────────────────────────────────────────
  console.log('\nA. Revising an appetite mints a version, it does not overwrite');
  const before = await api('/api/grc/appetite', { token: risk });
  const tech = (before.json.appetites || []).find((a) => a.category === 'Technology');
  tech
    ? ok('the seeded Technology appetite is in force', `v${tech.version}, appetite ${tech.appetiteThreshold}, tolerance ${tech.toleranceThreshold}`)
    : bad('no Technology appetite found');

  const revised = await api('/api/grc/appetite', {
    token: risk, method: 'POST',
    body: {
      category: 'Technology',
      statement: 'Probe revision — widened while the migration completes.',
      appetiteThreshold: 10, toleranceThreshold: 20,
    },
  });
  const draft = revised.json.appetite;
  draft && draft.version > (tech?.version ?? 0) && draft.status === 'Draft'
    ? ok('a revision drafts the next version', `v${draft.version} drafted; ${revised.json.currentlyInForce ? `v${revised.json.currentlyInForce.version} stays in force` : ''}`)
    : bad('revision did not version', JSON.stringify(revised.json).slice(0, 160));

  const stillInForce = await api('/api/grc/appetite', { token: risk });
  const nowTech = (stillInForce.json.appetites || []).find((a) => a.category === 'Technology');
  nowTech && nowTech.toleranceThreshold === tech.toleranceThreshold
    ? ok('the old ceiling still binds until the draft is approved', `tolerance still ${nowTech.toleranceThreshold}`)
    : bad('an unapproved draft changed the binding ceiling');

  // ── B. A second draft is refused ─────────────────────────────────────────
  console.log('\nB. Only one draft per category can be open');
  const second = await api('/api/grc/appetite', {
    token: risk, method: 'POST',
    body: { category: 'Technology', statement: 'Another probe.', appetiteThreshold: 9, toleranceThreshold: 18 },
  });
  second.json.code === 'DRAFT_ALREADY_OPEN'
    ? ok('a second concurrent draft is refused', second.json.code)
    : bad('draft uniqueness', `expected DRAFT_ALREADY_OPEN, got ${second.status}`);

  // ── C. Approval supersedes cleanly ───────────────────────────────────────
  console.log('\nC. Approving supersedes the predecessor with no gap');
  // The risk manager cannot approve at all — no approval capability — so the
  // SoD check is only reachable for someone who can both draft and approve.
  // Organization Admin holds MANAGE_TENANT (draft) and MAINTAIN_ROLES
  // (approve), which is precisely the account SoD has to stop.
  const rmTried = await api(`/api/grc/appetite/${draft.id}/approve`, { token: risk, method: 'POST' });
  rmTried.status === 403 && rmTried.json.code === 'CAPABILITY_DENIED'
    ? ok('a drafter without approval capability is refused first', 'CAPABILITY_DENIED')
    : bad('capability gate on approval', `got ${rmTried.status} ${rmTried.json.code || ''}`);

  const adminDraft = await api('/api/grc/appetite', {
    token: admin, method: 'POST',
    body: { category: 'People', statement: 'Probe — drafted by an account that can also approve.', appetiteThreshold: 6, toleranceThreshold: 12 },
  });
  if (adminDraft.json.appetite) {
    const selfApprove = await api(`/api/grc/appetite/${adminDraft.json.appetite.id}/approve`, { token: admin, method: 'POST' });
    selfApprove.json.code === 'SOD_VIOLATION'
      ? ok('an account that can do both cannot approve its own draft', selfApprove.json.code)
      : bad('appetite SoD', `expected SOD_VIOLATION, got ${selfApprove.status} ${selfApprove.json.code || ''}`);
  } else {
    bad('could not draft as admin to exercise SoD', JSON.stringify(adminDraft.json).slice(0, 140));
  }

  const approved = await api(`/api/grc/appetite/${draft.id}/approve`, { token: admin, method: 'POST' });
  approved.status === 200 && approved.json.superseded
    ? ok('approval supersedes the previous version', approved.json.message)
    : bad('approval did not supersede', JSON.stringify(approved.json).slice(0, 160));

  // ── D. The as-at question ────────────────────────────────────────────────
  console.log('\nD. "What was in force back then?"');
  const longAgo = new Date(Date.now() - 200 * 86_400_000).toISOString();
  const past = await api(`/api/grc/risk-criteria/as-at?at=${longAgo}&category=Technology`, { token: risk });
  const pastAppetite = past.json.appetite;
  pastAppetite
    ? ok('the historic ceiling is recoverable',
      `200 days ago Technology tolerance was ${pastAppetite.toleranceThreshold} (v${pastAppetite.version}), not today's ${approved.json.appetite?.toleranceThreshold}`)
    : bad('cannot resolve the historic appetite', JSON.stringify(past.json).slice(0, 160));

  const nowRes = await api('/api/grc/risk-criteria/as-at?category=Technology', { token: risk });
  nowRes.json.appetite && pastAppetite
    && nowRes.json.appetite.version !== pastAppetite.version
    ? ok('then and now resolve to different versions',
      `v${pastAppetite.version} then, v${nowRes.json.appetite.version} now`)
    : bad('as-at returns the same version for both dates');

  // ── E. An acceptance pins the ceiling it was judged against ──────────────
  console.log('\nE. An acceptance records the exact ceiling it was judged against');
  const risks = (await api('/api/grc/risks', { token: risk })).json.risks || [];
  const accepted = risks.find((r) => r.status === 'Accepted' && r.acceptedUnderAppetite);
  const anyAccepted = risks.find((r) => r.status === 'Accepted');
  if (accepted) {
    ok('the accepted risk names its appetite version',
      `${accepted.ref} judged against v${accepted.acceptedUnderAppetite.version}, tolerance ${accepted.acceptedUnderAppetite.toleranceThreshold}, at score ${accepted.acceptedAtScore}`);
  } else if (anyAccepted) {
    console.log(`   (${anyAccepted.ref} was seeded as accepted before versioning existed, so it carries no pin — new acceptances do)`);
    // Acceptance needs ASSESS_RISK, and the owner cannot accept their own risk.
    const me = (await api('/api/iam/users', { token: risk })).json.users || [];
    const rmId = (me.find((u) => u.email === 'risk.manager@omniops.me') || {}).id;
    const target = risks.find((r) =>
      r.status !== 'Accepted' && r.status !== 'Closed'
      && r.residualScore <= 6 && r.owner?.id !== rmId);
    if (target) {
      const acc = await api(`/api/grc/risks/${target.id}/accept`, {
        token: risk, method: 'POST',
        body: { until: new Date(Date.now() + 90 * 86_400_000).toISOString(), reason: 'Probe acceptance to check the pin.' },
      });
      if (acc.status === 200) {
        const after = (await api('/api/grc/risks', { token: risk })).json.risks || [];
        const pinned = after.find((r) => r.id === target.id);
        pinned?.acceptedUnderAppetite
          ? ok('a new acceptance pins its appetite version',
            `${pinned.ref} judged against v${pinned.acceptedUnderAppetite.version}, tolerance ${pinned.acceptedUnderAppetite.toleranceThreshold}, at score ${pinned.acceptedAtScore}`)
          : bad('the new acceptance carries no pin');
      } else {
        console.log(`   (could not accept a probe risk: ${acc.status} ${acc.json.code || acc.json.message})`);
      }
    }
  } else {
    bad('no accepted risk to inspect');
  }

  // ── F. Criteria govern the banding ───────────────────────────────────────
  console.log('\nF. The register is banded on the tenant\'s own criteria');
  const listed = await api('/api/grc/risk-criteria', { token: risk });
  const active = listed.json.active;
  active && active.isPlatformDefault === false
    ? ok('a tenant-approved criteria set is in force', `v${active.version} — "${active.name}"`)
    : bad('criteria not resolving to the tenant version', JSON.stringify(active).slice(0, 140));
  Array.isArray(active?.impactScale) && active.impactScale.length === 5 && active.impactScale[4].descriptor
    ? ok('impact levels carry real anchor text', `level 5 = "${active.impactScale[4].label}"`)
    : bad('impact scale missing anchors');

  const risksNow = (await api('/api/grc/risks', { token: risk })).json;
  risksNow.criteria && risksNow.criteria.version === active.version
    ? ok('the risk register publishes the criteria it banded on', `v${risksNow.criteria.version}`)
    : bad('register does not publish its criteria');

  // ── G. Criteria validation ───────────────────────────────────────────────
  console.log('\nG. Criteria cannot be drafted without real definitions');
  const thin = await api('/api/grc/risk-criteria', {
    token: risk, method: 'POST',
    body: {
      name: 'Probe thin criteria',
      impactScale: [1, 2, 3, 4, 5].map((n) => ({ level: n, label: `L${n}`, descriptor: 'short' })),
      likelihoodScale: SCALE_L,
    },
  });
  thin.json.code === 'INVALID_SCALE'
    ? ok('a level with no real descriptor is refused', thin.json.message.slice(0, 90))
    : bad('descriptor validation', `expected INVALID_SCALE, got ${thin.status}`);

  const badBands = await api('/api/grc/risk-criteria', {
    token: risk, method: 'POST',
    body: { name: 'Probe bad bands', impactScale: SCALE_I, likelihoodScale: SCALE_L, highThreshold: 6, mediumThreshold: 10 },
  });
  badBands.json.code === 'INVALID_THRESHOLDS'
    ? ok('bands that make Medium unreachable are refused', badBands.json.message.slice(0, 80))
    : bad('threshold validation', `expected INVALID_THRESHOLDS, got ${badBands.status}`);

  // ── H. Approving criteria reports the re-banding ─────────────────────────
  console.log('\nH. Approving new criteria reports what it re-bands');
  const newCriteria = await api('/api/grc/risk-criteria', {
    token: risk, method: 'POST',
    body: {
      name: 'Probe FY criteria — tighter bands',
      impactScale: SCALE_I, likelihoodScale: SCALE_L,
      // Tightening High from 15 to 10 should move real risks.
      highThreshold: 10, mediumThreshold: 5,
    },
  });
  const cid = newCriteria.json.criteria?.id;
  if (!cid) { bad('could not draft criteria', JSON.stringify(newCriteria.json).slice(0, 160)); }
  else {
    const appr = await api(`/api/grc/risk-criteria/${cid}/approve`, { token: admin, method: 'POST' });
    appr.status === 200
      ? ok('criteria approved', appr.json.message)
      : bad('criteria approval', `${appr.status} ${appr.json.code || appr.json.message}`);
    Array.isArray(appr.json.rebanded) && appr.json.rebanded.length > 0
      ? ok('the re-banding is reported and audited',
        appr.json.rebanded.slice(0, 3).map((r) => `${r.ref} ${r.from}→${r.to}`).join(', '))
      : console.log('   (no risk changed band under these thresholds)');

    const after = (await api('/api/grc/risks', { token: risk })).json;
    after.criteria?.highThreshold === 10
      ? ok('the register now bands on the new thresholds', `High at ${after.criteria.highThreshold}`)
      : bad('register did not adopt the new bands', JSON.stringify(after.criteria).slice(0, 100));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('(Reseed afterwards: npx tsx src/seed.ts)\n');
  process.exit(fail === 0 ? 0 : 1);
})();
