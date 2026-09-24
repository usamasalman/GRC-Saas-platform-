import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests: the three engines people actually use, at desktop and phone
 * size. Chromium covers Chrome and Edge, WebKit is Safari's engine (and every
 * browser on an iPhone), Firefox is Firefox.
 *
 * They need an API with the demo seed loaded — a throwaway one, never a real
 * database — at E2E_API_URL. The web app is built against that API and served
 * by `vite preview`, unless E2E_WEB_URL points at one already running.
 *
 *   E2E_API_URL=http://127.0.0.1:3100 npx playwright test
 *
 * One worker, on purpose. The API allows 300 requests a minute per address,
 * and a parallel sweep of every screen trips it — which would test the rate
 * limiter, not the screens.
 */
const WEB = process.env.E2E_WEB_URL || 'http://localhost:4173';
const API = process.env.E2E_API_URL || 'http://127.0.0.1:3000';

/**
 * Where Playwright's own Chromium cannot be downloaded, E2E_CHROMIUM_CHANNEL=
 * chrome (or msedge) drives the browser already installed. Same engine; CI
 * uses the bundled build.
 */
const CHANNEL = process.env.E2E_CHROMIUM_CHANNEL ? { channel: process.env.E2E_CHROMIUM_CHANNEL } : {};

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], ...CHANNEL } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'] } },
    { name: 'chromium-phone', use: { ...devices['Pixel 7'], ...CHANNEL } },
    { name: 'webkit-phone', use: { ...devices['iPhone 14'] } },
  ],
  webServer: process.env.E2E_WEB_URL ? undefined : {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: WEB,
    reuseExistingServer: true,
    timeout: 240_000,
    env: { VITE_API_BASE_URL: API },
  },
});
