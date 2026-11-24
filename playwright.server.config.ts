import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/server',
  workers: 1,
  timeout: 60_000,
  use: {
    browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          args: ['--no-sandbox'],
        }
      : {},
    trace: 'retain-on-failure',
  },
})
