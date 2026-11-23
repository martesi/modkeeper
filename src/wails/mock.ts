/** Injectable browser transport for Playwright and other agent-driven tests.
 * Install before app startup. Command keys are generated camelCase names.
 * Event names are exactly `task_progress` and `workspace-event`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type WailsMock = {
  commands?: Record<string, (...args: unknown[]) => unknown>
  events?: {
    on?: (name: string, callback: (...args: unknown[]) => void) => () => void
    emit?: (name: string, ...args: unknown[]) => void
  }
}

declare global {
  interface Window {
    __MK_WAILS_MOCK__?: WailsMock
  }
}

export function getWailsMock(): WailsMock | undefined {
  return typeof window === 'undefined' ? undefined : window.__MK_WAILS_MOCK__
}

export function installWailsMock(mock: WailsMock): () => void {
  if (typeof window === 'undefined')
    throw new Error('Mock transport requires a window')
  window.__MK_WAILS_MOCK__ = mock
  return () => {
    if (window.__MK_WAILS_MOCK__ === mock) delete window.__MK_WAILS_MOCK__
  }
}

/** In-memory bus for serve-mode/browser E2E: listeners + emit without a native runtime. */
export function createInMemoryWailsMock(): WailsMock {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const workspace: any = {
    activeLibraryId:
      localStorage.getItem('mk-e2e-no-active-library') === '1'
        ? null
        : 'mock-library',
    libraries: [
      {
        id: 'mock-library',
        name: 'Mock SPT',
        gameRoot: '/games/spt',
        libraryRoot: '/games/spt/.mod_keeper',
        sptVersion: '3.9.0',
        cacheStatus: { state: 'ready' },
        deployStale: false,
        updatedAt: new Date().toISOString(),
      },
    ],
    modsByLibraryId: {
      'mock-library': [
        {
          id: 'mock-mod-active',
          libraryId: 'mock-library',
          name: 'Example Server Mod',
          type: 'server',
          isEnabled: true,
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'mock-mod-disabled',
          libraryId: 'mock-library',
          name: 'Example Client Mod',
          type: 'client',
          isEnabled: false,
          updatedAt: new Date().toISOString(),
        },
      ] as Record<string, unknown>[],
    },
    toolsByLibraryId: { 'mock-library': [] },
    settings: (() => {
      try {
        return (
          JSON.parse(localStorage.getItem('mk-e2e-settings') ?? 'null') ?? {
            theme: 'system',
            accentColor: '#6750a4',
            language: 'en-US',
            enableModsOnInstall: true,
          }
        )
      } catch {
        return {
          theme: 'system',
          accentColor: '#6750a4',
          language: 'en-US',
          enableModsOnInstall: true,
        }
      }
    })(),
  }
  const now = () => new Date().toISOString()
  const complete = (type: string, input: any) => {
    const event: Record<string, unknown> = {
      type,
      taskId: input?.taskId ?? '',
      libraryId: input?.libraryId ?? '',
      failures: [],
      workspace: structuredClone(workspace),
    }
    if (type === 'cache_rebuild_completed')
      event.cacheStatus = { state: 'ready', lastRebuiltAt: now() }
    queueMicrotask(() =>
      listeners.get('workspace-event')?.forEach((callback) => callback(event)),
    )
    return { accepted: true }
  }
  const commands: Record<string, (...args: any[]) => unknown> = {
    getLibraryWorkspace: () => structuredClone(workspace),
    createLibrary: ({ gameRoot, libraryRoot, name }: any) => {
      const id = `mock-${Date.now()}`
      workspace.libraries.push({
        id,
        gameRoot,
        libraryRoot: libraryRoot ?? `${gameRoot}/.mod_keeper`,
        name: name ?? gameRoot.split(/[\\/]/).pop(),
        cacheStatus: { state: 'ready' },
        deployStale: false,
        updatedAt: now(),
      })
      workspace.modsByLibraryId[id] = []
      workspace.toolsByLibraryId[id] = []
      workspace.activeLibraryId = id
      return structuredClone(workspace)
    },
    activateLibrary: ({ libraryId }: any) => {
      workspace.activeLibraryId = libraryId
      return structuredClone(workspace)
    },
    renameLibrary: ({ libraryId, name }: any) => {
      const lib: any = workspace.libraries.find(
        (item: any) => item.id === libraryId,
      )
      if (lib) lib.name = name
      return structuredClone(workspace)
    },
    deleteLibrary: ({ libraryId }: any) => {
      workspace.libraries = workspace.libraries.filter(
        (item: any) => item.id !== libraryId,
      )
      delete workspace.modsByLibraryId[libraryId]
      delete workspace.toolsByLibraryId[libraryId]
      return structuredClone(workspace)
    },
    bulkUpdateMods: ({ libraryId, modIds, action }: any) => {
      const ids = new Set(modIds)
      workspace.modsByLibraryId[libraryId] = (
        workspace.modsByLibraryId[libraryId] ?? []
      )
        .filter((mod: any) => action !== 'delete' || !ids.has(mod.id))
        .map((mod: any) =>
          ids.has(mod.id)
            ? { ...mod, isEnabled: action === 'enable', updatedAt: now() }
            : mod,
        )
      return structuredClone(workspace)
    },
    syncMods: (input: any) => complete('sync_completed', input),
    installModArchives: (input: any) =>
      complete('mod_install_completed', input),
    cancelTask: () => undefined,
    rebuildLibraryCache: (input: any) =>
      complete('cache_rebuild_completed', input),
    getSettings: () => ({ ...workspace.settings }),
    saveSettings: (settings: any) => {
      workspace.settings = { ...workspace.settings, ...settings }
      if (typeof localStorage !== 'undefined')
        localStorage.setItem(
          'mk-e2e-settings',
          JSON.stringify(workspace.settings),
        )
      return workspace.settings
    },
    forgeSearch: async (query: string) =>
      query.trim()
        ? {
            mods: [
              { id: 1, name: `Mock ${query}`, summary: 'Mock Forge result' },
            ],
            addons: [],
            pagination: {},
          }
        : { mods: [], addons: [], pagination: {} },
    forgeModDetail: async (_kind: string, id: number) => ({
      id,
      name: `Mock mod ${id}`,
    }),
    forgeModVersions: async (_kind: string, id: number) => ({
      data: [{ id, name: '1.0.0' }],
      pagination: {},
    }),
    forgeAddonVersions: async (id: number) => ({
      data: [{ id, name: '1.0.0' }],
      pagination: {},
    }),
    forgeDownloadVersion: async () => ({ accepted: true }),
    forgeMatchInstalledMod: () => structuredClone(workspace),
    applyWindowEffect: () => undefined,
  }
  return {
    commands,
    events: {
      on: (name, callback) => {
        let set = listeners.get(name)
        if (!set) {
          set = new Set()
          listeners.set(name, set)
        }
        set.add(callback)
        return () => {
          set.delete(callback)
        }
      },
      emit: (name, ...args) => {
        for (const callback of listeners.get(name) ?? []) callback(...args)
      },
    },
  }
}
