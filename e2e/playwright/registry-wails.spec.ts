import { expect, test } from '@playwright/test'
import { bootMockApp } from './boot'

test('Wails mock searches, opens details, and loads versions', async ({
  page,
}, testInfo) => {
  await bootMockApp(page)
  await page.evaluate(() => {
    ;(window as Window & { _wails?: { environment: { OS: string } } })._wails =
      {
        environment: { OS: 'linux' },
      }
  })
  await page.getByRole('link', { name: /registry/i }).click()

  await page.evaluate(() => {
    const mock = window.__MK_WAILS_MOCK__
    if (!mock?.commands) throw new Error('Wails mock commands missing')
    const commands = mock.commands
    for (const name of ['forgeSearch', 'forgeModDetail', 'forgeModVersions']) {
      const original = commands[name]
      if (!original) throw new Error(`Wails mock ${name} missing`)
      commands[name] = (...args) => {
        ;(
          window as Window & { __MK_FORGE_CALLS__?: unknown[][] }
        ).__MK_FORGE_CALLS__ ??= []
        ;(
          window as Window & { __MK_FORGE_CALLS__?: unknown[][] }
        ).__MK_FORGE_CALLS__?.push([name, ...args])
        return original(...args)
      }
    }
  })

  await page.getByPlaceholder(/search/i).fill('Camo')
  const sortButton = page.getByRole('button', { name: 'Sort Registry' })
  await sortButton.click()
  await page.getByRole('menuitemradio', { name: 'Alphabetical' }).click()
  const alpha = page.getByRole('heading', { name: 'Mock Camo Alpha' })
  const zulu = page.getByRole('heading', { name: 'Mock Camo Zulu' })
  await expect(alpha).toBeVisible()
  await expect(zulu).toBeVisible()
  const order = await page.locator('[role="row"] h3').allTextContents()
  expect(order.indexOf('Mock Camo Alpha')).toBeLessThan(
    order.indexOf('Mock Camo Zulu'),
  )
  await zulu.click()
  await expect(page.getByRole('heading', { name: 'Mock mod 1' })).toBeVisible()
  await expect(page.getByText('v1.0.0')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('registry-wails.png') })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __MK_FORGE_CALLS__?: unknown[][] })
            .__MK_FORGE_CALLS__,
      ),
    )
    .toEqual(
      expect.arrayContaining([
        ['forgeSearch', 'Camo', 1, 1, 20],
        ['forgeModDetail', 'mod', 1],
        ['forgeModVersions', 'mod', 1, 1],
      ]),
    )
})

test('Wails mock filters versions, persists warning and endpoint settings', async ({
  page,
}) => {
  await bootMockApp(page)
  await page.evaluate(() => {
    ;(window as Window & { _wails?: { environment: { OS: string } } })._wails =
      {
        environment: { OS: 'linux' },
      }
  })
  await page.getByRole('link', { name: /registry/i }).click()
  await page.getByPlaceholder(/search/i).fill('Camo')
  await page.getByRole('heading', { name: 'Mock Camo Zulu' }).click()
  await expect(page.getByRole('heading', { name: 'Mock mod 1' })).toBeVisible()

  const versions = page.getByRole('region', {
    name: 'Versions & Compatibility',
  })
  await expect(versions.getByText('2 version(s)')).toBeVisible()
  await versions.getByLabel('Compatible with this SPT version').check()
  await expect(versions.getByText('1 version(s)')).toBeVisible()
  await versions.getByLabel('Compatible with this SPT version').uncheck()

  await versions
    .getByRole('button', { name: 'Incompatible with SPT 3.9.0' })
    .click()
  await expect(page.getByText('Version may be incompatible')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Version may be incompatible')).toBeHidden()

  await page.getByRole('link', { name: /settings/i }).click()
  const warningSwitch = page.getByRole('switch', {
    name: 'Warn before installing incompatible Forge versions',
  })
  await warningSwitch.click()
  await expect(warningSwitch).toHaveAttribute('aria-checked', 'false')
  const endpoint = page.getByLabel('Forge endpoint')
  await expect(endpoint).toHaveAttribute(
    'placeholder',
    'Default Forge endpoint',
  )
  await endpoint.fill('https://forge.example/api/v0')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(endpoint).toHaveValue('https://forge.example/api/v0')
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem('mk-e2e-settings') ?? '{}'),
      ),
    )
    .toMatchObject({
      warnIncompatibleForgeInstall: false,
      forgeEndpoint: 'https://forge.example/api/v0',
    })

  await page.getByRole('link', { name: /registry/i }).click()
  await page.getByPlaceholder(/search/i).fill('Camo')
  await page.getByRole('heading', { name: 'Mock Camo Zulu' }).click()
  const incompatibleInstall = page.getByRole('button', {
    name: 'Incompatible with SPT 3.9.0',
  })
  await incompatibleInstall.click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
})
