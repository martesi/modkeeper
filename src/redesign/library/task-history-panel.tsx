import { useAtomValue } from 'jotai'
import { X } from 'lucide-react'
import { isLibrarySummary } from '../data/redesign-types'
import {
  clearTaskHistory,
  dismissTaskHistory,
  taskHistoryAtom,
} from '../data/task-history'
import { taskHistoryText } from '../i18n/task-history-text'
import { libraryText } from '../i18n/library-text'
import { libraryListAtom } from '../state/library-state'
import { FidelityButton } from '../shared/components/fidelity-button'
import { FidelityIconButton } from '../shared/components/fidelity-icon-button'

export function TaskHistoryPanel() {
  const history = useAtomValue(taskHistoryAtom)
  const libraries = useAtomValue(libraryListAtom)

  return (
    <section
      aria-label={taskHistoryText.label()}
      className="mb-3 rounded-lg border border-border bg-card p-3 text-[13px] text-foreground"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">{taskHistoryText.title()}</h2>
        {history.length > 0 && (
          <FidelityButton
            size="sm"
            variant="primary"
            onClick={() => clearTaskHistory()}
          >
            {taskHistoryText.clear()}
          </FidelityButton>
        )}
      </div>
      {history.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{taskHistoryText.empty()}</p>
      ) : (
        <ol className="mk-scrollbar mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
          {history.map((entry) => {
            const library = libraries.find(
              (item) => isLibrarySummary(item) && item.id === entry.libraryId,
            )
            const libraryName =
              library && isLibrarySummary(library)
                ? library.name
                : entry.libraryId
            const operation = taskHistoryText.operation(entry.operation)

            return (
              <li
                data-task-id={entry.taskId}
                data-library-id={entry.libraryId}
                className="flex min-w-0 items-center gap-2 rounded-md border border-border/70 px-2.5 py-2"
                key={entry.taskId}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="font-medium">
                      {operation}
                      <span className="font-normal text-muted-foreground">
                        {' · '}
                        {libraryText.taskLibrary(libraryName)}
                      </span>
                    </h3>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={entry.timestamp}
                    >
                      {formatTimestamp(entry.timestamp)}
                    </time>
                    <span className="text-xs text-muted-foreground">
                      {taskHistoryText.status(entry.status)}
                    </span>
                  </div>
                  {entry.cause && (
                    <p className="mt-1 text-muted-foreground">
                      {taskHistoryText.syncCause(entry.cause)}
                    </p>
                  )}
                  {entry.logTail.length > 0 && (
                    <details className="mt-1">
                      <summary className="w-fit cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
                        {taskHistoryText.log(entry.logTail.length)}
                      </summary>
                      <ol className="mk-scrollbar mt-1 max-h-24 space-y-1 overflow-y-auto pl-4 pr-1">
                        {entry.logTail.map((log, index) => (
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
                </div>
                <FidelityIconButton
                  aria-label={taskHistoryText.dismiss(operation, libraryName)}
                  title={taskHistoryText.dismiss(operation, libraryName)}
                  size="sm"
                  onClick={() => dismissTaskHistory(entry.taskId)}
                >
                  <X aria-hidden="true" />
                </FidelityIconButton>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
