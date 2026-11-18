import { atom, getDefaultStore } from 'jotai'
import type { TaskOperation, TaskProgressLog } from './redesign-types'
import type { TaskOutcome } from './task-outcome'
import { pendingTasksAtom } from '../state/library-state'

export const TASK_HISTORY_KEY = 'modkeeper.taskHistory.v1'
export const TASK_HISTORY_LIMIT = 50
export const TASK_HISTORY_LOG_LIMIT = 20

export type TaskHistoryStatus =
  'success' | 'partial_failure' | 'failure' | 'unknown'

export type TaskHistoryEntry = {
  taskId: string
  timestamp: string
  operation: TaskOperation | 'unknown'
  libraryId: string
  status: TaskHistoryStatus
  logTail: TaskProgressLog[]
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type HistoryEnvelope = {
  version: 1
  tasks: TaskHistoryEntry[]
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

rememberPendingProgress()
store.sub(pendingTasksAtom, rememberPendingProgress)

export function loadTaskHistory(
  storage = localStorageOrNull(),
): TaskHistoryEntry[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(TASK_HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.tasks)
    ) {
      return []
    }
    return parsed.tasks
      .map(normalizeEntry)
      .filter((entry): entry is TaskHistoryEntry => entry !== null)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, TASK_HISTORY_LIMIT)
  } catch {
    return []
  }
}

export const taskHistoryAtom = atom<TaskHistoryEntry[]>(loadTaskHistory())

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

export function persistTaskHistory(
  entries: readonly TaskHistoryEntry[],
  storage = localStorageOrNull(),
): void {
  if (!storage) return
  try {
    const tasks = entries
      .map(normalizeEntry)
      .filter((entry): entry is TaskHistoryEntry => entry !== null)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, TASK_HISTORY_LIMIT)
    const envelope: HistoryEnvelope = { version: 1, tasks }
    storage.setItem(TASK_HISTORY_KEY, JSON.stringify(envelope))
  } catch {
    // Storage can be disabled or full; history remains available for this session.
  }
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
  persistTaskHistory(next)
}

export function clearTaskHistory(storage = localStorageOrNull()): void {
  try {
    storage?.removeItem(TASK_HISTORY_KEY)
  } catch {
    // Keep the in-memory control usable when storage is unavailable.
  }
  store.set(taskHistoryAtom, [])
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
  }
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
    if (outcome.succeeded) return 'success'
    return outcome.failures.length > 0 ? 'failure' : 'unknown'
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

function localStorageOrNull(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
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
    value === 'unknown'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
