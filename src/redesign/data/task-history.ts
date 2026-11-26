import { getDefaultStore } from 'jotai'
import { atomWithStorage, createJSONStorage } from 'jotai/utils'
import type { TaskOperation, TaskProgressLog } from './redesign-types'
import type { TaskOutcome } from './task-outcome'
import type { SyncCause } from '@/wails/contract'
import { pendingTasksAtom } from '../state/library-state'

export const TASK_HISTORY_LIMIT = 50
export const TASK_HISTORY_LOG_LIMIT = 20

export type TaskHistoryStatus =
  'success' | 'partial_failure' | 'failure' | 'cancelled' | 'unknown'

export type TaskHistoryEntry = {
  taskId: string
  timestamp: string
  operation: TaskOperation | 'unknown'
  libraryId: string
  status: TaskHistoryStatus
  logTail: TaskProgressLog[]
  cause?: SyncCause
}

const SAFE_HISTORY_LOGS: Record<string, TaskProgressLog> = {
  task_completed: {
    level: 'info',
    code: 'task_completed',
    message: 'Operation completed',
  },
  task_partial_failure: {
    level: 'warn',
    code: 'task_partial_failure',
    message: 'Operation completed with some failures',
  },
  task_failed: {
    level: 'error',
    code: 'task_failed',
    message: 'Operation failed',
  },
}

const store = getDefaultStore()
const progressByTaskId = new Map<
  string,
  { operation: TaskOperation | null; logTail: TaskProgressLog[] }
>()

function rememberPendingProgress(): void {
  for (const task of store.get(pendingTasksAtom)) {
    progressByTaskId.delete(task.taskId)
    progressByTaskId.set(task.taskId, {
      operation: task.operation,
      logTail: [...task.logTail],
    })
  }
  while (progressByTaskId.size > 100) {
    const oldestTaskId = progressByTaskId.keys().next().value
    if (oldestTaskId === undefined) break
    progressByTaskId.delete(oldestTaskId)
  }
}

// Retain task operation and safe progress logs until the completion event is recorded.
rememberPendingProgress()
store.sub(pendingTasksAtom, rememberPendingProgress)

const taskHistoryStorage = createJSONStorage<TaskHistoryEntry[]>(
  () => window.localStorage,
  {
    replacer: (key, value) =>
      key === '' ? { version: 1, tasks: normalizeHistory(value) } : value,
    reviver: (key, value) => {
      if (key !== '') return value
      return normalizeHistory(
        isRecord(value) && value.version === 1 ? value.tasks : [],
      )
    },
  },
)

export const taskHistoryAtom = atomWithStorage<TaskHistoryEntry[]>(
  'modkeeper.taskHistory.v1',
  [],
  taskHistoryStorage,
  { getOnInit: true },
)

export function makeTaskHistoryEntry(
  outcome: TaskOutcome,
  input?: {
    operation?: TaskOperation | null
    logTail?: readonly TaskProgressLog[]
    timestamp?: string
  },
): TaskHistoryEntry {
  return (
    normalizeEntry({
      taskId: outcome.taskId,
      timestamp: input?.timestamp ?? new Date().toISOString(),
      operation: input?.operation ?? operationForOutcome(outcome),
      libraryId: outcome.libraryId,
      status: statusForOutcome(outcome),
      logTail: input?.logTail ?? [],
      cause: outcome.kind === 'sync' ? outcome.cause : undefined,
    }) ?? {
      taskId: 'unknown',
      timestamp: new Date().toISOString(),
      operation: 'unknown',
      libraryId: 'unknown',
      status: 'unknown',
      logTail: [],
    }
  )
}

export function appendTaskHistory(
  entry: TaskHistoryEntry,
  existing: readonly TaskHistoryEntry[],
): TaskHistoryEntry[] {
  const normalized = normalizeEntry(entry)
  if (!normalized) return existing.slice(0, TASK_HISTORY_LIMIT)

  return [
    normalized,
    ...existing.filter((item) => item.taskId !== normalized.taskId),
  ]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, TASK_HISTORY_LIMIT)
}

export function recordTaskHistory(
  outcome: TaskOutcome,
  input?: {
    operation?: TaskOperation | null
    logTail?: readonly TaskProgressLog[]
    timestamp?: string
  },
): void {
  const current = store.get(taskHistoryAtom)
  const progress = progressByTaskId.get(outcome.taskId)
  const next = appendTaskHistory(
    makeTaskHistoryEntry(outcome, {
      ...input,
      operation: input?.operation ?? progress?.operation,
      logTail: input?.logTail ?? progress?.logTail,
    }),
    current,
  )
  progressByTaskId.delete(outcome.taskId)
  store.set(taskHistoryAtom, next)
}

export function clearTaskHistory(): void {
  store.set(taskHistoryAtom, [])
}

export function dismissTaskHistory(taskId: string): void {
  const remaining = store
    .get(taskHistoryAtom)
    .filter((entry) => entry.taskId !== taskId)
  store.set(taskHistoryAtom, remaining)
}

function normalizeEntry(value: unknown): TaskHistoryEntry | null {
  if (!isRecord(value)) return null
  const taskId = safeIdentifier(value.taskId)
  const libraryId = safeIdentifier(value.libraryId)
  const timestamp = safeTimestamp(value.timestamp)
  if (!taskId || !libraryId || !timestamp) return null

  return {
    taskId,
    libraryId,
    timestamp,
    operation: isTaskOperation(value.operation) ? value.operation : 'unknown',
    status: isTaskHistoryStatus(value.status) ? value.status : 'unknown',
    logTail: normalizeLogs(value.logTail),
    ...(isSyncCause(value.cause) ? { cause: value.cause } : {}),
  }
}

function normalizeHistory(value: unknown): TaskHistoryEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeEntry)
    .filter((entry): entry is TaskHistoryEntry => entry !== null)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, TASK_HISTORY_LIMIT)
}

function normalizeLogs(value: unknown): TaskProgressLog[] {
  if (!Array.isArray(value)) return []
  return value.slice(-TASK_HISTORY_LOG_LIMIT).flatMap((item) => {
    if (!isRecord(item) || typeof item.code !== 'string') return []
    const safeLog = SAFE_HISTORY_LOGS[item.code]
    return safeLog ? [{ ...safeLog }] : []
  })
}

function statusForOutcome(outcome: TaskOutcome): TaskHistoryStatus {
  if (outcome.kind === 'install') {
    if (outcome.failures.length === 0) return 'success'
    if (outcome.successCount === null) return 'unknown'
    return outcome.successCount > 0 ? 'partial_failure' : 'failure'
  }
  if (outcome.kind === 'sync') {
    return outcome.status
  }
  if (outcome.cacheState === 'ready') return 'success'
  if (outcome.cacheState === 'failed') return 'failure'
  return 'unknown'
}

function operationForOutcome(outcome: TaskOutcome): TaskOperation {
  if (outcome.kind === 'sync') return 'sync'
  if (outcome.kind === 'install') return 'install'
  return 'cache_rebuild'
}

function safeIdentifier(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  ) {
    return null
  }
  return value
}

function safeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    return null
  return new Date(value).toISOString()
}

function isTaskOperation(value: unknown): value is TaskOperation {
  return (
    value === 'sync' ||
    value === 'install' ||
    value === 'forge_install' ||
    value === 'cache_rebuild'
  )
}

function isTaskHistoryStatus(value: unknown): value is TaskHistoryStatus {
  return (
    value === 'success' ||
    value === 'partial_failure' ||
    value === 'failure' ||
    value === 'cancelled' ||
    value === 'unknown'
  )
}

function isSyncCause(value: unknown): value is SyncCause {
  return (
    value === 'discovery' ||
    value === 'initial_persistence' ||
    value === 'deployment' ||
    value === 'final_persistence' ||
    value === 'disk_state_uncertain'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
