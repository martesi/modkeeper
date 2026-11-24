import { afterAll, afterEach, describe, expect, test } from 'vitest'
import { Window } from 'happy-dom'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, createStore } from 'jotai'
import { libraryWorkspaceAtom } from '../../state/library-state'
import { emptyWorkspace } from '../../data/example-data'

const pickCalls: Array<[unknown, unknown]> = []
const installCalls: unknown[] = []
const pickResults: string[][] = []
const picker = async (
  nativePick: () => Promise<string[]>,
  pathEntry: () => Promise<string[] | null>,
): Promise<string[] | null> => {
  pickCalls.push([nativePick, pathEntry])
  return pickResults.shift() ?? []
}
const install = async (input: unknown) => {
  installCalls.push(input)
  return { accepted: true }
}

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
  pickCalls.length = 0
  installCalls.length = 0
  pickResults.length = 0
})

afterAll(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  browserWindow.happyDOM.abort()
})

describe('useArchiveFilePicker', () => {
  test('uses the gated picker path and installs only a selection', async () => {
    const store = createStore()
    const workspace = emptyWorkspace()
    workspace.activeLibraryId = 'lib-test'
    store.set(libraryWorkspaceAtom, workspace)

    let pickAndInstall: (() => Promise<void>) | undefined
    function Probe() {
      pickAndInstall = useArchiveFilePicker('add-button', {
        pick: picker,
        install,
      }).pickAndInstall
      return null
    }

    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(Provider, { store }, createElement(Probe)))
    })

    // The hook delegates to the native/path gate supplied by the default seam.
    expect(pickCalls).toHaveLength(0)
    pickResults.push([])
    await act(async () => {
      await pickAndInstall?.()
    })
    expect(pickCalls).toHaveLength(1)
    expect(pickCalls[0]?.[0]).toEqual(expect.any(Function))
    expect(pickCalls[0]?.[1]).toEqual(expect.any(Function))
    expect(installCalls).toHaveLength(0)

    pickResults.push(['/local/archive.zip'])
    await act(async () => {
      await pickAndInstall?.()
    })
    expect(pickCalls).toHaveLength(2)
    expect(installCalls).toEqual([
      {
        libraryId: 'lib-test',
        paths: ['/local/archive.zip'],
        source: 'add-button',
      },
    ])

    await act(async () => {
      root.unmount()
    })
    document.body.replaceChildren()
  })
})
