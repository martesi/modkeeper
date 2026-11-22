import { Provider, createStore } from 'jotai'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'

mock.module('@tanstack/react-router', () => ({ useNavigate: () => () => {} }))
mock.module('../i18n/library-text', () => ({
  libraryText: new Proxy(
    {},
    {
      get: (_target, key) => () =>
        key === 'tasksLabel' ? 'Tasks' : String(key),
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
  taskHistoryText: new Proxy(
    {},
    {
      get:
        (_target, key) =>
        (...args: unknown[]) =>
          key === 'title' ? `Recent tasks (${args[0]})` : '',
    },
  ),
}))
mock.module('../i18n/task-progress-text', () => ({
  taskProgressText: new Proxy({}, { get: () => () => '' }),
}))
mock.module('../data/library-repository', () => ({
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

beforeEach(async () => {
  document.body.replaceChildren()
  container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem(
    'modkeeper.taskHistory.v1',
    JSON.stringify({
      version: 1,
      tasks: [
        {
          taskId: 'recent-task',
          timestamp: '2025-01-01T00:00:00.000Z',
          operation: 'sync',
          libraryId: 'test-library',
          status: 'success',
          logTail: [],
        },
      ],
    }),
  )
  const { TaskCenterPanel } = await import('./task-results')
  root = createRoot(container)
  await act(async () =>
    root?.render(
      createElement(
        Provider,
        { store: createStore() },
        createElement(TaskCenterPanel),
      ),
    ),
  )
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

test('does not render Recent tasks from stored history', () => {
  expect(container.textContent).not.toContain('Recent tasks')
})
