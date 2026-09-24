/**
 * Every menu entry opens something, and entries are gated where the action is.
 *
 * Two failure modes this catches. A key in AppShell's NAV that the render
 * switch does not handle is a menu entry that opens nothing. And a screen
 * whose only purpose is one guarded action, shown to a role that cannot take
 * it, is the "hallucination" the rest of the menu rules exist to prevent.
 *
 *   node scripts/verify/qa-menu-test.js
 */
const q = require('./qa/lib');

const menu = q.menuModel();
const v = q.verdicts('qa-menu');

let entries = 0;
for (const [portal, groups] of Object.entries(menu.NAV)) {
  for (const [, items] of groups) {
    for (const [key, , label] of items) {
      entries += 1;
      v.record(`menu:${portal}/${key} opens a screen`, Boolean(menu.screenFor(portal, key)),
        `"${label}" is on the ${portal} menu but the render switch has no screen for "${key}"`);
    }
  }
}

// Screens whose whole purpose is one guarded act. Listing a screen here says
// the menu should agree with the API about who can use it.
const ACTION_SCREENS = {
  'tool-review': 'onboard-or-purchase-an-open-source-tool',
};
for (const [key, cap] of Object.entries(ACTION_SCREENS)) {
  const gated = (menu.NAV_CAPABILITY[key] || []).includes(cap);
  v.record(`menu:${key}-gated`, gated,
    `shown to every role in its portal, but approving needs "${cap}"`);
}

v.finish(`${entries} menu entries across ${Object.keys(menu.NAV).length} portals`);
