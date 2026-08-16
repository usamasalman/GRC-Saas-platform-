/**
 * Tests whether residual risk actually tracks control effectiveness.
 *
 * The Risk model documents residual as "COMPUTED from linked-control
 * effectiveness, never client-set". This checks that the claim holds over time,
 * not merely at the moment the link is written:
 *
 *   A. does linking a control immediately reflect that control's effectiveness?
 *   B. when a control is later re-validated as Ineffective, does the residual
 *      score of every risk relying on it move?
 *
 *   node scripts/verify/residual-feedback-test.js
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
  let j; try { j = JSON.parse(t); } catch { j = { message: t.slice(0, 160) }; }
  return { status: r.status, json: j };
}
/** There is no GET /risks/:id — the register is only exposed as a list. */
const getRisk = async (token, id) =>
  ((await api('/api/grc/risks', { token })).json?.risks || []).find((r) => r.id === id);

(async () => {
  const risk = await login('risk.manager@omniops.me');
  const grc = await login('grc.manager@omniops.me');
  const validator = await login('grc.manager@omniops.me');
  if (!risk || !grc) { console.error('API not reachable'); process.exit(1); }

  // A verified + Effective control is the only kind that reduces residual.
  const me = (await api('/api/iam/users', { token: validator })).json.users || [];
  const validatorId = (me.find((u) => u.email === 'grc.manager@omniops.me') || {}).id;
  const impls = (await api('/api/grc/implementations', { token: grc })).json.implementations || [];
  // SoD bars the owner and the operator from validating, so pick one the
  // validator is not involved in — otherwise part B cannot run at all.
  const reopenerId = (me.find((u) => u.email === 'risk.manager@omniops.me') || {}).id;
  const effective = impls.find((i) =>
    i.status === 'Verified' && i.effectiveness === 'Effective'
    && i.ownerId !== validatorId && i.operatorId !== validatorId
    && i.ownerId !== reopenerId && i.operatorId !== reopenerId);
  if (!effective) { console.error('No Verified/Effective implementation in the seed to test with.'); process.exit(1); }
  console.log(`\nUsing control ${effective.control.code} — ${effective.status}/${effective.effectiveness}`);

  // ── A. Linking a control should reflect its effectiveness immediately ────
  console.log('\nA. Does linking a control compute residual from the NEW link set?');
  const created = await api('/api/grc/risks', {
    token: risk, method: 'POST',
    body: {
      title: 'Residual feedback probe',
      description: 'Cause → event → impact. Probe risk for verifying the residual computation.',
      category: 'Operational',
      likelihood: 5, impact: 4,
      force: true, // a duplicate search is mandatory before create; this acknowledges it
    },
  });
  const riskId = created.json?.risk?.id;
  if (!riskId) { console.error('Could not create probe risk:', JSON.stringify(created.json).slice(0, 200)); process.exit(1); }

  const before = await getRisk(risk, riskId);
  console.log(`   inherent ${before.inherentLikelihood}x${before.inherentImpact}=${before.inherentScore}, residual ${before.residualScore}`);

  const linked = await api(`/api/grc/risks/${riskId}/links`, {
    token: risk, method: 'POST', body: { implementationIds: [effective.id] },
  });
  const afterLink = await getRisk(risk, riskId);
  console.log(`   after linking 1 Effective control: residual ${afterLink.residualScore}  (API said: "${linked.json.message}")`);

  // Effective on a Verified control reduces likelihood by 2: 5→3, so 3x4=12.
  if (afterLink.residualScore === 12) {
    ok('linking sees the new link set', `residual ${before.residualScore} → 12`);
  } else if (afterLink.residualScore === before.residualScore) {
    bad('linking did NOT see the new link set',
      `residual stayed ${afterLink.residualScore}; computeResidual reads via the global prisma client, not the transaction, so it sees the pre-transaction links`);
  } else {
    bad('unexpected residual after linking', `got ${afterLink.residualScore}, expected 12`);
  }

  // A second link call with the same set reveals whether the first was a
  // one-behind read: if so, the second call finally "catches up".
  await api(`/api/grc/risks/${riskId}/links`, {
    token: risk, method: 'POST', body: { implementationIds: [effective.id] },
  });
  const afterSecond = await getRisk(risk, riskId);
  if (afterSecond.residualScore !== afterLink.residualScore) {
    bad('the computation is one write behind',
      `re-linking the SAME controls changed residual ${afterLink.residualScore} → ${afterSecond.residualScore}, which can only happen if the first call read stale links`);
  } else {
    ok('re-linking the same controls is idempotent', `residual stable at ${afterSecond.residualScore}`);
  }

  // ── B. Downgrading the control should move every dependent risk ──────────
  console.log('\nB. When the control is later re-validated as Ineffective, does residual move?');
  const dependent = await getRisk(risk, riskId);
  const residualBeforeDowngrade = dependent.residualScore;

  // A Verified control cannot be validated directly — it must first be sent
  // back to Implemented, which is the only route to changing effectiveness.
  const reopen = await api(`/api/grc/implementations/${effective.id}`, {
    token: risk, method: 'PATCH', body: { status: 'Implemented' },
  });
  if (reopen.status !== 200) {
    console.log(`   (could not reopen for re-validation: ${reopen.status} ${reopen.json.message || ''})`);
  }
  const revalidate = await api(`/api/grc/implementations/${effective.id}/validate`, {
    token: validator, method: 'POST',
    body: { effectiveness: 'Ineffective', note: 'Probe: downgrading to test the feedback loop.' },
  });
  if (revalidate.status !== 200) {
    console.log(`   (could not re-validate: ${revalidate.status} ${revalidate.json.message || revalidate.json.code || ''})`);
  } else {
    console.log('   control re-validated as Ineffective');
  }

  const afterDowngrade = await getRisk(risk, riskId);
  console.log(`   control now Ineffective; risk residual ${residualBeforeDowngrade} → ${afterDowngrade.residualScore}`);

  if (afterDowngrade.residualScore === residualBeforeDowngrade && revalidate.status === 200) {
    bad('residual did NOT respond to the control being downgraded',
      `still ${afterDowngrade.residualScore}; it should have returned to the inherent likelihood. computeResidual is only called from riskController, never when effectiveness changes`);
  } else if (revalidate.status === 200) {
    ok('residual followed the control downgrade', `${residualBeforeDowngrade} → ${afterDowngrade.residualScore}`);
  }

  // ── C. Can an issue, an audit or an auditable entity reach this risk? ────
  console.log('\nC. Is the risk reachable from the audit side?');
  const full = { json: { risk: await getRisk(risk, riskId) } };
  const keys = Object.keys(full.json.risk || {});
  const auditLinks = keys.filter((k) => /audit|issue|finding|entity|engagement/i.test(k));
  auditLinks.length === 0
    ? bad('the risk exposes no audit-side relation at all', `fields present: ${keys.join(', ')}`)
    : ok('risk exposes audit-side relations', auditLinks.join(', '));

  const issues = (await api('/api/grc/issues', { token: grc })).json.issues || [];
  const issueHasRisk = issues.length > 0 && Object.keys(issues[0]).some((k) => /^riskId$|^risk$/.test(k));
  issueHasRisk
    ? ok('an issue can name the risk it evidences')
    : bad('an issue cannot name the risk it evidences', 'Issue has auditId but no riskId');

  const universe = (await api('/api/grc/universe', { token: grc })).json.entities || [];
  const entityHasRisk = universe.length > 0 && Object.keys(universe[0]).some((k) => /^risk(s|Ids)?$|registerRisk/i.test(k));
  entityHasRisk
    ? ok('an auditable entity can name its register risks')
    : bad('an auditable entity cannot name its register risks',
      'AuditableEntity scores 6 factors of its own with no reference to the Risk register');

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('(Reseed after running this: npx tsx src/seed.ts)\n');
  process.exit(0);
})();
