import { expect, test } from '@playwright/test'

test('serves the app favicon', async ({ page, request }) => {
  await page.goto('/')
  const legacyResponse = await request.get('/mod_keeper.svg')
  expect(legacyResponse.status()).toBe(200)
  expect(legacyResponse.headers()['content-type']).toContain('image/svg+xml')
  const icon = page.locator('link[rel~="icon"]')
  const href = await icon.getAttribute('href')
  expect(href).toBeTruthy()
  if (!href) throw new Error('Page does not declare a favicon href')
  const url = await icon.evaluate((link: HTMLLinkElement) => link.href)
  const response = await request.get(url)
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('image/svg+xml')
  const svg = await response.text()
  const validSvg = await page.evaluate((body) => {
    const document = new DOMParser().parseFromString(body, 'image/svg+xml')
    return (
      document.documentElement.localName === 'svg' &&
      document.documentElement.namespaceURI === 'http://www.w3.org/2000/svg' &&
      !document.querySelector('parsererror')
    )
  }, svg)
  expect(validSvg).toBe(true)
})
