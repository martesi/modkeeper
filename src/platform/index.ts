import { z } from 'zod'
import {
  hasNativeRuntime,
  isWails,
  isWailsDesktop,
  wailsWindow,
} from '@/wails/runtime'

export type PlatformKind = 'wails' | 'tauri' | 'browser'
export type FileSelectionOptions = {
  multiple?: boolean
  directory?: boolean
  filters?: { name: string; extensions: string[] }[]
  defaultPath?: string
  title?: string
}

// Wails delivers file drops to Go window listeners; the Go bridge re-emits
// this payload on the JS event bus. Only the paths matter to the renderer.
const wailsFileDropSchema = z.object({
  filenames: z.array(z.string()),
})

export function platformKind(): PlatformKind {
  if (isWails()) return 'wails'
  if (hasNativeRuntime() && !wailsWindow()?.__MK_WAILS_MOCK__) return 'tauri'
  return 'browser'
}

/**
 * A desktop shell owns native file dialogs. The Wails server build compiles the
 * same frontend as the native app, but it serves a browser page without the
 * desktop environment marker, so it has no native dialogs either.
 */
export function hasNativeFilePicker(): boolean {
  return hasNativeDesktopShell()
}

/** Minimize, maximize and close need a native window to act on. */
export function hasNativeWindowChrome(): boolean {
  return hasNativeDesktopShell()
}

/** Revealing a path hands it to the OS file manager on the desktop host. */
export function canOpenPath(): boolean {
  return hasNativeDesktopShell()
}

function hasNativeDesktopShell(): boolean {
  return platformKind() === 'tauri' || isWailsDesktop()
}

function tauriDialogOptions(options: FileSelectionOptions) {
  return {
    multiple: options.multiple ?? false,
    directory: options.directory ?? false,
    filters: options.filters?.map(({ name, extensions }) => ({
      name,
      extensions,
    })),
    defaultPath: options.defaultPath,
    title: options.title,
  }
}

export async function pickFiles(
  options: FileSelectionOptions = {},
): Promise<string[]> {
  if (platformKind() === 'wails') {
    const { Dialogs } = await import('@wailsio/runtime')
    const result = await Dialogs.OpenFile({
      CanChooseDirectories: false,
      CanChooseFiles: true,
      AllowsMultipleSelection: options.multiple ?? false,
      Filters: options.filters?.map(({ name, extensions }) => ({
        DisplayName: name,
        Pattern: extensions.map((ext) => `*.${ext}`).join(';'),
      })),
      Directory: options.defaultPath,
      Title: options.title,
    })
    return (Array.isArray(result) ? result : [result]).filter(Boolean)
  }
  if (platformKind() === 'tauri') {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const result = await open(tauriDialogOptions(options))
    return (Array.isArray(result) ? result : result ? [result] : []) as string[]
  }
  return []
}

export async function pickDirectory(
  options: FileSelectionOptions = {},
): Promise<string | null> {
  if (platformKind() === 'wails') {
    const { Dialogs } = await import('@wailsio/runtime')
    const result = await Dialogs.OpenFile({
      CanChooseDirectories: true,
      CanChooseFiles: false,
      AllowsMultipleSelection: false,
      Directory: options.defaultPath,
      Title: options.title,
    })
    return typeof result === 'string' && result ? result : null
  }
  if (platformKind() === 'tauri') {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const result = await open({
      ...tauriDialogOptions(options),
      directory: true,
      multiple: false,
    })
    return typeof result === 'string' ? result : null
  }
  return null
}

export async function openUrl(url: string): Promise<void> {
  if (platformKind() === 'wails' && isWailsDesktop())
    return (await import('@wailsio/runtime')).Browser.OpenURL(url)
  if (platformKind() === 'tauri')
    return (await import('@tauri-apps/plugin-opener')).openUrl(url)
  // Server and browser pages have no desktop host to open the URL, so use the
  // local tab instead of asking the server to open it.
  window.open(url, '_blank', 'noopener,noreferrer')
}

// openPath reveals a directory in the OS file manager and opens a file with
// the OS default handler (the Wails OpenPath bound method). Tauri keeps its
// opener plugin behavior.
export async function openPath(path: string): Promise<void> {
  if (platformKind() === 'wails') {
    const { openPathWithPlatformOpener } = await import('@/wails')
    return openPathWithPlatformOpener(path)
  }
  if (platformKind() === 'tauri')
    return (await import('@tauri-apps/plugin-opener')).openPath(path)
}

export async function startWindowDrag(): Promise<void> {
  if (platformKind() === 'tauri')
    return (await import('@tauri-apps/api/window'))
      .getCurrentWindow()
      .startDragging()
  // Wails starts a drag from the `--wails-draggable: drag` CSS property on the
  // titlebar element and exposes no public JS start-drag API.
}

export async function minimizeWindow(): Promise<void> {
  if (platformKind() === 'tauri')
    return (await import('@tauri-apps/api/window'))
      .getCurrentWindow()
      .minimize()
  if (platformKind() === 'wails')
    return (await import('@wailsio/runtime')).Window.Minimise()
}
export async function toggleMaximizeWindow(): Promise<void> {
  if (platformKind() === 'tauri')
    return (await import('@tauri-apps/api/window'))
      .getCurrentWindow()
      .toggleMaximize()
  if (platformKind() === 'wails')
    return (await import('@wailsio/runtime')).Window.ToggleMaximise()
}
export async function closeWindow(): Promise<void> {
  if (platformKind() === 'tauri')
    return (await import('@tauri-apps/api/window')).getCurrentWindow().close()
  if (platformKind() === 'wails')
    return (await import('@wailsio/runtime')).Window.Close()
}
export async function isWindowMaximized(): Promise<boolean> {
  if (platformKind() === 'tauri')
    return (await import('@tauri-apps/api/window'))
      .getCurrentWindow()
      .isMaximized()
  if (platformKind() === 'wails')
    return (await import('@wailsio/runtime')).Window.IsMaximised()
  return false
}
export async function setWindowChrome(
  option: 'overlay' | 'frameless',
): Promise<void> {
  if (platformKind() === 'tauri') {
    const win = (await import('@tauri-apps/api/window')).getCurrentWindow()
    return option === 'overlay'
      ? win.setTitleBarStyle('overlay')
      : win.setDecorations(false)
  }
  if (platformKind() === 'wails') {
    if (option === 'frameless')
      return (await import('@wailsio/runtime')).Window.SetFrameless(true)
    // Wails fixes the macOS overlay title bar when it creates the window
    // (MacTitleBarHiddenInsetUnified in main.go) and exposes no runtime setter.
    return
  }
}
export async function onWindowResize(
  callback: () => void,
): Promise<() => void> {
  if (platformKind() === 'tauri')
    return (await import('@tauri-apps/api/window'))
      .getCurrentWindow()
      .onResized(callback)
  if (platformKind() === 'wails')
    return (await import('@wailsio/runtime')).Events.On(
      'common:WindowDidResize',
      callback,
    )
  return () => {}
}
export async function onFileDrop(
  callback: (files: string[]) => void,
): Promise<() => void> {
  if (platformKind() === 'wails') {
    return (await import('@wailsio/runtime')).Events.On(
      'modkeeper:files-dropped',
      (event) => {
        const files = droppedFilesFromEvent(event.data)
        if (files) callback(files)
      },
    )
  }
  if (platformKind() === 'tauri')
    return (await import('@tauri-apps/api/window'))
      .getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'drop') callback(event.payload.paths)
      })
  return () => {}
}
export async function log(message: string): Promise<void> {
  if (platformKind() === 'wails') {
    const { logToFile } = await import('@/wails')
    return logToFile(message)
  }
  if (platformKind() === 'tauri')
    return (await import('@tauri-apps/plugin-log')).info(message)
  console.info(message)
}

function droppedFilesFromEvent(payload: unknown): string[] | null {
  const parsed = wailsFileDropSchema.safeParse(payload)
  if (parsed.success) return parsed.data.filenames
  console.warn(
    '[platform] ignoring malformed Wails file-drop payload',
    parsed.error,
  )
  return null
}
