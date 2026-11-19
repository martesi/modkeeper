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
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('tab', { name: /instance-/i })).toBeVisible()
  await dialog.getByRole('tab', { name: 'Mock SPT' }).click()
  await dialog.getByRole('button', { name: /^activate$/i }).click()
  await expect(
    dialog.getByRole('button', { name: /activated/i }),
  ).toBeDisabled()
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
