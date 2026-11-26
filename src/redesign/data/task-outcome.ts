import type {
  ArchiveFailure,
  CacheStatus,
  ModFailure,
  SError,
  SyncStatus,
  SyncCause,
} from '@/wails/contract'

export type ArchiveTaskFailure = { path: string; error: SError }
export type SyncTaskFailure = { modId: string; error: SError }

export type ForgeParentGateFailure =
  | { kind: 'missing'; parentId: number; parentGuid: string }
  | { kind: 'missing-version'; parentGuid: string }
  | {
      kind: 'mismatch'
      parentGuid: string
      constraint: string
      installedVersion: string
    }

type TaskIdentity = { taskId: string; libraryId: string }

export type InstallTaskOutcome = TaskIdentity & {
  kind: 'install'
  failures: ArchiveTaskFailure[]
  failedPaths: string[]
  submittedCount: number | null
  successCount: number | null
}

export type SyncTaskOutcome = TaskIdentity & {
  kind: 'sync'
  failures: SyncTaskFailure[]
  succeeded: boolean
  status: SyncStatus | 'unknown'
  cause: SyncCause | null
}

export type CacheTaskOutcome = TaskIdentity & {
  kind: 'cache'
  cacheState: CacheStatus['state']
  message: string | null
}

export type TaskOutcome =
  InstallTaskOutcome | SyncTaskOutcome | CacheTaskOutcome

export function parseForgeParentGateFailure(
  error: SError,
): ForgeParentGateFailure | null {
  if (error.code !== 'ParseError' || typeof error.data !== 'string') return null

  const missing = error.data.match(
    /^Forge addon requires installed parent (\d+) \(([^)]+)\)$/,
  )
  if (missing) {
    const parentId = Number(missing[1])
    if (Number.isSafeInteger(parentId)) {
      return { kind: 'missing', parentId, parentGuid: missing[2] }
    }
  }

  const missingVersion = error.data.match(
    /^Installed Forge parent (.+) has no recorded version$/,
  )
  if (missingVersion) {
    return { kind: 'missing-version', parentGuid: missingVersion[1] }
  }

  const mismatch = error.data.match(
    /^Forge addon requires parent (.+?) at (.+), installed version is (.+)$/,
  )
  if (mismatch) {
    return {
      kind: 'mismatch',
      parentGuid: mismatch[1],
      constraint: mismatch[2],
      installedVersion: mismatch[3],
    }
  }

  return null
}

export function archiveBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

export function deriveArchiveOutcome(
  failures: readonly ArchiveFailure[],
  submittedPaths: readonly string[] | undefined,
  taskId: string,
  libraryId: string,
): InstallTaskOutcome {
  const normalizedFailures = failures.map(({ archivePath, error }) => ({
    path: archivePath,
    error,
  }))
  const failedPaths = [...new Set(normalizedFailures.map(({ path }) => path))]
  const submittedCount = submittedPaths?.length ?? null

  // Count failures against submitted OCCURRENCES, not unique paths. A duplicate submission can
  // fail twice; one submitted path can never account for two failures.
  const submittedOccurrences = new Map<string, number>()
  for (const path of submittedPaths ?? []) {
    submittedOccurrences.set(path, (submittedOccurrences.get(path) ?? 0) + 1)
  }
  const failureOccurrences = new Map<string, number>()
  for (const { path } of normalizedFailures) {
    failureOccurrences.set(path, (failureOccurrences.get(path) ?? 0) + 1)
  }
  const metadataIsConsistent =
    submittedPaths !== undefined &&
    [...failureOccurrences].every(
      ([path, count]) => (submittedOccurrences.get(path) ?? 0) >= count,
    )

  return {
    kind: 'install',
    taskId,
    libraryId,
    failures: normalizedFailures,
    failedPaths,
    submittedCount,
    successCount: metadataIsConsistent
      ? submittedPaths.length - normalizedFailures.length
      : null,
  }
}

export function deriveSyncOutcome(
  failures: readonly ModFailure[],
  libraryId: string,
  taskId: string,
  status: SyncStatus,
  cause: SyncCause | null,
): SyncTaskOutcome {
  const safeStatus =
    status === 'success' ||
    status === 'partial_failure' ||
    status === 'failure' ||
    status === 'cancelled'
      ? status
      : 'unknown'
  return {
    kind: 'sync',
    taskId,
    libraryId,
    failures: failures.map(({ modId, error }) => ({ modId, error })),
    status: safeStatus,
    cause,
    succeeded: safeStatus === 'success',
  }
}

export function deriveCacheOutcome(
  cacheStatus: CacheStatus,
  libraryId: string,
  taskId: string,
): CacheTaskOutcome {
  return {
    kind: 'cache',
    taskId,
    libraryId,
    cacheState: cacheStatus.state,
    message: cacheStatus.message ?? null,
  }
}

export function canRetryFailedArchives(
  outcome: TaskOutcome,
  activeLibraryId: string | null,
  busy: boolean,
): outcome is InstallTaskOutcome {
  return (
    outcome.kind === 'install' &&
    outcome.libraryId === activeLibraryId &&
    !busy &&
    outcome.failedPaths.some((path) => path.length > 0)
  )
}
