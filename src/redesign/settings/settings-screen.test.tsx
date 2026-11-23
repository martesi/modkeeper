import { getDefaultStore } from 'jotai'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test'
import { installWailsMock } from '@/wails/mock'
import { installLinguiMacroMock } from '../testing/lingui-macro'
import { settingsAtom } from '../state/settings-state'

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
let deferFirstSave = false
let completeFirstSave: (() => void) | undefined

beforeEach(async () => {
  getDefaultStore().set(settingsAtom, {
    theme: 'system',
    accentColor: 'default',
    language: 'en-US',
    enableModsOnInstall: true,
    warnIncompatibleForgeInstall: true,
    forgeEndpoint: '',
  })
  document.body.replaceChildren()
  container = document.createElement('div')
  document.body.append(container)
  savedSettings = undefined
  settingsSaveHistory = []
  deferFirstSave = false
  completeFirstSave = undefined
  removeMock = installWailsMock({
    events: { on: () => () => {} },
    commands: {
      saveSettings: (settings) => {
        savedSettings = settings
        settingsSaveHistory.push(settings)
        if (deferFirstSave && settingsSaveHistory.length === 1) {
          return new Promise((resolve) => {
            completeFirstSave = () => resolve({ status: 'ok', data: settings })
          })
        }
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

function editEndpoint(input: HTMLInputElement, value: string) {
  const previousValue = input.value
  const setValue = Object.getOwnPropertyDescriptor(
    browserWindow.HTMLInputElement.prototype,
    'value',
  )?.set
  setValue?.call(input, value)
  const tracker = Reflect.get(input, '_valueTracker') as
    { setValue(value: string): void } | undefined
  tracker?.setValue(previousValue)
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

test('typing a Forge endpoint and saving persists the complete value', async () => {
  const input = container.querySelector<HTMLInputElement>(
    '[aria-label="Forge endpoint"]',
  )
  const save = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Save',
  )
  if (!input || !save) throw new Error('Forge endpoint controls are missing')

  await act(async () => editEndpoint(input, 'https://forge.example/api/v0'))
  expect(save.disabled).toBe(false)
  await act(async () => save.click())

  expect(input?.value).toBe('https://forge.example/api/v0')
  expect(savedSettings).toMatchObject({
    forgeEndpoint: 'https://forge.example/api/v0',
  })
})

test('editing back during a pending save keeps the newer draft', async () => {
  deferFirstSave = true
  const input = container.querySelector<HTMLInputElement>(
    '[aria-label="Forge endpoint"]',
  )
  const save = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Save',
  )
  if (!input || !save) throw new Error('Forge endpoint controls are missing')

  await act(async () => editEndpoint(input, 'https://forge.example/api/v0'))
  await act(async () => {
    save.click()
    await Promise.resolve()
  })
  if (!completeFirstSave)
    throw new Error('The first settings save did not start')

  await act(async () => editEndpoint(input, ''))
  expect(input.value).toBe('')
  await act(async () => {
    completeFirstSave?.()
    await Promise.resolve()
  })

  expect(input.value).toBe('')
  const saveDraft = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Save',
  )
  if (!saveDraft) throw new Error('Save control is missing after completion')
  expect(saveDraft.disabled).toBe(false)
  await act(async () => saveDraft.click())
  expect(settingsSaveHistory[1]).toMatchObject({ forgeEndpoint: '' })
})

test('overlapping settings saves preserve both patches', async () => {
  const { saveSettings } = await import('../data/settings-repository')
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
