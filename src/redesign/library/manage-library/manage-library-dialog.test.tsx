import { Provider, createStore } from 'jotai'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest'
import {
  libraryWorkspaceAtom,
  pendingTasksAtom,
} from '../../state/library-state'
import { getMockWorkspace, setMockWorkspace } from '../../data/example-data'
import { installWailsMock } from '@/wails/mock'
const browserWindow = new Window()
const originalGlobals = new Map<string, PropertyDescriptor | undefined>()
for (const [name, value] of Object.entries({
  window: browserWindow,
  document: browserWindow.document,
  navigator: browserWindow.navigator,
  HTMLElement: browserWindow.HTMLElement,
  KeyboardEvent: browserWindow.KeyboardEvent,
  HTMLFormElement: browserWindow.HTMLFormElement,
  Element: browserWindow.Element,
  Node: browserWindow.Node,
  NodeFilter: browserWindow.NodeFilter,
  DocumentFragment: browserWindow.DocumentFragment,
  Event: browserWindow.Event,
  EventTarget: browserWindow.EventTarget,
  MouseEvent: browserWindow.MouseEvent,
  CustomEvent: browserWindow.CustomEvent,
  MutationObserver: browserWindow.MutationObserver,
  getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
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
let store: ReturnType<typeof createStore>
let previousMockWorkspace = getMockWorkspace()

beforeEach(async () => {
  previousMockWorkspace = structuredClone(getMockWorkspace())
  const workspace = structuredClone(getMockWorkspace())
  for (const entry of workspace.libraries) {
    if ('id' in entry) entry.hostRuntime = 'wsl'
  }
  setMockWorkspace(workspace)
  store = createStore()
  store.set(libraryWorkspaceAtom, workspace)
  document.body.replaceChildren()
  container = document.createElement('div')
  document.body.append(container)
  const { ManageLibraryDialog } = await import('./manage-library-dialog')
  root = createRoot(container)
  await act(async () =>
    root?.render(
      createElement(
        Provider,
        { store },
        createElement(ManageLibraryDialog, {
          open: true,
          onOpenChange: () => {},
        }),
      ),
    ),
  )
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  setMockWorkspace(previousMockWorkspace)
  document.body.replaceChildren()
})

async function renderWorkspace(workspace: ReturnType<typeof getMockWorkspace>) {
  await act(async () => root?.unmount())
  store = createStore()
  store.set(libraryWorkspaceAtom, workspace)
  root = createRoot(container)
  const { ManageLibraryDialog } = await import('./manage-library-dialog')
  await act(async () =>
    root?.render(
      createElement(
        Provider,
        { store },
        createElement(ManageLibraryDialog, {
          open: true,
          onOpenChange: () => {},
        }),
      ),
    ),
  )
}

afterAll(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  browserWindow.happyDOM.abort()
})

test('keeps runtime and deployment controls disabled in WSL', () => {
  const selects =
    document.body.querySelectorAll<HTMLButtonElement>('[role="combobox"]')
  expect(selects).toHaveLength(2)
  expect(selects[0]?.disabled).toBe(true)
  expect(selects[1]?.disabled).toBe(true)
  expect(document.body.textContent).toContain(
    'Runtime and deployment choices are disabled in WSL',
  )
})

test('fails closed and explains when the host runtime is unknown', async () => {
  const workspace = structuredClone(getMockWorkspace())
  for (const entry of workspace.libraries) {
    if ('id' in entry) entry.hostRuntime = 'unknown'
  }
  setMockWorkspace(workspace)
  await renderWorkspace(workspace)
  const selects =
    document.body.querySelectorAll<HTMLButtonElement>('[role="combobox"]')
  expect(selects).toHaveLength(2)
  expect(selects[0]?.disabled).toBe(true)
  expect(selects[1]?.disabled).toBe(true)
  expect(document.body.textContent).toContain(
    'host platform could not be verified',
  )
})

test('disables policy controls while the active library has a pending task', async () => {
  const workspace = structuredClone(getMockWorkspace())
  const active = workspace.libraries.find(
    (entry) => 'id' in entry && entry.id === workspace.activeLibraryId,
  )
  expect(active && 'id' in active).toBe(true)
  if (!active || !('id' in active)) return
  active.hostRuntime = 'linux'
  active.targetRuntime = 'linux'
  active.deploymentMethod = 'copy'
  setMockWorkspace(workspace)
  await renderWorkspace(workspace)
  await act(async () =>
    store.set(pendingTasksAtom, [
      {
        taskId: 'sync-in-flight',
        libraryId: active.id,
        source: 'sync-button',
        operation: null,
        stage: null,
        percent: null,
        logTail: [],
        lastSequence: -1,
        terminal: false,
      },
    ]),
  )
  const selects =
    document.body.querySelectorAll<HTMLButtonElement>('[role="combobox"]')
  expect(selects[0]?.disabled).toBe(true)
  expect(selects[1]?.disabled).toBe(true)
})

test('shows recovery-required controls after a post-replacement policy failure', async () => {
  const workspace = structuredClone(getMockWorkspace())
  for (const entry of workspace.libraries) {
    if ('id' in entry) {
      entry.hostRuntime = 'linux'
      entry.targetRuntime = 'linux'
      entry.deploymentMethod = 'copy'
    }
  }
  setMockWorkspace(workspace)
  await renderWorkspace(workspace)
  const currentWorkspace = structuredClone(workspace)
  for (const entry of currentWorkspace.libraries) {
    if ('id' in entry) {
      entry.policyUncertain = true
      entry.targetRuntime = ''
      entry.deploymentMethod = ''
    }
  }
  const uninstall = installWailsMock({
    commands: {
      setDeploymentPolicy: () => ({
        status: 'error',
        error: { code: 'IOError', data: ['manifest replacement uncertain'] },
      }),
      getLibraryWorkspace: () => structuredClone(currentWorkspace),
    },
  })
  try {
    const method =
      document.body.querySelectorAll<HTMLButtonElement>('[role="combobox"]')[1]
    expect(method).not.toBeNull()
    await act(async () => {
      method?.focus()
      method?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
        }),
      )
    })
    expect(document.body.querySelector('[role="option"]')).not.toBeNull()
    await act(async () => {
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'))
        .find((option) => option.textContent?.includes('Symbolic link'))
        ?.click()
    })
    const save = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Save deployment policy'),
    )
    expect(save?.disabled).toBe(false)
    await act(async () => save?.click())
    expect(method?.disabled).toBe(true)
    expect(method?.textContent).toContain('Symbolic link')
    expect(document.body.textContent).toContain('saved policy is uncertain')
  } finally {
    uninstall()
  }
})

test('locks policy controls when Save transport and authoritative refresh both fail', async () => {
  const workspace = structuredClone(getMockWorkspace())
  for (const entry of workspace.libraries) {
    if ('id' in entry) {
      entry.hostRuntime = 'linux'
      entry.targetRuntime = 'linux'
      entry.deploymentMethod = 'copy'
    }
  }
  setMockWorkspace(workspace)
  await renderWorkspace(workspace)
  const uninstall = installWailsMock({
    commands: {
      setDeploymentPolicy: () => Promise.reject(new Error('transport dropped')),
      getLibraryWorkspace: () => Promise.reject(new Error('refresh dropped')),
    },
  })
  try {
    const method =
      document.body.querySelectorAll<HTMLButtonElement>('[role="combobox"]')[1]
    await act(async () => {
      method?.focus()
      method?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
        }),
      )
    })
    await act(async () => {
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'))
        .find((option) => option.textContent?.includes('Symbolic link'))
        ?.click()
    })
    const save = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Save deployment policy'),
    )
    await act(async () => save?.click())
    expect(method?.disabled).toBe(true)
    expect(method?.textContent).toContain('Symbolic link')
    expect(document.body.textContent).toContain('saved policy is uncertain')
  } finally {
    uninstall()
  }
})

test('clears recovery lock after an authoritative policy refresh succeeds', async () => {
  const workspace = structuredClone(getMockWorkspace())
  for (const entry of workspace.libraries) {
    if ('id' in entry) {
      entry.hostRuntime = 'linux'
      entry.targetRuntime = 'linux'
      entry.deploymentMethod = 'copy'
    }
  }
  setMockWorkspace(workspace)
  await renderWorkspace(workspace)
  const uninstall = installWailsMock({
    commands: {
      setDeploymentPolicy: () => Promise.reject(new Error('transport dropped')),
      getLibraryWorkspace: () => structuredClone(workspace),
    },
  })
  try {
    const method =
      document.body.querySelectorAll<HTMLButtonElement>('[role="combobox"]')[1]
    await act(async () => {
      method?.focus()
      method?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      )
    })
    await act(async () => {
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'))
        .find((option) => option.textContent?.includes('Symbolic link'))
        ?.click()
    })
    const save = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Save deployment policy'),
    )
    await act(async () => save?.click())
    expect(method?.disabled).toBe(false)
    expect(method?.textContent).toContain('Copy')
    expect(document.body.textContent).not.toContain('saved policy is uncertain')
  } finally {
    uninstall()
  }
})
