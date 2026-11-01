/*
 * Settings-screen i18n namespace (frontend-redesign-spec.md §10): the §12.6 row list.
 */
import { t } from '@lingui/core/macro'

export const settingsText = {
  title: () => t({ id: 'settings.header.title', message: 'Settings' }),
  subtitle: () =>
    t({
      id: 'settings.header.subtitle',
      message: 'Find and configure settings instantly.',
    }),
  enableOnInstall: () =>
    t({
      id: 'settings.install.enable.label',
      message: 'Enable mods after installation',
    }),
  enableOnInstallDescription: () =>
    t({
      id: 'settings.install.enable.description',
      message:
        'Newly installed mods are enabled automatically. Sync the library to deploy them.',
    }),
  appearance: () =>
    t({ id: 'settings.appearance.label', message: 'App Theme' }),
  appearanceDescription: () =>
    t({
      id: 'settings.appearance.description',
      message: 'Light, dark, or system preference',
    }),
  themeSystem: () => t({ id: 'settings.appearance.system', message: 'System' }),
  themeLight: () => t({ id: 'settings.appearance.light', message: 'Light' }),
  themeDark: () => t({ id: 'settings.appearance.dark', message: 'Dark' }),
  accent: () => t({ id: 'settings.accent.label', message: 'Accent Color' }),
  accentDescription: () =>
    t({
      id: 'settings.accent.description',
      message: 'Custom branding color',
    }),
  accentSwatch: (name: string) =>
    t({ id: 'settings.accent.swatch', message: `Use ${name} accent` }),
  language: () =>
    t({ id: 'settings.language.label', message: 'Interface Language' }),
  languageDescription: () =>
    t({
      id: 'settings.language.description',
      message: 'App display language',
    }),
}
