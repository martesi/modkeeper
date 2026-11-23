import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createStore, getDefaultStore } from 'jotai'
import { getMockWorkspace } from '../data/example-data'
import { runTrackedCommand } from '../data/runtime-boundary'
import type { ModSummary } from '../data/redesign-types'
import type { TaskProgressEvent } from '../data/redesign-types'
import {
  addPendingTask,
  applyTaskProgress,
  clearLibraryFiltersAtom,
  clearLibrarySearchAtom,
  libraryBusyAtom,
  librarySearchAtom,
  libraryRevealModIdAtom,
  locateLibraryModAtom,
  librarySortAtom,
  libraryStatusFilterAtom,
  libraryTypeFilterAtom,
  libraryViewModeAtom,
  libraryWorkspaceAtom,
  pendingTasksAtom,
  removePendingTask,
  selectedModIdsAtom,
  setWorkspace,
  visibleModsAtom,
  type LibrarySort,
  type LibraryTypeFilter,
  type PendingTask,
} from './library-state'

function pendingTask(
  taskId: string,
  libraryId: string,
  source: PendingTask['source'],
): PendingTask {
  return {
    taskId,
    libraryId,
    source,
    operation: null,
    stage: null,
    percent: null,
    logTail: [],
    lastSequence: -1,
    terminal: false,
  }
}

function progress(
  input: Partial<TaskProgressEvent> &
    Pick<TaskProgressEvent, 'taskId' | 'libraryId' | 'sequence'>,
): TaskProgressEvent {
  return {
    operation: 'sync',
    kind: 'progress',
    stage: 'sync_plan',
    percent: null,
    log: null,
    ...input,
  }
}

function setupLibrary() {
  const workspace = structuredClone(getMockWorkspace())
  const libraryId = 'lib-example'
  const mods: ModSummary[] = [
    {
      id: 'old',
      libraryId,
      name: 'Zulu',
      type: 'server',
      isEnabled: true,
      installedAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    },
    {
      id: 'new',
      libraryId,
      name: 'Alpha',
      type: 'client',
      isEnabled: false,
      installedAt: '2026-02-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    },
    {
      id: 'unknown',
      libraryId,
      name: 'Legacy',
      type: 'unknown',
      isEnabled: true,
      updatedAt: '',
    },
    {
      id: 'both',
      libraryId,
      name: 'Beta',
      type: 'both',
      isEnabled: false,
      installedAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-02-01T10:00:00Z',
    },
    {
      id: 'new-server',
      libraryId,
      name: 'Zeta',
      type: 'server',
      isEnabled: true,
      installedAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-01-15T10:00:00Z',
    },
  ]
  workspace.activeLibraryId = libraryId
  workspace.modsByLibraryId[libraryId] = mods
  const store = createStore()
  store.set(libraryWorkspaceAtom, workspace)
  return { store, workspace, mods }
}

function resetDefaultStore() {
  const store = getDefaultStore()
  store.set(libraryWorkspaceAtom, null)
  store.set(selectedModIdsAtom, new Set())
  store.set(pendingTasksAtom, [])
}

beforeEach(resetDefaultStore)
afterEach(resetDefaultStore)

describe('library view mode', () => {
  test('defaults to list and accepts the other presentations', () => {
    const store = createStore()
    expect(store.get(libraryViewModeAtom)).toBe('list')
    store.set(libraryViewModeAtom, 'icons')
    expect(store.get(libraryViewModeAtom)).toBe('icons')
  })
})

describe('library sorting', () => {
  const cases: [LibrarySort, string[]][] = [
    ['installed-desc', ['new-server', 'new', 'both', 'old', 'unknown']],
    ['installed-asc', ['old', 'both', 'new', 'new-server', 'unknown']],
    ['updated-desc', ['old', 'both', 'new-server', 'new', 'unknown']],
    ['name-asc', ['new', 'both', 'unknown', 'new-server', 'old']],
    ['name-desc', ['old', 'new-server', 'unknown', 'both', 'new']],
  ]
  for (const [sort, expected] of cases) {
    test(`${sort} orders mods independently of other dates`, () => {
      const { store, mods } = setupLibrary()
      store.set(librarySortAtom, sort)
      expect(store.get(visibleModsAtom).map((mod) => mod.id)).toEqual(expected)
      expect(mods.map((mod) => mod.id)).toEqual([
        'old',
        'new',
        'unknown',
        'both',
        'new-server',
      ])
    })
  }

  test('installation sorting still respects search and enabled filters', () => {
    const { store } = setupLibrary()
    store.set(librarySortAtom, 'installed-desc')
    store.set(libraryStatusFilterAtom, 'enabled')
    expect(store.get(visibleModsAtom).map((mod) => mod.id)).toEqual([
      'new-server',
      'old',
      'unknown',
    ])
    store.set(librarySearchAtom, 'zULu')
    expect(store.get(visibleModsAtom).map((mod) => mod.id)).toEqual(['old'])
  })

  test('equal dates use natural name order and invalid legacy dates stay last', () => {
    const { store, mods } = setupLibrary()
    mods[0].installedAt = '2026-01-01T10:00:00Z'
    mods[1].installedAt = '2026-01-01T10:00:00.000Z'
    mods[2].installedAt = 'invalid'
    store.set(librarySortAtom, 'installed-asc')
    expect(store.get(visibleModsAtom).map((mod) => mod.id)).toEqual([
      'new',
      'old',
      'both',
      'new-server',
      'unknown',
    ])
    store.set(librarySortAtom, 'installed-desc')
    expect(store.get(visibleModsAtom).map((mod) => mod.id)).toEqual([
      'new-server',
      'both',
      'new',
      'old',
      'unknown',
    ])
  })
})

describe('library type filtering and recovery', () => {
  const cases: [LibraryTypeFilter, string[]][] = [
    ['all', ['new', 'both', 'unknown', 'new-server', 'old']],
    ['client', ['new']],
    ['server', ['new-server', 'old']],
    ['both', ['both']],
    ['unknown', ['unknown']],
  ]

  for (const [filter, expected] of cases) {
    test(`${filter} shows the matching mod types`, () => {
      const { store } = setupLibrary()
      store.set(libraryTypeFilterAtom, filter)
      expect(store.get(visibleModsAtom).map((mod) => mod.id)).toEqual(expected)
    })
  }

  test('type, status, search, and sort compose together', () => {
    const { store } = setupLibrary()
    store.set(librarySortAtom, 'installed-desc')
    store.set(libraryStatusFilterAtom, 'enabled')
    store.set(libraryTypeFilterAtom, 'server')
    store.set(librarySearchAtom, 'z')
    expect(store.get(visibleModsAtom).map((mod) => mod.id)).toEqual([
      'new-server',
      'old',
    ])
  })

  test('clearing search leaves filters and selection unchanged', () => {
    const { store } = setupLibrary()
    store.set(librarySearchAtom, 'Zulu')
    store.set(libraryStatusFilterAtom, 'enabled')
    store.set(libraryTypeFilterAtom, 'server')
    store.set(selectedModIdsAtom, new Set(['off-screen']))

    store.set(clearLibrarySearchAtom)

    expect(store.get(librarySearchAtom)).toBe('')
    expect(store.get(libraryStatusFilterAtom)).toBe('enabled')
    expect(store.get(libraryTypeFilterAtom)).toBe('server')
    expect(store.get(selectedModIdsAtom)).toEqual(new Set(['off-screen']))
  })

  test('clearing filters leaves search and selection unchanged', () => {
    const { store } = setupLibrary()
    store.set(librarySearchAtom, 'Zulu')
    store.set(libraryStatusFilterAtom, 'enabled')
    store.set(libraryTypeFilterAtom, 'server')
    store.set(selectedModIdsAtom, new Set(['off-screen']))

    store.set(clearLibraryFiltersAtom)

    expect(store.get(librarySearchAtom)).toBe('Zulu')
    expect(store.get(libraryStatusFilterAtom)).toBe('all')
    expect(store.get(libraryTypeFilterAtom)).toBe('all')
    expect(store.get(selectedModIdsAtom)).toEqual(new Set(['off-screen']))
  })
})

describe('default library store helpers', () => {
  test('locating a mod hidden only by type keeps its matching search and status filters', () => {
    const { store } = setupLibrary()
    store.set(librarySearchAtom, 'Zeta')
    store.set(libraryStatusFilterAtom, 'enabled')
    store.set(libraryTypeFilterAtom, 'client')

    store.set(locateLibraryModAtom, 'new-server')

    expect(store.get(librarySearchAtom)).toBe('Zeta')
    expect(store.get(libraryStatusFilterAtom)).toBe('enabled')
    expect(store.get(libraryTypeFilterAtom)).toBe('all')
    expect(store.get(libraryRevealModIdAtom)).toBe('new-server')
  })

  test('locating a mod clears every filter that hides it', () => {
    const { store } = setupLibrary()
    store.set(librarySearchAtom, 'not found')
    store.set(libraryStatusFilterAtom, 'disabled')
    store.set(libraryTypeFilterAtom, 'client')

    store.set(locateLibraryModAtom, 'new-server')

    expect(store.get(librarySearchAtom)).toBe('')
    expect(store.get(libraryStatusFilterAtom)).toBe('all')
    expect(store.get(libraryTypeFilterAtom)).toBe('all')
  })

  test('locating clears only hiding filters and preserves bulk selection', () => {
    const { store } = setupLibrary()
    store.set(librarySearchAtom, 'not found')
    store.set(libraryStatusFilterAtom, 'disabled')
    store.set(libraryTypeFilterAtom, 'client')
    store.set(selectedModIdsAtom, new Set(['selected-mod']))

    store.set(locateLibraryModAtom, 'new-server')

    expect(store.get(librarySearchAtom)).toBe('')
    expect(store.get(libraryStatusFilterAtom)).toBe('all')
    expect(store.get(libraryTypeFilterAtom)).toBe('all')
    expect(store.get(selectedModIdsAtom)).toEqual(new Set(['selected-mod']))
    expect(store.get(libraryRevealModIdAtom)).toBe('new-server')
  })

  test('setWorkspace prunes selection when a mod disappears', () => {
    const store = getDefaultStore()
    const { workspace } = setupLibrary()
    store.set(selectedModIdsAtom, new Set(['old', 'new']))
    setWorkspace(workspace)

    const updatedWorkspace = structuredClone(workspace)
    updatedWorkspace.modsByLibraryId['lib-example'] =
      updatedWorkspace.modsByLibraryId['lib-example'].filter(
        (mod) => mod.id !== 'new',
      )
    setWorkspace(updatedWorkspace)

    expect(store.get(selectedModIdsAtom)).toEqual(new Set(['old']))
  })

  test('pending tasks make only the active library busy', () => {
    const store = getDefaultStore()
    const { workspace } = setupLibrary()
    setWorkspace(workspace)
    store.set(pendingTasksAtom, [
      pendingTask('active-task', 'lib-example', 'sync-button'),
      pendingTask('other-task', 'lib-other', 'other'),
    ])
    expect(store.get(libraryBusyAtom)).toBe(true)

    store.set(pendingTasksAtom, [
      pendingTask('other-task', 'lib-other', 'other'),
    ])
    expect(store.get(libraryBusyAtom)).toBe(false)

    const otherWorkspace = structuredClone(workspace)
    otherWorkspace.activeLibraryId = 'lib-other'
    otherWorkspace.modsByLibraryId['lib-other'] = []
    setWorkspace(otherWorkspace)
    expect(store.get(libraryBusyAtom)).toBe(true)
  })

  test('interleaved updates stay isolated by task and library', () => {
    const store = getDefaultStore()
    addPendingTask(pendingTask('sync-a', 'lib-a', 'sync-button'))
    addPendingTask(pendingTask('install-b', 'lib-b', 'add-button'))

    expect(
      applyTaskProgress(
        progress({
          taskId: 'sync-a',
          libraryId: 'lib-a',
          sequence: 1,
          operation: 'sync',
          stage: 'sync_deploy',
          percent: 35,
        }),
      ),
    ).toBe(true)
    expect(
      applyTaskProgress(
        progress({
          taskId: 'install-b',
          libraryId: 'lib-b',
          sequence: 0,
          operation: 'forge_install',
          stage: 'forge_download',
          percent: 72,
        }),
      ),
    ).toBe(true)

    expect(store.get(pendingTasksAtom)).toMatchObject([
      {
        taskId: 'sync-a',
        source: 'sync-button',
        operation: 'sync',
        stage: 'sync_deploy',
        percent: 35,
        lastSequence: 1,
      },
      {
        taskId: 'install-b',
        source: 'add-button',
        operation: 'forge_install',
        stage: 'forge_download',
        percent: 72,
        lastSequence: 0,
      },
    ])
  })

  test('ignores unknown, misrouted, duplicate, out-of-order, and terminal updates', () => {
    const store = getDefaultStore()
    addPendingTask(pendingTask('known', 'lib-a', 'sync-button'))
    const first = progress({
      taskId: 'known',
      libraryId: 'lib-a',
      sequence: 3,
      percent: 20,
    })

    expect(applyTaskProgress(progress({ ...first, taskId: 'unknown' }))).toBe(
      false,
    )
    expect(applyTaskProgress(progress({ ...first, libraryId: 'lib-b' }))).toBe(
      false,
    )
    expect(applyTaskProgress(first)).toBe(true)
    expect(applyTaskProgress(first)).toBe(false)
    expect(
      applyTaskProgress(progress({ ...first, sequence: 2, percent: 90 })),
    ).toBe(false)

    expect(
      applyTaskProgress(
        progress({
          ...first,
          sequence: 4,
          kind: 'completed',
          stage: 'task_failed',
          percent: null,
        }),
      ),
    ).toBe(true)
    expect(
      applyTaskProgress(progress({ ...first, sequence: 5, percent: 100 })),
    ).toBe(false)
    expect(store.get(pendingTasksAtom)[0]).toMatchObject({
      percent: null,
      stage: 'task_failed',
      lastSequence: 4,
      terminal: true,
    })
  })

  test('bounds the log tail and ignores late progress after completion clears pending', () => {
    const store = getDefaultStore()
    addPendingTask(pendingTask('logged-task', 'lib-a', 'add-button'))

    for (let sequence = 0; sequence < 25; sequence += 1) {
      applyTaskProgress(
        progress({
          taskId: 'logged-task',
          libraryId: 'lib-a',
          sequence,
          log: { level: 'info', code: `step-${sequence}`, message: 'Updated' },
        }),
      )
    }

    expect(store.get(pendingTasksAtom)[0]?.logTail).toHaveLength(20)
    expect(store.get(pendingTasksAtom)[0]?.logTail[0]?.code).toBe('step-5')

    const unmount = store.sub(pendingTasksAtom, () => {})
    unmount()
    expect(store.get(pendingTasksAtom)[0]?.logTail).toHaveLength(20)

    removePendingTask('logged-task')
    expect(
      applyTaskProgress(
        progress({
          taskId: 'logged-task',
          libraryId: 'lib-a',
          sequence: 26,
        }),
      ),
    ).toBe(false)
    expect(store.get(pendingTasksAtom)).toEqual([])
  })

  test('completion can clear a task when every progress event was lost', () => {
    const store = getDefaultStore()
    addPendingTask(pendingTask('no-progress', 'lib-a', 'sync-button'))

    expect(removePendingTask('no-progress')).toBe(true)
    expect(
      applyTaskProgress(
        progress({
          taskId: 'no-progress',
          libraryId: 'lib-a',
          sequence: 1,
          percent: 50,
        }),
      ),
    ).toBe(false)
    expect(store.get(pendingTasksAtom)).toEqual([])
  })

  test('action loaders follow exact task IDs through completion, rejection, and remount', async () => {
    const store = getDefaultStore()
    addPendingTask({
      taskId: 'unrelated-task',
      libraryId: 'lib-example',
      source: 'other',
    })

    const unmount = store.sub(pendingTasksAtom, () => {})
    unmount()
    const remount = store.sub(pendingTasksAtom, () => {})
    expect(store.get(pendingTasksAtom)).toHaveLength(1)
    remount()

    const completed = await runTrackedCommand({
      isNative: true,
      registerPending: () => {
        addPendingTask({
          taskId: 'fast-sync',
          libraryId: 'lib-example',
          source: 'sync-button',
        })
        return 'fast-sync'
      },
      invoke: async (taskId) => {
        removePendingTask('unrelated-task')
        expect(store.get(pendingTasksAtom)).toEqual([
          pendingTask(taskId, 'lib-example', 'sync-button'),
        ])
        applyTaskProgress(
          progress({
            taskId,
            libraryId: 'lib-example',
            sequence: 0,
            stage: 'sync_deploy',
            percent: 50,
          }),
        )
        expect(store.get(pendingTasksAtom)[0]?.source).toBe('sync-button')
        removePendingTask(taskId)
        return { status: 'ok', data: { accepted: true } }
      },
      clearPending: removePendingTask,
      mockComplete: () => {},
      schedule: () => {},
      onDomainError: () => {},
      onTransportError: () => {},
    })
    expect(completed.accepted).toBe(true)
    expect(store.get(pendingTasksAtom)).toEqual([])

    const rejected = await runTrackedCommand({
      isNative: true,
      registerPending: () => {
        addPendingTask({
          taskId: 'rejected-add',
          libraryId: 'lib-example',
          source: 'add-button',
        })
        return 'rejected-add'
      },
      invoke: async () => ({ status: 'error', error: 'rejected' }),
      clearPending: (taskId) => {
        removePendingTask(taskId)
      },
      mockComplete: () => {},
      schedule: () => {},
      onDomainError: () => {},
      onTransportError: () => {},
    })
    expect(rejected.accepted).toBe(false)
    expect(store.get(pendingTasksAtom)).toEqual([])
  })
})
