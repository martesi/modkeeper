import { i18n } from '@lingui/core'
import { t } from '@lingui/core/macro'
import { I18nProvider } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

test('the Vite Lingui transform interpolates and renders source messages', () => {
  const name = 'Ada'
  expect(t`Hello ${name}`).toBe('Hello Ada')
  expect(
    renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <Trans>
          Hello <strong>{name}</strong>
        </Trans>
      </I18nProvider>,
    ),
  ).toBe('Hello <strong>Ada</strong>')
})
