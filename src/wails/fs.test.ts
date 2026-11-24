import { afterEach, expect, spyOn, test } from 'bun:test'
import { Call } from '@wailsio/runtime'
import { homeDirectory, listDirectory } from './fs'
import { installWailsMock, type WailsMock } from './mock'

// These assignments also check that ordinary values and promises need no cancellation API.
const typedCommands: NonNullable<WailsMock['commands']> = {
  listDirectory: async (path) => [{ Name: path, IsDir: true }],
  homeDirectory: () => '/home',
}
void typedCommands
const invalidCommands: NonNullable<WailsMock['commands']> = {
  // @ts-expect-error Generated entries require IsDir.
  listDirectory: () => [{ Name: 'missing' }],
  // @ts-expect-error Generated home directory is a string.
  homeDirectory: () => 42,
}
void invalidCommands

const originalWindow = globalThis.window
afterEach(() => {
  globalThis.window = originalWindow
})

test('dispatches to generated bindings when no mock is installed', async () => {
  const call = spyOn(Call, 'ByID').mockImplementation((_id, ...args) => {
    if (args.length)
      return Promise.resolve([{ Name: 'game', IsDir: true }]) as never
    return Promise.resolve('/home') as never
  })
  await expect(listDirectory('/home')).resolves.toEqual([
    { Name: 'game', IsDir: true },
  ])
  await expect(homeDirectory()).resolves.toBe('/home')
  expect(call).toHaveBeenCalledTimes(2)
  expect(call.mock.calls[0]?.slice(1)).toEqual(['/home'])
  call.mockRestore()
})

test('prefers filesystem mocks and propagates their errors', async () => {
  // @ts-expect-error Test supplies a minimal browser global.
  globalThis.window = {}
  const failure = new Error('unavailable')
  const remove = installWailsMock({
    commands: {
      listDirectory: (path: string) => [{ Name: path, IsDir: true }],
      homeDirectory: async () => {
        throw failure
      },
    },
  })
  await expect(listDirectory('/mock')).resolves.toEqual([
    { Name: '/mock', IsDir: true },
  ])
  await expect(homeDirectory()).rejects.toBe(failure)
  remove()
})

test('propagates generated binding errors', async () => {
  const failure = new Error('transport unavailable')
  const call = spyOn(Call, 'ByID').mockImplementation(
    () => Promise.reject(failure) as never,
  )
  await expect(listDirectory('/home')).rejects.toBe(failure)
  await expect(homeDirectory()).rejects.toBe(failure)
  call.mockRestore()
})

test('rejects null listings and empty home directories', async () => {
  // @ts-expect-error Test supplies a minimal browser global.
  globalThis.window = {}
  const remove = installWailsMock({
    commands: { listDirectory: () => null, homeDirectory: () => '' },
  })
  await expect(listDirectory('/mock')).rejects.toThrow()
  await expect(homeDirectory()).rejects.toThrow()
  remove()
})
