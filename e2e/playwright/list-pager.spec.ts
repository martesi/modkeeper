import { expect, test } from '@playwright/test'
import { bootMockApp } from './boot'

test('library list keeps both row edges and registry All has one pager', async ({
  page,
}) => {
  await bootMockApp(page)
  await page.getByRole('link', { name: /library/i }).click()
  await expect(page.getByText('Example Server Mod')).toBeVisible()
  await page.getByRole('button', { name: /list/i }).click()

  const firstCell = page
    .locator('tr')
    .filter({
      hasText: 'Example Server Mod',
    })
    .locator('td')
    .first()
  const lastCell = page
    .locator('tr')
    .filter({
      hasText: 'Example Server Mod',
    })
    .locator('td')
    .last()
  for (const [theme, width] of [
    ['light', 1280],
    ['dark', 1280],
    ['light', 440],
    ['dark', 440],
  ] as const) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(
      (value) =>
        document.documentElement.classList.toggle('dark', value === 'dark'),
      theme,
    )
    const left = await firstCell.evaluate(
      (cell) => getComputedStyle(cell).borderLeftWidth,
    )
    const right = await lastCell.evaluate(
      (cell) => getComputedStyle(cell).borderRightWidth,
    )
    console.log(`${theme} ${width}px row borders: left=${left}, right=${right}`)
    expect(parseFloat(left)).toBeGreaterThan(0)
    expect(parseFloat(right)).toBeGreaterThan(0)
  }

  await page.getByRole('link', { name: /registry/i }).click()
  await page.getByRole('button', { name: /list/i }).click()
  await expect(page.getByRole('table', { name: 'Registry' })).toBeVisible()
  const registryOverflow = await page.evaluate(() => {
    const table = document.querySelector(
      '[role="table"][aria-label="Registry"]',
    )
    const results = table?.parentElement
    if (!table || !results) throw new Error('Registry list not found')
    return {
      tableWidth: table.getBoundingClientRect().width,
      viewportWidth: results.getBoundingClientRect().width,
      overflowX: getComputedStyle(results).overflowX,
    }
  })
  console.log('narrow registry list geometry', registryOverflow)
  const allFilter = page.getByRole('button', {
    name: 'All Items',
    exact: true,
  })
  await expect(allFilter).toBeVisible()
  await expect(
    page.getByRole('group', { name: 'All Items pages' }),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Mods', exact: true }).click()
  await expect(page.getByRole('group', { name: /mods/i })).toHaveCount(1)
  await page.getByRole('button', { name: 'Addons', exact: true }).click()
  await expect(page.getByRole('group', { name: /addon pages/i })).toHaveCount(1)
})
