import { afterEach, describe, expect, test } from 'bun:test'
import { getDefaultStore } from 'jotai'
import { installWailsMock } from '@/wails/mock'
import { pendingTasksAtom } from '../state/library-state'
import {
  registryInstallingMapAtom,
  registryMatchingMapAtom,
  registryRateLimitedUntilAtom,
} from '../state/registry-state'
import { installLinguiMacroMock } from '../testing/lingui-macro'
import { clearRegistryInstallTimeout } from './registry-install-task'

installLinguiMacroMock()

const repo = await import('./registry-repository')
const {
  getForgeModDetail,
  getForgeModVersions,
  installForgeVersion,
  matchInstalledMod,
  searchForge,
} = repo

const originalWindow = globalThis.window
const calls: Array<[string, ...unknown[]]> = []

const searchResponse = {
  sptVersion: '4.0.11',
  mods: {
    items: [],
    pagination: { currentPage: 1, lastPage: 1, perPage: 20, total: 0 },
    stale: false,
  },
  addons: {
    items: [],
    pagination: { currentPage: 1, lastPage: 1, perPage: 20, total: 0 },
    stale: false,
  },
}

const detailResponse = {
  kind: 'addon' as const,
  id: 9,
  guid: 'addon-9',
  name: 'Addon',
  slug: null,
  teaser: null,
  description: null,
  thumbnail: null,
  detailUrl: null,
  fikaCompatibility: null,
  parentModId: 7,
  parent: null,
  modVersionConstraint: null,
  isDetached: true,
  stale: false,
}

const versionsResponse = {
  kind: 'mod' as const,
  itemId: 7,
  versions: [],
  pagination: { currentPage: 2, lastPage: 2, perPage: 50, total: 1 },
  stale: false,
}

const workspace = {
  activeLibraryId: 'library',
  libraries: [],
  modsByLibraryId: {},
  toolsByLibraryId: {},
  settings: {
    theme: 'system' as const,
    accentColor: 'teal',
    language: 'en-US',
    enableModsOnInstall: true,
  },
}

function installBridge() {
  // The bridge only treats a window with an injected Wails environment as the
  // Wails platform; the in-memory mock then owns every command.
  // @ts-expect-error Test supplies a minimal browser global.
  globalThis.window = { _wails: { environment: { OS: 'linux' } } }
  return installWailsMock({
    events: { on: () => () => {} },
    commands: {
      forgeSearch: (...args: unknown[]) => {
        calls.push(['forgeSearch', ...args])
        return searchResponse
      },
      forgeModDetail: (...args: unknown[]) => {
        calls.push(['forgeModDetail', ...args])
        return detailResponse
      },
      forgeModVersions: (...args: unknown[]) => {
        calls.push(['forgeModVersions', ...args])
        return versionsResponse
      },
      forgeAddonVersions: (...args: unknown[]) => {
        calls.push(['forgeAddonVersions', ...args])
        return versionsResponse
      },
      forgeDownloadVersion: (...args: unknown[]) => {
        calls.push(['forgeDownloadVersion', ...args])
        return { accepted: true }
      },
      forgeMatchInstalledMod: (...args: unknown[]) => {
        calls.push(['forgeMatchInstalledMod', ...args])
        return workspace
      },
    },
  })
}

afterEach(() => {
  const store = getDefaultStore()
  // The install command is fire-and-track: it leaves the busy-map entry and a
  // ten-minute timeout behind until a workspace event arrives. Tests start the
  // task but never emit that event, so clear both here.
  for (const taskId of Object.values(store.get(registryInstallingMapAtom))) {
    clearRegistryInstallTimeout(taskId)
  }
  store.set(registryInstallingMapAtom, {})
  store.set(registryMatchingMapAtom, {})
  store.set(registryRateLimitedUntilAtom, null)
  store.set(pendingTasksAtom, [])

  expect(store.get(registryInstallingMapAtom)).toEqual({})
  expect(store.get(pendingTasksAtom)).toEqual([])

  calls.length = 0
  globalThis.window = originalWindow
})

describe('registry repository Wails bridge', () => {
  test('search calls the Wails forgeSearch command', async () => {
    const remove = installBridge()
    await expect(
      searchForge({ query: 'sain', modPage: 2, addonPage: 3, perPage: 10 }),
    ).resolves.toEqual(searchResponse)
    expect(calls).toEqual([['forgeSearch', 'sain', 2, 3, 10]])
    remove()
  })

  test('detail and versions keep kind and page positional arguments', async () => {
    const remove = installBridge()
    await expect(getForgeModDetail('addon', 9)).resolves.toEqual(detailResponse)
    await expect(getForgeModVersions('mod', 7, 2)).resolves.toEqual(
      versionsResponse,
    )
    await expect(getForgeModVersions('addon', 7, 2)).resolves.toEqual(
      versionsResponse,
    )
    expect(calls).toEqual([
      ['forgeModDetail', 'addon', 9],
      ['forgeModVersions', 'mod', 7, 2],
      ['forgeAddonVersions', 7, 2],
    ])
    remove()
  })

  test('install and match call the Wails commands', async () => {
    const remove = installBridge()
    await expect(
      installForgeVersion({
        libraryId: 'library',
        kind: 'mod',
        itemId: 7,
        versionId: 2,
      }),
    ).resolves.toEqual({ accepted: true })
    await expect(
      matchInstalledMod({
        libraryId: 'library',
        installedModId: 'local-mod',
        kind: 'mod',
        itemId: 7,
        versionId: 2,
      }),
    ).resolves.toEqual(workspace)
    expect(calls[0]?.[0]).toBe('forgeDownloadVersion')
    expect(calls[1]).toEqual([
      'forgeMatchInstalledMod',
      {
        libraryId: 'library',
        installedModId: 'local-mod',
        kind: 'mod',
        itemId: 7,
        versionId: 2,
      },
    ])
    remove()
  })
})
