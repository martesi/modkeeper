import { afterEach, describe, expect, test, vi } from 'vitest'
import { commands, dispatchCommand } from './bridge'
import { createInMemoryWailsMock, installWailsMock } from './mock'
import { events } from './events'

// The generated bindings import Wails' browser runtime, which starts a timer
// that outlives this test's happy-dom window. These tests exercise the bridge,
// so keep the native runtime outside this unit-test boundary.
vi.mock('@wailsio/runtime', () => ({
  Call: { ByID: vi.fn() },
  CancellablePromise: vi.fn(),
  Create: { Events: {} },
  Events: { On: vi.fn(), Once: vi.fn(), Emit: vi.fn() },
}))

const originalWindow = globalThis.window

afterEach(() => {
  // @ts-expect-error Test restores a minimal browser global.
  globalThis.window = originalWindow
})

describe('Wails browser mock', () => {
  test('dispatches the browser mock before Wails', async () => {
    const calls: string[] = []
    await dispatchCommand(
      () => calls.push('mock'),
      () => calls.push('wails'),
    )
    expect(calls).toEqual(['mock'])
    calls.length = 0
    await dispatchCommand(undefined, () => calls.push('wails'))
    expect(calls).toEqual(['wails'])
    calls.length = 0
    await expect(dispatchCommand(undefined, undefined)).rejects.toThrow(
      'Command is not available in this runtime',
    )
  })

  test('wraps Wails return values in the shared command result shape', async () => {
    await expect(
      dispatchCommand(undefined, () => ({ activeLibraryId: 'library' })),
    ).resolves.toEqual({
      status: 'ok',
      data: { activeLibraryId: 'library' },
    })
  })

  test('rejects commands without a Wails runtime or browser mock', async () => {
    await expect(dispatchCommand(undefined, undefined)).rejects.toThrow(
      'Command is not available in this runtime',
    )
  })

  test('keeps structured Wails domain errors on the typed command path', async () => {
    const failure = { code: 'LibraryBusy', data: null }
    const runtimeError = new Error('call failed')
    runtimeError.name = 'RuntimeError'
    runtimeError.cause = JSON.stringify(failure)
    await expect(
      dispatchCommand(undefined, () => Promise.reject(runtimeError)),
    ).resolves.toEqual({ status: 'error', error: failure })
  })

  test('unwraps an object Wails cause and preserves unrelated transport failures', async () => {
    const failure = { code: 'LibraryBusy', data: null }
    const runtimeError = new Error('call failed')
    runtimeError.name = 'RuntimeError'
    runtimeError.cause = failure
    await expect(
      dispatchCommand(undefined, () => Promise.reject(runtimeError)),
    ).resolves.toEqual({ status: 'error', error: failure })

    const transportError = new Error('connection closed')
    await expect(
      dispatchCommand(undefined, () => Promise.reject(transportError)),
    ).rejects.toBe(transportError)
  })
  test('dispatches generated commands to the injected mock', async () => {
    // @ts-expect-error Test supplies a minimal browser global.
    globalThis.window = {}
    const remove = installWailsMock({
      commands: { getLibraryWorkspace: () => ({ libraries: [] }) },
    })
    await expect(commands.getLibraryWorkspace()).resolves.toEqual({
      status: 'ok',
      data: { libraries: [] },
    })
    remove()
  })

  test('preserves rejected mock command errors', async () => {
    // @ts-expect-error Test supplies a minimal browser global.
    globalThis.window = {}
    const failure = { code: 'Unavailable', data: 'mock failure' }
    const remove = installWailsMock({
      commands: { getSettings: () => Promise.reject(failure) },
    })
    await expect(commands.getSettings()).rejects.toEqual(failure)
    remove()
  })

  test('propagates structured command errors', async () => {
    // @ts-expect-error Test supplies a minimal browser global.
    globalThis.window = {}
    const failure = { code: 'InvalidLibrary', data: ['id', 'path'] }
    const remove = installWailsMock({
      commands: { getSettings: () => Promise.reject(failure) },
    })
    await expect(commands.getSettings()).rejects.toEqual(failure)
    remove()
  })

  test('removes event listeners on unsubscribe', async () => {
    // @ts-expect-error Test supplies a minimal browser global.
    globalThis.window = {}
    const remove = installWailsMock(createInMemoryWailsMock())
    let calls = 0
    const callback = () => {
      calls++
    }
    const unlisten = await events.taskProgress.listen(callback)
    unlisten()
    await events.taskProgress.emit({} as never)
    expect(calls).toBe(0)
    remove()
  })

  test('forge mock returns Wails-shaped registry responses', async () => {
    const mockTransport = createInMemoryWailsMock()
    const search = await mockTransport.commands?.forgeSearch?.(
      'fixture',
      1,
      1,
      10,
    )
    expect(search).toHaveProperty('sptVersion', '3.9.0')
    expect(search).toHaveProperty('mods.items.0.kind', 'mod')
    expect(search).toHaveProperty('mods.pagination.currentPage', 1)
    expect(search).toHaveProperty('mods.pagination.perPage', 10)
    expect(search).toHaveProperty('mods.stale', false)
    expect(search).toHaveProperty('addons.items.length', 0)
    expect(search).toHaveProperty('addons.pagination.currentPage', 1)
    expect(search).toHaveProperty('addons.stale', false)
    expect(
      await mockTransport.commands?.forgeModDetail?.('mod', 1),
    ).toMatchObject({
      kind: 'mod',
      id: 1,
      stale: false,
    })
    const modVersions = await mockTransport.commands?.forgeModVersions?.(
      'mod',
      1,
      1,
    )
    expect(modVersions).toMatchObject({
      kind: 'mod',
      itemId: 1,
      versions: [
        expect.objectContaining({
          kind: 'mod',
          itemId: 1,
          version: '2.0.0',
          sptVersionConstraint: '^4.0.0',
          contentLength: 1_024,
        }),
        expect.objectContaining({
          kind: 'mod',
          itemId: 1,
          version: '1.0.0',
          sptVersionConstraint: '^3.0.0',
        }),
      ],
      pagination: { currentPage: 1, lastPage: 1, perPage: 20, total: 2 },
    })

    const addonVersions = await mockTransport.commands?.forgeAddonVersions?.(
      2,
      1,
    )
    expect(addonVersions).toMatchObject({
      kind: 'addon',
      itemId: 2,
      versions: [
        expect.objectContaining({
          kind: 'addon',
          itemId: 2,
          version: '2.0.0',
          sptVersionConstraint: '^4.0.0',
          contentLength: 1_024,
        }),
        expect.objectContaining({
          kind: 'addon',
          itemId: 2,
          version: '1.0.0',
          sptVersionConstraint: '^3.0.0',
        }),
      ],
    })
  })

  test('settings mock persists custom endpoint and warning preference', async () => {
    const mockTransport = createInMemoryWailsMock()
    await mockTransport.commands?.saveSettings?.({
      forgeEndpoint: 'https://forge.example/api/v0',
      warnIncompatibleForgeInstall: false,
    })
    expect(await mockTransport.commands?.getSettings?.()).toMatchObject({
      forgeEndpoint: 'https://forge.example/api/v0',
      warnIncompatibleForgeInstall: false,
    })
  })

  test('every generated command has a resolving mock handler', async () => {
    const mockTransport = createInMemoryWailsMock()
    const missing = Object.keys(commands).filter(
      (key) => !mockTransport.commands?.[key],
    )
    expect(missing).toEqual([])
    // @ts-expect-error Test supplies a minimal browser global.
    globalThis.window = {}
    const uninstall = installWailsMock(mockTransport)
    const args: Record<string, unknown[]> = {
      createLibrary: [
        { gameRoot: '/games/new', libraryRoot: null, name: 'New' },
      ],
      activateLibrary: [{ libraryId: 'mock-library' }],
      renameLibrary: [{ libraryId: 'mock-library', name: 'Renamed' }],
      deleteLibrary: [{ libraryId: 'missing', deleteFiles: false }],
      bulkUpdateMods: [
        { libraryId: 'mock-library', modIds: [], action: 'disable' },
      ],
      syncMods: [{ taskId: 'unit-task', libraryId: 'mock-library' }],
      installModArchives: [
        { taskId: 'unit-task', libraryId: 'mock-library', archivePaths: [] },
      ],
      rebuildLibraryCache: [{ taskId: 'unit-task', libraryId: 'mock-library' }],
      saveSettings: [{}],
      forgeSearch: ['fixture', 1, 1, 10],
      forgeModDetail: ['mod', 1],
      forgeModVersions: ['mod', 1, 1],
      forgeAddonVersions: [1, 1],
      forgeDownloadVersion: [{}],
      forgeMatchInstalledMod: [
        {
          libraryId: 'mock-library',
          installedModId: 'mock-mod-active',
          kind: 'mod',
          itemId: 1,
          versionId: 101,
        },
      ],
      applyWindowEffect: [null],
    }
    for (const name of Object.keys(commands)) {
      const command = commands[name as keyof typeof commands] as (
        ...args: unknown[]
      ) => Promise<unknown>
      const result = command(...(args[name] ?? []))
      await expect(result).resolves.toMatchObject({ status: 'ok' })
    }
    uninstall()
  })
})
