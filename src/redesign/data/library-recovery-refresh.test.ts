import { describe, expect, test } from 'bun:test'
import { getDefaultStore } from 'jotai'
import { emptyWorkspace } from './example-data'
import { runPlainCommand } from './runtime-boundary'
import { beginWorkspaceRecoverySequence } from './workspace-recovery'
import type { LibraryWorkspace } from './redesign-types'
import { libraryWorkspaceAtom, setWorkspace } from '../state/library-state'

const pendingWorkspace: LibraryWorkspace = {
  ...emptyWorkspace(),
  configWarning:
    'Initial library recovery did not finish. Preserve the library and backups.',
}

describe('startup recovery sequence lifecycle', () => {
  test('cleanup during backoff prevents another request and final toast', async () => {
    const sequence = beginWorkspaceRecoverySequence()
    let loadCount = 0
    let toastCount = 0
    let signalWaitStarted!: () => void
    const waitStarted = new Promise<void>((resolve) => {
      signalWaitStarted = resolve
    })

    const running = sequence.run(
      async () => {
        loadCount++
        return pendingWorkspace
      },
      () => toastCount++,
      (_milliseconds, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true })
          signalWaitStarted()
        }),
    )

    await waitStarted
    sequence.dispose()
    await running

    expect(loadCount).toBe(1)
    expect(toastCount).toBe(0)
  })

  test('cleanup during an in-flight refresh prevents its repository write and toast', async () => {
    const sequence = beginWorkspaceRecoverySequence()
    const response = deferred<{
      status: 'ok'
      data: LibraryWorkspace
    }>()
    let loadCount = 0
    let workspace = pendingWorkspace
    let toastCount = 0
    let refreshStarted!: () => void
    const refreshIsStarted = new Promise<void>((resolve) => {
      refreshStarted = resolve
    })

    const running = sequence.run(
      async (guard) => {
        loadCount++
        if (loadCount === 1) return workspace
        refreshStarted()
        return loadThroughBoundary(
          response.promise,
          guard,
          () => workspace,
          (value) => {
            workspace = value
          },
        )
      },
      () => toastCount++,
      async () => {},
    )

    await refreshIsStarted
    sequence.dispose()
    response.resolve({ status: 'ok', data: recoveredWorkspace() })
    await running

    expect(workspace).toBe(pendingWorkspace)
    expect(toastCount).toBe(0)
  })

  test('a command workspace write invalidates an older recovery response', async () => {
    const store = getDefaultStore()
    setWorkspace(emptyWorkspace())
    const sequence = beginWorkspaceRecoverySequence()
    const oldResponse = deferred<{
      status: 'ok'
      data: LibraryWorkspace
    }>()
    const toasts: Array<LibraryWorkspace | null> = []
    const oldRun = sequence.run(
      (guard) =>
        loadThroughBoundary(
          oldResponse.promise,
          guard,
          () => store.get(libraryWorkspaceAtom) ?? emptyWorkspace(),
          setWorkspace,
        ),
      (value) => toasts.push(value),
    )

    const latestWorkspace = recoveredWorkspace()
    // This represents a successful user command applying its returned workspace.
    setWorkspace(latestWorkspace)

    oldResponse.resolve({ status: 'ok', data: pendingWorkspace })
    await oldRun

    expect(store.get(libraryWorkspaceAtom)).toBe(latestWorkspace)
    expect(toasts).toEqual([])
    sequence.dispose()
    setWorkspace(emptyWorkspace())
  })

  test('a duplicate Strict Mode initialization invalidates its previous sequence', async () => {
    const store = getDefaultStore()
    setWorkspace(emptyWorkspace())
    const latestWorkspace = recoveredWorkspace()
    const older = beginWorkspaceRecoverySequence()
    const oldResponse = deferred<{
      status: 'ok'
      data: LibraryWorkspace
    }>()
    const toasts: Array<LibraryWorkspace | null> = []
    const oldRun = older.run(
      (guard) =>
        loadThroughBoundary(
          oldResponse.promise,
          guard,
          () => store.get(libraryWorkspaceAtom) ?? emptyWorkspace(),
          setWorkspace,
        ),
      (value) => toasts.push(value),
    )

    const newer = beginWorkspaceRecoverySequence()
    expect(older.isCurrent()).toBe(false)
    const newRun = newer.run(
      (guard) =>
        loadThroughBoundary(
          Promise.resolve({ status: 'ok' as const, data: latestWorkspace }),
          guard,
          () => store.get(libraryWorkspaceAtom) ?? emptyWorkspace(),
          setWorkspace,
        ),
      (value) => toasts.push(value),
    )
    await newRun

    oldResponse.resolve({ status: 'ok', data: pendingWorkspace })
    await oldRun

    expect(store.get(libraryWorkspaceAtom)).toBe(latestWorkspace)
    expect(toasts).toEqual([latestWorkspace])
    newer.dispose()
    setWorkspace(emptyWorkspace())
  })

  test('returns a recovery failure warning after the pending warning clears', async () => {
    const sequence = beginWorkspaceRecoverySequence()
    const recoveryError: LibraryWorkspace = {
      ...emptyWorkspace(),
      configWarning: 'Preserve the library and backups. Repair the marker.',
    }
    const results: Array<LibraryWorkspace | null> = []
    let loads = 0

    await sequence.run(
      async () => {
        loads++
        return loads === 1 ? pendingWorkspace : recoveryError
      },
      (workspace) => results.push(workspace),
      async () => {},
    )

    expect(loads).toBe(2)
    expect(results).toEqual([recoveryError])
    sequence.dispose()
  })

  test('a perpetually pending warning exhausts all three retries', async () => {
    const sequence = beginWorkspaceRecoverySequence()
    const delays: number[] = []
    const results: Array<LibraryWorkspace | null> = []
    let loads = 0

    await sequence.run(
      async () => {
        loads++
        return pendingWorkspace
      },
      (workspace) => results.push(workspace),
      async (milliseconds) => {
        delays.push(milliseconds)
      },
    )

    expect(loads).toBe(4)
    expect(delays).toEqual([1000, 2000, 4000])
    expect(results).toEqual([pendingWorkspace])
    sequence.dispose()
  })
})

function loadThroughBoundary(
  invoke: Promise<{ status: 'ok'; data: LibraryWorkspace }>,
  guard: {
    isCurrent: () => boolean
    onApplied: () => void
  },
  current: () => LibraryWorkspace,
  apply: (workspace: LibraryWorkspace) => void,
): Promise<LibraryWorkspace> {
  return runPlainCommand({
    isNative: true,
    invoke: () => invoke,
    mock: emptyWorkspace,
    apply,
    onDomainError: () => {},
    onTransportError: () => {},
    current,
    isCurrent: guard.isCurrent,
    onApplied: guard.onApplied,
    applyMock: true,
  })
}

function recoveredWorkspace(): LibraryWorkspace {
  return { ...emptyWorkspace(), activeLibraryId: 'recovered-library' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
