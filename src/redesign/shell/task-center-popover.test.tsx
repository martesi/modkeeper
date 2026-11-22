import { Provider, createStore } from 'jotai'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { pendingTasksAtom, taskResultAtom } from '../state/library-state'
import { installLinguiMacroMock } from '../testing/lingui-macro'

installLinguiMacroMock()

const browserWindow = new Window()
const originalGlobals = new Map<string, PropertyDescriptor | undefined>()

for (const [name, value] of Object.entries({
  window: browserWindow,
  document: browserWindow.document,
  navigator: browserWindow.navigator,
  HTMLElement: browserWindow.HTMLElement,
  Element: browserWindow.Element,
  Node: browserWindow.Node,
  NodeFilter: browserWindow.NodeFilter,
  Event: browserWindow.Event,
  CustomEvent: browserWindow.CustomEvent,
  MutationObserver: browserWindow.MutationObserver,
  ResizeObserver: browserWindow.ResizeObserver,
  PointerEvent: browserWindow.PointerEvent,
  KeyboardEvent: browserWindow.KeyboardEvent,
  getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
  requestAnimationFrame:
    browserWindow.requestAnimationFrame.bind(browserWindow),
  cancelAnimationFrame: browserWindow.cancelAnimationFrame.bind(browserWindow),
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

describe('task center popover', () => {
  let store: ReturnType<typeof createStore>
  let root: Root | null
  let container: HTMLDivElement

  beforeEach(async () => {
    store = createStore()
    root = null
    document.body.replaceChildren()
    container = document.createElement('div')
    document.body.append(container)

    const { TaskCenterPopover } = await import('./task-center-popover')
    root = createRoot(container)
    await act(async () => {
      root?.render(
        createElement(
          Provider,
          { store },
          createElement(
            TaskCenterPopover,
            { expanded: false },
            createElement('button', { type: 'button' }, 'Task action'),
          ),
        ),
      )
    })
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    document.body.replaceChildren()
    root = null
  })

  test('collapsed rail trigger shows active count and opens the center', async () => {
    await act(async () => {
      store.set(pendingTasksAtom, [
        {
          taskId: 'task-1',
          libraryId: 'library-1',
          source: 'other',
          operation: null,
          stage: null,
          percent: null,
          logTail: [],
          lastSequence: 0,
          terminal: false,
        },
      ])
    })

    const trigger = getTrigger()
    expect(trigger.getAttribute('aria-label')).toBe('Tasks, 1 active')
    expect(trigger.className).toContain('justify-center')
    expect(trigger.textContent).toContain('1')

    await act(async () => trigger.click())

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Task action')
  })

  test('latest outcome keeps a completion marker on the rail', async () => {
    await act(async () => {
      store.set(taskResultAtom, {
        kind: 'sync',
        taskId: 'task-1',
        libraryId: 'library-1',
        failures: [],
        succeeded: true,
      })
    })

    expect(getTrigger().querySelector('.lucide-check')).not.toBeNull()
  })

  test('Escape closes, focus stays inside while open, and restores the trigger', async () => {
    const outsideButton = document.createElement('button')
    outsideButton.textContent = 'Outside'
    document.body.append(outsideButton)

    const trigger = getTrigger()
    trigger.focus()
    await act(async () => trigger.click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    outsideButton.focus()
    expect(document.activeElement).not.toBe(outsideButton)

    const closeButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Close"]',
    )
    if (!closeButton) throw new Error('Task center close button is missing')
    await act(async () => {
      closeButton.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }),
      )
    })
    await act(async () => waitForFocusRestoration())

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement?.getAttribute('data-slot')).toBe(
      'popover-trigger',
    )
  })

  test('outside interaction closes the center and restores focus', async () => {
    const trigger = getTrigger()
    await act(async () => trigger.click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    const backdrop = document.querySelector<HTMLDivElement>(
      '[data-task-center-backdrop]',
    )
    if (!backdrop) throw new Error('Task center backdrop is missing')
    await act(async () => {
      backdrop.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    await act(async () => waitForFocusRestoration())

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement?.getAttribute('data-slot')).toBe(
      'popover-trigger',
    )
  })
})

function getTrigger(): HTMLButtonElement {
  const trigger = document.querySelector<HTMLButtonElement>(
    'button[data-slot="popover-trigger"]',
  )
  if (!trigger)
    throw new Error(`Tasks rail trigger is missing: ${document.body.innerHTML}`)
  return trigger
}

function waitForFocusRestoration(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
