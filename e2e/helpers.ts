import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';

export const API = process.env.E2E_API_URL || 'http://127.0.0.1:3000';

/**
 * Read out of seed.ts, so these tests publish no password of their own.
 * (A URL rather than __dirname: this package is an ES module, which has none.)
 */
export function demoPassword(): string {
  const seed = fs.readFileSync(new URL('../grc_wisdom_api/src/seed.ts', import.meta.url), 'utf8');
  const m = seed.match(/const DEMO_PASSWORD = '([^']+)'/);
  if (!m) throw new Error('seed.ts no longer declares DEMO_PASSWORD');
  return m[1];
}

export interface Session {
  token: string;
  refreshToken?: string;
  user: { id: string; name: string; role: string; portal: string; capabilities: string[] };
}

/**
 * Signs in through the API and hands the session to the page the way the
 * login screen does, before any of the app's code runs.
 *
 * Not through the form: the form is tested once, in public.spec, and typing a
 * password into it for every screen would make every test a test of the form.
 */
export async function signIn(page: Page, request: APIRequestContext, email: string, password = demoPassword()): Promise<Session> {
  const res = await request.post(`${API}/api/auth/login`, { data: { email, password } });
  if (!res.ok()) throw new Error(`sign-in failed for ${email}: HTTP ${res.status()} ${await res.text()}`);
  const s = (await res.json()) as Session;
  await page.addInitScript((session) => {
    localStorage.setItem('grc_jwt_token', session.token);
    if (session.refreshToken) localStorage.setItem('grc_refresh_token', session.refreshToken);
    localStorage.setItem('grc_user_json', JSON.stringify(session.user));
  }, s);
  return s;
}

/** The platform administrator — CI's bootstrap admin, or a local override. */
export function adminCredentials(): { email: string; password: string } | null {
  const email = process.env.ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD;
  return email && password ? { email, password } : null;
}

/**
 * Collects what a person would call "the page broke": uncaught exceptions, and
 * console errors other than failed network loads. Refused requests are the
 * API suites' business; a screen that throws when one is refused is this one's.
 */
export function watchForBreakage(page: Page): () => string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|net::ERR_|status of 4\d\d|status of 5\d\d/.test(t)) return;
    problems.push(`console: ${t.slice(0, 200)}`);
  });
  return () => problems.splice(0);
}

/**
 * The same known-defect register every QA suite reads. A check listed there
 * that fails is known and recorded; one that fails without an entry is new; one
 * with an entry that passes is probably fixed, and its entry should go.
 */
const REGISTER = createRequire(import.meta.url)('../grc_wisdom_api/scripts/verify/qa/known-defects.js') as
  Record<string, { severity: string; title: string; checks: string[] }>;

export function knownDefect(check: string): string | null {
  for (const [id, d] of Object.entries(REGISTER)) if (d.checks.includes(check)) return `${id} (${d.severity}): ${d.title}`;
  return null;
}

export const isPhone = (info: TestInfo) => info.project.name.endsWith('-phone');

/**
 * The menu is a drawer at every size: it starts closed and closes again after
 * each choice. "Open" is the sidebar's class, not its visibility — a closed
 * drawer is slid off-screen, which the DOM still calls visible.
 */
export async function openMenu(page: Page): Promise<void> {
  const sidebar = page.locator('#sidebar');
  if (await sidebar.evaluate((el) => el.classList.contains('open'))) return;
  await page.locator('.menu-btn').click();
  await sidebar.locator('#nav').waitFor();
  await page.waitForFunction(() => document.getElementById('sidebar')?.classList.contains('open'));
}

/** Content wider than the screen means a person has to scroll sideways to use it. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
