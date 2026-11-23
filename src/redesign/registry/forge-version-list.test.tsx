import { afterAll, afterEach, expect, mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { Provider, createStore, type Store } from 'jotai'
import {
  act,
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type {
  AppSettings,
  ForgeDetail,
  ForgeVersionsPage,
  LibraryWorkspace,
  LibrarySummary,
} from '@/wails/contract'
import { libraryWorkspaceAtom } from '../state/library-state'
import { settingsAtom } from '../state/settings-state'
import { installLinguiMacroMock } from '../testing/lingui-macro'

installLinguiMacroMock()
mock.module('../i18n/registry-text', () => ({
  registryText: new Proxy({}, { get: (_, key) => () => String(key) }),
}))
mock.module('../i18n/settings-text', () => ({
  settingsText: new Proxy({}, { get: (_, key) => () => String(key) }),
}))
const closeDialog = createContext(() => {})
mock.module('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    children: ReactNode
  }) =>
    open
      ? createElement(
          closeDialog.Provider,
          { value: () => onOpenChange(false) },
          createElement('div', { role: 'alertdialog' }, children),
        )
      : null,
  AlertDialogAction: ({
    onClick,
    children,
  }: {
    onClick?: () => void
    children: ReactNode
  }) => {
    const close = useContext(closeDialog)
    return createElement(
      'button',
      {
        onClick: () => {
          onClick?.()
          close()
        },
      },
      children,
    )
  },
  AlertDialogCancel: ({ children }: { children: ReactNode }) => {
    const close = useContext(closeDialog)
    return createElement('button', { onClick: close }, children)
  },
  AlertDialogContent: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
  AlertDialogDescription: ({ children }: { children: ReactNode }) =>
    createElement('p', null, children),
  AlertDialogFooter: ({ children }: { children: ReactNode }) =>
    createElement('footer', null, children),
  AlertDialogHeader: ({ children }: { children: ReactNode }) =>
    createElement('header', null, children),
  AlertDialogTitle: ({ children }: { children: ReactNode }) =>
    createElement('h2', null, children),
}))
mock.module('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    [key: string]: unknown
  }) =>
    createElement('button', {
      ...props,
      role: 'switch',
      'aria-checked': checked,
      onClick: () => onCheckedChange(!checked),
    }),
}))

let saveSetting: (settings: AppSettings) => Promise<AppSettings> = async (
  settings,
) => settings
mock.module('../data/settings-repository', () => ({
  DEFAULT_ACCENT: 'default',
  saveSettings: (settings: AppSettings) => saveSetting(settings),
}))

const browserWindow = new Window()
const originalGlobals = new Map<string, PropertyDescriptor | undefined>()
for (const [name, value] of Object.entries({
  window: browserWindow,
  document: browserWindow.document,
  DocumentFragment: browserWindow.DocumentFragment,
  navigator: browserWindow.navigator,
  HTMLElement: browserWindow.HTMLElement,
  HTMLInputElement: browserWindow.HTMLInputElement,
  HTMLFormElement: browserWindow.HTMLFormElement,
  Element: browserWindow.Element,
  Node: browserWindow.Node,
  Event: browserWindow.Event,
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

const { ForgeVersionList } = await import('./forge-version-list')
const { SettingsScreen } = await import('../settings/settings-screen')
const detail: ForgeDetail = {
  kind: 'mod',
  id: 24,
  guid: 'demo.mod',
  name: 'Demo Mod',
  slug: null,
  teaser: null,
  description: null,
  thumbnail: null,
  detailUrl: null,
  fikaCompatibility: null,
  parentModId: null,
  parent: null,
  modVersionConstraint: null,
  isDetached: null,
  stale: false,
}
const versions: ForgeVersionsPage = {
  kind: 'mod',
  itemId: 24,
  versions: [
    {
      kind: 'mod',
      itemId: 24,
      id: 2,
      version: '2.0.0',
      description: null,
      link: 'https://example.test/2.zip',
      contentLength: 100,
      sptVersionConstraint: '^4.0.0',
      fikaCompatibility: 'unknown',
      dependencies: [],
    },
    {
      kind: 'mod',
      itemId: 24,
      id: 1,
      version: '1.0.0',
      description: null,
      link: 'https://example.test/1.zip',
      contentLength: 100,
      sptVersionConstraint: '^3.9.0',
      fikaCompatibility: 'unknown',
      dependencies: [],
    },
  ],
  pagination: { currentPage: 1, lastPage: 2, perPage: 20, total: 3 },
  stale: false,
}
const activeLibrary: LibrarySummary = {
  id: 'library-one',
  name: 'SPT 3.9',
  gameRoot: '/game',
  libraryRoot: '/library',
  sptVersion: '3.9.1',
  cacheStatus: { state: 'ready' },
  deployStale: false,
  updatedAt: '',
}
const initialSettings: AppSettings = {
  theme: 'system',
  accentColor: 'default',
  language: 'en-US',
  enableModsOnInstall: true,
  warnIncompatibleForgeInstall: true,
  forgeEndpoint: '',
}

let store: Store
let container: HTMLDivElement
let root: Root
let installed: Array<[ForgeVersionsPage['versions'][number], string]>

function workspace(activeLibraryId: string): LibraryWorkspace {
  return {
    activeLibraryId,
    libraries: [activeLibrary],
    modsByLibraryId: {},
    toolsByLibraryId: {},
    settings: initialSettings,
  }
}

function listElement(settings = initialSettings) {
  return createElement(ForgeVersionList, {
    detail,
    versionsPage: versions,
    activeLibrary,
    matchableMods: [],
    selectedLocalModId: '',
    hasParentBlock: false,
    parentStatus: { status: 'standalone' },
    isLibraryBusy: false,
    installingMap: {},
    matchingMap: {},
    isOffline: false,
    isRateLimited: false,
    rateLimitSecondsRemaining: 0,
    isDetailStale: false,
    settings,
    versionPage: 1,
    lastVersionPage: 2,
    isVersionsLoading: false,
    error: null,
    onMatch: () => {},
    onInstall: (version, libraryId) => installed.push([version, libraryId]),
    onChangePage: () => {},
    onRetry: () => {},
  })
}

async function render(element: React.ReactNode) {
  store = createStore()
  store.set(libraryWorkspaceAtom, workspace('library-one'))
  store.set(settingsAtom, initialSettings)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(createElement(Provider, { store }, element)),
  )
}

async function click(button: HTMLButtonElement | undefined) {
  expect(button).toBeDefined()
  await act(async () => button?.click())
}

function findButton(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((button) =>
    button.textContent?.includes(text),
  )
}

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  installed = []
  saveSetting = async (settings) => settings
})

afterAll(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  browserWindow.happyDOM.abort()
})

test('compatibility toggle filters versions rendered on the current page', async () => {
  await render(listElement())
  expect(container.textContent).toContain('v2.0.0')
  expect(container.textContent).toContain('v1.0.0')
  const toggle = container.querySelector('input[type="checkbox"]')
  expect(toggle).toBeDefined()
  await act(async () => {
    ;(toggle as HTMLInputElement | null)?.click()
  })
  expect(container.textContent).not.toContain('v2.0.0')
  expect(container.textContent).toContain('v1.0.0')
})

test('incompatible install dialog cancels without installing', async () => {
  await render(listElement())
  const row = [...container.querySelectorAll('div')].find((element) =>
    element.textContent?.includes('v2.0.0'),
  )
  await click(
    row?.querySelector('button[aria-label="statusSptIncompatible"]') ??
      undefined,
  )
  expect(container.textContent).toContain('incompatibleInstallTitle')
  await click(findButton('Cancel'))
  expect(installed).toEqual([])
})

test('dialog persists disable preference, and settings can re-enable warnings', async () => {
  saveSetting = async (settings) => {
    store.set(settingsAtom, settings)
    return settings
  }
  await render(listElement())
  const row = [...container.querySelectorAll('div')].find((element) =>
    element.textContent?.includes('v2.0.0'),
  )
  await click(
    row?.querySelector('button[aria-label="statusSptIncompatible"]') ??
      undefined,
  )
  const checkboxes = container.querySelectorAll('input[type="checkbox"]')
  const disableWarning = checkboxes.item(0)
  await act(async () => {
    ;(disableWarning as HTMLInputElement).click()
  })
  await click(findButton('installAnyway'))
  expect(installed).toEqual([[versions.versions[0]!, 'library-one']])
  expect(store.get(settingsAtom)?.warnIncompatibleForgeInstall).toBe(false)

  await act(async () => {
    root.render(
      createElement(
        Provider,
        { store },
        listElement(store.get(settingsAtom) ?? initialSettings),
      ),
    )
  })
  const incompatibleRow = [...container.querySelectorAll('div')].find(
    (element) => element.textContent?.includes('v2.0.0'),
  )
  await click(
    incompatibleRow?.querySelector(
      'button[aria-label="statusSptIncompatible"]',
    ) ?? undefined,
  )
  expect(container.textContent).not.toContain('incompatibleInstallTitle')
  expect(installed).toHaveLength(2)

  await act(async () => {
    root.render(
      createElement(Provider, { store }, createElement(SettingsScreen)),
    )
  })
  const warningSwitch = container.querySelector(
    'button[aria-label="warnIncompatibleForgeInstall"]',
  )
  await click(warningSwitch as HTMLButtonElement | undefined)
  expect(store.get(settingsAtom)?.warnIncompatibleForgeInstall).toBe(true)
})

test('active library change dismisses confirmation and prevents wrong-library install', async () => {
  await render(listElement())
  const row = [...container.querySelectorAll('div')].find((element) =>
    element.textContent?.includes('v2.0.0'),
  )
  await click(
    row?.querySelector('button[aria-label="statusSptIncompatible"]') ??
      undefined,
  )
  expect(container.textContent).toContain('incompatibleInstallTitle')
  await act(async () => {
    store.set(libraryWorkspaceAtom, workspace('library-two'))
  })
  expect(container.textContent).not.toContain('incompatibleInstallTitle')
  expect(installed).toEqual([])
})
