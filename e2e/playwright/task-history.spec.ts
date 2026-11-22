import { expect, test } from '@playwright/test'
import { bootEmptyLibraryMockApp } from './boot'

const history = [
  {
    taskId: 'download-event',
    timestamp: '2026-01-18T12:30:00.000Z',
    operation: 'forge_install',
    libraryId: 'fixture-library',
    status: 'success',
    logTail: [],
  },
  {
    taskId: 'sync-event',
    timestamp: '2026-01-18T12:25:00.000Z',
    operation: 'sync',
    libraryId: 'fixture-library',
    status: 'success',
    logTail: [],
  },
  {
    taskId: 'upload-event',
    timestamp: '2026-01-18T12:20:00.000Z',
    operation: 'install',
    libraryId: 'fixture-library',
    status: 'partial_failure',
    logTail: [],
  },
]

test('task history is visible in light and dark themes', async ({ page }) => {
  await bootEmptyLibraryMockApp(page, history)
  await page.getByRole('button', { name: 'Tasks' }).click()

  const panel = page.getByRole('region', { name: 'Recent task history' })
  await expect(panel).toBeVisible()
  await expect(panel.locator('li')).toHaveCount(3)
  await expect(panel).toContainText('Download')
  await expect(panel).toContainText('Sync')
  await expect(panel).toContainText('Upload')
  await expect(panel).toContainText('Fixture Library')
  await expect(panel).toContainText('Completed')
  await expect(panel).toContainText('Completed with errors')

  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.classList.toggle('dark', value === 'dark')
    }, theme)
    await page.screenshot({
      path: test.info().outputPath(`task-list-${theme}.png`),
      fullPage: true,
    })
  }
})
