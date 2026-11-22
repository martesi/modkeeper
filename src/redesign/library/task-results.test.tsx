import { getDefaultStore } from 'jotai'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'

mock.module('@tanstack/react-router', () => ({ useNavigate: () => () => {} }))
mock.module('../i18n/library-text', () => ({
  libraryText: new Proxy(
    {},
    {
      get: (_target, key) =>
        key === 'taskLibrary'
          ? (name: string) => `Library: ${name}`
          : () => (key === 'tasksLabel' ? 'Tasks' : String(key)),
    },
  ),
}))
mock.module('../i18n/registry-text', () => ({
  registryText: new Proxy({}, { get: () => () => '' }),
}))
mock.module('../i18n/common-text', () => ({
  commonText: { close: () => 'Close' },
}))
mock.module('../i18n/error-text', () => ({
  errorText: new Proxy({}, { get: () => () => '' }),
}))
mock.module('../i18n/task-history-text', () => ({
  taskHistoryText: {
    title: () => 'Recent tasks',
    label: () => 'Recent task history',
    clear: () => 'Clear all',
    empty: () => 'No events yet.',
    operation: (operation: string) =>
      operation === 'sync'
        ? 'Sync'
        : operation === 'forge_install'
          ? 'Download'
          : 'Upload',
    status: () => 'Completed',
    dismiss: (operation: string, library: string) =>
      `Dismiss ${operation} for ${library}`,
    log: () => 'Show log',
  },
}))
mock.module('../i18n/task-progress-text', () => ({
  taskProgressText: new Proxy({}, { get: () => () => '' }),
}))
mock.module('../data/library-repository', () => ({
  syncMods: async () => {},
  retryFailedArchives: async () => {},
}))
mock.module('../../wails/bridge', () => ({ cancelInstallTask: async () => {} }))

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
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  })
}

let root: Root | null = null
let container: HTMLDivElement
let recordTaskHistory: typeof import('../data/task-history').recordTaskHistory
let clearTaskHistory: typeof import('../data/task-history').clearTaskHistory

beforeEach(async () => {
  document.body.replaceChildren()
  container = document.createElement('div')
  document.body.append(container)
  const history = await import('../data/task-history')
  recordTaskHistory = history.recordTaskHistory
  clearTaskHistory = history.clearTaskHistory
  clearTaskHistory()
  const { TaskCenterPanel } = await import('./task-results')
  root = createRoot(container)
  await act(async () => root?.render(createElement(TaskCenterPanel)))
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  window.localStorage.clear()
  document.body.replaceChildren()
})

afterAll(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  browserWindow.happyDOM.abort()
})

test('shows a recorded event and Clear all empties the list', async () => {
  await act(async () =>
    recordTaskHistory({
      kind: 'sync',
      taskId: 'sync-event-1',
      libraryId: 'test-library',
      failures: [],
      succeeded: true,
    }),
  )

  const panel = container.querySelector('[aria-label="Recent task history"]')
  expect(panel?.textContent).toContain('Sync')
  expect(panel?.textContent).toContain('Library: test-library')
  expect(panel?.textContent).toContain('Completed')
  expect(panel?.querySelectorAll('li')).toHaveLength(1)

  const clearButton = [...(panel?.querySelectorAll('button') ?? [])].find(
    (button) => button.textContent === 'Clear all',
  )
  expect(clearButton).toBeDefined()
  await act(async () => clearButton?.click())
  expect(panel?.querySelectorAll('li')).toHaveLength(0)
  expect(panel?.textContent).toContain('No events yet.')
  expect(
    getDefaultStore().get(
      (await import('../data/task-history')).taskHistoryAtom,
    ),
  ).toHaveLength(0)
})
