/** Wails runtime detection and access. This module is safe in a normal browser. */
export type WailsApp = Record<string, unknown>

export type WailsWindow = Window & {
  __TAURI__?: unknown
  __MK_WAILS_MOCK__?: unknown
  go?: Record<string, WailsApp>
  runtime?: {
    EventsOn?: (
      name: string,
      callback: (...args: unknown[]) => void,
    ) => (() => void) | void
    EventsOnce?: (
      name: string,
      callback: (...args: unknown[]) => void,
    ) => (() => void) | void
    EventsEmit?: (name: string, ...args: unknown[]) => void
    OpenURL?: (url: string) => void
    OpenFile?: (path: string) => void
    LogPrint?: (message: string) => void
  }
}

export function wailsWindow(): WailsWindow | undefined {
  return typeof window === 'undefined' ? undefined : (window as WailsWindow)
}

export function isWails(): boolean {
  return Boolean(wailsWindow()?.go)
}

export function hasNativeRuntime(): boolean {
  const target = wailsWindow()
  return Boolean(target?.go || target?.__TAURI__ || target?.__MK_WAILS_MOCK__)
}

export function wailsMethod(
  method: string,
): ((...args: unknown[]) => unknown) | undefined {
  const apps = wailsWindow()?.go
  if (!apps) return undefined
  // Wails exposes bound methods on `go.<package>.<Type>`. For this app the
  // generated Go binding is expected under `go.main.App`.
  for (const app of Object.values(apps)) {
    const receiver = (app.App as WailsApp | undefined) ?? app
    const candidate = receiver[method]
    if (typeof candidate === 'function')
      return candidate.bind(receiver) as (...args: unknown[]) => unknown
  }
  return undefined
}
