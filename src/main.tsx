import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { Provider as JotaiProvider, getDefaultStore } from 'jotai'
import { ThemeProvider } from 'next-themes'
import Router from '@utils/router.ts'
import './assets/style.css'
import { I18nProvider } from '@lingui/react'
import { i18n } from '@lingui/core'
import { initializeStartupLocale } from '@utils/i18n.ts'
import { Toaster } from './components/ui/sonner'
import {
  clearBootError,
  logBootError,
  readBootError,
  reportBootError,
} from '@utils/boot-diagnostics'

declare global {
  interface Window {
    __MODKEEPER_BOOTED__?: boolean
    __MODKEEPER_MARK_BOOTED__?: () => void
    __MODKEEPER_REPORT_BOOT_ERROR__?: (message: string, error: unknown) => void
  }
}

const root = document.getElementById('root')
const bootFallback = document.getElementById('boot-fallback')
window.__MODKEEPER_REPORT_BOOT_ERROR__ = reportBootError
if (new URLSearchParams(window.location.search).has('native-smoke')) {
  void import('./native_smoke')
}

const previousBootError = readBootError()
if (previousBootError) {
  logBootError('previous boot failure', new Error(previousBootError))
}

async function startApp() {
  await initializeStartupLocale()

  if (!root) throw new Error('The app root element is missing')

  createRoot(root).render(
    <StrictMode>
      <ThemeProvider
        defaultTheme="system"
        enableSystem={true}
        storageKey="modkeeper-theme"
        attribute="class"
      >
        {/* Explicitly the default store: the redesign repository layer writes atoms from outside
            React via getDefaultStore(), so the React tree must read the same store. */}
        <JotaiProvider store={getDefaultStore()}>
          <I18nProvider i18n={i18n}>
            <RouterProvider router={Router} />
            <Toaster />
            <StartupComplete />
          </I18nProvider>
        </JotaiProvider>
      </ThemeProvider>
    </StrictMode>,
  )
}

function handleStartupFailure(error: unknown) {
  // React/bootstrap APIs throw outside the render boundary; keep a visible reload path.
  reportBootError('app initialization failed', error)
  if (!bootFallback) return
  const message = bootFallback.querySelector('[data-boot-message]')
  if (message) {
    message.textContent = `Modkeeper could not start: ${error instanceof Error ? error.message : String(error)}`
  }
  bootFallback.hidden = false
  bootFallback.setAttribute('role', 'alert')
  const reload =
    bootFallback.querySelector<HTMLButtonElement>('[data-boot-reload]')
  if (reload) reload.hidden = false
}

function StartupComplete() {
  useEffect(() => {
    clearBootError()
    window.__MODKEEPER_MARK_BOOTED__?.()
  }, [])

  return null
}

void startApp().catch(handleStartupFailure)
