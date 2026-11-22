import { afterEach, describe, expect, test } from 'bun:test'
import { commands, dispatchCommand } from './bridge'
import { createInMemoryWailsMock, installWailsMock } from './mock'
import { events } from './events'

const originalWindow = globalThis.window

afterEach(() => {
  // @ts-expect-error Test restores a minimal browser global.
  globalThis.window = originalWindow
})

describe('Wails browser mock', () => {
  test('dispatches mock before Wails and Wails before Tauri', async () => {
    const calls: string[] = []
    await dispatchCommand(
      () => calls.push('mock'),
      () => calls.push('wails'),
      () => calls.push('tauri'),
    )
    expect(calls).toEqual(['mock'])
    calls.length = 0
    await dispatchCommand(
      undefined,
      () => calls.push('wails'),
      () => calls.push('tauri'),
    )
    expect(calls).toEqual(['wails'])
    calls.length = 0
    await dispatchCommand(undefined, undefined, () => calls.push('tauri'))
    expect(calls).toEqual(['tauri'])
  })

  test('wraps Wails return values in the shared command result shape', async () => {
    await expect(
      dispatchCommand(
        undefined,
        () => ({ activeLibraryId: 'library' }),
        () => null,
      ),
    ).resolves.toEqual({
      status: 'ok',
      data: { activeLibraryId: 'library' },
    })
  })

  test('wraps raw Tauri return values in the same command result shape', async () => {
    await expect(
      dispatchCommand(undefined, undefined, () => undefined),
    ).resolves.toEqual({ status: 'ok', data: undefined })
  })

  test('keeps structured Wails domain errors on the typed command path', async () => {
    const failure = { code: 'LibraryBusy', data: null }
    const runtimeError = new Error('call failed')
    runtimeError.name = 'RuntimeError'
    runtimeError.cause = JSON.stringify(failure)
    await expect(
      dispatchCommand(
        undefined,
        () => Promise.reject(runtimeError),
        () => null,
      ),
    ).resolves.toEqual({ status: 'error', error: failure })
  })

  test('unwraps an object Wails cause and preserves unrelated transport failures', async () => {
    const failure = { code: 'LibraryBusy', data: null }
    const runtimeError = new Error('call failed')
    runtimeError.name = 'RuntimeError'
    runtimeError.cause = failure
    await expect(
      dispatchCommand(
        undefined,
        () => Promise.reject(runtimeError),
        () => null,
      ),
    ).resolves.toEqual({ status: 'error', error: failure })

    const transportError = new Error('connection closed')
    await expect(
      dispatchCommand(
        undefined,
        () => Promise.reject(transportError),
        () => null,
      ),
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
      forgeSearch: ['fixture', 0, 0, 10],
      forgeModDetail: ['mod', 1],
      forgeModVersions: ['mod', 1, 0],
      forgeAddonVersions: [1, 0],
      forgeDownloadVersion: [{}],
      forgeMatchInstalledMod: [{}],
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
