import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import { nativeModules } from './native-modules'

const calls: Array<[string, ...unknown[]]> = []
let tauriDrop: ((event: unknown) => void) | undefined
const wailsListeners = new Map<string, (event: unknown) => void>()

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

const tauriDialog = {
  open: async (options: unknown) => {
    calls.push(['dialog', options])
    return '/tmp/file.zip'
  },
}
const tauriOpener = {
  openUrl: async (url: string) => calls.push(['url', url]),
  openPath: async (path: string) => calls.push(['path', path]),
}
const tauriWindowModule = { getCurrentWindow: () => tauriWindow }
const tauriLog = {
  info: async (message: string) => calls.push(['log', message]),
}
const wailsRuntime = {
  Dialogs: {
    OpenFile: async (options: unknown) => {
      calls.push(['wails-dialog', options])
      return '/native/file.zip'
    },
  },
  Browser: { OpenURL: async (url: string) => calls.push(['wails-url', url]) },
  Window: {
    Minimise: async () => calls.push(['wails-minimize']),
    ToggleMaximise: async () => calls.push(['wails-maximize']),
    Close: async () => calls.push(['wails-close']),
    IsMaximised: async () => true,
    SetFrameless: async (value: boolean) => calls.push(['wails-chrome', value]),
  },
  Events: {
    On: (name: string, cb: (event: unknown) => void) => {
      wailsListeners.set(name, cb)
      calls.push(['wails-event-on', name])
      return () => {
        wailsListeners.delete(name)
        calls.push(['wails-event-off', name])
      }
    },
  },
}
const appBindings = {
  openPathWithPlatformOpener: async (path: string) => {
    calls.push(['wails-call', 0, path])
  },
  logToFile: async (message: string) => {
    calls.push(['wails-call', 0, message])
  },
}

// Replace only the loader functions. Module mocks are process-global under
// Bun, so a test file that runs later would import these fakes; spies are
// restored in afterEach and never touch another file's module graph.
beforeEach(() => {
  spyOn(nativeModules, 'tauriDialog').mockResolvedValue(tauriDialog as never)
  spyOn(nativeModules, 'tauriOpener').mockResolvedValue(tauriOpener as never)
  spyOn(nativeModules, 'tauriWindow').mockResolvedValue(
    tauriWindowModule as never,
  )
  spyOn(nativeModules, 'tauriLog').mockResolvedValue(tauriLog as never)
  spyOn(nativeModules, 'wails').mockResolvedValue(wailsRuntime as never)
  spyOn(nativeModules, 'appBindings').mockResolvedValue(appBindings as never)
})

const platform = await import('./index')
const originalWindow = globalThis.window
const originalOpen = originalWindow?.open
const originalInfo = console.info
const originalWailsFlag = import.meta.env.WAILS
function setWindow(value: Record<string, unknown>) {
  // @ts-expect-error Tests install minimal runtime markers.
  globalThis.window = value
}
function setWailsBuildFlag(value: string | undefined) {
  const env = import.meta.env as Record<string, string | undefined>
  if (value === undefined) delete env.WAILS
  else env.WAILS = value
}
afterEach(() => {
  mock.restore()
  calls.length = 0
  tauriDrop = undefined
  wailsListeners.clear()
  // @ts-expect-error Restore original browser global.
  globalThis.window = originalWindow
  if (globalThis.window) window.open = originalOpen
  console.info = originalInfo
  setWailsBuildFlag(originalWailsFlag)
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

  test('reports native capabilities only for desktop shells', () => {
    // Desktop Wails injects the environment marker.
    setWailsBuildFlag('true')
    setWindow({ _wails: { environment: { OS: 'linux' } } })
    expect(platform.platformKind()).toBe('wails')
    expect(platform.hasNativeFilePicker()).toBe(true)
    expect(platform.hasNativeWindowChrome()).toBe(true)
    expect(platform.canOpenPath()).toBe(true)

    // The server build compiles with WAILS_APP=true but serves a plain page
    // with no environment marker.
    setWindow({ _wails: {} })
    expect(platform.platformKind()).toBe('wails')
    expect(platform.hasNativeFilePicker()).toBe(false)
    expect(platform.hasNativeWindowChrome()).toBe(false)
    expect(platform.canOpenPath()).toBe(false)

    // A plain browser build has no native runtime at all.
    setWailsBuildFlag('false')
    setWindow({})
    expect(platform.platformKind()).toBe('browser')
    expect(platform.hasNativeFilePicker()).toBe(false)
    expect(platform.hasNativeWindowChrome()).toBe(false)
    expect(platform.canOpenPath()).toBe(false)

    // Tauri is a desktop shell too.
    setWindow({ __TAURI__: {} })
    expect(platform.platformKind()).toBe('tauri')
    expect(platform.hasNativeFilePicker()).toBe(true)
    expect(platform.hasNativeWindowChrome()).toBe(true)
    expect(platform.canOpenPath()).toBe(true)
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
    expect(calls.filter(([name]) => name === 'wails-dialog')).toHaveLength(2)
  })

  test('does not open native pickers without a desktop shell', async () => {
    setWailsBuildFlag('true')
    setWindow({ _wails: {} })
    expect(await platform.pickFiles()).toEqual([])
    expect(await platform.pickDirectory()).toBeNull()
    expect(calls).toEqual([])

    setWailsBuildFlag('false')
    setWindow({})
    expect(await platform.pickFiles()).toEqual([])
    expect(await platform.pickDirectory()).toBeNull()
    expect(calls).toEqual([])

    setWindow({ __MK_WAILS_MOCK__: {} })
    expect(platform.platformKind()).toBe('browser')
    expect(platform.hasNativeFilePicker()).toBe(false)
    expect(await platform.pickFiles()).toEqual([])
    expect(await platform.pickDirectory()).toBeNull()
    expect(calls).toEqual([])
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
    calls.length = 0
    setWindow({ _wails: { environment: {} } })
    await platform.openUrl('https://example.test')
    await platform.openPath('/tmp/x')
    await platform.startWindowDrag()
    await platform.minimizeWindow()
    await platform.toggleMaximizeWindow()
    await platform.closeWindow()
    expect(await platform.isWindowMaximized()).toBe(true)
    expect(calls.map(([name]) => name)).toEqual([
      'wails-url',
      'wails-call',
      'wails-minimize',
      'wails-maximize',
      'wails-close',
    ])
    expect(calls).toContainEqual(['wails-call', expect.any(Number), '/tmp/x'])
  })

  test('opens server and browser URLs in a local tab', async () => {
    setWailsBuildFlag('true')
    setWindow({ _wails: {} })
    const open = mock(() => null)
    window.open = open
    await platform.openUrl('https://example.test')
    expect(open).toHaveBeenCalledWith(
      'https://example.test',
      '_blank',
      'noopener,noreferrer',
    )
    expect(calls).toEqual([])
  })

  test('selects the Wails window chrome for each titlebar style', async () => {
    setWindow({ _wails: { environment: {} } })
    await platform.setWindowChrome('overlay')
    expect(calls).toEqual([])
    await platform.setWindowChrome('frameless')
    expect(calls).toEqual([['wails-chrome', true]])
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
    calls.length = 0
    setWindow({ _wails: { environment: {} } })
    const unlistenWails = await platform.onFileDrop((paths) =>
      dropped.push(paths),
    )
    const dropListener = wailsListeners.get('modkeeper:files-dropped')
    dropListener?.({
      data: {
        filenames: ['/tmp/b'],
        x: 12,
        y: 34,
        elementDetails: { id: 'root', classList: [], attributes: {} },
      },
    })
    dropListener?.({ data: { filenames: 'not-an-array' } })
    unlistenWails()
    expect(dropped).toEqual([['/tmp/a'], ['/tmp/b']])
    expect(calls).toContainEqual(['wails-event-on', 'modkeeper:files-dropped'])
    expect(calls).toContainEqual(['wails-event-off', 'modkeeper:files-dropped'])
  })

  test('re-reads maximize state on Wails window resize', async () => {
    setWindow({ _wails: { environment: {} } })
    let resized = 0
    const unlisten = await platform.onWindowResize(() => {
      resized += 1
    })
    expect(calls).toContainEqual(['wails-event-on', 'common:WindowDidResize'])
    wailsListeners.get('common:WindowDidResize')?.({})
    unlisten()
    expect(resized).toBe(1)
    expect(calls).toContainEqual(['wails-event-off', 'common:WindowDidResize'])
  })

  test('writes Wails diagnostics through the bound logger', async () => {
    setWindow({ _wails: { environment: {} } })
    await platform.log('wails diagnostic')
    expect(calls).toContainEqual([
      'wails-call',
      expect.any(Number),
      'wails diagnostic',
    ])
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
