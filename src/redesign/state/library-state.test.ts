import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { getMockWorkspace } from '../data/example-data'
import type { ModSummary } from '../data/redesign-types'
import {
  librarySearchAtom,
  librarySortAtom,
  libraryStatusFilterAtom,
  libraryWorkspaceAtom,
  visibleModsAtom,
  type LibrarySort,
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
      sourcePath: null,
      installedPath: null,
      installedAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    },
    {
      id: 'new',
      libraryId,
      name: 'Alpha',
      type: 'client',
      isEnabled: false,
      sourcePath: null,
      installedPath: null,
      installedAt: '2026-02-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    },
    {
      id: 'unknown',
      libraryId,
      name: 'Legacy',
      type: 'unknown',
      isEnabled: true,
      sourcePath: null,
      installedPath: null,
      installedAt: null,
      updatedAt: '',
    },
  ]
  workspace.activeLibraryId = libraryId
  workspace.modsByLibraryId[libraryId] = mods
  const store = createStore()
  store.set(libraryWorkspaceAtom, workspace)
  return { store, mods }
}

describe('library sorting', () => {
  const cases: [LibrarySort, string[]][] = [
    ['installed-desc', ['new', 'old', 'unknown']],
    ['installed-asc', ['old', 'new', 'unknown']],
    ['updated-desc', ['old', 'new', 'unknown']],
    ['name-asc', ['new', 'unknown', 'old']],
    ['name-desc', ['old', 'unknown', 'new']],
  ]
  for (const [sort, expected] of cases) {
    test(`${sort} orders mods independently of other dates`, () => {
      const { store, mods } = setupLibrary()
      store.set(librarySortAtom, sort)
      expect(store.get(visibleModsAtom).map((mod) => mod.id)).toEqual(expected)
      expect(mods.map((mod) => mod.id)).toEqual(['old', 'new', 'unknown'])
    })
  }

  test('installation sorting still respects search and enabled filters', () => {
    const { store } = setupLibrary()
    store.set(librarySortAtom, 'installed-desc')
    store.set(libraryStatusFilterAtom, 'enabled')
    expect(store.get(visibleModsAtom).map((mod) => mod.id)).toEqual([
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
    for (const sort of ['installed-asc', 'installed-desc'] as const) {
      store.set(librarySortAtom, sort)
      expect(store.get(visibleModsAtom).map((mod) => mod.id)).toEqual([
        'new',
        'old',
        'unknown',
      ])
    }
  })
})
