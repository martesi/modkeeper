import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { X } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { retryFailedArchives } from '../data/library-repository'
import { cancelInstallTask } from '../../wails/bridge'
import {
  archiveBasename,
  canRetryFailedArchives,
  parseForgeParentGateFailure,
} from '../data/task-outcome'
import { isLibrarySummary } from '../data/redesign-types'
import type { LibraryEntry } from '../data/redesign-types'
import type { PendingTask } from '../state/library-state'
import type {
  CacheTaskOutcome,
  InstallTaskOutcome,
  TaskOutcome,
} from '../data/task-outcome'
import { libraryText } from '../i18n/library-text'
import { resolveCommandErrorSummary } from '../shared/hooks/use-command-error'
import { registryText } from '../i18n/registry-text'
import { TaskHistoryPanel } from './task-history-panel'
import {
  registrySearchAtom,
  selectedRegistryItemAtom,
} from '../state/registry-state'
import {
  activeLibraryIdAtom,
  clearTaskResult,
  libraryBusyAtom,
  taskResultAtom,
  libraryListAtom,
  pendingTasksAtom,
} from '../state/library-state'

export function TaskCenterPanel() {
  const outcome = useAtomValue(taskResultAtom)
  const activeLibraryId = useAtomValue(activeLibraryIdAtom)
  const busy = useAtomValue(libraryBusyAtom)
  const navigate = useNavigate()
  const setSearch = useSetAtom(registrySearchAtom)
  const setSelectedRegistryItem = useSetAtom(selectedRegistryItemAtom)

  function openForgeParent(parentId: number | null, parentGuid: string) {
    if (parentId !== null) {
      setSearch('')
      setSelectedRegistryItem({ kind: 'mod', id: parentId })
    } else {
      setSearch(parentGuid)
      setSelectedRegistryItem(null)
    }
    void navigate({ to: '/registry' })
  }

  if (!outcome) {
    return (
      <>
        <TaskProgressBanner />
        <TaskHistoryPanel />
      </>
    )
  }

  const retryAllowed = canRetryFailedArchives(outcome, activeLibraryId, busy)
  const hasForgeParentGateFailure =
    outcome.kind === 'install' &&
    outcome.failures.some((failure) =>
      Boolean(parseForgeParentGateFailure(failure.error)),
    )

  return (
    <>
      <TaskProgressBanner />
      <section
        aria-label={libraryText.taskResultLabel()}
        aria-live="polite"
        className="mb-3 flex max-h-64 flex-col gap-2 overflow-hidden rounded-lg border border-border bg-card p-3 text-[13px] text-foreground"
        role="status"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 overflow-y-auto">
            <OutcomeDetails
              outcome={outcome}
              onOpenForgeParent={openForgeParent}
            />
          </div>
          <button
            aria-label={libraryText.dismissTaskResult()}
            className="shrink-0 rounded p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={clearTaskResult}
            title={libraryText.dismissTaskResult()}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        {outcome.kind === 'install' &&
          outcome.failedPaths.some(Boolean) &&
          !hasForgeParentGateFailure && (
            <button
              aria-label={libraryText.retryFailedArchives()}
              className="h-8 w-fit rounded-sm border border-border px-2.5 text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!retryAllowed}
              onClick={() => void retryFailedArchives(outcome)}
              title={retryAllowed ? undefined : libraryText.retryUnavailable()}
              type="button"
            >
              {libraryText.retryFailedArchives()}
            </button>
          )}
      </section>
      <TaskHistoryPanel />
    </>
  )
}

function TaskProgressBanner() {
  const tasks = useAtomValue(pendingTasksAtom)
  const libraries = useAtomValue(libraryListAtom)

  return <ActiveTasks tasks={tasks} libraries={libraries} />
}

function ActiveTasks({
  tasks,
  libraries,
}: {
  tasks: PendingTask[]
  libraries: LibraryEntry[]
}) {
  const [cancelling, setCancelling] = useState<string[]>([])
  if (tasks.length === 0) return null

  return (
    <section
      aria-label={libraryText.activeTasksLabel()}
      className="mb-3 rounded-lg border border-border bg-card p-3 text-[13px] text-foreground"
    >
      <h2 className="sr-only">{libraryText.activeTasksLabel()}</h2>
      <ul className="space-y-3">
        {tasks.map((task) => {
          const library = libraries.find(
            (entry) => isLibrarySummary(entry) && entry.id === task.libraryId,
          )
          const libraryName =
            library && isLibrarySummary(library)
              ? library.name
              : libraryText.unknownTaskLibrary()
          const operation = libraryText.taskOperation(task.operation)
          const stage = libraryText.taskStage(task.stage)

          return (
            <li className="min-w-0" key={task.taskId}>
              <div className="flex items-center gap-3">
                <TaskProgressRing
                  label={libraryText.taskProgressAccessibleLabel(
                    operation,
                    libraryName,
                  )}
                  percent={task.percent}
                  stage={stage}
                />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-medium">
                    {operation} · {libraryText.taskLibrary(libraryName)}
                  </h3>
                  <p className="truncate text-muted-foreground">{stage}</p>
                </div>
                {task.percent !== null && (
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {libraryText.taskProgressPercentage(task.percent)}
                  </span>
                )}
                {task.operation === 'install' && (
                  <button
                    aria-label={libraryText.cancelTask()}
                    className="h-7 rounded border border-border px-2 text-xs hover:bg-muted disabled:opacity-50"
                    disabled={cancelling.includes(task.taskId)}
                    onClick={() => {
                      setCancelling((current) => [...current, task.taskId])
                      void cancelInstallTask(task.taskId, task.libraryId).catch(
                        () =>
                          setCancelling((current) =>
                            current.filter((id) => id !== task.taskId),
                          ),
                      )
                    }}
                    type="button"
                  >
                    {libraryText.cancelTask()}
                  </button>
                )}
              </div>
              {task.logTail.length > 0 && (
                <details className="ml-8 mt-1">
                  <summary className="w-fit cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
                    {libraryText.taskLogLabel(task.logTail.length)}
                  </summary>
                  <ol className="mk-scrollbar mt-1 max-h-28 space-y-1 overflow-y-auto pl-4 pr-1">
                    {task.logTail.map((log, index) => (
                      <li
                        className="break-words text-muted-foreground"
                        key={`${log.code}-${index}`}
                      >
                        {log.level !== 'info' && (
                          <span
                            className={
                              log.level === 'error'
                                ? 'font-medium text-destructive'
                                : 'font-medium'
                            }
                          >
                            {log.level === 'error'
                              ? libraryText.taskLogError()
                              : libraryText.taskLogWarning()}
                            {': '}
                          </span>
                        )}
                        {log.message}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function TaskProgressRing({
  label,
  percent,
  stage,
}: {
  label: string
  percent: number | null
  stage: string
}) {
  const circumference = 2 * Math.PI * 8

  return (
    <div
      aria-label={label}
      aria-live="off"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={
        percent === null ? stage : libraryText.taskProgressValue(stage, percent)
      }
      className="size-5 shrink-0 text-primary"
      role="progressbar"
    >
      <svg
        aria-hidden="true"
        className={`size-5 ${percent === null ? 'animate-spin' : '-rotate-90'}`}
        viewBox="0 0 20 20"
      >
        <circle
          className="text-muted-foreground/30"
          cx="10"
          cy="10"
          fill="none"
          r="8"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle
          cx="10"
          cy="10"
          fill="none"
          r="8"
          stroke="currentColor"
          strokeDasharray={
            percent === null
              ? `${circumference * 0.28} ${circumference * 0.72}`
              : circumference
          }
          strokeDashoffset={
            percent === null ? undefined : circumference * (1 - percent / 100)
          }
          strokeLinecap="round"
          strokeWidth="2"
        />
      </svg>
    </div>
  )
}

function OutcomeDetails({
  outcome,
  onOpenForgeParent,
}: {
  outcome: TaskOutcome
  onOpenForgeParent: (parentId: number | null, parentGuid: string) => void
}) {
  if (outcome.kind === 'install') {
    return (
      <InstallDetails outcome={outcome} onOpenForgeParent={onOpenForgeParent} />
    )
  }
  if (outcome.kind === 'sync') {
    const visibleFailures = outcome.failures
    return (
      <>
        <h2 className="font-medium">
          {outcome.succeeded
            ? libraryText.syncSucceeded()
            : libraryText.syncFailed()}
        </h2>
        {visibleFailures.length > 0 && (
          <ul className="mt-1 list-inside list-disc text-muted-foreground">
            {visibleFailures.map((failure, index) => (
              <li className="break-words" key={`${failure.modId}-${index}`}>
                {resolveCommandErrorSummary(failure.error)}
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  return <CacheDetails outcome={outcome} />
}

function InstallDetails({
  outcome,
  onOpenForgeParent,
}: {
  outcome: InstallTaskOutcome
  onOpenForgeParent: (parentId: number | null, parentGuid: string) => void
}) {
  const uniqueFailures = uniqueArchiveFailures(outcome)
  const visibleFailures = uniqueFailures
  const title =
    outcome.successCount !== null && outcome.submittedCount !== null
      ? libraryText.installImported(
          outcome.successCount,
          outcome.submittedCount,
        )
      : outcome.failedPaths.length > 0
        ? libraryText.installFailedCount(outcome.failedPaths.length)
        : libraryText.installCompleted()

  return (
    <>
      <h2 className="font-medium">{title}</h2>
      {visibleFailures.length > 0 && (
        <>
          <h3 className="mt-1 text-muted-foreground">
            {libraryText.failedArchives()}
          </h3>
          <ul className="mt-1 space-y-1">
            {visibleFailures.map((failure) => (
              <li className="min-w-0" key={failure.path}>
                <p
                  className="truncate font-medium"
                  title={archiveBasename(failure.path)}
                >
                  {boundedText(
                    archiveBasename(failure.path) ||
                      libraryText.unknownArchive(),
                    100,
                  )}
                </p>
                <p className="break-words text-muted-foreground">
                  {formatFailure(failure.error)}
                </p>
                {parseForgeParentGateFailure(failure.error) && (
                  <button
                    type="button"
                    className="mt-1 h-7 rounded-sm border border-border px-2 text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={() => {
                      const parentFailure = parseForgeParentGateFailure(
                        failure.error,
                      )
                      if (!parentFailure) return
                      onOpenForgeParent(
                        parentFailure.kind === 'missing'
                          ? parentFailure.parentId
                          : null,
                        parentFailure.parentGuid,
                      )
                    }}
                  >
                    {registryText.parentGateSearch()}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {outcome.failedPaths.length > 0 && (
        <details className="mt-1">
          <summary className="w-fit cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
            {libraryText.fullPaths()}
          </summary>
          <ul className="mk-scrollbar mt-1 max-h-24 space-y-1 overflow-y-auto pr-1">
            {outcome.failedPaths.map((path, index) => (
              <li
                className="break-all font-mono text-xs text-muted-foreground"
                key={`${path}-${index}`}
              >
                {path || libraryText.unknownArchive()}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

function formatFailure(error: InstallTaskOutcome['failures'][number]['error']) {
  const parentFailure = parseForgeParentGateFailure(error)
  if (!parentFailure) return resolveCommandErrorSummary(error)
  if (parentFailure.kind === 'missing') {
    return registryText.errorParentMissing(
      `${parentFailure.parentId} (${parentFailure.parentGuid})`,
    )
  }
  if (parentFailure.kind === 'missing-version') {
    return registryText.errorParentVersionMissing(parentFailure.parentGuid)
  }
  return registryText.errorParentMismatch(
    parentFailure.parentGuid,
    parentFailure.constraint,
    parentFailure.installedVersion,
  )
}

function CacheDetails({ outcome }: { outcome: CacheTaskOutcome }) {
  const stateText =
    outcome.cacheState === 'failed'
      ? libraryText.cacheRebuildFailed()
      : outcome.cacheState === 'ready'
        ? libraryText.cacheStateReady()
        : outcome.cacheState === 'dirty'
          ? libraryText.cacheStateDirty()
          : libraryText.cacheStateRebuilding()

  return (
    <>
      <h2 className="font-medium">{stateText}</h2>
      {outcome.message && (
        <p className="break-words text-muted-foreground">
          <span className="font-medium">{libraryText.cacheDiagnostic()}: </span>
          {boundedText(outcome.message, 300)}
        </p>
      )}
    </>
  )
}

function uniqueArchiveFailures(outcome: InstallTaskOutcome) {
  const seenPaths = new Set<string>()
  return outcome.failures.filter((failure) => {
    if (seenPaths.has(failure.path)) return false
    seenPaths.add(failure.path)
    return true
  })
}

function boundedText(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) return value
  return `${value.slice(0, maximumLength - 1).trimEnd()}…`
}
