import {
  afterAll,
  afterEach,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import { Window } from 'happy-dom'
import { Provider, createStore } from 'jotai'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ForgeSearchResponse, LibraryWorkspace } from '@/wails/contract'
import { libraryWorkspaceAtom } from '../state/library-state'
import { registrySearchAtom } from '../state/registry-state'
import { installLinguiMacroMock } from '../testing/lingui-macro'

installLinguiMacroMock()

mock.module('../i18n/registry-text', () => ({
  registryText: new Proxy({}, { get: (_, key) => () => String(key) }),
}))
mock.module('./registry-toolbar', () => ({
  RegistryToolbar: ({
    modPage,
    onAllPageChange,
  }: {
    modPage: number
    onAllPageChange: (page: number) => void
  }) =>
    createElement(
      'button',
      { onClick: () => onAllPageChange(modPage + 1) },
      'Next',
    ),
}))
mock.module('../library/manage-library/manage-library-dialog', () => ({
  ManageLibraryDialog: () => null,
}))
mock.module('./registry-parent-dialog', () => ({
  RegistryParentDialog: () => null,
}))
mock.module('./registry-detail-inspector', () => ({
  RegistryDetailInspector: () => null,
}))
mock.module('./registry-list-view', () => ({ RegistryListView: () => null }))
mock.module('./registry-grid-view', () => ({ RegistryGridView: () => null }))
mock.module('./registry-icons-view', () => ({ RegistryIconsView: () => null }))

const repository = await import('../data/registry-repository')
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
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  })
}

const response: ForgeSearchResponse = {
  sptVersion: '3.10',
  mods: {
    items: [],
    stale: false,
    pagination: { currentPage: 1, perPage: 20, lastPage: 4, total: 80 },
  },
  addons: {
    items: [],
    stale: false,
    pagination: { currentPage: 1, perPage: 20, lastPage: 2, total: 40 },
  },
}

function workspace(id: string, sptVersion = '3.10'): LibraryWorkspace {
  return {
    activeLibraryId: id,
    libraries: [
      {
        id,
        name: id,
        gameRoot: '',
        libraryRoot: '',
        sptVersion,
        cacheStatus: { state: 'ready' },
        deployStale: false,
        updatedAt: '',
      },
    ],
    modsByLibraryId: {},
    toolsByLibraryId: {},
  } as LibraryWorkspace
}

let store: ReturnType<typeof createStore>
let container: HTMLDivElement
let root: Root
let search: ReturnType<
  typeof spyOn<typeof import('../data/registry-repository'), 'searchForge'>
>

beforeEach(async () => {
  store = createStore()
  store.set(libraryWorkspaceAtom, workspace('one'))
  search = spyOn(repository, 'searchForge').mockResolvedValue(response)
  container = document.createElement('div')
  document.body.append(container)
  const { RegistryScreen } = await import('./registry-screen')
  root = createRoot(container)
  await act(async () =>
    root.render(
      createElement(Provider, { store }, createElement(RegistryScreen)),
    ),
  )
})

afterEach(async () => {
  await act(async () => root.unmount())
  search.mockRestore()
  container.remove()
})

afterAll(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  browserWindow.happyDOM.abort()
})

async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  )
  expect(button).toBeDefined()
  await act(async () => button?.click())
}

async function goToPageThree() {
  await click('Next')
  await click('Next')
  expect(search.mock.calls.at(-1)?.[0]).toMatchObject({
    modPage: 3,
    addonPage: 2,
  })
}

test('retry on All page three keeps the known addon bound', async () => {
  await click('Next')
  search.mockRejectedValueOnce(new Error('temporary failure'))
  await click('Next')
  expect(search.mock.calls.at(-1)?.[0]).toMatchObject({
    modPage: 3,
    addonPage: 2,
  })
  expect(container.textContent).toContain('searchFailedTitle')
  await click('retrySearch')
  expect(search.mock.calls.at(-1)?.[0]).toMatchObject({
    modPage: 3,
    addonPage: 2,
  })
})

test('a new library or SPT version starts from page one before discovering bounds', async () => {
  await goToPageThree()
  let start = search.mock.calls.length
  await act(async () => store.set(libraryWorkspaceAtom, workspace('two')))
  expect(
    search.mock.calls
      .slice(start)
      .map(([input]) => [input.modPage, input.addonPage]),
  ).toEqual([[1, 1]])
  await goToPageThree()
  start = search.mock.calls.length
  await act(async () =>
    store.set(libraryWorkspaceAtom, workspace('two', '3.11')),
  )
  expect(
    search.mock.calls
      .slice(start)
      .map(([input]) => [input.modPage, input.addonPage]),
  ).toEqual([[1, 1]])
})

test('a changed search query discovers bounds from page one', async () => {
  await goToPageThree()
  const start = search.mock.calls.length
  await act(async () => store.set(registrySearchAtom, 'new query'))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350))
  })
  expect(search.mock.calls.slice(start).at(-1)?.[0]).toMatchObject({
    query: 'new query',
    modPage: 1,
    addonPage: 1,
  })
})
