import { expect, type Page } from '@playwright/test'

/** A fresh page has a fresh module-level in-memory backend for every spec. */
export async function bootMockApp(page: Page): Promise<void> {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    // next-themes intentionally renders its inline pre-hydration script. React
    // 19 dev mode warns about that node; it is not an app/runtime error.
    if (
      message.type() === 'error' &&
      !message
        .text()
        .startsWith('Encountered a script tag while rendering React component.')
    )
      consoleErrors.push(message.text())
  })
  await page.goto('/')
  await expect(
    page.getByRole('navigation', { name: /primary navigation/i }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: /library/i })).toBeVisible()
  // The first load warms the dev app. Assert clean startup diagnostics on the
  // deliberate clean-storage reload below, not on the warm-up document.
  consoleErrors.length = 0
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.getByRole('link', { name: /library/i })).toBeVisible()
  await expect.poll(() => consoleErrors).toEqual([])
}

export async function bootEmptyLibraryMockApp(
  page: Page,
  history: readonly Record<string, unknown>[] = [],
): Promise<void> {
  await page.addInitScript(
    (taskHistory) => {
      type MockWindow = Window & {
        __MK_WAILS_MOCK__?: {
          commands: Record<string, (...args: unknown[]) => unknown>
          events: {
            on: (
              name: string,
              callback: (...args: unknown[]) => void,
            ) => () => void
            emit: (name: string, ...args: unknown[]) => void
          }
        }
      }
      const library = {
        id: 'fixture-library',
        name: 'Fixture Library',
        gameRoot: '/games/spt',
        libraryRoot: '/games/spt/.mod_keeper',
        sptVersion: '3.9.0',
        cacheStatus: { state: 'ready' },
        deployStale: false,
        updatedAt: new Date().toISOString(),
      }
      ;(window as MockWindow).__MK_WAILS_MOCK__ = {
        commands: {
          getLibraryWorkspace: () => ({
            activeLibraryId: null,
            libraries: [library],
            modsByLibraryId: { [library.id]: [] },
            toolsByLibraryId: { [library.id]: [] },
            settings: {
              theme: 'system',
              accentColor: '#6750a4',
              language: 'en-US',
              enableModsOnInstall: true,
            },
          }),
        },
        events: { on: () => () => {}, emit: () => {} },
      }
      if (taskHistory.length > 0) {
        localStorage.setItem(
          'modkeeper.taskHistory.v1',
          JSON.stringify({ version: 1, tasks: taskHistory }),
        )
      }
    },
    [...history],
  )
  await page.goto('/')
  await expect(
    page.getByRole('navigation', { name: /primary navigation/i }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: /library/i })).toBeVisible()
}
