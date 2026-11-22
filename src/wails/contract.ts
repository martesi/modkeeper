/*
 * App-facing wire contract.
 *
 * Rust (`backend/models`, `backend/config`) is the authority for every shape
 * here. `frontend/bindings` is machine output from `wails3 generate bindings`;
 * this module is the ONE place the app reads it, and the ONE place the few
 * normalization rules live:
 *
 *   - Wails emits string enums; the wire is a plain string union, so the
 *     app-facing aliases below are unions (object literals like
 *     `{ kind: 'mod' }` stay assignable).
 *   - Wails emits nullable slices; the wire always sends arrays, so the
 *     app-facing shapes expose non-null arrays.
 *   - Wails emits `LibraryEntry` as `any`; the app-facing entry is the
 *     two-variant union the Go `MarshalJSON` actually produces.
 *
 * `src/gen/bindings.ts` (Tauri/Specta) is not a type source for the app. It
 * remains only as the runtime fallback inside `bridge.ts`/`events.ts`.
 */
import type {
  AppSettings as WailsAppSettings,
  ThemeMode as WailsThemeMode,
} from '../../frontend/bindings/github.com/martes/modkeeper/backend/config/models'
import type {
  ForgeDownloadVersionInput as WailsForgeDownloadVersionInput,
  ForgeMatchInstalledModInput as WailsForgeMatchInstalledModInput,
} from '../../frontend/bindings/github.com/martes/modkeeper/backend/forge/models'
import type {
  ActivateLibraryInput as WailsActivateLibraryInput,
  BulkAction as WailsBulkAction,
  BulkUpdateModsInput as WailsBulkUpdateModsInput,
  CreateLibraryInput as WailsCreateLibraryInput,
  DeleteLibraryInput as WailsDeleteLibraryInput,
  ForgeAddonParent as WailsForgeAddonParent,
  ForgeDependency as WailsForgeDependency,
  ForgeDetail as WailsForgeDetail,
  ForgeKind as WailsForgeKind,
  ForgePageInfo as WailsForgePageInfo,
  ForgeSearchItem as WailsForgeSearchItem,
  ForgeSearchPage as WailsForgeSearchPage,
  ForgeSearchResponse as WailsForgeSearchResponse,
  ForgeVersion as WailsForgeVersion,
  ForgeVersionsPage as WailsForgeVersionsPage,
  InstallModArchivesInput as WailsInstallModArchivesInput,
  LibraryWorkspace as WailsLibraryWorkspace,
  ModSource as WailsModSource,
  ModSummary as WailsModSummary,
  ModType as WailsModType,
  OperationAccepted as WailsOperationAccepted,
  RebuildLibraryCacheInput as WailsRebuildLibraryCacheInput,
  RenameLibraryInput as WailsRenameLibraryInput,
  SyncModsInput as WailsSyncModsInput,
  TaskOperation as WailsTaskOperation,
  TaskProgressEvent as WailsTaskProgressEvent,
  TaskProgressKind as WailsTaskProgressKind,
  TaskProgressLevel as WailsTaskProgressLevel,
  TaskProgressLog as WailsTaskProgressLog,
  TaskProgressStage as WailsTaskProgressStage,
  ToolSummary as WailsToolSummary,
} from '../../frontend/bindings/github.com/martes/modkeeper/backend/models/models'

/** The string values of a generated TypeScript enum, minus its zero member. */
type EnumValues<T extends string> = Exclude<`${T}`, ''>

// --- Normalized enum surfaces -------------------------------------------------

export type ThemeMode = EnumValues<WailsThemeMode>
export type AppSettings = Omit<WailsAppSettings, 'theme'> & { theme: ThemeMode }

export type ModType = EnumValues<WailsModType>
export type ModSource = EnumValues<WailsModSource>
export type ForgeKind = EnumValues<WailsForgeKind>
export type BulkAction = EnumValues<WailsBulkAction>

export type TaskOperation = EnumValues<WailsTaskOperation>
export type TaskProgressKind = EnumValues<WailsTaskProgressKind>
export type TaskProgressStage = EnumValues<WailsTaskProgressStage>
export type TaskProgressLevel = EnumValues<WailsTaskProgressLevel>

// --- Normalized models -------------------------------------------------------

export type ToolSummary = WailsToolSummary
export type OperationAccepted = WailsOperationAccepted

export type ModSummary = Omit<
  WailsModSummary,
  'type' | 'source' | 'forgeKind'
> & {
  type: ModType
  source?: ModSource | null
  forgeKind?: ForgeKind | null
}

/**
 * Hand-owned because no bound signature produces it (`LibraryEntry` is `any`).
 * Rust: `backend/models/library.go`.
 */
export type CacheState = 'ready' | 'dirty' | 'rebuilding' | 'failed'

export type CacheStatus = {
  state: CacheState
  message?: string | null
  lastRebuiltAt?: string | null
}

export type LibrarySummary = {
  id: string
  name: string
  gameRoot: string
  libraryRoot: string
  sptVersion?: string | null
  cacheStatus: CacheStatus
  deployStale: boolean
  updatedAt: string
}

export type LibraryStub = {
  path: string
}

/** Rust `LibraryEntry.MarshalJSON`: a readable summary or a path-only stub. */
export type LibraryEntry = LibrarySummary | LibraryStub

export type LibraryWorkspace = Omit<
  WailsLibraryWorkspace,
  'libraries' | 'modsByLibraryId' | 'toolsByLibraryId' | 'settings'
> & {
  libraries: LibraryEntry[]
  modsByLibraryId: Record<string, ModSummary[]>
  toolsByLibraryId: Record<string, ToolSummary[]>
  settings: AppSettings
}

/** Rust: `backend/models/mod.go`. No bound command returns a full `Mod`. */
export type Mod = {
  id: string
  isActive: boolean
  type: ModType
  name: string
  installedAt?: string | null
  version?: string | null
  forgeId?: number | null
  forgeGuid?: string | null
  source: ModSource
  forgeKind?: ForgeKind | null
  forgeVersionId?: number | null
  forgeMetaCachedAt?: string | null
}

// --- Forge -------------------------------------------------------------------

export type ForgePageInfo = WailsForgePageInfo
export type ForgeAddonParent = WailsForgeAddonParent
export type ForgeDependency = WailsForgeDependency

export type ForgeSearchItem = Omit<WailsForgeSearchItem, 'kind'> & {
  kind: ForgeKind
}

export type ForgeSearchPage = Omit<WailsForgeSearchPage, 'items'> & {
  items: ForgeSearchItem[]
}

export type ForgeSearchResponse = Omit<
  WailsForgeSearchResponse,
  'mods' | 'addons'
> & {
  mods: ForgeSearchPage
  addons: ForgeSearchPage
}

export type ForgeDetail = Omit<WailsForgeDetail, 'kind'> & {
  kind: ForgeKind
}

export type ForgeVersion = Omit<WailsForgeVersion, 'kind' | 'dependencies'> & {
  kind: ForgeKind
  dependencies: ForgeDependency[]
}

export type ForgeVersionsPage = Omit<
  WailsForgeVersionsPage,
  'kind' | 'versions'
> & {
  kind: ForgeKind
  versions: ForgeVersion[]
}

// --- Command inputs ----------------------------------------------------------

export type ActivateLibraryInput = WailsActivateLibraryInput
export type BulkUpdateModsInput = Omit<WailsBulkUpdateModsInput, 'action'> & {
  action: BulkAction
}
export type CreateLibraryInput = WailsCreateLibraryInput
export type DeleteLibraryInput = WailsDeleteLibraryInput
export type InstallModArchivesInput = WailsInstallModArchivesInput
export type RebuildLibraryCacheInput = WailsRebuildLibraryCacheInput
export type RenameLibraryInput = WailsRenameLibraryInput
export type SyncModsInput = WailsSyncModsInput

export type ForgeDownloadVersionInput = Omit<
  WailsForgeDownloadVersionInput,
  'kind'
> & { kind: ForgeKind }

export type ForgeMatchInstalledModInput = Omit<
  WailsForgeMatchInstalledModInput,
  'kind'
> & { kind: ForgeKind }

// --- Progress and completion events -----------------------------------------

export type TaskProgressLog = Omit<WailsTaskProgressLog, 'level'> & {
  level: TaskProgressLevel
}

export type TaskProgressEvent = Omit<
  WailsTaskProgressEvent,
  'operation' | 'kind' | 'stage' | 'log'
> & {
  operation: TaskOperation
  kind: TaskProgressKind
  stage: TaskProgressStage
  log: TaskProgressLog | null
}

/**
 * Hand-owned because no bound signature produces it. Rust:
 * `backend/models/error.go` is the authority for the code set and the
 * positional `data` payloads.
 */
export type SError =
  | { code: 'UnsupportedSPTVersion'; data: string }
  | { code: 'ParseError'; data: string }
  | { code: 'IOError'; data: string }
  | { code: 'GameOrServerRunning' }
  | { code: 'ProcessRunning' }
  | { code: 'UnableToDetermineModId' }
  | { code: 'ModNotFound'; data: string }
  | { code: 'FileOrDirectoryNotFound'; data: string }
  | { code: 'FileCollision'; data: string[] }
  | { code: 'Unexpected' }
  | { code: 'UnhandledCompression'; data: string }
  | { code: 'AsyncRuntimeError'; data: string }
  | { code: 'NoActiveLibrary' }
  | { code: 'InvalidLibrary'; data: [string, string] }
  | { code: 'ModIdConflict'; data: [string, string] }
  | { code: 'ConfigSaveFailed'; data: string }
  | { code: 'TaskIdInUse'; data: string }
  | { code: 'LibraryBusy' }

export type Result<T, E = SError> =
  { status: 'ok'; data: T } | { status: 'error'; error: E }

export type ArchiveFailure = {
  archivePath: string
  error: SError
}

export type ModFailure = {
  modId: string
  error: SError
}

/** Rust: `backend/models/workspace.go`. */
export type WorkspaceEvent =
  | {
      type: 'cache_rebuild_completed'
      taskId: string
      libraryId: string
      cacheStatus: CacheStatus
      workspace: LibraryWorkspace
    }
  | {
      type: 'mod_install_completed'
      taskId: string
      libraryId: string
      failures: ArchiveFailure[]
      workspace: LibraryWorkspace
    }
  | {
      type: 'sync_completed'
      taskId: string
      libraryId: string
      failures: ModFailure[]
      workspace: LibraryWorkspace
    }

// --- Command facade ----------------------------------------------------------

/**
 * The bridge command map, typed from the Wails surface instead of the Tauri
 * `typeof commands`. Every method resolves to the shared `{ status, data }` /
 * `{ status, error }` shape the bridge normalizes both transports to.
 */
export interface Commands {
  activateLibrary(
    input: ActivateLibraryInput,
  ): Promise<Result<LibraryWorkspace>>
  applyWindowEffect(isDark: boolean | null): Promise<Result<void>>
  bulkUpdateMods(input: BulkUpdateModsInput): Promise<Result<LibraryWorkspace>>
  createLibrary(input: CreateLibraryInput): Promise<Result<LibraryWorkspace>>
  deleteLibrary(input: DeleteLibraryInput): Promise<Result<LibraryWorkspace>>
  forgeAddonVersions(
    id: number,
    page: number,
  ): Promise<Result<ForgeVersionsPage>>
  forgeDownloadVersion(
    input: ForgeDownloadVersionInput,
  ): Promise<Result<OperationAccepted>>
  forgeMatchInstalledMod(
    input: ForgeMatchInstalledModInput,
  ): Promise<Result<LibraryWorkspace>>
  forgeModDetail(kind: ForgeKind, id: number): Promise<Result<ForgeDetail>>
  forgeModVersions(
    kind: ForgeKind,
    id: number,
    page: number,
  ): Promise<Result<ForgeVersionsPage>>
  forgeSearch(
    query: string,
    modPage: number,
    addonPage: number,
    perPage: number,
  ): Promise<Result<ForgeSearchResponse>>
  getLibraryWorkspace(): Promise<Result<LibraryWorkspace>>
  getSettings(): Promise<Result<AppSettings>>
  installModArchives(
    input: InstallModArchivesInput,
  ): Promise<Result<OperationAccepted>>
  rebuildLibraryCache(
    input: RebuildLibraryCacheInput,
  ): Promise<Result<OperationAccepted>>
  renameLibrary(input: RenameLibraryInput): Promise<Result<LibraryWorkspace>>
  saveSettings(settings: AppSettings): Promise<Result<AppSettings>>
  syncMods(input: SyncModsInput): Promise<Result<OperationAccepted>>
}
