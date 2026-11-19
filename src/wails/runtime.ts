/** Wails runtime detection and access. This module is safe in a normal browser. */
export type WailsWindow = Window & {
  __TAURI__?: unknown
  __MK_WAILS_MOCK__?: unknown
}

export function wailsWindow(): WailsWindow | undefined {
  return typeof window === 'undefined' ? undefined : (window as WailsWindow)
}

/** Wails v3 injects its runtime through the @wailsio/runtime module, not window.go. */
export function isWails(): boolean {
  return import.meta.env.WAILS === 'true'
}

export function hasNativeRuntime(): boolean {
  const target = wailsWindow()
  return Boolean(target?.__TAURI__ || target?.__MK_WAILS_MOCK__ || isWails())
}
