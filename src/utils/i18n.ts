import { i18n } from '@lingui/core'

const STARTUP_LOCALE_TIMEOUT_MS = 3_000

export async function changeLocale(locale: string) {
  const { messages } = await import(`../../locales/${locale}.po`)

  i18n.loadAndActivate({ locale, messages })
}

export async function initializeStartupLocale(
  loadLocale: () => Promise<void> = () => changeLocale('en-US'),
  timeoutMs = STARTUP_LOCALE_TIMEOUT_MS,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  await Promise.race([
    loadLocale(),
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Locale loading exceeded ${timeoutMs}ms`)),
        timeoutMs,
      )
    }),
  ])
    .catch((error: unknown) => {
      // This boundary keeps a missing locale chunk from preventing the app root from rendering.
      console.error(
        '[startup] locale initialization failed; using source text',
        error,
      )
      i18n.loadAndActivate({ locale: 'en-US', messages: {} })
    })
    .finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    })
}
