import { describe, expect, test } from 'bun:test'
import { getDefaultStore } from 'jotai'
import type { TaskProgressLog } from './redesign-types'
import {
  TASK_HISTORY_KEY,
  TASK_HISTORY_LIMIT,
  appendTaskHistory,
  clearTaskHistory,
  loadTaskHistory,
  makeTaskHistoryEntry,
  persistTaskHistory,
  recordTaskHistory,
  taskHistoryAtom,
  type TaskHistoryEntry,
} from './task-history'
import { deriveArchiveOutcome, deriveSyncOutcome } from './task-outcome'
import {
  addPendingTask,
  applyTaskProgress,
  pendingTasksAtom,
  removePendingTask,
} from '../state/library-state'

function memoryStorage(initial?: string) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(TASK_HISTORY_KEY, initial)
  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    removeItem(key: string) {
      values.delete(key)
    },
  }
}

function entry(taskId: string, timestamp: string): TaskHistoryEntry {
  return {
    taskId,
    timestamp,
    operation: 'sync',
    libraryId: 'library-1',
    status: 'success',
    logTail: [],
  }
}

describe('completed task history', () => {
  test('survives a storage reload with only completed summary fields', () => {
    const storage = memoryStorage()
    const outcome = deriveSyncOutcome([], 'library-1', 'task-1')
    const summary = makeTaskHistoryEntry(outcome, {
      timestamp: '2026-11-18T10:00:00.000Z',
      logTail: [
        { level: 'info', code: 'sync_done', message: 'Sync completed' },
      ],
    })

    persistTaskHistory([summary], storage)

    expect(loadTaskHistory(storage)).toEqual([summary])
    expect(JSON.parse(storage.values.get(TASK_HISTORY_KEY) ?? 'null')).toEqual({
      version: 1,
      tasks: [summary],
    })
  })

  test('keeps the newest 50 entries and replaces duplicate task ids', () => {
    let history: TaskHistoryEntry[] = []
    for (let index = 0; index < TASK_HISTORY_LIMIT + 2; index += 1) {
      history = appendTaskHistory(
        entry(`task-${index}`, new Date(2026, 0, index + 1).toISOString()),
        history,
      )
    }
    history = appendTaskHistory(
      entry('task-10', '2026-12-31T00:00:00.000Z'),
      history,
    )

    expect(history).toHaveLength(TASK_HISTORY_LIMIT)
    expect(history[0]?.taskId).toBe('task-10')
    expect(history.filter((item) => item.taskId === 'task-10')).toHaveLength(1)
    expect(history.some((item) => item.taskId === 'task-0')).toBe(false)
  })

  test('retains failure and unknown outcomes without persisting outcome paths', () => {
    const failure = deriveArchiveOutcome(
      [
        {
          archivePath: '/home/bryan/mods/broken.zip',
          error: { code: 'ParseError', data: 'broken archive' },
        },
      ],
      ['/home/bryan/mods/broken.zip'],
      'task-failed',
      'library-1',
    )
    const unknown = deriveArchiveOutcome(
      [
        {
          archivePath: 'C:\\Users\\Bryan\\mods\\unknown.zip',
          error: { code: 'Unexpected' },
        },
      ],
      undefined,
      'task-unknown',
      'library-1',
    )
    const failedSummary = makeTaskHistoryEntry(failure)
    const unknownSummary = makeTaskHistoryEntry(unknown)
    const storage = memoryStorage()

    persistTaskHistory([failedSummary, unknownSummary], storage)

    expect(loadTaskHistory(storage).map(({ status }) => status)).toEqual([
      'failure',
      'unknown',
    ])
    expect(storage.values.get(TASK_HISTORY_KEY)).not.toContain('/home/bryan')
    expect(storage.values.get(TASK_HISTORY_KEY)).not.toContain('C:\\Users')
  })

  test('persists only allowlisted fixed log messages', () => {
    const logs: TaskProgressLog[] = [
      {
        level: 'error',
        code: 'download_failed',
        message:
          'GET https://user:secret@example.test/private?token=abc failed at C:\\Users\\Bryan\\mods\\broken.zip',
      },
      {
        level: 'warn',
        code: 'archive_read',
        message:
          'Could not read /home/bryan/data/file.zip from mods/private/archive.zip',
      },
      {
        level: 'info',
        code: 'cache_source',
        message: 'Source file:///private/cache/job/output.zip was skipped',
      },
      {
        level: 'error',
        code: 'task_failed',
        message: 'Authorization: Bearer FAKE_SECRET /123/private /秘密',
      },
      {
        level: 'info',
        code: 'unknown_unicode_path',
        message: 'File /秘密 was rejected',
      },
    ]
    const summary = entry('task-log', '2026-11-18T10:00:00.000Z')
    summary.logTail = logs
    const storage = memoryStorage()
    persistTaskHistory([summary], storage)
    const content = storage.values.get(TASK_HISTORY_KEY) ?? ''

    expect(content).not.toContain('https://')
    expect(content).not.toContain('user:secret')
    expect(content).not.toContain('C:\\Users')
    expect(content).not.toContain('/home/bryan')
    expect(content).not.toContain('file://')
    expect(content).not.toContain('/private/cache')
    expect(content).not.toContain('Authorization')
    expect(content).not.toContain('FAKE_SECRET')
    expect(content).not.toContain('/123/private')
    expect(content).not.toContain('/秘密')
    expect(content).not.toContain('mods/private/archive.zip')
    expect(loadTaskHistory(storage)[0]?.logTail).toEqual([
      {
        level: 'error',
        code: 'task_failed',
        message: 'Operation failed',
      },
    ])
  })

  test('bounds log count and message lengths', () => {
    const logs = Array.from({ length: 30 }, (_, index) => ({
      level: (index % 2 === 0 ? 'info' : 'error') as 'info' | 'error',
      code: index % 2 === 0 ? 'task_completed' : 'task_failed',
      message: 'x'.repeat(500),
    }))
    const summary = entry('task-log', '2026-11-18T10:00:00.000Z')
    summary.logTail = logs
    const storage = memoryStorage()
    persistTaskHistory([summary], storage)
    const bounded = loadTaskHistory(storage)[0]?.logTail ?? []

    expect(bounded).toHaveLength(20)
    expect(bounded[0]?.code).toBe('task_completed')
    expect(bounded[0]?.message).toBe('Operation completed')
  })

  test('treats malformed, unsupported and unavailable storage as empty', () => {
    const corrupt = memoryStorage('{bad json')
    const unsupported = memoryStorage(JSON.stringify({ version: 9, tasks: [] }))
    const unavailable = {
      getItem() {
        throw new Error('storage disabled')
      },
      setItem() {
        throw new Error('storage disabled')
      },
      removeItem() {
        throw new Error('storage disabled')
      },
    }

    expect(loadTaskHistory(corrupt)).toEqual([])
    expect(loadTaskHistory(unsupported)).toEqual([])
    expect(loadTaskHistory(unavailable)).toEqual([])
    expect(() => persistTaskHistory([], unavailable)).not.toThrow()
  })

  test('clears the versioned history key without throwing', () => {
    const storage = memoryStorage(JSON.stringify({ version: 1, tasks: [] }))

    clearTaskHistory(storage)

    expect(storage.values.has(TASK_HISTORY_KEY)).toBe(false)
  })

  test('records immediate interleaved completions without a mounted panel', () => {
    const store = getDefaultStore()
    const firstTask = 'history-fast-forge'
    const secondTask = 'history-fast-sync'
    clearTaskHistory()

    addPendingTask({
      taskId: firstTask,
      libraryId: 'library-1',
      source: 'other',
    })
    applyTaskProgress({
      taskId: firstTask,
      libraryId: 'library-1',
      operation: 'forge_install',
      sequence: 0,
      kind: 'completed',
      stage: 'task_completed',
      percent: null,
      log: {
        level: 'info',
        code: 'task_completed',
        message: 'Arbitrary secret-bearing completion text',
      },
    })

    addPendingTask({
      taskId: secondTask,
      libraryId: 'library-1',
      source: 'other',
    })
    applyTaskProgress({
      taskId: secondTask,
      libraryId: 'library-1',
      operation: 'sync',
      sequence: 0,
      kind: 'completed',
      stage: 'task_failed',
      percent: null,
      log: {
        level: 'error',
        code: 'task_failed',
        message: 'Another arbitrary completion message',
      },
    })

    removePendingTask(firstTask)
    recordTaskHistory(deriveArchiveOutcome([], [], firstTask, 'library-1'), {
      timestamp: '2026-11-18T10:00:00.000Z',
    })
    removePendingTask(secondTask)
    recordTaskHistory(
      deriveSyncOutcome(
        [{ modId: 'mod-1', error: { code: 'ParseError', data: 'failed' } }],
        'library-1',
        secondTask,
      ),
      { timestamp: '2026-11-18T10:01:00.000Z' },
    )

    const byId = new Map(
      store.get(taskHistoryAtom).map((summary) => [summary.taskId, summary]),
    )
    expect(byId.get(firstTask)).toMatchObject({
      operation: 'forge_install',
      logTail: [{ code: 'task_completed', message: 'Operation completed' }],
    })
    expect(byId.get(secondTask)).toMatchObject({
      operation: 'sync',
      logTail: [{ code: 'task_failed', message: 'Operation failed' }],
    })
    expect(
      store
        .get(pendingTasksAtom)
        .some(
          (task) => task.taskId === firstTask || task.taskId === secondTask,
        ),
    ).toBe(false)

    clearTaskHistory()
  })
})
