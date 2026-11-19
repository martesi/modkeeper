import { afterEach, describe, expect, test } from 'bun:test'
import { hasNativeRuntime, isWails, wailsWindow } from './runtime'

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
    expect(hasNativeRuntime()).toBe(false)
  })

  test('detects the injected browser mock', () => {
    // @ts-expect-error Test supplies a minimal window stub.
    globalThis.window = { __MK_WAILS_MOCK__: {} }
    expect(isWails()).toBe(false)
    expect(hasNativeRuntime()).toBe(true)
  })

  test('returns the window only when available', () => {
    expect(wailsWindow()).toBe(originalWindow)
  })
})
