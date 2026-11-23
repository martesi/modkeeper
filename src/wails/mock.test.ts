import { afterEach, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { createInMemoryWailsMock } from './mock'

const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  'localStorage',
)

afterEach(() => {
  if (originalStorage)
    Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

test('uses defaults and keeps settings in memory without storage', () => {
  Reflect.deleteProperty(globalThis, 'localStorage')
  const commands = createInMemoryWailsMock().commands
  expect(commands?.getLibraryWorkspace()).toMatchObject({
    activeLibraryId: 'mock-library',
    settings: { theme: 'system' },
  })
  commands?.saveSettings({ theme: 'dark' })
  expect(commands?.getSettings()).toMatchObject({ theme: 'dark' })
})

test('default mock supports filesystem browsing for server-mode forms', async () => {
  const commands = createInMemoryWailsMock().commands
  expect(commands?.homeDirectory).toBeFunction()
  expect(commands?.listDirectory).toBeFunction()
  expect(await commands?.homeDirectory?.()).toBe('/mock/home')
  expect(await commands?.listDirectory?.('/mock/home')).toEqual([
    { Name: 'game', IsDir: true },
    { Name: 'mods.zip', IsDir: false },
  ])
})

test('reads and persists browser storage', () => {
  const storage = new Window({ url: 'https://example.test' }).localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
  storage.setItem('mk-e2e-no-active-library', '1')
  storage.setItem('mk-e2e-settings', JSON.stringify({ theme: 'light' }))
  const commands = createInMemoryWailsMock().commands
  expect(commands?.getLibraryWorkspace()).toMatchObject({
    activeLibraryId: null,
  })
  expect(commands?.getSettings()).toEqual({ theme: 'light' })
  commands?.saveSettings({ theme: 'dark' })
  expect(JSON.parse(storage.getItem('mk-e2e-settings') ?? 'null')).toEqual({
    theme: 'dark',
  })
})
