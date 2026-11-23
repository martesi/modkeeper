/*
 * Library repository (consolidated-spec.md §10).
 *
 * The UI calls these functions, never the generated bindings directly. Every function is real-first /
 * mock-fallback: it tries the generated Wails command, and if no backend is present (browser
 * prototype) or the transport fails (backend killed), it falls back to `example-data.ts`. Every
 * fallback is tagged `MOCK-FALLBACK` so it is a single grep target that goes to zero once the
 * backend covers it.
 *
 * Two repository SHAPES exist, frozen by the 8.2 gate:
 *   - PLAIN (bulkUpdateMods and the library CRUD): awaited, returns the updated workspace, local
 *     per-click pending only. A domain rejection is toasted and resolves with the workspace
 *     unchanged — dialog/caller state stays stable (§10 error handling).
 *   - FIRE-AND-TRACK (rebuildLibraryCache / installModArchives / syncMods): mint a client taskId,
 *     register the pending task BEFORE invoking, resolve with an accept; the OUTCOME arrives later
 *     as a WorkspaceEvent matched by taskId.
 * Both feed one single persistent event bus; the bus dispatches by taskId and clears library-busy.
 */
import { toast } from 'sonner'
import { commands, events } from '@/wails'
import { hasNativeRuntime } from '@/wails/runtime'
import { createInMemoryWailsMock, installWailsMock } from '@/wails/mock'
import type {
  LibraryWorkspace,
  LibrarySummary,
  LibraryId,
  ModId,
  BulkModAction,
  OperationAccepted,
  WorkspaceEvent,
  TaskProgressEvent,
  SError,
} from './redesign-types'
import { isLibrarySummary } from './redesign-types'
import { resolveCommandError } from '../shared/hooks/use-command-error'
import { commonText } from '../i18n/common-text'
import { libraryText } from '../i18n/library-text'
import {
  createRetryableConnection,
  runPlainCommand,
  runTrackedCommand,
} from './runtime-boundary'
import type { CommandResult } from './runtime-boundary'
import {
  emptyWorkspace,
  getMockWorkspace,
  setMockWorkspace,
} from './example-data'
import { stripSupportedArchiveExtension } from '../shared/utils/file-filters'
import {
  activeLibraryIdAtom,
  libraryBusyAtom,
  libraryWorkspaceAtom,
  type PendingTaskSource,
  getWorkspaceVersion,
  setWorkspace,
  addPendingTask,
  removePendingTask,
  applyTaskProgress,
  isLibraryTaskPending,
  setWorkspaceStatus,
} from '../state/library-state'
import type { WorkspaceReadGuard } from './workspace-recovery'
import { canRetryFailedArchives } from './task-outcome'
import type { InstallTaskOutcome } from './task-outcome'
import { setSettings } from '../state/settings-state'
import { getDefaultStore } from 'jotai'

type TaskProgressE2eFixture = {
  registerTask: (taskId: string, libraryId: LibraryId) => Promise<void>
  emit: (event: Parameters<typeof events.taskProgress.emit>[0]) => Promise<void>
  clearTask: (taskId: string) => void
}

declare global {
  interface Window {
    __MK_TASK_PROGRESS_E2E__?: TaskProgressE2eFixture
  }
}

// --- The single persistent event bus (§10) ---

type WorkspaceEventHandler = (
  event: WorkspaceEvent,
  submittedPaths?: readonly string[],
) => void

const subscribers = new Set<WorkspaceEventHandler>()
const submittedArchivePathsByTaskId = new Map<string, string[]>()
const connectWorkspaceEvents = createRetryableConnection((error) => {
  console.error('[redesign] workspace event source unavailable', error)
})
const connectTaskProgressEvents = createRetryableConnection((error) => {
  console.error('[redesign] task progress event source unavailable', error)
})

/**
 * Dispatch a completion event from the Wails event bridge or mock emitter, identically.
 * Clears the in-flight task (drops library-busy) first, then fans out to subscribers.
 */
function dispatchWorkspaceEvent(event: WorkspaceEvent): void {
  if (!removePendingTask(event.taskId)) return
  const submittedPaths = submittedArchivePathsByTaskId.get(event.taskId)
  submittedArchivePathsByTaskId.delete(event.taskId)
  applyWorkspace(event.workspace)
  subscribers.forEach((handler) => handler(event, submittedPaths))
}

/** Dispatch a progress event from the real listener or a deterministic UI fixture. */
function dispatchTaskProgressEvent(event: TaskProgressEvent): void {
  applyTaskProgress(event)
}

/** Register a workspace-event subscriber. Returns an unsubscribe. */
export function listenWorkspaceEvent(
  handler: WorkspaceEventHandler,
): () => void {
  subscribers.add(handler)
  return () => subscribers.delete(handler)
}

/**
 * Connect the native Wails event source into the bus, once. Called by redesign-initializers. In the
 * browser prototype there is no source — the mock emitter feeds `dispatchWorkspaceEvent` directly.
 */
export function ensureWorkspaceEventBus(): Promise<boolean> {
  if (!hasNativeRuntime()) return Promise.resolve(true)
  return Promise.all([
    connectWorkspaceEvents(() =>
      events.workspaceEvent.listen((event) =>
        dispatchWorkspaceEvent(event.payload as WorkspaceEvent),
      ),
    ),
    connectTaskProgressEvents(() =>
      events.taskProgress.listen((event) =>
        dispatchTaskProgressEvent(event.payload),
      ),
    ),
  ]).then(([workspaceReady, progressReady]) => workspaceReady && progressReady)
}

export function initWorkspaceEventBus(): Promise<boolean> {
  return ensureWorkspaceEventBus()
}

if (
  typeof window !== 'undefined' &&
  (import.meta.env.VITE_E2E_TASK_PROGRESS === '1' ||
    import.meta.env.VITE_E2E_MOCK === '1')
) {
  // Serve-mode browser E2E has no native runtime: install the in-memory Wails
  // mock so the event bus subscribes and the fixture emits over one bus.
  if (!hasNativeRuntime()) installWailsMock(createInMemoryWailsMock())
  window.__MK_TASK_PROGRESS_E2E__ = {
    async registerTask(taskId, libraryId) {
      if (!(await ensureWorkspaceEventBus())) {
        throw new Error('Task progress listener is unavailable')
      }
      addPendingTask({ taskId, libraryId, source: 'sync-button' })
    },
    async emit(event) {
      if (!(await ensureWorkspaceEventBus())) {
        throw new Error('Task progress listener is unavailable')
      }
      await events.taskProgress.emit(event)
    },
    clearTask(taskId) {
      removePendingTask(taskId)
    },
  }
}

function surfaceError(error: SError): void {
  toast.error(resolveCommandError(error))
  console.error('[redesign] command error', error)
}

function surfaceTransportError(label: string, error: unknown): void {
  toast.error(commonText.backendUnavailable())
  console.error(`[redesign] ${label} transport failure`, error)
}

/** The workspace the UI currently shows — what a rejected command resolves with, unchanged. */
function currentWorkspace(): LibraryWorkspace {
  return getDefaultStore().get(libraryWorkspaceAtom) ?? emptyWorkspace()
}

/** Apply a workspace from the backend to the atom (and mirror settings, which ride it — T1). */
function applyWorkspace(workspace: LibraryWorkspace): LibraryWorkspace {
  setWorkspace(workspace)
  setSettings(workspace.settings)
  return workspace
}

/**
 * The PLAIN command shape (§10): Wails failures leave the current workspace as-is. Only the
 * browser prototype clones and mutates its fixture.
 */
export type CommandOutcome<T> =
  { status: 'success'; workspace: T } | { status: 'failure'; workspace: T }

async function plainCommand(
  label: string,
  real: () => Promise<CommandResult<LibraryWorkspace, SError>>,
  mock: (workspace: LibraryWorkspace) => void,
): Promise<CommandOutcome<LibraryWorkspace>> {
  let failed = false
  const workspace = await runPlainCommand({
    isNative: hasNativeRuntime(),
    invoke: real,
    mock: () => {
      const workspace = structuredClone(getMockWorkspace())
      mock(workspace)
      setMockWorkspace(workspace)
      applyWorkspace(workspace)
      return workspace
    },
    apply: applyWorkspace,
    onDomainError: (error) => {
      failed = true
      surfaceError(error)
    },
    onTransportError: (error) => {
      failed = true
      surfaceTransportError(label, error)
    },
    current: currentWorkspace,
  })

  if (failed) return { status: 'failure', workspace }
  return { status: 'success', workspace }
}

/**
 * The FIRE-AND-TRACK command shape (§7e/C15): client-minted taskId, pending task registered BEFORE
 * invoking so the completion event can never race ahead of a handler. The invoke result is the
 * ACCEPT; the outcome arrives on the bus. A sync validation rejection has no event coming, so the
 * pending task is cleared here.
 */
async function fireAndTrack(
  label: string,
  libraryId: LibraryId,
  source: PendingTaskSource,
  real: (taskId: string) => Promise<CommandResult<OperationAccepted, SError>>,
  mockComplete: (taskId: string) => void,
  onTaskRegistered?: (taskId: string) => void,
): Promise<OperationAccepted> {
  const wails = hasNativeRuntime()
  return runTrackedCommand({
    isNative: wails,
    ensureReady: ensureWorkspaceEventBus,
    onNotReady: () => toast.error(libraryText.taskUpdatesUnavailable()),
    invoke: real,
    registerPending: () => {
      const taskId = crypto.randomUUID()
      addPendingTask({ taskId, libraryId, source })
      onTaskRegistered?.(taskId)
      return taskId
    },
    canStart: () => !isLibraryTaskPending(libraryId),
    onBusy: () => toast.error(libraryText.libraryBusy()),
    clearPending: (taskId) => {
      removePendingTask(taskId)
      submittedArchivePathsByTaskId.delete(taskId)
    },
    mockComplete,
    schedule: (callback) => setTimeout(callback, 700),
    onDomainError: surfaceError,
    onTransportError: (error) => {
      console.warn(
        `[redesign] ${label} transport failed; outcome may be unknown`,
        error,
      )
      toast.error(libraryText.taskOutcomeUnknown(), {
        action: {
          label: commonText.refresh(),
          onClick: () => void loadLibraryWorkspace(),
        },
      })
    },
  })
}

function findSummary(
  workspace: LibraryWorkspace,
  libraryId: LibraryId,
): LibrarySummary | undefined {
  const entry = workspace.libraries.find(
    (lib) => isLibrarySummary(lib) && lib.id === libraryId,
  )
  return entry && isLibrarySummary(entry) ? entry : undefined
}

// --- Workspace load ---

export async function loadLibraryWorkspace(
  recoveryGuard?: WorkspaceReadGuard,
): Promise<LibraryWorkspace | null> {
  const guard: WorkspaceReadGuard = recoveryGuard ?? {
    isActive: () => true,
    isCurrent: () => true,
    onApplied: () => {},
  }
  const versionAtStart = getWorkspaceVersion()
  const isCurrent = () =>
    guard.isCurrent() && versionAtStart === getWorkspaceVersion()
  if (!isCurrent()) {
    if (guard.isActive()) setWorkspaceStatus('ready')
    return null
  }

  setWorkspaceStatus('loading')
  let failed = false
  let superseded = false
  const workspace = await runPlainCommand({
    isNative: hasNativeRuntime(),
    invoke: () => commands.getLibraryWorkspace(),
    mock: getMockWorkspace,
    apply: applyWorkspace,
    applyMock: true,
    onApplied: guard.onApplied,
    onStale: () => {
      superseded = true
      if (guard.isActive()) setWorkspaceStatus('ready')
    },
    onDomainError: (error) => {
      failed = true
      surfaceError(error)
    },
    onTransportError: (error) => {
      failed = true
      surfaceTransportError('getLibraryWorkspace', error)
    },
    current: currentWorkspace,
    isCurrent,
  })

  if (!guard.isActive()) return null
  if (superseded) return null
  if (failed) {
    setWorkspaceStatus('error')
    return null
  }
  setWorkspaceStatus('ready')
  return workspace
}

// --- Library CRUD (PLAIN) ---

export async function createLibrary(input: {
  gameRoot: string
  libraryRoot?: string
  name?: string
}): Promise<CommandOutcome<LibraryWorkspace>> {
  return plainCommand(
    'createLibrary',
    () =>
      commands.createLibrary({
        gameRoot: input.gameRoot,
        libraryRoot: input.libraryRoot ?? null,
        name: input.name ?? null,
      }),
    (workspace) => {
      const id = crypto.randomUUID()
      const name =
        input.name ??
        input.gameRoot
          .replace(/[\\/]+$/, '')
          .split(/[\\/]/)
          .pop() ??
        'New Library'
      workspace.libraries.push({
        id,
        name,
        gameRoot: input.gameRoot,
        libraryRoot: input.libraryRoot ?? `${input.gameRoot}/.mod_keeper`,
        cacheStatus: { state: 'ready' },
        deployStale: false,
        updatedAt: new Date().toISOString(),
      })
      workspace.modsByLibraryId[id] = []
      workspace.toolsByLibraryId[id] = []
      workspace.activeLibraryId = id
    },
  )
}

export async function activateLibrary(
  libraryId: LibraryId,
): Promise<CommandOutcome<LibraryWorkspace>> {
  return plainCommand(
    'activateLibrary',
    () => commands.activateLibrary({ libraryId }),
    (workspace) => {
      if (findSummary(workspace, libraryId))
        workspace.activeLibraryId = libraryId
    },
  )
}

export async function renameLibrary(input: {
  libraryId: LibraryId
  name: string
}): Promise<CommandOutcome<LibraryWorkspace>> {
  return plainCommand(
    'renameLibrary',
    () => commands.renameLibrary(input),
    (workspace) => {
      const library = findSummary(workspace, input.libraryId)
      if (library) {
        library.name = input.name
        library.updatedAt = new Date().toISOString()
      }
    },
  )
}

export async function deleteLibrary(input: {
  libraryId: LibraryId
  deleteFiles: boolean
}): Promise<CommandOutcome<LibraryWorkspace>> {
  return plainCommand(
    'deleteLibrary',
    () => commands.deleteLibrary(input),
    (workspace) => {
      // A path-only stub has no id, so its registered path doubles as the removal handle (C13).
      workspace.libraries = workspace.libraries.filter((lib) =>
        isLibrarySummary(lib)
          ? lib.id !== input.libraryId
          : lib.path !== input.libraryId,
      )
      delete workspace.modsByLibraryId[input.libraryId]
      delete workspace.toolsByLibraryId[input.libraryId]
      if (workspace.activeLibraryId === input.libraryId) {
        delete workspace.activeLibraryId
      }
    },
  )
}

// --- Mod state (PLAIN, delta 3 — never deploys, only marks the deploy stale, C3) ---

export async function bulkUpdateMods(input: {
  libraryId: LibraryId
  modIds: ModId[]
  action: BulkModAction
}): Promise<CommandOutcome<LibraryWorkspace>> {
  return plainCommand(
    'bulkUpdateMods',
    () => commands.bulkUpdateMods(input),
    (workspace) => {
      const ids = new Set(input.modIds)
      const mods = workspace.modsByLibraryId[input.libraryId] ?? []
      if (input.action === 'delete') {
        workspace.modsByLibraryId[input.libraryId] = mods.filter(
          (mod) => !ids.has(mod.id),
        )
      } else {
        const enabled = input.action === 'enable'
        for (const mod of mods) {
          if (ids.has(mod.id)) {
            mod.isEnabled = enabled
            mod.updatedAt = new Date().toISOString()
          }
        }
      }
      const library = findSummary(workspace, input.libraryId)
      if (library) library.deployStale = true
    },
  )
}

/** One code path (§10): a single toggle is a one-element bulk update. */
export async function toggleModStatus(input: {
  libraryId: LibraryId
  modId: ModId
  enabled: boolean
}): Promise<CommandOutcome<LibraryWorkspace>> {
  return bulkUpdateMods({
    libraryId: input.libraryId,
    modIds: [input.modId],
    action: input.enabled ? 'enable' : 'disable',
  })
}

// --- Fire-and-track operations (§7e) ---

export async function syncMods(
  libraryId: LibraryId,
): Promise<OperationAccepted> {
  return fireAndTrack(
    'syncMods',
    libraryId,
    'sync-button',
    (taskId) => commands.syncMods({ taskId, libraryId }),
    (taskId) => {
      const workspace = structuredClone(getMockWorkspace())
      const library = findSummary(workspace, libraryId)
      // Sync deploys and clears the stale flag.
      if (library) library.deployStale = false
      setMockWorkspace(workspace)
      dispatchWorkspaceEvent({
        type: 'sync_completed',
        taskId,
        libraryId,
        failures: [],
        workspace,
      })
    },
  )
}

export async function rebuildLibraryCache(
  libraryId: LibraryId,
): Promise<OperationAccepted> {
  return fireAndTrack(
    'rebuildLibraryCache',
    libraryId,
    'other',
    (taskId) => commands.rebuildLibraryCache({ taskId, libraryId }),
    (taskId) => {
      const workspace = structuredClone(getMockWorkspace())
      const library = findSummary(workspace, libraryId)
      const cacheStatus = {
        state: 'ready' as const,
        lastRebuiltAt: new Date().toISOString(),
      }
      if (library) library.cacheStatus = cacheStatus
      setMockWorkspace(workspace)
      dispatchWorkspaceEvent({
        type: 'cache_rebuild_completed',
        taskId,
        libraryId,
        cacheStatus,
        workspace,
      })
    },
  )
}

export async function installModArchives(input: {
  libraryId: LibraryId
  paths: string[]
  source?: PendingTaskSource
}): Promise<OperationAccepted> {
  const { libraryId, paths, source = 'other' } = input
  return fireAndTrack(
    'installModArchives',
    libraryId,
    source,
    (taskId) =>
      commands.installModArchives({ taskId, libraryId, archivePaths: paths }),
    (taskId) => {
      const workspace = structuredClone(getMockWorkspace())
      const mods = (workspace.modsByLibraryId[libraryId] ??= [])
      const fixture = browserInstallFixture()
      const failedPath = fixture ? paths.at(-1) : undefined
      const successfulPaths = failedPath
        ? paths.filter((path) => path !== failedPath)
        : paths
      for (const path of successfulPaths) {
        const fileName = path.split(/[\\/]/).pop() ?? path
        mods.push({
          id: crypto.randomUUID(),
          libraryId,
          name: stripSupportedArchiveExtension(fileName),
          type: 'unknown',
          isEnabled: workspace.settings.enableModsOnInstall,
          sourcePath: path,
          installedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      }
      const library = findSummary(workspace, libraryId)
      if (library && successfulPaths.length > 0) library.deployStale = true
      if (fixture === 'install-failure-inactive') {
        const otherLibrary = workspace.libraries.find(
          (entry) => isLibrarySummary(entry) && entry.id !== libraryId,
        )
        if (otherLibrary && isLibrarySummary(otherLibrary)) {
          workspace.activeLibraryId = otherLibrary.id
        }
      }
      setMockWorkspace(workspace)
      dispatchWorkspaceEvent({
        type: 'mod_install_completed',
        taskId,
        libraryId,
        failures: failedPath
          ? [
              {
                archivePath: failedPath,
                error: {
                  code: 'ParseError',
                  data: 'Browser fixture simulated an archive parse failure.',
                },
              },
            ]
          : [],
        workspace,
      })
    },
    (taskId) => submittedArchivePathsByTaskId.set(taskId, [...paths]),
  )
}

export function retryFailedArchives(
  outcome: InstallTaskOutcome,
): Promise<OperationAccepted> {
  const store = getDefaultStore()
  if (
    !canRetryFailedArchives(
      outcome,
      store.get(activeLibraryIdAtom),
      store.get(libraryBusyAtom),
    )
  ) {
    return Promise.resolve({ accepted: false })
  }

  const paths = [
    ...new Set(outcome.failedPaths.filter((path) => path.length > 0)),
  ]
  // Keep the failed result visible until a new completion replaces it: a listener/busy/domain
  // rejection means no retry started, and the user still needs the failed paths.
  return installModArchives({ libraryId: outcome.libraryId, paths })
}

function browserInstallFixture():
  'install-failure' | 'install-failure-inactive' | null {
  if (!import.meta.env.DEV) return null
  const fixture = new URLSearchParams(window.location.search).get('fixture')
  if (fixture === 'install-failure' || fixture === 'install-failure-inactive') {
    return fixture
  }
  return null
}
