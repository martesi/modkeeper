import { afterEach, describe, expect, test } from 'bun:test'
import { commands } from './bridge'
import { installWailsMock } from './mock'

const originalWindow = globalThis.window

afterEach(() => {
  // @ts-expect-error Test restores a minimal browser global.
  globalThis.window = originalWindow
})

describe('Wails browser mock', () => {
  test('dispatches generated commands to the injected mock', async () => {
    // @ts-expect-error Test supplies a minimal browser global.
    globalThis.window = {}
    const remove = installWailsMock({
      commands: { getLibraryWorkspace: () => ({ libraries: [] }) },
    })
    await expect(commands.getLibraryWorkspace()).resolves.toEqual({
      libraries: [],
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
})
