import { afterAll, describe, expect, test } from 'vitest'
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
    document.body.append(wailsContainer)
    const wailsRoot = createRoot(wailsContainer)

    await act(async () => {
      wailsRoot.render(createElement(TitleBarDragRegion, { platform: 'wails' }))
    })

    const wailsOverlay = wailsContainer.firstElementChild as HTMLElement
    expect(wailsOverlay.getAttribute('data-wails-drag-region')).toBeNull()
    expect(wailsOverlay.style.getPropertyValue('--wails-draggable')).toBe(
      'drag',
    )

    await act(async () => {
      wailsRoot.unmount()
    })
    document.body.replaceChildren()
  })
})
