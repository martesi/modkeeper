/*
 * Library repository (consolidated-spec.md §10).
 *
 * The UI calls these functions, never `@gen/bindings` directly. Every function is real-first /
 * mock-fallback: it tries the generated Tauri command, and if no backend is present (browser
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
import { isTauri } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { commands, events } from '@gen/bindings'
import type { Result } from '@gen/bindings'
import type {
  LibraryWorkspace,
  LibrarySummary,
  LibraryId,
  ModId,
  OperationAccepted,
  WorkspaceEvent,
  SError,
} from './redesign-types'
import { isLibrarySummary } from './redesign-types'
import { resolveCommandError } from '../shared/hooks/use-command-error'
import { getMockWorkspace, setMockWorkspace } from './example-data'
import { stripSupportedArchiveExtension } from '../shared/utils/file-filters'
import {
  libraryWorkspaceAtom,
  setWorkspace,
  addPendingTask,
  removePendingTask,
} from '../state/library-state'
import { setSettings } from '../state/settings-state'
import { getDefaultStore } from 'jotai'

// --- The single persistent event bus (§10) ---

type WorkspaceEventHandler = (event: WorkspaceEvent) => void

const subscribers = new Set<WorkspaceEventHandler>()
let realSourceConnected = false

/**
 * Dispatch a completion event — from the real Tauri listener OR the mock emitter, identically.
 * Clears the in-flight task (drops library-busy) first, then fans out to subscribers.
 */
function dispatchWorkspaceEvent(event: WorkspaceEvent): void {
  removePendingTask(event.taskId)
  subscribers.forEach((handler) => handler(event))
}

/** Register a workspace-event subscriber. Returns an unsubscribe. */
export function listenWorkspaceEvent(
  handler: WorkspaceEventHandler,
): () => void {
  subscribers.add(handler)
  return () => subscribers.delete(handler)
}

/**
 * Connect the real Tauri event source into the bus, once. Called by redesign-initializers. In the
 * browser prototype there is no source — the mock emitter feeds `dispatchWorkspaceEvent` directly.
 */
export async function initWorkspaceEventBus(): Promise<void> {
  if (realSourceConnected) return
  realSourceConnected = true
  if (!isTauri()) return
  try {
    await events.workspaceEvent.listen((event) =>
      dispatchWorkspaceEvent(event.payload),
    )
  } catch (error) {
    // MOCK-FALLBACK: event source unavailable — the mock emitter still drives the bus.
    console.warn('[redesign] workspace event source unavailable', error)
  }
}

function surfaceError(error: SError): void {
  toast.error(resolveCommandError(error))
  console.error('[redesign] command error', error)
}

/** The workspace the UI currently shows — what a rejected command resolves with, unchanged. */
function currentWorkspace(): LibraryWorkspace {
  return getDefaultStore().get(libraryWorkspaceAtom) ?? getMockWorkspace()
}

/** Apply a workspace from the backend to the atom (and mirror settings, which ride it — T1). */
function applyWorkspace(workspace: LibraryWorkspace): LibraryWorkspace {
  setWorkspace(workspace)
  setSettings(workspace.settings)
  return workspace
}

/**
 * The PLAIN command shape (§10): try the real call; a domain rejection is toasted and leaves the
 * workspace as-is; a transport failure falls through to the mock mutation.
 */
async function plainCommand(
  label: string,
  real: () => Promise<Result<LibraryWorkspace, SError>>,
  mock: (workspace: LibraryWorkspace) => void,
): Promise<LibraryWorkspace> {
  try {
    if (isTauri()) {
      const result = await real()
      if (result.status === 'ok') return applyWorkspace(result.data)
      surfaceError(result.error)
      return currentWorkspace()
    }
  } catch (error) {
    // MOCK-FALLBACK: backend unavailable — apply the change to the fixture instead.
    console.warn(`[redesign] ${label} failed, using mock`, error)
  }
  // MOCK-FALLBACK: no backend present (browser prototype).
  const workspace = structuredClone(getMockWorkspace())
  mock(workspace)
  setMockWorkspace(workspace)
  setWorkspace(workspace)
  return workspace
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
  real: (taskId: string) => Promise<Result<OperationAccepted, SError>>,
  mockComplete: (taskId: string) => void,
): Promise<OperationAccepted> {
  const taskId = crypto.randomUUID()
  addPendingTask({ taskId, libraryId })
  try {
    if (isTauri()) {
      const result = await real(taskId)
      if (result.status === 'ok') return result.data
      removePendingTask(taskId)
      surfaceError(result.error)
      return { accepted: false }
    }
  } catch (error) {
    // MOCK-FALLBACK: backend unavailable — simulate the accept + completion locally.
    console.warn(`[redesign] ${label} failed, using mock`, error)
  }
  // MOCK-FALLBACK: no backend present — accept now, emit the completion after a short delay.
  setTimeout(() => mockComplete(taskId), 700)
  return { accepted: true }
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

export async function loadLibraryWorkspace(): Promise<LibraryWorkspace> {
  try {
    if (isTauri()) {
      const result = await commands.getLibraryWorkspace()
      if (result.status === 'ok') return applyWorkspace(result.data)
      surfaceError(result.error)
    }
  } catch (error) {
    // MOCK-FALLBACK: backend unavailable — load the fixture instead of crashing.
    console.warn('[redesign] getLibraryWorkspace failed, using mock', error)
  }
  // MOCK-FALLBACK: no backend present (browser prototype).
  return applyWorkspace(getMockWorkspace())
}

// --- Library CRUD (PLAIN) ---

export async function createLibrary(input: {
  gameRoot: string
  libraryRoot?: string
  name?: string
}): Promise<LibraryWorkspace> {
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
        sptVersion: null,
        cacheStatus: { state: 'ready', message: null, lastRebuiltAt: null },
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
): Promise<LibraryWorkspace> {
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
}): Promise<LibraryWorkspace> {
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
}): Promise<LibraryWorkspace> {
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
        workspace.activeLibraryId = null
      }
    },
  )
}

// --- Mod state (PLAIN, delta 3 — never deploys, only marks the deploy stale, C3) ---

export async function bulkUpdateMods(input: {
  libraryId: LibraryId
  modIds: ModId[]
  action: 'enable' | 'disable' | 'delete'
}): Promise<LibraryWorkspace> {
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
}): Promise<LibraryWorkspace> {
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
    (taskId) => commands.rebuildLibraryCache({ taskId, libraryId }),
    (taskId) => {
      const workspace = structuredClone(getMockWorkspace())
      const library = findSummary(workspace, libraryId)
      const cacheStatus = {
        state: 'ready' as const,
        message: null,
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
}): Promise<OperationAccepted> {
  const { libraryId, paths } = input
  return fireAndTrack(
    'installModArchives',
    libraryId,
    (taskId) =>
      commands.installModArchives({ taskId, libraryId, archivePaths: paths }),
    (taskId) => {
      const workspace = structuredClone(getMockWorkspace())
      const mods = (workspace.modsByLibraryId[libraryId] ??= [])
      for (const path of paths) {
        const fileName = path.split(/[\\/]/).pop() ?? path
        mods.push({
          id: crypto.randomUUID(),
          libraryId,
          name: stripSupportedArchiveExtension(fileName),
          type: 'unknown',
          isEnabled: workspace.settings.enableModsOnInstall,
          sourcePath: path,
          installedPath: null,
          updatedAt: new Date().toISOString(),
        })
      }
      const library = findSummary(workspace, libraryId)
      if (library) library.deployStale = true
      setMockWorkspace(workspace)
      dispatchWorkspaceEvent({
        type: 'mod_install_completed',
        taskId,
        libraryId,
        failures: [],
        workspace,
      })
    },
  )
}
