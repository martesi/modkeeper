import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, createStore } from 'jotai'
import { libraryWorkspaceAtom } from '../../state/library-state'
import { emptyWorkspace } from '../../data/example-data'

const gateCalls: unknown[][] = []
const installCalls: unknown[] = []
const textProxy = new Proxy(
  {},
  {
    get: () => () => 'text',
  },
)

mock.module('../../i18n/library-text', () => ({ libraryText: textProxy }))
mock.module('../../data/library-repository', () => ({
  installModArchives: async (input: unknown) => {
    installCalls.push(input)
  },
}))
mock.module('../utils/picker-gate', () => ({
  pickWithNativeOrPathEntry: (...args: unknown[]) => {
    gateCalls.push(args)
    return Promise.resolve([])
  },
}))

const { useArchiveFilePicker } = await import('./use-archive-file-picker')

const browserWindow = new Window()
const originalGlobals = new Map<string, PropertyDescriptor | undefined>()

for (const [name, value] of Object.entries({
  window: browserWindow,
  document: browserWindow.document,
  navigator: browserWindow.navigator,
  HTMLElement: browserWindow.HTMLElement,
  Element: browserWindow.Element,
  Node: browserWindow.Node,
  Event: browserWindow.Event,
  MutationObserver: browserWindow.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  })
}

afterEach(() => {
  gateCalls.length = 0
  installCalls.length = 0
})

afterAll(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  browserWindow.happyDOM.abort()
})

describe('useArchiveFilePicker', () => {
  test('uses the gated picker path instead of calling a platform picker', async () => {
    const store = createStore()
    const workspace = emptyWorkspace()
    workspace.activeLibraryId = 'lib-test'
    store.set(libraryWorkspaceAtom, workspace)

    let pickAndInstall: (() => Promise<void>) | undefined
    function Probe() {
      pickAndInstall = useArchiveFilePicker('add-button').pickAndInstall
      return null
    }

    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(Provider, { store }, createElement(Probe)))
    })

    expect(gateCalls).toHaveLength(0)
    await act(async () => {
      await pickAndInstall?.()
    })
    expect(gateCalls).toHaveLength(1)
    expect(installCalls).toHaveLength(0)

    await act(async () => {
      root.unmount()
    })
    document.body.replaceChildren()
  })
})
