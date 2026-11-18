import { t } from '@lingui/core/macro'
import type { TaskOperation } from '../data/redesign-types'

const operationText: Record<TaskOperation, () => string> = {
  sync: () => t({ id: 'library.task.history.operation.sync', message: 'Sync' }),
  install: () =>
    t({ id: 'library.task.history.operation.install', message: 'Import' }),
  forge_install: () =>
    t({
      id: 'library.task.history.operation.forgeInstall',
      message: 'Forge install',
    }),
  cache_rebuild: () =>
    t({
      id: 'library.task.history.operation.cacheRebuild',
      message: 'Cache rebuild',
    }),
}

export const taskHistoryText = {
  title: (count: number) =>
    t({ id: 'library.task.history.title', message: `Recent tasks (${count})` }),
  label: () =>
    t({ id: 'library.task.history.label', message: 'Recent task history' }),
  clear: () =>
    t({ id: 'library.task.history.clear', message: 'Clear history' }),
  empty: () =>
    t({ id: 'library.task.history.empty', message: 'No completed tasks yet.' }),
  operation: (operation: TaskOperation | 'unknown') =>
    operation === 'unknown'
      ? t({
          id: 'library.task.history.operation.unknown',
          message: 'Unknown task',
        })
      : operationText[operation](),
  status: (status: 'success' | 'partial_failure' | 'failure' | 'unknown') => {
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
      case 'unknown':
        return t({
          id: 'library.task.history.status.unknown',
          message: 'Outcome unknown',
        })
    }
  },
  log: (count: number) =>
    t({ id: 'library.task.history.log', message: `Show log (${count})` }),
}
