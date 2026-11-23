import { afterEach, expect, test } from 'bun:test'
import { getDefaultStore } from 'jotai'
import type { AppSettings } from '@/wails/contract'
import { installWailsMock } from '@/wails/mock'
import { settingsAtom } from '../state/settings-state'
import { installLinguiMacroMock } from '../testing/lingui-macro'

installLinguiMacroMock()

const persistedSettings: AppSettings[] = []
let signalFirstSave: () => void = () => {}
let releaseFirstSave: (() => void) | undefined
let removeMock = () => {}
const originalWindow = globalThis.window

const { saveSettings } = await import('./settings-repository')
const store = getDefaultStore()
const startingSettings: AppSettings = {
  theme: 'system',
  accentColor: 'default',
  language: 'en-US',
  enableModsOnInstall: true,
  warnIncompatibleForgeInstall: true,
  forgeEndpoint: 'https://forge.example/api/v0',
}

test('serialized partial setting saves merge patches onto the latest settings', async () => {
  // @ts-expect-error Test installs a minimal Wails mock window.
  globalThis.window = { _wails: { environment: { OS: 'linux' } } }
  removeMock = installWailsMock({
    commands: {
      saveSettings: (input) => {
        const settings = input as AppSettings
        persistedSettings.push(settings)
        if (persistedSettings.length === 1) {
          return new Promise((resolve) => {
            signalFirstSave()
            releaseFirstSave = () => resolve(settings)
          })
        }
        return settings
      },
    },
  })
  persistedSettings.length = 0
  store.set(settingsAtom, startingSettings)
  let firstSaveStarted!: () => void
  const firstSaveStartedPromise = new Promise<void>((resolve) => {
    firstSaveStarted = resolve
  })
  signalFirstSave = firstSaveStarted

  const disableWarning = saveSettings({ warnIncompatibleForgeInstall: false })
  await firstSaveStartedPromise
  const updateAccent = saveSettings({ accentColor: 'teal' })
  await Promise.resolve()
  expect(persistedSettings).toHaveLength(1)

  releaseFirstSave?.()
  await Promise.all([disableWarning, updateAccent])
  expect(persistedSettings).toHaveLength(2)
  expect(persistedSettings[1]).toMatchObject({
    warnIncompatibleForgeInstall: false,
    accentColor: 'teal',
    forgeEndpoint: startingSettings.forgeEndpoint,
  })
})

afterEach(() => {
  removeMock()
  globalThis.window = originalWindow
})
