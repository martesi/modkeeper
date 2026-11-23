/** Wails runtime detection and access. This module is safe in a normal browser. */
export type WailsWindow = Window & {
  __MK_WAILS_MOCK__?: unknown
  _wails?: { environment?: { OS?: string } }
}

const runtimeConfigReadyEvent = 'wails:runtime-config-ready'
const nativeDesktopShellListeners = new Set<() => void>()
let listenerTarget: WailsWindow | undefined
let lastNativeDesktopShell: boolean | undefined

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

/**
 * True when the page runs inside a native desktop shell. Wails injects its
 * environment only after the webview finishes navigation, so callers that
 * render capability-dependent UI must subscribe to changes instead of caching
 * this value.
 */
export function isNativeDesktopShell(): boolean {
  return isWailsDesktop()
}

export function getNativeDesktopSnapshot(): boolean {
  return isNativeDesktopShell()
}

/**
 * Subscribes to Wails runtime-config changes. Wails dispatches
 * `wails:runtime-config-ready` after it injects `window._wails.environment`.
 * The window `load` event is a fallback for hosts that finish navigation first.
 */
export function subscribeNativeDesktopShell(listener: () => void): () => void {
  nativeDesktopShellListeners.add(listener)
  if (nativeDesktopShellListeners.size === 1) {
    attachNativeDesktopListeners()
    lastNativeDesktopShell = isNativeDesktopShell()
  }
  return () => {
    nativeDesktopShellListeners.delete(listener)
    if (nativeDesktopShellListeners.size === 0) detachNativeDesktopListeners()
  }
}

function attachNativeDesktopListeners(): void {
  const target = wailsWindow()
  if (!target || typeof target.addEventListener !== 'function') return
  if (listenerTarget === target) return
  detachNativeDesktopListeners()
  listenerTarget = target
  target.addEventListener(runtimeConfigReadyEvent, notifyNativeDesktopChange)
  target.addEventListener('load', notifyNativeDesktopChange)
}

function detachNativeDesktopListeners(): void {
  const target = listenerTarget
  if (!target) return
  target.removeEventListener(runtimeConfigReadyEvent, notifyNativeDesktopChange)
  target.removeEventListener('load', notifyNativeDesktopChange)
  listenerTarget = undefined
  lastNativeDesktopShell = undefined
}

function notifyNativeDesktopChange(): void {
  const current = isNativeDesktopShell()
  if (current === lastNativeDesktopShell) return
  lastNativeDesktopShell = current
  for (const listener of nativeDesktopShellListeners) listener()
}

export function hasNativeRuntime(): boolean {
  const target = wailsWindow()
  return Boolean(target?.__MK_WAILS_MOCK__ || isWails())
}
