import { z } from 'zod'
import { nativeModules } from './native-modules'
import { isNativeDesktopShell, isWails } from '@/wails/runtime'

export type PlatformKind = 'wails' | 'browser'
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
  return 'browser'
}

/**
 * A desktop shell owns native file dialogs. The Wails server build compiles the
 * same frontend as the native app, but it serves a browser page without the
 * desktop environment marker, so it has no native dialogs either.
 */
export function hasNativeFilePicker(): boolean {
  return isNativeDesktopShell()
}

/** Minimize, maximize and close need a native window to act on. */
export function hasNativeWindowChrome(): boolean {
  return isNativeDesktopShell()
}

/** Revealing a path hands it to the OS file manager on the desktop host. */
export function canOpenPath(): boolean {
  return isNativeDesktopShell()
}

export async function pickFiles(
  options: FileSelectionOptions = {},
): Promise<string[]> {
  if (!hasNativeFilePicker()) return []
  if (platformKind() === 'wails') {
    const { Dialogs } = await nativeModules.wails()
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
  return []
}

export async function pickDirectory(
  options: FileSelectionOptions = {},
): Promise<string | null> {
  if (!hasNativeFilePicker()) return null
  if (platformKind() === 'wails') {
    const { Dialogs } = await nativeModules.wails()
    const result = await Dialogs.OpenFile({
      CanChooseDirectories: true,
      CanChooseFiles: false,
      AllowsMultipleSelection: false,
      Directory: options.defaultPath,
      Title: options.title,
    })
    return typeof result === 'string' && result ? result : null
  }
  return null
}

export async function openUrl(url: string): Promise<void> {
  if (platformKind() === 'wails' && hasNativeWindowChrome())
    return (await nativeModules.wails()).Browser.OpenURL(url)
  // Server and browser pages have no desktop host to open the URL, so use the
  // local tab instead of asking the server to open it.
  window.open(url, '_blank', 'noopener,noreferrer')
}

// openPath reveals a directory in the OS file manager and opens a file with
// the OS default handler through the Wails OpenPath bound method.
export async function openPath(path: string): Promise<void> {
  if (!canOpenPath()) return
  if (platformKind() === 'wails') {
    const { openPathWithPlatformOpener } = await nativeModules.appBindings()
    return openPathWithPlatformOpener(path)
  }
}

export async function startWindowDrag(): Promise<void> {
  if (!hasNativeWindowChrome()) return
  // Wails starts a drag from the `--wails-draggable: drag` CSS property on the
  // titlebar element and exposes no public JS start-drag API.
}

export async function minimizeWindow(): Promise<void> {
  if (!hasNativeWindowChrome()) return
  if (platformKind() === 'wails')
    return (await nativeModules.wails()).Window.Minimise()
}
export async function toggleMaximizeWindow(): Promise<void> {
  if (!hasNativeWindowChrome()) return
  if (platformKind() === 'wails')
    return (await nativeModules.wails()).Window.ToggleMaximise()
}
export async function closeWindow(): Promise<void> {
  if (!hasNativeWindowChrome()) return
  if (platformKind() === 'wails')
    return (await nativeModules.wails()).Window.Close()
}
export async function isWindowMaximized(): Promise<boolean> {
  if (!hasNativeWindowChrome()) return false
  if (platformKind() === 'wails')
    return (await nativeModules.wails()).Window.IsMaximised()
  return false
}
export async function setWindowChrome(
  option: 'overlay' | 'frameless',
): Promise<void> {
  if (!hasNativeWindowChrome()) return
  if (platformKind() === 'wails') {
    if (option === 'frameless')
      return (await nativeModules.wails()).Window.SetFrameless(true)
    // Wails fixes the macOS overlay title bar when it creates the window
    // (MacTitleBarHiddenInsetUnified in main.go) and exposes no runtime setter.
    return
  }
}
export async function onWindowResize(
  callback: () => void,
): Promise<() => void> {
  if (!hasNativeWindowChrome()) return () => {}
  if (platformKind() === 'wails')
    return (await nativeModules.wails()).Events.On(
      'common:WindowDidResize',
      callback,
    )
  return () => {}
}
export async function onFileDrop(
  callback: (files: string[]) => void,
): Promise<() => void> {
  if (!hasNativeWindowChrome()) return () => {}
  if (platformKind() === 'wails') {
    return (await nativeModules.wails()).Events.On(
      'modkeeper:files-dropped',
      (event) => {
        const files = droppedFilesFromEvent(event.data)
        if (files) callback(files)
      },
    )
  }
  return () => {}
}
export async function log(message: string): Promise<void> {
  if (platformKind() === 'wails') {
    const { logToFile } = await nativeModules.appBindings()
    return logToFile(message)
  }
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
