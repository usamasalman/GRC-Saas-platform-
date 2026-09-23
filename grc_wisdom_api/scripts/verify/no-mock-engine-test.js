/**
 * No mock screens, and no mock engine.
 *
 * Eleven screens rendered generated HTML backed by browser localStorage,
 * including five invented client organisations shown to any partner user.
 *
 * This test pins:
 *   1. src/utils/appMockEngine.js is deleted.
 *   2. AppShell.tsx does not import or invoke renderMockView.
 *   3. None of the eleven mock keys appear in any portal's NAV map.
 *
 *   node scripts/verify/no-mock-engine-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..', '..');
const MOCK_ENGINE = path.join(ROOT, 'src', 'utils', 'appMockEngine.js');
const APP_SHELL = path.join(ROOT, 'src', 'pages', 'AppShell.tsx');

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

console.log('Running no-mock-engine verification suite...');

// 1. appMockEngine.js does not exist
ok(!fs.existsSync(MOCK_ENGINE), 'src/utils/appMockEngine.js must not exist in repository');

// 2. AppShell does not import or invoke renderMockView
const shellSrc = fs.readFileSync(APP_SHELL, 'utf8');
ok(!shellSrc.includes('appMockEngine'), 'AppShell.tsx must not reference appMockEngine');
ok(!shellSrc.includes('renderMockView'), 'AppShell.tsx must not invoke renderMockView');

// 3. None of the eleven mock keys are in NAV
const MOCK_KEYS = [
  'wisdom-eye',
  'eye-phish',
  'asm-tenants',
  'clients',
  'engagements',
  'contacts',
  'workspace-transfer',
  'subsidiaries',
  'branch-lifecycle',
  'exceptions',
  'exports',
];

const navBlockMatch = shellSrc.match(/const NAV: Record<string, any\[\]> = \{([\s\S]*?)\n\};/);
ok(navBlockMatch, 'NAV block must exist in AppShell.tsx');
const navBlock = navBlockMatch[1];

for (const key of MOCK_KEYS) {
  const re = new RegExp(`\\['${key}',`);
  ok(!re.test(navBlock), `Mock key "${key}" must not appear in NAV map in AppShell.tsx`);
}

console.log(`no-mock-engine: ${checks} assertions passed`);
