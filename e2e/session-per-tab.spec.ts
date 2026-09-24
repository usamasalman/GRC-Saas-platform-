import { test, expect } from '@playwright/test';
import { API, demoPassword, isPhone } from './helpers';

/**
 * The reported bug, in real browsers: signing in as somebody else in a second
 * tab must stop the first one rather than silently re-identify it.
 *
 * session-per-tab-test proves the module's logic against a fake browser. This
 * proves the storage events it relies on actually fire between two tabs in
 * each engine — which is the part a fake browser cannot.
 */
test('a tab stops when another tab signs in as someone else', async ({ context, request }, info) => {
  test.skip(isPhone(info), 'phones do not run two tabs side by side');

  const login = async (email: string) => {
    const res = await request.post(`${API}/api/auth/login`, { data: { email, password: demoPassword() } });
    expect(res.ok()).toBeTruthy();
    return res.json();
  };
  const first = await login('grc.manager@omniops.me');
  const second = await login('risk.manager@omniops.me');

  const tabA = await context.newPage();
  await tabA.goto('/login');
  await tabA.evaluate((s) => {
    localStorage.setItem('grc_jwt_token', s.token);
    localStorage.setItem('grc_user_json', JSON.stringify(s.user));
  }, first);
  await tabA.goto('/app');
  await expect(tabA.locator('.app-shell')).toBeVisible();
  await expect(tabA.getByRole('alertdialog')).toHaveCount(0);

  // The second tab signs in as somebody else, in the order Login.tsx writes.
  const tabB = await context.newPage();
  await tabB.goto('/login');
  await tabB.evaluate((s) => {
    localStorage.setItem('grc_jwt_token', s.token);
    localStorage.setItem('grc_user_json', JSON.stringify(s.user));
  }, second);

  const notice = tabA.getByRole('alertdialog');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(first.user.name);
  await expect(notice).toContainText(second.user.name);

  // And "Continue" makes the first tab the new person, cleanly.
  await notice.getByRole('button', { name: /Continue as/ }).click();
  await expect(tabA.locator('.app-shell')).toBeVisible();
  await expect(tabA.getByRole('alertdialog')).toHaveCount(0);
});
