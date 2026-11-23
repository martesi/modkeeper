import { getDefaultStore } from 'jotai'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test'
import { installWailsMock } from '@/wails/mock'
import { installLinguiMacroMock } from '../testing/lingui-macro'
import { settingsAtom } from '../state/settings-state'
import { saveSettings } from '../data/settings-repository'

installLinguiMacroMock()

const browserWindow = new Window()
const originalGlobals = new Map<string, PropertyDescriptor | undefined>()
for (const [name, value] of Object.entries({
  window: browserWindow,
  document: browserWindow.document,
  navigator: browserWindow.navigator,
  HTMLElement: browserWindow.HTMLElement,
  HTMLFormElement: browserWindow.HTMLFormElement,
  HTMLInputElement: browserWindow.HTMLInputElement,
  Element: browserWindow.Element,
  Node: browserWindow.Node,
  DocumentFragment: browserWindow.DocumentFragment,
  Event: browserWindow.Event,
  InputEvent: browserWindow.InputEvent,
  MouseEvent: browserWindow.MouseEvent,
  MutationObserver: browserWindow.MutationObserver,
  getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  })
}

let root: Root | null = null
let container: HTMLDivElement
let removeMock: (() => void) | undefined
let savedSettings: unknown
let settingsSaveHistory: unknown[]

beforeEach(async () => {
  getDefaultStore().set(settingsAtom, {
    theme: 'system',
    accentColor: 'default',
    language: 'en-US',
    enableModsOnInstall: true,
    forgeEndpoint: '',
  })
  document.body.replaceChildren()
  container = document.createElement('div')
  document.body.append(container)
  savedSettings = undefined
  settingsSaveHistory = []
  removeMock = installWailsMock({
    events: { on: () => () => {} },
    commands: {
      saveSettings: (settings) => {
        savedSettings = settings
        settingsSaveHistory.push(settings)
        return { status: 'ok', data: settings }
      },
    },
  })
  const { SettingsScreen } = await import('./settings-screen')
  const { createRoot } = await import('react-dom/client')
  root = createRoot(container)
  await act(async () => root?.render(createElement(SettingsScreen)))
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  removeMock?.()
  removeMock = undefined
  document.body.replaceChildren()
})

afterAll(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  browserWindow.happyDOM.abort()
})

test('typing a Forge endpoint and saving persists the complete value', async () => {
  const input = container.querySelector<HTMLInputElement>(
    '[aria-label="Forge endpoint"]',
  )
  const save = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Save',
  )
  if (!input || !save) throw new Error('Forge endpoint controls are missing')

  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(
      browserWindow.HTMLInputElement.prototype,
      'value',
    )?.set
    setValue?.call(input, 'https://forge.example/api/v0')
    const tracker = Reflect.get(input, '_valueTracker') as
      { setValue(value: string): void } | undefined
    tracker?.setValue('')
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(save.disabled).toBe(false)
  await act(async () => save.click())

  expect(input?.value).toBe('https://forge.example/api/v0')
  expect(savedSettings).toMatchObject({
    forgeEndpoint: 'https://forge.example/api/v0',
  })
})

test('overlapping settings saves preserve both patches', async () => {
  await Promise.all([
    saveSettings({ theme: 'dark' }),
    saveSettings({ forgeEndpoint: 'https://forge.example/api/v0' }),
  ])

  expect(settingsSaveHistory).toHaveLength(2)
  expect(settingsSaveHistory[1]).toMatchObject({
    theme: 'dark',
    forgeEndpoint: 'https://forge.example/api/v0',
  })
})
