/** Wails runtime detection and access. This module is safe in a normal browser. */
export type WailsApp = Record<string, (...args: unknown[]) => unknown>

export type WailsWindow = Window & {
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

export function wailsMethod(
  method: string,
): ((...args: unknown[]) => unknown) | undefined {
  const apps = wailsWindow()?.go
  if (!apps) return undefined
  // Wails exposes bound methods on `go.<package>.<Type>`. For this app the
  // generated Go binding is expected under `go.main.App`.
  for (const app of Object.values(apps)) {
    const candidate = app.App?.[method] ?? app[method]
    if (typeof candidate === 'function') return candidate.bind(app.App ?? app)
  }
  return undefined
}
