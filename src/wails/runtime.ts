/** Wails runtime detection and access. This module is safe in a normal browser. */
export type WailsWindow = Window & {
  __TAURI__?: unknown
  __MK_WAILS_MOCK__?: unknown
  _wails?: { environment?: { OS?: string } }
}

export function wailsWindow(): WailsWindow | undefined {
  return typeof window === 'undefined' ? undefined : (window as WailsWindow)
}

/**
 * Wails v3 has no `window.go`; it injects `window._wails`. The build flag covers
 * `build:wails`, but `wails3 build` alone compiles whatever `dist/` exists, so
 * also trust the environment object the native webview injects.
 */
export function isWails(): boolean {
  if (import.meta.env.WAILS === 'true') return true
  return Boolean(wailsWindow()?._wails?.environment)
}

/**
 * A native Wails window injects `_wails.environment`. The server build also
 * compiles the frontend with `WAILS_APP=true`, so `isWails()` is true there, but
 * it serves a plain browser page and never injects that environment object.
 *
 * `@wailsio/runtime` exports `Flags.GetFlag`, but it reads `window._wails.flags`,
 * which the server page does not receive. The environment marker is the reliable
 * desktop signal.
 */
export function isWailsDesktop(): boolean {
  return Boolean(wailsWindow()?._wails?.environment)
}

export function hasNativeRuntime(): boolean {
  const target = wailsWindow()
  return Boolean(target?.__TAURI__ || target?.__MK_WAILS_MOCK__ || isWails())
}
