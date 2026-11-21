import { expect, test } from '@playwright/test'
import { bootMockApp } from './boot'

test('workspace renders fixture library and mods', async ({ page }) => {
  await bootMockApp(page)
  await expect(page.getByText('2 mods installed')).toBeVisible()
  await expect(page.getByText('Example Server Mod')).toBeVisible()
  await expect(page.getByText('Example Client Mod')).toBeVisible()
})

test('create library and activate it', async ({ page }) => {
  await bootMockApp(page)
  await page.getByRole('button', { name: /manage libraries/i }).click()
  await page.getByRole('button', { name: /add library/i }).click()
  const pathDialog = page.getByRole('dialog').filter({
    has: page.getByLabel('Game root path'),
  })
  await pathDialog
    .getByLabel('Game root path')
    .fill('C:\\SPT-instances\\typed-instance')
  await pathDialog.getByRole('button', { name: 'Use path' }).click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('tab', { name: 'typed-instance' }),
  ).toBeVisible()
  await dialog.getByRole('tab', { name: 'Mock SPT' }).click()
  await dialog.getByRole('button', { name: /^activate$/i }).click()
  await expect(
    dialog.getByRole('button', { name: /activated/i }),
  ).toBeDisabled()
})

test('library activation shows the retry message for a busy backend', async ({
  page,
}) => {
  await bootMockApp(page)
  await page.evaluate(() => {
    const commands = window.__MK_WAILS_MOCK__?.commands
    if (!commands) throw new Error('Mock commands missing')
    commands.activateLibrary = async () => ({
      status: 'error',
      error: { code: 'LibraryBusy', data: null },
    })
  })
  await page.getByRole('button', { name: /manage libraries/i }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /add library/i }).click()
  const pathDialog = page.getByRole('dialog').filter({
    has: page.getByLabel('Game root path'),
  })
  await pathDialog.getByLabel('Game root path').fill('C:\\busy-target')
  await pathDialog.getByRole('button', { name: 'Use path' }).click()
  await dialog.getByRole('tab', { name: 'Mock SPT' }).click()
  await dialog.getByRole('button', { name: /^activate$/i }).click()

  await expect(
    page.getByText('A task is in progress. Retry when it finishes.'),
  ).toBeVisible()
})

test('archive import accepts typed paths and starts the install flow', async ({
  page,
}) => {
  await bootMockApp(page)
  await page.evaluate(() => {
    const mock = window.__MK_WAILS_MOCK__
    const original = mock?.commands?.installModArchives
    if (!mock?.commands || !original)
      throw new Error('Mock install command missing')
    mock.commands.installModArchives = (...args) => {
      const target = window as Window & { __MK_INSTALL_INPUT__?: unknown }
      target.__MK_INSTALL_INPUT__ = args[0]
      return original(...args)
    }
  })
  await page.getByRole('button', { name: /add mod/i }).click()
  const dialog = page.getByRole('dialog').filter({
    has: page.getByLabel('Archive paths'),
  })
  await dialog
    .getByLabel('Archive paths')
    .fill('C:\\downloads\\typed-mod.zip\nC:\\downloads\\second-mod.7z')
  await dialog.getByRole('button', { name: 'Use path' }).click()

  await expect(page.getByText('typed-mod')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __MK_INSTALL_INPUT__?: { archivePaths: string[] }
            }
          ).__MK_INSTALL_INPUT__?.archivePaths,
      ),
    )
    .toEqual(['C:\\downloads\\typed-mod.zip', 'C:\\downloads\\second-mod.7z'])
})

test('settings theme and accent persist after reload', async ({ page }) => {
  await bootMockApp(page)
  await page.getByRole('link', { name: /settings/i }).click()
  await page.getByRole('radio', { name: /dark/i }).click()
  await page.reload()
  await page.getByRole('link', { name: /settings/i }).click()
  await expect(page.getByRole('radio', { name: /dark/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})

test('forge search has fixture results and empty state', async ({ page }) => {
  await bootMockApp(page)
  await page.getByRole('link', { name: /registry/i }).click()
  const search = page.getByPlaceholder(/search/i)
  await search.fill('Camo')
  await expect(
    page.getByRole('heading', { name: 'Camo And Stickers' }),
  ).toBeVisible()
  await search.fill('not-a-match')
  await expect(
    page.getByText(/no mods|no results|nothing found/i),
  ).toBeVisible()
})

test('bulk mod actions update enabled state', async ({ page }) => {
  await bootMockApp(page)
  const selectAll = page.getByRole('checkbox', {
    name: /select all visible mods/i,
  })
  await selectAll.click()
  const actions = page.getByRole('button', { name: /mod actions/i })
  await actions.click()
  await page.getByRole('menuitem', { name: /disable selected/i }).click()
  await page.keyboard.press('Escape')
  const serverRow = page.getByRole('row', { name: /example server mod/i })
  await expect(serverRow.getByRole('switch')).not.toBeChecked()
  await actions.click()
  await page.getByRole('menuitem', { name: /enable selected/i }).click()
  await page.keyboard.press('Escape')
  await expect(serverRow.getByRole('switch')).toBeChecked()
})
