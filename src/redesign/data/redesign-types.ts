/*
 * Frozen type surface for the redesign (consolidated-spec.md §9).
 *
 * The UI and repositories type against THIS module, never the generated bindings directly, so the
 * redesign has one stable vocabulary. `@/wails/contract` is the single source: it owns the Wails
 * normalization (string unions, non-null arrays, `LibraryEntry`) and hand-owned app shapes.
 * Names here are the spec's; the aliases below preserve the existing vocabulary.
 */
import type { LibraryEntry, LibrarySummary } from '@/wails/contract'

export type {
  LibraryWorkspace,
  LibraryEntry,
  LibrarySummary,
  DeploymentMethod,
  TargetRuntime,
  SetDeploymentPolicyInput,
  LibraryStub,
  ModSummary,
  ModType,
  ToolSummary,
  CacheStatus,
  CacheState,
  AppSettings,
  BulkAction as BulkModAction,
  OperationAccepted,
  WorkspaceEvent,
  TaskOperation,
  TaskProgressEvent,
  TaskProgressKind,
  TaskProgressLog,
  TaskProgressStage,
  SError,
  ArchiveFailure,
  ModFailure,
} from '@/wails/contract'

export type LibraryId = string
export type ModId = string
export type ToolId = string

/**
 * A registered library is either a readable summary (has `id`) or a path-only stub (has only
 * `path`). The stub is never dropped from the list (C13); this guard splits the two at render time.
 */
export function isLibrarySummary(entry: LibraryEntry): entry is LibrarySummary {
  return 'id' in entry
}
