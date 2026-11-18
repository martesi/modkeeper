import { useAtomValue } from 'jotai'
import { X } from 'lucide-react'
import { retryFailedArchives } from '../data/library-repository'
import { archiveBasename, canRetryFailedArchives } from '../data/task-outcome'
import type {
  CacheTaskOutcome,
  InstallTaskOutcome,
  TaskOutcome,
} from '../data/task-outcome'
import { libraryText } from '../i18n/library-text'
import { resolveCommandErrorSummary } from '../shared/hooks/use-command-error'
import {
  activeLibraryIdAtom,
  clearTaskResult,
  libraryBusyAtom,
  taskResultAtom,
} from '../state/library-state'

export function TaskResults() {
  const outcome = useAtomValue(taskResultAtom)
  const activeLibraryId = useAtomValue(activeLibraryIdAtom)
  const busy = useAtomValue(libraryBusyAtom)

  if (!outcome) return null

  const retryAllowed = canRetryFailedArchives(outcome, activeLibraryId, busy)

  return (
    <section
      aria-label={libraryText.taskResultLabel()}
      aria-live="polite"
      className="mb-3 flex max-h-64 flex-col gap-2 overflow-hidden rounded-lg border border-border bg-card p-3 text-[13px] text-foreground"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        clearTaskResult()
      }}
      role="status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <OutcomeDetails outcome={outcome} />
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

      {outcome.kind === 'install' && outcome.failedPaths.some(Boolean) && (
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
  )
}

function OutcomeDetails({ outcome }: { outcome: TaskOutcome }) {
  if (outcome.kind === 'install') return <InstallDetails outcome={outcome} />
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

function InstallDetails({ outcome }: { outcome: InstallTaskOutcome }) {
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
                  {resolveCommandErrorSummary(failure.error)}
                </p>
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
