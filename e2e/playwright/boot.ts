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
