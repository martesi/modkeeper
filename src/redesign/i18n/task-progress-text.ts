import { t } from '@lingui/core/macro'
import type { TaskOperation, TaskProgressStage } from '../data/redesign-types'

const operationText: Record<TaskOperation, () => string> = {
  sync: () => t({ id: 'library.task.operation.sync', message: 'Sync' }),
  install: () => t({ id: 'library.task.operation.install', message: 'Import' }),
  forge_install: () =>
    t({ id: 'library.task.operation.forgeInstall', message: 'Forge install' }),
  cache_rebuild: () =>
    t({ id: 'library.task.operation.cacheRebuild', message: 'Cache rebuild' }),
}

const stageText: Record<string, () => string> = {
  task_started: () =>
    t({ id: 'library.task.stage.started', message: 'Starting' }),
  task_completed: () =>
    t({ id: 'library.task.stage.completed', message: 'Finishing' }),
  task_partial_failure: () =>
    t({
      id: 'library.task.stage.partialFailure',
      message: 'Finishing with some errors',
    }),
  task_failed: () =>
    t({ id: 'library.task.stage.failed', message: 'Finishing with an error' }),
  task_cancelled: () =>
    t({ id: 'library.task.stage.cancelled', message: 'Import cancelled' }),
  sync_plan: () =>
    t({ id: 'library.task.stage.syncPlan', message: 'Planning sync' }),
  sync_preflight: () =>
    t({ id: 'library.task.stage.syncPreflight', message: 'Checking files' }),
  sync_cleanup: () =>
    t({ id: 'library.task.stage.syncCleanup', message: 'Cleaning up' }),
  sync_deploy: () =>
    t({ id: 'library.task.stage.syncDeploy', message: 'Deploying files' }),
  sync_persist: () =>
    t({ id: 'library.task.stage.syncPersist', message: 'Saving sync results' }),
  install_archives: () =>
    t({
      id: 'library.task.stage.installArchives',
      message: 'Preparing archives',
    }),
  install_archive_stage: () =>
    t({
      id: 'library.task.stage.installArchive',
      message: 'Installing archive',
    }),
  install_commit: () =>
    t({ id: 'library.task.stage.installCommit', message: 'Finishing import' }),
  forge_metadata: () =>
    t({
      id: 'library.task.stage.forgeMetadata',
      message: 'Reading Forge details',
    }),
  forge_versions: () =>
    t({ id: 'library.task.stage.forgeVersions', message: 'Checking versions' }),
  forge_download: () =>
    t({ id: 'library.task.stage.forgeDownload', message: 'Downloading' }),
  forge_size_verification: () =>
    t({ id: 'library.task.stage.forgeSize', message: 'Verifying download' }),
  forge_parent_validation: () =>
    t({
      id: 'library.task.stage.forgeParent',
      message: 'Checking addon requirements',
    }),
  forge_stage: () =>
    t({ id: 'library.task.stage.forgeStage', message: 'Preparing install' }),
  forge_install: () =>
    t({
      id: 'library.task.stage.forgeInstall',
      message: 'Installing from Forge',
    }),
  cache_normalize: () =>
    t({ id: 'library.task.stage.cacheNormalize', message: 'Preparing cache' }),
  cache_scan: () =>
    t({ id: 'library.task.stage.cacheScan', message: 'Scanning library' }),
  cache_persist: () =>
    t({ id: 'library.task.stage.cachePersist', message: 'Saving cache' }),
}

export const taskProgressText = {
  operation: (operation: TaskOperation) => operationText[operation](),
  stage: (stage: TaskProgressStage) =>
    stageText[stage as keyof typeof stageText]?.() ?? unknownStageText(),
}

function unknownStageText() {
  return t({ id: 'library.task.stage.unknown', message: 'Task update' })
}
