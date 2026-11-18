import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createStore, getDefaultStore } from 'jotai'
import { getMockWorkspace } from '../data/example-data'
import type { ModSummary } from '../data/redesign-types'
import {
  clearLibraryFiltersAtom,
  clearLibrarySearchAtom,
  libraryBusyAtom,
  librarySearchAtom,
  librarySortAtom,
  libraryStatusFilterAtom,
  libraryTypeFilterAtom,
  libraryWorkspaceAtom,
  pendingTasksAtom,
  selectedModIdsAtom,
  setWorkspace,
  visibleModsAtom,
  type LibrarySort,
  type LibraryTypeFilter,
} from './library-state'

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
      { taskId: 'active-task', libraryId: 'lib-example' },
      { taskId: 'other-task', libraryId: 'lib-other' },
    ])
    expect(store.get(libraryBusyAtom)).toBe(true)

    store.set(pendingTasksAtom, [
      { taskId: 'other-task', libraryId: 'lib-other' },
    ])
    expect(store.get(libraryBusyAtom)).toBe(false)

    const otherWorkspace = structuredClone(workspace)
    otherWorkspace.activeLibraryId = 'lib-other'
    otherWorkspace.modsByLibraryId['lib-other'] = []
    setWorkspace(otherWorkspace)
    expect(store.get(libraryBusyAtom)).toBe(true)
  })
})
