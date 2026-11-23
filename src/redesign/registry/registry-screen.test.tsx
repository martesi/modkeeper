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
import {
  registryAddonPageAtom,
  registryModPageAtom,
  registrySearchAtom,
} from '../state/registry-state'
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

test('stale search metadata shows the stale-cache banner', async () => {
  search.mockResolvedValue({
    ...response,
    mods: { ...response.mods, stale: true },
  })
  await click('Next')
  expect(container.textContent).toContain('staleCacheNotice')
})

test('initial search does not reset a page selected within the debounce window', async () => {
  await act(async () => root.unmount())
  const timers = spyOn(globalThis, 'setTimeout')
  const { RegistryScreen } = await import('./registry-screen')
  root = createRoot(container)
  await act(async () =>
    root.render(
      createElement(Provider, { store }, createElement(RegistryScreen)),
    ),
  )
  const debounceTimers = timers.mock.calls.filter(([, delay]) => delay === 300)
  timers.mockRestore()
  await goToPageThree()
  expect(debounceTimers).toHaveLength(0)
  expect(store.get(registryModPageAtom)).toBe(3)
  expect(store.get(registryAddonPageAtom)).toBe(3)
})

test('shrinking page counts are rediscovered after navigating to a later page', async () => {
  await click('Next')
  const start = search.mock.calls.length
  search.mockImplementation(async (input) => ({
    ...response,
    mods: {
      ...response.mods,
      pagination: {
        ...response.mods.pagination,
        currentPage: input.modPage ?? 1,
        lastPage: 2,
      },
    },
    addons: {
      ...response.addons,
      pagination: {
        ...response.addons.pagination,
        currentPage: input.addonPage ?? 1,
        lastPage: 1,
      },
    },
  }))
  await click('Next')
  expect(
    search.mock.calls
      .slice(start)
      .map(([input]) => [input.modPage, input.addonPage]),
  ).toEqual([
    [3, 2],
    [2, 1],
  ])
  expect(store.get(registryModPageAtom)).toBe(2)
  expect(store.get(registryAddonPageAtom)).toBe(2)
  expect(container.textContent).not.toContain('searchFailedTitle')
})

test('a later-page HTTP rejection resets once and a page-one failure is shown', async () => {
  search.mockRejectedValue({ code: 'IOError', data: 'Forge returned HTTP 422' })
  const start = search.mock.calls.length
  await click('Next')
  expect(
    search.mock.calls
      .slice(start)
      .map(([input]) => [input.modPage, input.addonPage]),
  ).toEqual([
    [2, 2],
    [1, 1],
  ])
  expect(container.textContent).toContain('searchFailedTitle')
  await click('retrySearch')
  expect(search.mock.calls.at(-1)?.[0]).toMatchObject({
    modPage: 1,
    addonPage: 1,
  })
  expect(search.mock.calls.length - start).toBe(3)
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
