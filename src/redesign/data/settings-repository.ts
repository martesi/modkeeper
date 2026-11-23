/*
 * Settings repository (consolidated-spec.md §10).
 *
 * Settings are backend-owned in App Config (T1). Mutations accept partial patches and serialize
 * them against the latest atom value before sending the full settings object to the backend.
 * Returned settings replace the atom wholesale. Appliers turn that saved value into visible effects.
 */
import { toast } from 'sonner'
import { i18n } from '@lingui/core'
import { commands } from '@/wails'
import { hasNativeRuntime } from '@/wails/runtime'
import { getDefaultStore } from 'jotai'
import { changeLocale } from '@/utils/i18n'
import type { AppSettings } from './redesign-types'
import { resolveCommandError } from '../shared/hooks/use-command-error'
import { contrastOn, accentForBackground } from '../shared/utils/contrast'
import { commonText } from '../i18n/common-text'
import {
  emptyWorkspace,
  getMockWorkspace,
  setMockWorkspace,
} from './example-data'
import { runPlainCommand } from './runtime-boundary'
import { setSettings, settingsAtom } from '../state/settings-state'
import { DEFAULT_ACCENT } from './settings-defaults'

export { DEFAULT_ACCENT } from './settings-defaults'

let settingsSaveQueue: Promise<void> = Promise.resolve()

export async function saveSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const operation = settingsSaveQueue.then(() => {
    const settings = {
      ...(getDefaultStore().get(settingsAtom) ?? emptyWorkspace().settings),
      ...patch,
    }
    return runPlainCommand({
      isTauri: hasNativeRuntime(),
      invoke: () => commands.saveSettings(settings),
      mock: () => {
        const workspace = structuredClone(getMockWorkspace())
        workspace.settings = settings
        setMockWorkspace(workspace)
        setSettings(settings)
        return settings
      },
      apply: setSettings,
      onDomainError: (error) => {
        toast.error(resolveCommandError(error))
        console.error('[redesign] saveSettings command error', error)
      },
      onTransportError: (error) => {
        toast.error(commonText.backendUnavailable())
        console.error('[redesign] saveSettings transport failure', error)
      },
      current: () =>
        getDefaultStore().get(settingsAtom) ?? emptyWorkspace().settings,
    })
  })
  settingsSaveQueue = operation.then(
    () => undefined,
    () => undefined,
  )
  return operation
}

/**
 * Custom accents override the theme tokens. The theme-aware Fluent default clears all overrides.
 */
export function applyAccent(accentColor: string, isDark = false): void {
  const style = document.documentElement.style
  if (accentColor === DEFAULT_ACCENT) {
    for (const name of ['--primary', '--primary-foreground', '--ring']) {
      style.removeProperty(name)
    }
    return
  }
  // The stored hex is data; the rendered accent is shade-adjusted only when it would be
  // unreadable as text/focus against the current canvas. Filled controls choose their own
  // foreground from the adjusted fill.
  const readable = accentForBackground(
    accentColor,
    isDark ? '#202020' : '#f3f3f3',
  )
  style.setProperty('--primary', readable)
  style.setProperty('--primary-foreground', contrastOn(readable))
  style.setProperty('--ring', readable)
}

export async function applyLanguage(language: string): Promise<void> {
  if (i18n.locale === language) return
  try {
    await changeLocale(language)
  } catch (error) {
    // Configs written before the backend default was fixed persist bare "en"; there is no such
    // catalog (lingui locales are region-tagged, e.g. en-US), so fall back instead of warning
    // on every boot.
    if (language === 'en-US') throw error
    console.warn(
      `[redesign] no catalog for "${language}", falling back to en-US`,
      error,
    )
    await changeLocale('en-US')
  }
}
