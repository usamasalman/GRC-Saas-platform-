import { test, expect } from '@playwright/test';
import { watchForBreakage, isPhone, horizontalOverflow, knownDefect } from './helpers';

/**
 * The pages a person reaches before signing in, on every engine and size.
 *
 * The sign-in form must be on screen without scrolling sideways. On a phone
 * it is not (QA-007): the customer sign-in page is a two-column grid of fixed
 * widths totalling 980px, and on a 375px phone the email field sits beyond the
 * right edge. The register marks it known, so the build stays green while the
 * defect is open — and fails, saying so, the moment it is fixed.
 */
const PAGES = [
  { path: '/login', name: 'customer sign-in', fields: 2 },
  { path: '/control-plane', name: 'operator sign-in', fields: 2 },
  { path: '/forgot-password', name: 'forgot password', fields: 1 },
  { path: '/reset-password', name: 'reset password', fields: 1 },
];

for (const p of PAGES) {
  test(`${p.name} renders, fits the screen and throws nothing`, async ({ page }, info) => {
    // Expected to fail while the register lists it; fails loudly once fixed.
    const known = knownDefect('browser:login-form-visible-on-phone');
    test.fail(isPhone(info) && p.path === '/login' && known !== null, known ?? '');
    const breakage = watchForBreakage(page);
    await page.goto(p.path);

    const inputs = page.locator('input:not([type=hidden])');
    await expect(inputs.first()).toBeVisible();
    expect(await inputs.count()).toBeGreaterThanOrEqual(p.fields);

    // On screen, not merely in the document: a field at x=523 on a 375px
    // phone is "visible" to the DOM and invisible to the person.
    const box = await inputs.first().boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect(box, 'the first field has a box').not.toBeNull();
    expect(box!.x, 'the first field starts on screen').toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, 'and ends on screen').toBeLessThanOrEqual(width + 1);
    expect(await horizontalOverflow(page), 'no sideways scrolling').toBeLessThanOrEqual(1);

    expect(breakage()).toEqual([]);
  });
}

test('an unknown address and a signed-out /app both land on sign-in', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login/);
});
