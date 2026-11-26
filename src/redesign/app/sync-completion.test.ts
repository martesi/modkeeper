import { getDefaultStore } from 'jotai'
import { beforeEach, expect, test } from 'vitest'
import type { WorkspaceEvent } from '../data/redesign-types'
import { clearTaskHistory, taskHistoryAtom } from '../data/task-history'
import { clearTaskResult, taskResultAtom } from '../state/library-state'
import { handleWorkspaceEvent } from './redesign-initializers'

beforeEach(() => {
  clearTaskHistory()
  clearTaskResult()
})

test.each([
  ['failure', 'discovery'],
  ['failure', 'initial_persistence'],
  ['failure', 'final_persistence'],
  ['cancelled', undefined],
] as const)('sync completion publishes %s with cause %s', (status, cause) => {
  const event = {
    type: 'sync_completed',
    taskId: 'task',
    libraryId: 'library',
    failures: [{ modId: 'mod', error: { code: 'Unexpected' } }],
    status,
    cause,
    workspace: {},
  } as WorkspaceEvent
  handleWorkspaceEvent(event)
  const store = getDefaultStore()
  expect(store.get(taskResultAtom)).toMatchObject({
    status,
    cause: cause ?? null,
    failures: [{ modId: 'mod' }],
  })
  expect(store.get(taskHistoryAtom)[0]).toMatchObject({
    status,
    ...(cause ? { cause } : {}),
  })
})
