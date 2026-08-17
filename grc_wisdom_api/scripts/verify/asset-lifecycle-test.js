/**
 * The asset register and asset-driven risk, end to end.
 *
 * Checks the ISO 27005 chain the register exists to make traceable:
 *   register an asset → value it on C/I/A → criticality derives
 *   → raise a risk naming a threat and a vulnerability
 *   → impact derives from the asset, likelihood from threat x vulnerability
 *   → loss expectancy where the inputs exist
 *   → the asset shows the risk it now carries
 *
 *   node scripts/verify/asset-lifecycle-test.js
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

(async () => {
  const risk = await login('risk.manager@omniops.me');
  const staff = await login('hr.manager@omniops.me');
  if (!risk) { console.error('API not reachable'); process.exit(1); }

  // ── A. Valuation ─────────────────────────────────────────────────────────
  console.log('\nA. Criticality derives from the CIA triad');
  const created = await api('/api/grc/assets', {
    token: risk, method: 'POST',
    body: {
      name: 'Probe — customer contract archive', type: 'Information', ownership: 'Internal',
      classification: 'Confidential',
      // Deliberately lopsided: averaging would give 3.3 and hide this asset.
      confidentiality: 2, integrity: 5, availability: 3,
      replacementValue: 1_200_000,
    },
  });
  const asset = created.json.asset;
  if (!asset) { bad('could not register the probe asset', JSON.stringify(created.json).slice(0, 160)); process.exit(1); }
  asset.criticality === 5 && asset.criticalityTier === 'Critical'
    ? ok('max(2, 5, 3) = 5 → Critical', 'averaging would have given 3.3 and buried it')
    : bad('criticality wrong', `got ${asset.criticality} / ${asset.criticalityTier}`);

  // ── B. Third-party discipline ────────────────────────────────────────────
  console.log('\nB. A third-party asset must name the supplier that holds it');
  const noVendor = await api('/api/grc/assets', {
    token: risk, method: 'POST',
    body: { name: 'Probe — unnamed supplier service', type: 'Service', ownership: 'ThirdParty' },
  });
  noVendor.json.code === 'VENDOR_REQUIRED'
    ? ok('refused without a supplier', noVendor.json.code)
    : bad('supplier gate', `expected VENDOR_REQUIRED, got ${noVendor.status}`);

  // ── C. Authorisation ─────────────────────────────────────────────────────
  console.log('\nC. Maintaining the inventory needs a GRC capability');
  if (staff) {
    const denied = await api('/api/grc/assets', {
      token: staff, method: 'POST', body: { name: 'Probe — unauthorised' },
    });
    denied.status === 403
      ? ok('a role without asset, control or risk capability is refused', denied.json.capability || '403')
      : bad('capability gate', `expected 403, got ${denied.status}`);
  }

  // ── D. ISO 27005 risk statement ──────────────────────────────────────────
  console.log('\nD. Risk is a threat exploiting a vulnerability of the asset');
  const noPair = await api(`/api/grc/assets/${asset.id}/risks`, {
    token: risk, method: 'POST', body: { title: 'Something bad' },
  });
  noPair.json.code === 'THREAT_AND_VULNERABILITY_REQUIRED'
    ? ok('a risk with no threat/vulnerability pair is refused', noPair.json.code)
    : bad('ISO 27005 gate', `expected THREAT_AND_VULNERABILITY_REQUIRED, got ${noPair.status}`);

  const raised = await api(`/api/grc/assets/${asset.id}/risks`, {
    token: risk, method: 'POST',
    body: {
      threat: 'Insider exfiltrates contract terms',
      vulnerability: 'No data-loss prevention on the archive share',
      threatLevel: 4, vulnerabilityLevel: 3, exposureFactor: 0.3,
    },
  });
  const d = raised.json.derivation;
  d && d.impact === 5 && d.likelihood === 4 && d.score === 20
    ? ok('impact 5 from criticality, likelihood ceil((4+3)/2) = 4, inherent 20')
    : bad('derivation wrong', JSON.stringify(d));

  const le = raised.json.lossExpectancy;
  le && le.sle === 360_000
    ? ok('SLE = 1,200,000 x 0.3 = 360,000', `ARO ${le.aro}, ALE SAR ${le.ale.toLocaleString()}`)
    : bad('loss expectancy wrong', JSON.stringify(le));

  // ── E. The link reads back ───────────────────────────────────────────────
  console.log('\nE. The asset shows the risk it now carries');
  const list = await api('/api/grc/assets', { token: risk });
  const probe = (list.json.assets || []).find((a) => a.id === asset.id);
  probe && probe.openRiskCount === 1
    ? ok('risk visible from the asset', `exposure ${probe.exposure}, posture ${probe.controlPosture.posture}`)
    : bad('risk not linked back to the asset');
  probe && probe.unprotectedButExposed
    ? ok('flagged exposed but unprotected', 'carries risk with no control linked')
    : bad('exposure flag not set');

  // ── F. Analytics ─────────────────────────────────────────────────────────
  console.log('\nF. Register analytics');
  const an = await api('/api/grc/asset-analytics', { token: risk });
  const keys = ['grid', 'postureOrder', 'byType', 'formulas', 'attention', 'topExposure', 'totals'];
  const missing = keys.filter((k) => an.json[k] === undefined);
  missing.length === 0
    ? ok('analytics payload complete', keys.join(', '))
    : bad('analytics incomplete', `missing ${missing.join(', ')}`);
  (an.json.formulas || []).length >= 8
    ? ok('every derivation is published to the UI', `${an.json.formulas.length} formulas`)
    : bad('formulas not published');

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('(Reseed afterwards: npx tsx src/seed.ts)\n');
  process.exit(fail === 0 ? 0 : 1);
})();
