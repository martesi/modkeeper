import { expect, test } from '@playwright/test'
import { bootMockApp } from './boot'

test('browses server folders and creates a library from the selected path', async ({
  page,
}) => {
  await bootMockApp(page)
  await page.getByRole('button', { name: /manage libraries/i }).click()
  await page.getByRole('button', { name: /add library/i }).click()
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Game root path') })
  await dialog.getByRole('button', { name: 'Browse folders' }).click()
  await dialog.getByRole('button', { name: 'game/' }).click()
  await expect(dialog.getByText('/mock/home/game')).toBeVisible()
  await dialog.getByRole('button', { name: 'Parent folder' }).click()
  await dialog.getByRole('button', { name: 'game/' }).click()
  await dialog.getByRole('button', { name: 'Select this folder' }).click()
  await page.screenshot({
    path: test.info().outputPath('path-browser-selected.png'),
    fullPage: true,
  })
  await expect(dialog.getByLabel('Game root path')).toHaveValue(
    '/mock/home/game',
  )
  await dialog.getByRole('button', { name: 'Use path' }).click()
  await expect(page.getByRole('tab', { name: 'game' })).toBeVisible()
})

test('selects archive files and keeps manual entry available on browse failure', async ({
  page,
}) => {
  await bootMockApp(page)
  await page.evaluate(() => {
    const commands = window.__MK_WAILS_MOCK__?.commands
    if (!commands) throw new Error('Mock commands missing')
    commands.homeDirectory = () => '/home/test'
    commands.listDirectory = (path) => {
      if (path === '/home/test/broken') throw new Error('access denied')
      return [
        { Name: 'broken', IsDir: true },
        { Name: 'mod.zip', IsDir: false },
      ]
    }
  })
  await page.getByRole('button', { name: /add mod/i }).click()
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Archive paths') })
  await dialog.getByRole('button', { name: 'Browse folders' }).click()
  await dialog.getByRole('button', { name: 'mod.zip' }).click()
  await expect(dialog.getByLabel('Archive paths')).toHaveValue(
    '/home/test/mod.zip',
  )
  await dialog.getByRole('button', { name: 'broken/' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Could not browse')
  await dialog.getByLabel('Archive paths').fill('/manual/mod.zip')
  await dialog.getByRole('button', { name: 'Use path' }).click()
  await expect(dialog).toBeHidden()
})
