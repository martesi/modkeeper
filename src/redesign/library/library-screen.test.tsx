import { Provider, createStore } from 'jotai'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest'
import {
  libraryWorkspaceAtom,
  workspaceStatusAtom,
} from '../state/library-state'

const browserWindow = new Window()
const originalGlobals = new Map<string, PropertyDescriptor | undefined>()
for (const [name, value] of Object.entries({
  window: browserWindow,
  document: browserWindow.document,
  navigator: browserWindow.navigator,
  HTMLElement: browserWindow.HTMLElement,
  Element: browserWindow.Element,
  Node: browserWindow.Node,
  NodeFilter: browserWindow.NodeFilter,
  Event: browserWindow.Event,
  EventTarget: browserWindow.EventTarget,
  MouseEvent: browserWindow.MouseEvent,
  CustomEvent: browserWindow.CustomEvent,
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

let store: ReturnType<typeof createStore>
let root: Root | null = null
let container: HTMLDivElement

beforeEach(async () => {
  store = createStore()
  store.set(libraryWorkspaceAtom, null)
  store.set(workspaceStatusAtom, 'ready')
  document.body.replaceChildren()
  container = document.createElement('div')
  document.body.append(container)
  const { LibraryScreen } = await import('./library-screen')
  root = createRoot(container)
  await act(async () =>
    root?.render(
      createElement(Provider, { store }, createElement(LibraryScreen)),
    ),
  )
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

afterAll(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  browserWindow.happyDOM.abort()
})

test('does not show an inert create-or-activate subtitle without an active library', () => {
  expect(container.textContent).toContain('Activate a library')
  expect(container.textContent).toContain('Manage libraries')
  expect(container.textContent).not.toContain(
    'Click to create or activate a library',
  )
})
