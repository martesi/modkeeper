import { Provider, createStore } from 'jotai'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  libraryWorkspaceAtom,
  workspaceStatusAtom,
} from '../state/library-state'

mock.module('../shared/hooks/use-archive-file-picker', () => ({
  useArchiveFilePicker: () => ({
    pickAndInstall: async () => {},
    pathInputDialog: null,
  }),
}))
mock.module('../i18n/library-text', () => ({
  libraryText: {
    emptyActivateTitle: () => 'Activate a library',
    emptyActivateBody: () => 'Create a profile',
    manageLibraries: () => 'Manage libraries',
    subtitleEmpty: () => 'Click to create or activate a library',
    subtitleModsInstalled: (count: number) => `${count} mods installed`,
  },
}))
mock.module('../i18n/common-text', () => ({
  commonText: { close: () => 'Close' },
}))
mock.module('../data/library-repository', () => ({ syncMods: async () => {} }))
mock.module('./manage-library/manage-library-dialog', () => ({
  ManageLibraryDialog: () => null,
}))
mock.module('./library-drop-empty-state', () => ({
  LibraryDropEmptyState: () => null,
}))
mock.module('./mod-grid-toolbar', () => ({ ModGridToolbar: () => null }))
mock.module('./mod-grid', () => ({ ModGrid: () => null }))

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
  expect(container.textContent).not.toContain(
    'Click to create or activate a library',
  )
})
