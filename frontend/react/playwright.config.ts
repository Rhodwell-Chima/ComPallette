import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3111';

export default defineConfig({
  testDir: './tests/navigation',
  outputDir: './test-results/navigation',
  workers: 2,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', channel: process.env.COMPALLETTE_PLAYWRIGHT_CHANNEL || undefined } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  use: {
    baseURL,
    actionTimeout: 7_500,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run verify:ui -- --mode navigation-test --port 3111',
    url: baseURL,
    reuseExistingServer: false,
  },
});
