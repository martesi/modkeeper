import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/playwright',
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:1420',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          args: ['--no-sandbox'],
        }
      : {},
  },
  webServer: {
    command:
      'VITE_E2E_TASK_PROGRESS=1 bun run dev:wails -- --port 1420 --strictPort',
    url: 'http://127.0.0.1:1420/',
    reuseExistingServer: !process.env.CI,
  },
})
