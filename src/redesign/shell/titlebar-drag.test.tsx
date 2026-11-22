import { afterAll, describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { TitleBarDragRegion } from './titlebar-drag'

const browserWindow = new Window()
const originalGlobals = new Map<string, PropertyDescriptor | undefined>()

for (const [name, value] of Object.entries({
  window: browserWindow,
  document: browserWindow.document,
  navigator: browserWindow.navigator,
  HTMLElement: browserWindow.HTMLElement,
  Element: browserWindow.Element,
  Node: browserWindow.Node,
  Event: browserWindow.Event,
  MutationObserver: browserWindow.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  })
}

afterAll(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  browserWindow.happyDOM.abort()
})

describe('titlebar drag marker', () => {
  test('overlay carries the Wails CSS property only in the Wails shell', async () => {
    const wailsContainer = document.createElement('div')
    const tauriContainer = document.createElement('div')
    document.body.append(wailsContainer, tauriContainer)
    const wailsRoot = createRoot(wailsContainer)
    const tauriRoot = createRoot(tauriContainer)

    await act(async () => {
      wailsRoot.render(createElement(TitleBarDragRegion, { platform: 'wails' }))
      tauriRoot.render(createElement(TitleBarDragRegion, { platform: 'tauri' }))
    })

    const wailsOverlay = wailsContainer.firstElementChild as HTMLElement
    const tauriOverlay = tauriContainer.firstElementChild as HTMLElement
    expect(wailsOverlay.getAttribute('data-tauri-drag-region')).toBe('true')
    expect(wailsOverlay.style.getPropertyValue('--wails-draggable')).toBe(
      'drag',
    )
    expect(tauriOverlay.getAttribute('data-tauri-drag-region')).toBe('true')
    expect(tauriOverlay.style.getPropertyValue('--wails-draggable')).toBe('')

    await act(async () => {
      wailsRoot.unmount()
      tauriRoot.unmount()
    })
    document.body.replaceChildren()
  })
})
