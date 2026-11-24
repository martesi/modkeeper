import { afterEach, describe, expect, test } from 'vitest'
import {
  getNativeDesktopSnapshot,
  hasNativeRuntime,
  isNativeDesktopShell,
  isWails,
  isWailsDesktop,
  subscribeNativeDesktopShell,
  wailsWindow,
} from './runtime'

const originalWindow = globalThis.window

afterEach(() => {
  // @ts-expect-error Test restores the browser global after installing a stub.
  globalThis.window = originalWindow
})

describe('Wails runtime detection', () => {
  test('does not detect a browser without a native runtime', () => {
    // @ts-expect-error Test supplies a minimal window stub.
    globalThis.window = {}
    expect(isWails()).toBe(false)
    expect(isWailsDesktop()).toBe(false)
    expect(hasNativeRuntime()).toBe(false)
  })

  test('detects the injected browser mock', () => {
    // @ts-expect-error Test supplies a minimal window stub.
    globalThis.window = { __MK_WAILS_MOCK__: {} }
    expect(isWails()).toBe(false)
    expect(hasNativeRuntime()).toBe(true)
  })

  test('detects the injected native Wails environment', () => {
    // @ts-expect-error Test supplies a minimal window stub.
    globalThis.window = { _wails: { environment: { OS: 'linux' } } }
    expect(isWails()).toBe(true)
    expect(isWailsDesktop()).toBe(true)
    expect(hasNativeRuntime()).toBe(true)
  })

  test('does not treat a server page as a desktop Wails window', () => {
    // @ts-expect-error Test supplies a minimal window stub.
    globalThis.window = { _wails: {} }
    expect(isWailsDesktop()).toBe(false)
    expect(isNativeDesktopShell()).toBe(false)
  })

  test('notifies subscribers when Wails injects the environment', () => {
    const target = new EventTarget() as EventTarget & {
      _wails?: { environment?: { OS?: string } }
    }
    target._wails = {}
    // @ts-expect-error Test installs an EventTarget as the window.
    globalThis.window = target
    expect(isNativeDesktopShell()).toBe(false)

    let changes = 0
    const unsubscribe = subscribeNativeDesktopShell(() => {
      changes += 1
    })
    target._wails.environment = { OS: 'linux' }
    target.dispatchEvent(new Event('wails:runtime-config-ready'))

    expect(isNativeDesktopShell()).toBe(true)
    expect(getNativeDesktopSnapshot()).toBe(true)
    expect(changes).toBe(1)
    unsubscribe()
  })

  test('keeps a server page non-desktop through runtime events', () => {
    const target = new EventTarget() as EventTarget & {
      _wails?: { environment?: { OS?: string } }
    }
    target._wails = {}
    // @ts-expect-error Test installs an EventTarget as the window.
    globalThis.window = target

    let changes = 0
    const unsubscribe = subscribeNativeDesktopShell(() => {
      changes += 1
    })
    target.dispatchEvent(new Event('wails:runtime-config-ready'))
    target.dispatchEvent(new Event('load'))

    expect(isNativeDesktopShell()).toBe(false)
    expect(getNativeDesktopSnapshot()).toBe(false)
    expect(changes).toBe(0)
    unsubscribe()
  })

  test('reads a late environment on the window load fallback', () => {
    const target = new EventTarget() as EventTarget & {
      _wails?: { environment?: { OS?: string } }
    }
    target._wails = {}
    // @ts-expect-error Test installs an EventTarget as the window.
    globalThis.window = target

    let changes = 0
    const unsubscribe = subscribeNativeDesktopShell(() => {
      changes += 1
    })
    target._wails.environment = { OS: 'linux' }
    target.dispatchEvent(new Event('load'))

    expect(isNativeDesktopShell()).toBe(true)
    expect(changes).toBe(1)
    unsubscribe()
  })

  test('returns the window only when available', () => {
    expect(wailsWindow()).toBe(originalWindow)
  })
})
