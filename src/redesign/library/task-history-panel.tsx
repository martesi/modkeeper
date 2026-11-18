import { useAtomValue } from 'jotai'
import { isLibrarySummary } from '../data/redesign-types'
import { clearTaskHistory, taskHistoryAtom } from '../data/task-history'
import { taskHistoryText } from '../i18n/task-history-text'
import { libraryText } from '../i18n/library-text'
import { libraryListAtom } from '../state/library-state'

export function TaskHistoryPanel() {
  const history = useAtomValue(taskHistoryAtom)
  const libraries = useAtomValue(libraryListAtom)

  return (
    <section
      aria-label={taskHistoryText.label()}
      className="mb-3 rounded-lg border border-border bg-card p-3 text-[13px] text-foreground"
    >
      <div className="flex items-start gap-3">
        <details className="min-w-0 flex-1">
          <summary className="w-fit cursor-pointer rounded-sm font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50">
            {taskHistoryText.title(history.length)}
          </summary>
          {history.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              {taskHistoryText.empty()}
            </p>
          ) : (
            <ol className="mk-scrollbar mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
              {history.map((entry) => {
                const library = libraries.find(
                  (item) =>
                    isLibrarySummary(item) && item.id === entry.libraryId,
                )
                const libraryName =
                  library && isLibrarySummary(library)
                    ? library.name
                    : entry.libraryId

                return (
                  <li
                    className="min-w-0 rounded-md border border-border/70 px-2.5 py-2"
                    key={entry.taskId}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h3 className="font-medium">
                        {taskHistoryText.operation(entry.operation)}
                        <span className="font-normal text-muted-foreground">
                          {' · '}
                          {libraryText.taskLibrary(libraryName)}
                        </span>
                      </h3>
                      <time
                        className="shrink-0 text-xs text-muted-foreground"
                        dateTime={entry.timestamp}
                      >
                        {formatTimestamp(entry.timestamp)}
                      </time>
                    </div>
                    <p className="mt-0.5 text-muted-foreground">
                      {taskHistoryText.status(entry.status)}
                    </p>
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
                  </li>
                )
              })}
            </ol>
          )}
        </details>
        {history.length > 0 && (
          <button
            aria-label={taskHistoryText.clear()}
            className="h-7 shrink-0 rounded-sm border border-border px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => clearTaskHistory()}
            title={taskHistoryText.clear()}
            type="button"
          >
            {taskHistoryText.clear()}
          </button>
        )}
      </div>
    </section>
  )
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
