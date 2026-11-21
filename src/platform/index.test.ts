import { afterEach, describe, expect, mock, test } from 'bun:test'

const calls: Array<[string, ...unknown[]]> = []
let tauriDrop: ((event: unknown) => void) | undefined
let wailsDrop: ((event: unknown) => void) | undefined

const tauriWindow = {
  startDragging: async () => calls.push(['drag']),
  minimize: async () => calls.push(['minimize']),
  toggleMaximize: async () => calls.push(['maximize']),
  close: async () => calls.push(['close']),
  isMaximized: async () => true,
  onResized: async (cb: () => void) => {
    calls.push(['resize'])
    cb()
    return () => calls.push(['resize-off'])
  },
  onDragDropEvent: async (cb: (event: unknown) => void) => {
    tauriDrop = cb
    calls.push(['drop-on'])
    return () => calls.push(['drop-off'])
  },
  setTitleBarStyle: async (value: string) => calls.push(['chrome', value]),
  setDecorations: async (value: boolean) => calls.push(['decorations', value]),
}

// Module mocks are process-global: test files that run later in the same
// process import the real bindings, so each factory must expose every export
// those bindings use. An incomplete mock breaks their ESM link with
// "Export named 'Call' not found".
mock.module('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async () => undefined,
}))
mock.module('@tauri-apps/plugin-dialog', () => ({
  open: async (options: unknown) => {
    calls.push(['dialog', options])
    return '/tmp/file.zip'
  },
}))
mock.module('@tauri-apps/plugin-opener', () => ({
  openUrl: async (url: string) => calls.push(['url', url]),
  openPath: async (path: string) => calls.push(['path', path]),
}))
mock.module('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => tauriWindow,
}))
mock.module('@tauri-apps/plugin-log', () => ({
  info: async (message: string) => calls.push(['log', message]),
}))
mock.module('@wailsio/runtime', () => ({
  // Everything the generated bindings import at module scope must exist here,
  // because this mock also covers the files that load them later.
  Call: {
    ByName: async () => {
      throw new Error('Wails Call.ByName is not mocked')
    },
    ByID: async () => {
      throw new Error('Wails Call.ByID is not mocked')
    },
  },
  CancellablePromise: Promise,
  Create: { Events: {}, Array: (value: unknown) => value },
  Dialogs: {
    OpenFile: async (options: unknown) => {
      calls.push(['wails-dialog', options])
      return '/native/file.zip'
    },
  },
  Browser: { OpenURL: async (url: string) => calls.push(['wails-url', url]) },
  System: {},
  Window: {
    Minimise: async () => calls.push(['wails-minimize']),
    ToggleMaximise: async () => calls.push(['wails-maximize']),
    Close: async () => calls.push(['wails-close']),
    IsMaximised: async () => true,
    SetFrameless: async (value: boolean) => calls.push(['wails-chrome', value]),
  },
  Events: {
    On: (_name: string, cb: (event: unknown) => void) => {
      wailsDrop = cb
      calls.push(['wails-drop-on'])
      return () => calls.push(['wails-drop-off'])
    },
  },
}))

const platform = await import('./index')
const originalWindow = globalThis.window
const originalOpen = originalWindow?.open
const originalInfo = console.info
function setWindow(value: Record<string, unknown>) {
  // @ts-expect-error Tests install minimal runtime markers.
  globalThis.window = value
}
afterEach(() => {
  calls.length = 0
  tauriDrop = undefined
  wailsDrop = undefined
  // @ts-expect-error Restore original browser global.
  globalThis.window = originalWindow
  if (globalThis.window) window.open = originalOpen
  console.info = originalInfo
})

describe('platform capability dispatch', () => {
  test('selects Wails, Tauri, then browser', () => {
    setWindow({ _wails: { environment: { OS: 'linux' } } })
    expect(platform.platformKind()).toBe('wails')
    setWindow({ __TAURI__: {} })
    expect(platform.platformKind()).toBe('tauri')
    setWindow({})
    expect(platform.platformKind()).toBe('browser')
  })

  test('dispatches file pickers to Tauri and Wails', async () => {
    setWindow({ __TAURI__: {} })
    expect(await platform.pickFiles({ multiple: true })).toEqual([
      '/tmp/file.zip',
    ])
    expect(await platform.pickDirectory()).toBe('/tmp/file.zip')
    setWindow({ _wails: { environment: {} } })
    expect(await platform.pickFiles()).toEqual(['/native/file.zip'])
    expect(await platform.pickDirectory()).toBe('/native/file.zip')
  })

  test('dispatches openers and window helpers', async () => {
    setWindow({ __TAURI__: {} })
    await platform.openUrl('https://example.test')
    await platform.openPath('/tmp/x')
    await platform.startWindowDrag()
    await platform.minimizeWindow()
    await platform.toggleMaximizeWindow()
    await platform.closeWindow()
    expect(await platform.isWindowMaximized()).toBe(true)
    expect(calls.map(([name]) => name)).toEqual([
      'url',
      'path',
      'drag',
      'minimize',
      'maximize',
      'close',
    ])
    setWindow({ _wails: { environment: {} } })
    await platform.openUrl('https://example.test')
    await platform.minimizeWindow()
    await platform.toggleMaximizeWindow()
    await platform.closeWindow()
    expect(await platform.isWindowMaximized()).toBe(true)
    expect(calls.map(([name]) => name)).toContain('wails-url')
  })

  test('subscribes and unsubscribes file-drop listeners', async () => {
    setWindow({ __TAURI__: {} })
    const dropped: string[][] = []
    const unlistenTauri = await platform.onFileDrop((paths) =>
      dropped.push(paths),
    )
    tauriDrop?.({ payload: { type: 'drop', paths: ['/tmp/a'] } })
    tauriDrop?.({ payload: { type: 'over', paths: [] } })
    unlistenTauri()
    setWindow({ _wails: { environment: {} } })
    const unlistenWails = await platform.onFileDrop((paths) =>
      dropped.push(paths),
    )
    wailsDrop?.({ data: ['/tmp/b'] })
    unlistenWails()
    expect(dropped).toEqual([['/tmp/a'], ['/tmp/b']])
    expect(calls.map(([name]) => name)).toContain('drop-off')
  })

  test('uses browser fallbacks for opening, logging, and window helpers', async () => {
    setWindow({})
    const open = mock(() => null)
    const info = mock(() => undefined)
    window.open = open
    console.info = info
    await platform.openUrl('https://example.test')
    await platform.log('message')
    await platform.startWindowDrag()
    await platform.minimizeWindow()
    expect(await platform.isWindowMaximized()).toBe(false)
    expect(open).toHaveBeenCalledWith(
      'https://example.test',
      '_blank',
      'noopener,noreferrer',
    )
    expect(info).toHaveBeenCalledWith('message')
    expect(await platform.onFileDrop(() => {})).toBeFunction()
  })
})
