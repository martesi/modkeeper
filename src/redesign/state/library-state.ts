/*
 * Library state atoms (consolidated-spec.md §10 "State").
 *
 * The shapes proven by the 8.2 exit gate are frozen:
 *   - the workspace is a single-writer atom, written only by the repository layer;
 *   - "library busy" is DERIVED from an in-flight fire-and-track task set keyed by libraryId.
 * 8.4 adds the durable view state on top: selection, search, sort, type filter, and the derived
 * visible-mod list the grid renders. Confirmation/form-draft/transient state stays parent-owned.
 *
 * The pending-task set is the one piece of mutable state a plain repository function needs to poke
 * from outside React, so it is written through `getDefaultStore()` here rather than exposing the
 * atom to the repository directly — store access stays in the state layer.
 */
import { atom, getDefaultStore } from 'jotai'
import type {
  LibraryWorkspace,
  LibraryEntry,
  LibrarySummary,
  ModSummary,
  ToolSummary,
  LibraryId,
  ModId,
} from '../data/redesign-types'
import { isLibrarySummary } from '../data/redesign-types'
import { compareByName } from '../shared/utils/sorting'

export const libraryWorkspaceAtom = atom<LibraryWorkspace | null>(null)

export const activeLibraryIdAtom = atom(
  (get) => get(libraryWorkspaceAtom)?.activeLibraryId ?? null,
)

export const activeLibraryAtom = atom<LibrarySummary | null>((get) => {
  const workspace = get(libraryWorkspaceAtom)
  const activeId = workspace?.activeLibraryId
  if (!workspace || !activeId) return null
  const entry = workspace.libraries.find(
    (lib) => isLibrarySummary(lib) && lib.id === activeId,
  )
  return entry && isLibrarySummary(entry) ? entry : null
})

/** Every registered library, readable summaries and path-only stubs alike (C13). */
export const libraryListAtom = atom<LibraryEntry[]>(
  (get) => get(libraryWorkspaceAtom)?.libraries ?? [],
)

export const modListAtom = atom<ModSummary[]>((get) => {
  const workspace = get(libraryWorkspaceAtom)
  const activeId = workspace?.activeLibraryId
  if (!workspace || !activeId) return []
  return workspace.modsByLibraryId[activeId] ?? []
})

/** Executable tools registered on the active library (reference header toolbar). */
export const activeLibraryToolsAtom = atom<ToolSummary[]>((get) => {
  const workspace = get(libraryWorkspaceAtom)
  const activeId = workspace?.activeLibraryId
  if (!workspace || !activeId) return []
  return workspace.toolsByLibraryId[activeId] ?? []
})

// --- Durable view state (§10): selection, search, sort, status filter ---

export const selectedModIdsAtom = atom<ReadonlySet<ModId>>(new Set<ModId>())

export const librarySearchAtom = atom('')

export type LibrarySort =
  | 'name-asc'
  | 'name-desc'
  | 'updated-desc'
  | 'installed-desc'
  | 'installed-asc'
export const librarySortAtom = atom<LibrarySort>('name-asc')

export type LibraryStatusFilter = 'all' | 'enabled' | 'disabled'
export const libraryStatusFilterAtom = atom<LibraryStatusFilter>('all')

/** The mods the grid actually renders: status-filtered, search-filtered, sorted. */
export const visibleModsAtom = atom<ModSummary[]>((get) => {
  const statusFilter = get(libraryStatusFilterAtom)
  const search = get(librarySearchAtom).trim().toLowerCase()
  const sort = get(librarySortAtom)
  return get(modListAtom)
    .filter(
      (mod) =>
        statusFilter === 'all' ||
        mod.isEnabled === (statusFilter === 'enabled'),
    )
    .filter((mod) => search === '' || mod.name.toLowerCase().includes(search))
    .sort((a, b) => {
      if (sort === 'installed-desc' || sort === 'installed-asc') {
        return compareInstallationTime(a, b, sort === 'installed-desc')
      }
      if (sort === 'updated-desc') return b.updatedAt.localeCompare(a.updatedAt)
      return sort === 'name-asc' ? compareByName(a, b) : compareByName(b, a)
    })
})

function compareInstallationTime(
  a: ModSummary,
  b: ModSummary,
  newestFirst: boolean,
): number {
  const aTime = Date.parse(a.installedAt ?? '')
  const bTime = Date.parse(b.installedAt ?? '')
  // Missing or unreadable legacy dates stay last in either direction.
  if (!Number.isFinite(aTime))
    return Number.isFinite(bTime) ? 1 : compareByName(a, b)
  if (!Number.isFinite(bTime)) return -1
  const difference = newestFirst ? bTime - aTime : aTime - bTime
  return difference || compareByName(a, b)
}

/** An accepted-but-not-yet-completed fire-and-track operation. */
export type PendingTask = { taskId: string; libraryId: LibraryId }

export const pendingTasksAtom = atom<PendingTask[]>([])

/** True while any fire-and-track task is in flight for the active library (§10 library-busy). */
export const libraryBusyAtom = atom((get) => {
  const activeId = get(activeLibraryIdAtom)
  if (!activeId) return false
  return get(pendingTasksAtom).some((task) => task.libraryId === activeId)
})

// --- Single-writer helpers used by the repository layer (outside React) ---

const store = getDefaultStore()

export function setWorkspace(workspace: LibraryWorkspace): void {
  store.set(libraryWorkspaceAtom, workspace)
  // Prune the selection to mods that still exist in the active library, so a delete or a library
  // switch can never leave phantom ids behind for the next bulk action.
  const selected = store.get(selectedModIdsAtom)
  if (selected.size === 0) return
  const activeId = workspace.activeLibraryId
  const mods = activeId ? (workspace.modsByLibraryId[activeId] ?? []) : []
  const alive = new Set(mods.map((mod) => mod.id))
  const pruned = new Set([...selected].filter((id) => alive.has(id)))
  if (pruned.size !== selected.size) store.set(selectedModIdsAtom, pruned)
}

export function addPendingTask(task: PendingTask): void {
  store.set(pendingTasksAtom, [...store.get(pendingTasksAtom), task])
}

export function removePendingTask(taskId: string): void {
  store.set(
    pendingTasksAtom,
    store.get(pendingTasksAtom).filter((task) => task.taskId !== taskId),
  )
}
