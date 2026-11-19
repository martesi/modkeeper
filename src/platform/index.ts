import { hasNativeRuntime, isWails } from '@/wails/runtime'

export type PlatformKind = 'wails' | 'tauri' | 'browser'
export type FileSelectionOptions = {
  multiple?: boolean
  directory?: boolean
  filters?: { name: string; extensions: string[] }[]
  defaultPath?: string
  title?: string
}

export function platformKind(): PlatformKind {
  if (isWails()) return 'wails'
  if (hasNativeRuntime()) return 'tauri'
  return 'browser'
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
  if (platformKind() === 'wails')
    return (await import('@wailsio/runtime')).Browser.OpenURL(url)
  if (platformKind() === 'tauri')
    return (await import('@tauri-apps/plugin-opener')).openUrl(url)
  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function openPath(path: string): Promise<void> {
  if (platformKind() === 'wails')
    return (await import('@wailsio/runtime')).System.OpenDirectory(path)
  if (platformKind() === 'tauri')
    return (await import('@tauri-apps/plugin-opener')).openPath(path)
}

export async function startWindowDrag(): Promise<void> {
  if (platformKind() === 'tauri')
    return (await import('@tauri-apps/api/window'))
      .getCurrentWindow()
      .startDragging()
  if (platformKind() === 'wails')
    return (await import('@wailsio/runtime')).Window.Drag()
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
export async function onFileDrop(
  callback: (files: string[]) => void,
): Promise<() => void> {
  if (platformKind() === 'wails')
    return (await import('@wailsio/runtime')).Events.On('wails:drop', (event) =>
      callback(event.data as string[]),
    )
  if (platformKind() === 'tauri')
    return (await import('@tauri-apps/api/window'))
      .getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'drop') callback(event.payload.paths)
      })
  return () => {}
}
export async function log(message: string): Promise<void> {
  if (platformKind() === 'wails')
    return (await import('@wailsio/runtime')).System.Log(message)
  if (platformKind() === 'tauri')
    return (await import('@tauri-apps/plugin-log')).info(message)
  console.info(message)
}
