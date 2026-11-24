import { afterEach, describe, expect, vi, test } from 'vitest'
import { i18n } from '@lingui/core'
import { initializeStartupLocale } from './i18n'

afterEach(() => vi.restoreAllMocks())

describe('initializeStartupLocale', () => {
  test('activates source text when locale loading fails', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await initializeStartupLocale(
      () => Promise.reject(new Error('catalog chunk unavailable')),
      100,
    )

    expect(i18n.locale).toBe('en-US')
    expect(logError).toHaveBeenCalledWith(
      '[startup] locale initialization failed; using source text',
      expect.any(Error),
    )
  })

  test('activates source text when locale loading times out', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await initializeStartupLocale(() => new Promise(() => {}), 1)

    expect(i18n.locale).toBe('en-US')
    expect(logError).toHaveBeenCalledWith(
      '[startup] locale initialization failed; using source text',
      expect.any(Error),
    )
  })
})
