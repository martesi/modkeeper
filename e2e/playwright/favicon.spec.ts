import { expect, test } from '@playwright/test'

test('serves the app favicon', async ({ page, request }) => {
  await page.goto('/')
  const response = await request.get('/mod_keeper.svg')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('image/svg+xml')
})
