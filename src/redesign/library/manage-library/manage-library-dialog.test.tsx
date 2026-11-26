import { Provider, createStore } from 'jotai'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test'
import { libraryWorkspaceAtom } from '../../state/library-state'
import { getMockWorkspace, setMockWorkspace } from '../../data/example-data'
import { installLinguiMacroMock } from '../../testing/lingui-macro'

installLinguiMacroMock()

const browserWindow = new Window()
const originalGlobals = new Map<string, PropertyDescriptor | undefined>()
for (const [name, value] of Object.entries({
  window: browserWindow,
  document: browserWindow.document,
  navigator: browserWindow.navigator,
  HTMLElement: browserWindow.HTMLElement,
  HTMLFormElement: browserWindow.HTMLFormElement,
  Element: browserWindow.Element,
  Node: browserWindow.Node,
  NodeFilter: browserWindow.NodeFilter,
  DocumentFragment: browserWindow.DocumentFragment,
  Event: browserWindow.Event,
  EventTarget: browserWindow.EventTarget,
  MouseEvent: browserWindow.MouseEvent,
  CustomEvent: browserWindow.CustomEvent,
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
let previousMockWorkspace = getMockWorkspace()

beforeEach(async () => {
  previousMockWorkspace = structuredClone(getMockWorkspace())
  const workspace = getMockWorkspace()
  for (const entry of workspace.libraries) {
    if ('id' in entry) entry.hostRuntime = 'wsl'
  }
  setMockWorkspace(workspace)
  const store = createStore()
  store.set(libraryWorkspaceAtom, workspace)
  document.body.replaceChildren()
  container = document.createElement('div')
  document.body.append(container)
  const { ManageLibraryDialog } = await import('./manage-library-dialog')
  root = createRoot(container)
  await act(async () =>
    root?.render(
      createElement(
        Provider,
        { store },
        createElement(ManageLibraryDialog, {
          open: true,
          onOpenChange: () => {},
        }),
      ),
    ),
  )
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  setMockWorkspace(previousMockWorkspace)
  document.body.replaceChildren()
})

afterAll(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  browserWindow.happyDOM.abort()
})

test('keeps runtime and deployment controls disabled in WSL', () => {
  const selects =
    document.body.querySelectorAll<HTMLButtonElement>('[role="combobox"]')
  expect(selects).toHaveLength(2)
  expect(selects[0]?.disabled).toBe(true)
  expect(selects[1]?.disabled).toBe(true)
  expect(document.body.textContent).toContain(
    'Runtime and deployment choices are disabled in WSL',
  )
})
