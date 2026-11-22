import { expect, test } from '@playwright/test'
import { bootMockApp } from './boot'

test('empty library card is centered in the main area in both themes', async ({
  page,
}) => {
  await bootMockApp(page)
  await page.getByRole('link', { name: /library/i }).click()
  await expect(page.getByText('Activate a library')).toBeVisible()
  await expect(
    page.getByText('Click to create or activate a library'),
  ).toHaveCount(0)

  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (value) =>
        document.documentElement.classList.toggle('dark', value === 'dark'),
      theme,
    )
    const centers = await page.evaluate(() => {
      const title = [...document.querySelectorAll('p')].find(
        (node) => node.textContent === 'Activate a library',
      )
      const card = title?.parentElement
      const main = document.querySelector('main')
      if (!card || !main)
        throw new Error('Empty library card or main area is missing')
      const a = card.getBoundingClientRect()
      const b = main.getBoundingClientRect()
      return {
        cardX: a.x + a.width / 2,
        cardY: a.y + a.height / 2,
        mainX: b.x + b.width / 2,
        mainY: b.y + b.height / 2,
      }
    })
    expect(
      Math.abs(centers.cardX - centers.mainX),
      `${theme} horizontal center`,
    ).toBeLessThanOrEqual(2)
    expect(
      Math.abs(centers.cardY - centers.mainY),
      `${theme} vertical center`,
    ).toBeLessThanOrEqual(2)
    await page.screenshot({
      path: `test-results/library-empty-${theme}.png`,
      fullPage: true,
    })
  }
})
