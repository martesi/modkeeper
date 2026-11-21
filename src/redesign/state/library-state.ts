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
import { atomWithStorage } from 'jotai/utils'
import type {
  LibraryWorkspace,
  LibraryEntry,
  LibrarySummary,
  ModSummary,
  ModType,
  ToolSummary,
  LibraryId,
  ModId,
  TaskOperation,
  TaskProgressEvent,
  TaskProgressLog,
  TaskProgressStage,
} from '../data/redesign-types'
import type { TaskOutcome } from '../data/task-outcome'
import { isLibrarySummary } from '../data/redesign-types'
import { compareByName } from '../shared/utils/sorting'

export const libraryWorkspaceAtom = atom<LibraryWorkspace | null>(null)

export type WorkspaceStatus = 'loading' | 'ready' | 'error'
export const workspaceStatusAtom = atom<WorkspaceStatus>('loading')

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

// --- Durable view state (§10): selection, search, sort, status/type filters ---

export type LibraryViewMode = 'list' | 'grid' | 'icons'

/** Persist the Library section's presentation independently from other sections. */
export const libraryViewModeAtom = atomWithStorage<LibraryViewMode>(
  'modkeeper.library.viewMode',
  'list',
)

export const selectedModIdsAtom = atom<ReadonlySet<ModId>>(new Set<ModId>())

export const librarySearchAtom = atom('')

export type LibrarySort =
  'name-asc' | 'name-desc' | 'updated-desc' | 'installed-desc' | 'installed-asc'
export const librarySortAtom = atom<LibrarySort>('name-asc')

export type LibraryStatusFilter = 'all' | 'enabled' | 'disabled'
export const libraryStatusFilterAtom = atom<LibraryStatusFilter>('all')

export type LibraryTypeFilter = 'all' | ModType
export const libraryTypeFilterAtom = atom<LibraryTypeFilter>('all')

export const clearLibrarySearchAtom = atom(null, (_get, set) => {
  set(librarySearchAtom, '')
})

export const clearLibraryFiltersAtom = atom(null, (_get, set) => {
  set(libraryStatusFilterAtom, 'all')
  set(libraryTypeFilterAtom, 'all')
})

/** The mods the grid actually renders: status/type-filtered, search-filtered, sorted. */
export const visibleModsAtom = atom<ModSummary[]>((get) => {
  const statusFilter = get(libraryStatusFilterAtom)
  const typeFilter = get(libraryTypeFilterAtom)
  const search = get(librarySearchAtom).trim().toLowerCase()
  const sort = get(librarySortAtom)
  return get(modListAtom)
    .filter(
      (mod) =>
        statusFilter === 'all' ||
        mod.isEnabled === (statusFilter === 'enabled'),
    )
    .filter((mod) => typeFilter === 'all' || mod.type === typeFilter)
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

/** The initiating control whose loader should follow a tracked task. */
export type PendingTaskSource = 'sync-button' | 'add-button' | 'other'

/** A task stays tied to its initiating control until its exact taskId completes. */
export type PendingTask = {
  taskId: string
  libraryId: LibraryId
  source: PendingTaskSource
  operation: TaskOperation | null
  stage: TaskProgressStage | null
  percent: number | null
  logTail: TaskProgressLog[]
  lastSequence: number
  terminal: boolean
}

type NewPendingTask = Pick<PendingTask, 'taskId' | 'libraryId' | 'source'> &
  Partial<
    Pick<
      PendingTask,
      | 'operation'
      | 'stage'
      | 'percent'
      | 'logTail'
      | 'lastSequence'
      | 'terminal'
    >
  >

export const pendingTasksAtom = atom<PendingTask[]>([])

export const taskResultAtom = atom<TaskOutcome | null>(null)

/** True while any fire-and-track task is in flight for the active library (§10 library-busy). */
export const libraryBusyAtom = atom((get) => {
  const activeId = get(activeLibraryIdAtom)
  if (!activeId) return false
  return get(pendingTasksAtom).some((task) => task.libraryId === activeId)
})

// --- Single-writer helpers used by the repository layer (outside React) ---

const store = getDefaultStore()
let workspaceVersion = 0

export function setWorkspace(workspace: LibraryWorkspace): void {
  store.set(libraryWorkspaceAtom, workspace)
  workspaceVersion++
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

export function getWorkspaceVersion(): number {
  return workspaceVersion
}

export function setWorkspaceStatus(status: WorkspaceStatus): void {
  store.set(workspaceStatusAtom, status)
}

export function setTaskResult(outcome: TaskOutcome): void {
  store.set(taskResultAtom, outcome)
}

export function clearTaskResult(): void {
  store.set(taskResultAtom, null)
}

export function addPendingTask(task: NewPendingTask): void {
  store.set(pendingTasksAtom, [
    ...store.get(pendingTasksAtom),
    {
      ...task,
      operation: task.operation ?? null,
      stage: task.stage ?? null,
      percent: task.percent ?? null,
      logTail: task.logTail ?? [],
      lastSequence: task.lastSequence ?? -1,
      terminal: task.terminal ?? false,
    },
  ])
}

const TASK_LOG_LIMIT = 20
const TASK_LOG_MESSAGE_LIMIT = 500
const TASK_LOG_CODE_LIMIT = 80

/** Apply only the next update for a registered, non-terminal task. */
export function applyTaskProgress(event: TaskProgressEvent): boolean {
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 0) return false

  let applied = false
  const nextTasks = store.get(pendingTasksAtom).map((task) => {
    if (
      task.taskId !== event.taskId ||
      task.libraryId !== event.libraryId ||
      task.terminal ||
      event.sequence <= task.lastSequence
    ) {
      return task
    }

    applied = true
    const logTail = event.log
      ? [
          ...task.logTail,
          {
            ...event.log,
            code: event.log.code.slice(0, TASK_LOG_CODE_LIMIT),
            message: event.log.message.slice(0, TASK_LOG_MESSAGE_LIMIT),
          },
        ].slice(-TASK_LOG_LIMIT)
      : task.logTail

    return {
      ...task,
      operation: event.operation,
      stage: event.stage,
      percent:
        typeof event.percent === 'number' &&
        Number.isFinite(event.percent) &&
        event.percent >= 0 &&
        event.percent <= 100
          ? event.percent
          : null,
      logTail,
      lastSequence: event.sequence,
      terminal: event.kind === 'completed',
    }
  })

  if (applied) store.set(pendingTasksAtom, nextTasks)
  return applied
}

export function removePendingTask(taskId: string): boolean {
  const current = store.get(pendingTasksAtom)
  const remaining = current.filter((task) => task.taskId !== taskId)
  if (remaining.length === current.length) return false
  store.set(pendingTasksAtom, remaining)
  return true
}

/** Whether any fire-and-track operation is still in flight for a specific library. */
export function isLibraryTaskPending(libraryId: LibraryId): boolean {
  return store
    .get(pendingTasksAtom)
    .some((task) => task.libraryId === libraryId)
}
