import { afterEach, describe, expect, test } from 'bun:test'
import { isWails, wailsMethod, wailsWindow } from './runtime'

const originalWindow = globalThis.window

afterEach(() => {
  // @ts-expect-error Test restores the browser global after installing a stub.
  globalThis.window = originalWindow
})

describe('Wails runtime detection', () => {
  test('does not detect Wails in a browser without bound Go methods', () => {
    // @ts-expect-error Test supplies a minimal window stub.
    globalThis.window = {}
    expect(isWails()).toBe(false)
    expect(wailsMethod('getLibraryWorkspace')).toBeUndefined()
  })

  test('finds and binds a method on the App receiver', () => {
    const app = {
      getLibraryWorkspace: function (this: { marker: number }) {
        return this.marker
      },
    }
    // @ts-expect-error Test supplies only the Wails binding surface.
    globalThis.window = {
      go: { main: { App: Object.assign(app, { marker: 42 }) } },
    }
    expect(isWails()).toBe(true)
    expect(wailsMethod('getLibraryWorkspace')?.()).toBe(42)
  })

  test('returns the window only when available', () => {
    expect(wailsWindow()).toBe(originalWindow)
  })
})
