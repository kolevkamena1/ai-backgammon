import { defineConfig, devices } from '@playwright/test'

/**
 * Real-browser regressions for defects jsdom cannot observe (native constraint validation inside
 * collapsed <details>, layout reachability, keyboard resize, reduced motion). Kept separate from the
 * Vitest unit suite (`npm run test`); run with `npm run test:e2e`. The web server is the Vite dev
 * server so the specs exercise live source; CI (E5) runs the same specs against `wrangler pages dev`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 30_000,
      },
})