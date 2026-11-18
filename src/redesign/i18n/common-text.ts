/*
 * Common i18n namespace (frontend-redesign-spec.md §10).
 *
 * One member per user-visible string, plainly named — the namespace object already says "translated
 * text", so no `t` prefix. Keys follow `domain.context.descriptor`. Members are functions so they
 * are never evaluated before the locale loads.
 */
import { t } from '@lingui/core/macro'

export const commonText = {
  home: () => t({ id: 'common.nav.home', message: 'Home' }),
  settings: () => t({ id: 'common.nav.settings', message: 'Settings' }),
  libraryBusy: () =>
    t({ id: 'common.status.libraryBusy', message: 'Library busy' }),
  somethingWentWrong: () =>
    t({
      id: 'common.status.somethingWentWrong',
      message: 'Something went wrong',
    }),
  backendUnavailable: () =>
    t({
      id: 'common.status.backendUnavailable',
      message: 'The app could not communicate with its backend.',
    }),
  reload: () => t({ id: 'common.action.reload', message: 'Reload' }),
  retry: () => t({ id: 'common.action.retry', message: 'Retry' }),
  refresh: () =>
    t({ id: 'common.action.refreshWorkspace', message: 'Refresh workspace' }),
  fileOpenerFailed: () =>
    t({
      id: 'common.error.fileOpenerFailed',
      message: 'Could not open this location.',
    }),
  cancel: () => t({ id: 'common.action.cancel', message: 'Cancel' }),
  close: () => t({ id: 'common.action.close', message: 'Close' }),
}
