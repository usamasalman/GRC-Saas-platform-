import { test, expect } from '@playwright/test';
import { signIn, adminCredentials, watchForBreakage, isPhone, horizontalOverflow, openMenu, knownDefect } from './helpers';

/**
 * Signed in, as four people from three different portals, every entry on
 * their menu is opened by clicking it — the way a person would — and must
 * render without the page throwing.
 *
 * The API-level crawl (qa-role-crawl-test) already proves every screen's DATA
 * loads for every role. This proves the SCREEN survives it, in each engine:
 * a response the component did not expect is a white page here and a 200 there.
 *
 * Phones also check the signed-in shell fits the screen.
 */
const PEOPLE = [
  { who: 'Organization GRC Manager', email: 'grc.manager@omniops.me' },
  // Holds the user-management capabilities the GRC manager does not.
  { who: 'Organization Admin', email: 'company.admin@omniops.me' },
  { who: 'Compliance Manager (document portal)', email: 'eleanor.vance@globalbank.com' },
  { who: 'Platform Super Admin', email: null as string | null },
];

/** Phones walk the first few entries — enough to prove the drawer works. */
const PHONE_WALK = 6;

for (const person of PEOPLE) {
  test(`${person.who}: every menu entry opens without breaking`, async ({ page, request }, info) => {
    // The platform administrator's menu has around forty entries.
    test.setTimeout(240_000);
    const admin = adminCredentials();
    if (!person.email && !admin) test.skip(true, 'no ADMIN_EMAIL/ADMIN_PASSWORD for the platform administrator');
    await signIn(page, request, person.email ?? admin!.email, person.email ? undefined : admin!.password);

    const breakage = watchForBreakage(page);
    await page.goto('/app');
    await expect(page.locator('.app-shell')).toBeVisible();
    if (isPhone(info)) {
      expect(await horizontalOverflow(page), 'the signed-in shell fits the phone').toBeLessThanOrEqual(1);
    }

    await openMenu(page);
    const items = page.locator('#nav .nav-item');
    const labels = (await items.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    expect(labels.length, 'the menu has entries').toBeGreaterThan(0);

    const walk = isPhone(info) ? Math.min(PHONE_WALK, labels.length) : labels.length;
    const broken: string[] = [];
    const fixed: string[] = [];
    for (let i = 0; i < walk; i++) {
      await openMenu(page);
      // By position, not by text: "Users" is inside four different labels.
      await items.nth(i).click();
      await page.waitForTimeout(700);
      const shellAlive = await page.locator('.app-shell').isVisible();
      const problems = [shellAlive ? '' : 'the app shell disappeared', ...breakage()].filter(Boolean);
      const known = knownDefect(`browser:screen:${labels[i]}`);
      if (problems.length && known) {
        info.annotations.push({ type: 'known defect', description: `${labels[i]} — ${known}` });
      } else if (problems.length) {
        broken.push(`${labels[i]}: ${problems.join(' | ')}`);
      } else if (known) {
        fixed.push(`${labels[i]} works now — remove it from ${known.split(' ')[0]} in known-defects.js`);
      }
      // A screen that took the whole app down: start again from the top, so
      // one broken screen does not hide every screen after it.
      if (!shellAlive) {
        await page.goto('/app');
        await expect(page.locator('.app-shell')).toBeVisible();
        breakage();
      }
    }
    expect(broken, `screens that broke for ${person.who} (new defects)`).toEqual([]);
    expect(fixed, 'known defects that look fixed').toEqual([]);
  });
}
