import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { Provider as JotaiProvider, getDefaultStore } from 'jotai'
import { ThemeProvider } from 'next-themes'
import Router from '@utils/router.ts'
import './assets/style.css'
import { I18nProvider } from '@lingui/react'
import { i18n } from '@lingui/core'
import { changeLocale } from '@utils/i18n.ts'
import { Toaster } from './components/ui/sonner'

await changeLocale('en-US')

createRoot(document.getElementById('root')!).render(
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
        </I18nProvider>
      </JotaiProvider>
    </ThemeProvider>
  </StrictMode>,
)
