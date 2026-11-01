import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { commands, events } from '../src/gen/bindings'
import type {
  AppSettings_Serialize as AppSettings,
  SError,
  WorkspaceEvent_Serialize as WorkspaceEvent,
} from '../src/gen/bindings'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', {
    value: { crypto: globalThis.crypto },
    configurable: true,
  })
})

afterEach(clearMocks)

afterAll(() => {
  if (originalWindow)
    Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

test('generated commands preserve the settings arguments and result contract', async () => {
  const settings: AppSettings = {
    theme: 'dark',
    accentColor: '#e91e63',
    language: 'en-US',
    enableModsOnInstall: true,
  }
  mockIPC((command, args) => {
    expect(command).toBe('save_settings')
    expect(args).toEqual({ settings })
    return settings
  })

  expect(await commands.saveSettings(settings)).toEqual({
    status: 'ok',
    data: settings,
  })
})

test('generated commands return tagged backend errors without changing their shape', async () => {
  const error: SError = { code: 'NoActiveLibrary' }
  mockIPC(() => Promise.reject(error))

  expect(await commands.getLibraryWorkspace()).toEqual({
    status: 'error',
    error,
  })
})

test('generated workspace events preserve their name and payload', async () => {
  mockIPC(() => undefined, { shouldMockEvents: true })
  const payload: WorkspaceEvent = {
    type: 'sync_completed',
    taskId: 'dependency-update-test',
    libraryId: 'test-library',
    failures: [],
    workspace: {
      libraries: [],
      modsByLibraryId: {},
      toolsByLibraryId: {},
      settings: {
        theme: 'system',
        accentColor: '#e91e63',
        language: 'en-US',
        enableModsOnInstall: true,
      },
    },
  }
  const received: WorkspaceEvent[] = []
  const unlisten = await events.workspaceEvent.listen((event) => {
    expect(event.event).toBe('workspace-event')
    received.push(event.payload)
  })

  await events.workspaceEvent.emit(payload)
  expect(received).toEqual([payload])
  unlisten()
})
