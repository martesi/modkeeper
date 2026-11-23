import { expect, test } from '@playwright/test'
import { bootMockApp } from './boot'

test('All pages contain every result once', async ({ page }) => {
  await page.route(
    '**/src/redesign/registry/registry-screen.tsx*',
    async (route) => {
      const response = await route.fetch()
      const body = (await response.text()).replace('perPage: 20', 'perPage: 1')
      await route.fulfill({ response, body })
    },
  )
  await page.route(
    '**/src/redesign/data/registry-repository.ts*',
    async (route) => {
      const response = await route.fetch()
      const body = (await response.text())
        .replace(
          'items: filteredMods,',
          'items: (() => { if (modPage > Math.max(1, Math.ceil(filteredMods.length / perPage))) throw new Error("out of range mods"); return filteredMods.slice((modPage - 1) * perPage, modPage * perPage) })(),',
        )
        .replace(
          'items: filteredAddons,',
          'items: (() => { if (addonPage > Math.max(1, Math.ceil(filteredAddons.length / perPage))) throw new Error("out of range addons"); return filteredAddons.slice((addonPage - 1) * perPage, addonPage * perPage) })(),',
        )
      await route.fulfill({ response, body })
    },
  )
  await bootMockApp(page)
  await page.getByRole('link', { name: /registry/i }).click()
  const pager = page.getByRole('group', { name: 'All Items pages' })
  const names = [
    'Camo And Stickers',
    'SAIN — Solarint AI',
    'SPT Realism Mod',
    'Simple Caliber and Ammo paint markers',
    'Profile Editor Decoupled CLI',
  ]
  const expected = [[names[0], names[3]], [names[1], names[4]], [names[2]]]
  const seen: string[] = []
  for (const [index, items] of expected.entries()) {
    for (const name of names) {
      const locator = page.getByText(name, { exact: true })
      if (items.includes(name)) {
        await expect(locator).toBeVisible()
        seen.push(name)
      } else await expect(locator).toHaveCount(0)
    }
    if (index < expected.length - 1)
      await pager.getByRole('button', { name: /next/i }).click()
  }
  expect(new Set(seen).size).toBe(names.length)
  expect(seen.sort()).toEqual([...names].sort())
})
