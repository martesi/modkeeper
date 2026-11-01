/*
 * Frozen type surface for the redesign (consolidated-spec.md §9).
 *
 * The UI and repositories type against THIS module, never `@gen/bindings` directly, so the redesign
 * has one stable vocabulary even as the generated bindings churn. The generated shapes already match
 * §9 (camelCase via tauri-specta), so we re-export them here rather than redefine — a single source,
 * no drift. The UI consumes serialized output; deserialization types also accept legacy aliases
 * and omitted defaults that do not describe returned state. Names/ids are the spec's; the mapping
 * to generated names lives only in this file.
 */
import type {
  LibraryWorkspace_Serialize as LibraryWorkspace,
  LibraryEntry_Serialize as LibraryEntry,
  LibrarySummary_Serialize as LibrarySummary,
  LibraryStub,
  ModSummary_Serialize as ModSummary,
  ModType_Serialize as ModType,
  ToolSummary_Serialize as ToolSummary,
  CacheStatus_Serialize as CacheStatus,
  CacheState,
  AppSettings_Serialize as AppSettings,
  OperationAccepted,
  WorkspaceEvent_Serialize as WorkspaceEvent,
  SError,
} from '@gen/bindings'

export type {
  LibraryWorkspace,
  LibraryEntry,
  LibrarySummary,
  LibraryStub,
  ModSummary,
  ModType,
  ToolSummary,
  CacheStatus,
  CacheState,
  AppSettings,
  OperationAccepted,
  WorkspaceEvent,
  SError,
}

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
