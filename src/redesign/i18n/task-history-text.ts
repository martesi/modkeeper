import { t } from '@lingui/core/macro'
import type { TaskOperation } from '../data/redesign-types'
import type { SyncCause } from '@/wails/contract'

const operationText: Record<TaskOperation, () => string> = {
  sync: () => t({ id: 'library.task.history.operation.sync', message: 'Sync' }),
  install: () =>
    t({ id: 'library.task.history.operation.upload', message: 'Upload' }),
  forge_install: () =>
    t({
      id: 'library.task.history.operation.download',
      message: 'Download',
    }),
  cache_rebuild: () =>
    t({
      id: 'library.task.history.operation.cacheRebuild',
      message: 'Cache rebuild',
    }),
}

export const taskHistoryText = {
  title: () =>
    t({ id: 'library.task.history.heading', message: 'Recent tasks' }),
  label: () =>
    t({ id: 'library.task.history.label', message: 'Recent task history' }),
  clear: () => t({ id: 'library.task.history.clearAll', message: 'Clear all' }),
  dismiss: (operation: string, library: string) =>
    t({
      id: 'library.task.history.dismiss',
      message: `Dismiss ${operation} for ${library}`,
    }),
  empty: () =>
    t({ id: 'library.task.history.emptyState', message: 'No events yet.' }),
  operation: (operation: TaskOperation | 'unknown') =>
    operation === 'unknown'
      ? t({
          id: 'library.task.history.operation.unknown',
          message: 'Unknown task',
        })
      : operationText[operation](),
  status: (
    status: 'success' | 'partial_failure' | 'failure' | 'cancelled' | 'unknown',
  ) => {
    switch (status) {
      case 'success':
        return t({
          id: 'library.task.history.status.success',
          message: 'Completed',
        })
      case 'partial_failure':
        return t({
          id: 'library.task.history.status.partialFailure',
          message: 'Completed with errors',
        })
      case 'failure':
        return t({
          id: 'library.task.history.status.failure',
          message: 'Failed',
        })
      case 'cancelled':
        return t({
          id: 'library.task.history.status.cancelled',
          message: 'Cancelled',
        })
      case 'unknown':
        return t({
          id: 'library.task.history.status.unknown',
          message: 'Outcome unknown',
        })
    }
  },
  syncCause: (cause: SyncCause) => {
    switch (cause) {
      case 'discovery':
        return t({
          id: 'library.sync.cause.discovery',
          message: 'Could not discover the game layout. Check the game folder.',
        })
      case 'initial_persistence':
        return t({
          id: 'library.sync.cause.initialPersistence',
          message:
            'Could not save the dirty state before sync. Check library storage.',
        })
      case 'deployment':
        return t({
          id: 'library.sync.cause.deployment',
          message: 'Deployment failed. Check the game and library files.',
        })
      case 'final_persistence':
        return t({
          id: 'library.sync.cause.finalPersistence',
          message: 'Could not save the sync state. Check library storage.',
        })
    }
  },
  log: (count: number) =>
    t({ id: 'library.task.history.log', message: `Show log (${count})` }),
}
