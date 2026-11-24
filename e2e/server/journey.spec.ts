import { expect } from '@playwright/test'
import { test } from './fixture'
import path from 'node:path'
import { readFile } from 'node:fs/promises'

test('server starts without a mock', async ({ page, server }) => {
  const workspaceResponse = page.waitForResponse((response) => {
    const request = response.request()
    if (
      request.method() !== 'POST' ||
      new URL(response.url()).pathname !== '/wails/runtime'
    )
      return false
    const body = request.postDataJSON() as {
      object?: number
      method?: number
      args?: { methodID?: number }
    }
    return (
      body.object === 0 &&
      body.method === 0 &&
      body.args?.methodID === 188297059
    )
  })
  await page.goto(server.url)
  expect((await workspaceResponse).ok()).toBe(true)
  await expect(
    page.getByRole('navigation', { name: /primary navigation/i }),
  ).toBeVisible()
  await expect(
    page.getByText('Activate a library', { exact: true }),
  ).toBeVisible()
})

test('browses, creates and activates a library, then imports a local archive', async ({
  page,
  server,
}) => {
  await page.goto(server.url)
  await page.getByRole('button', { name: /manage libraries/i }).click()
  await page.getByRole('button', { name: /add library/i }).click()
  const picker = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Game root path') })
  await picker.getByRole('button', { name: 'Browse folders' }).click()
  await picker.getByRole('button', { name: 'game/', exact: true }).click()
  await picker.getByRole('button', { name: 'Select this folder' }).click()
  await expect(picker.getByLabel('Game root path')).toHaveValue(server.game)
  await picker.getByRole('button', { name: 'Use path' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('tab', { name: 'game' })).toBeVisible()
  await dialog.getByRole('button', { name: /add library/i }).click()
  const secondPicker = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Game root path') })
  await secondPicker
    .getByLabel('Game root path')
    .fill(path.join(server.root, 'second-game'))
  await secondPicker.getByRole('button', { name: 'Use path' }).click()
  await dialog.getByRole('tab', { name: 'game', exact: true }).click()
  await dialog.getByRole('button', { name: /^activate$/i }).click()
  await expect(
    dialog.getByRole('button', { name: /activated/i }),
  ).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Add mod', exact: true }).click()
  const archiveDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Archive paths') })
  await archiveDialog.getByLabel('Archive paths').fill(server.archive)
  await archiveDialog.getByRole('button', { name: 'Use path' }).click()
  await expect(
    page.getByText('fixture-mod', { exact: false }).first(),
  ).toBeVisible()
  await expect
    .poll(async () =>
      readFile(
        path.join(server.game, '.mod_keeper', 'manifest.toml'),
        'utf8',
      ).catch(() => ''),
    )
    .toContain('fixture-mod')
})

test('settings persist through a fresh browser context', async ({
  browser,
  page,
  server,
}) => {
  await page.goto(server.url)
  await page.getByRole('link', { name: /settings/i }).click()
  await page.getByRole('radio', { name: /dark/i }).click()
  await expect(page.getByRole('radio', { name: /dark/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect
    .poll(() =>
      readFile(
        path.join(server.root, 'config', 'Modkeeper', 'config.toml'),
        'utf8',
      ).catch(() => ''),
    )
    .toContain('theme = "dark"')
  const context = await browser.newContext()
  const fresh = await context.newPage()
  await fresh.goto(server.url)
  await fresh.getByRole('link', { name: /settings/i }).click()
  await expect(fresh.getByRole('radio', { name: /dark/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await context.close()
})
