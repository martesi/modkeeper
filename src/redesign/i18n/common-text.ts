/*
 * Common i18n namespace (frontend-redesign-spec.md §10).
 *
 * One member per user-visible string, plainly named — the namespace object already says "translated
 * text", so no `t` prefix. Keys follow `domain.context.descriptor`. Members are functions so they
 * are never evaluated before the locale loads.
 */
import { t } from '@lingui/core/macro'

export const commonText = {
  appName: () => t({ id: 'common.app.name', message: 'Modkeeper' }),
  home: () => t({ id: 'common.nav.home', message: 'Home' }),
  settings: () => t({ id: 'common.nav.settings', message: 'Settings' }),
  primaryNavigation: () =>
    t({ id: 'common.nav.primaryNavigation', message: 'Primary navigation' }),
  workspace: () => t({ id: 'common.nav.workspace', message: 'Workspace' }),
  preferences: () =>
    t({ id: 'common.nav.preferences', message: 'Preferences' }),
  collapseNavigation: () =>
    t({ id: 'common.nav.collapseNavigation', message: 'Collapse navigation' }),
  expandNavigation: () =>
    t({ id: 'common.nav.expandNavigation', message: 'Expand navigation' }),
  minimizeWindow: () =>
    t({ id: 'common.window.minimize', message: 'Minimize window' }),
  maximizeWindow: () =>
    t({ id: 'common.window.maximize', message: 'Maximize or restore window' }),
  searchUnavailable: () =>
    t({ id: 'common.search.unavailable', message: 'Search unavailable here' }),
  searchPaletteDescription: () =>
    t({
      id: 'common.search.paletteDescription',
      message: 'Type to search. Press Escape to close.',
    }),
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
