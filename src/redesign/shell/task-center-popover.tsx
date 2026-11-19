import { useRef, useState, type ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { Check, ListTodo, X } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover'
import { commonText } from '../i18n/common-text'
import { libraryText } from '../i18n/library-text'
import { pendingTasksAtom, taskResultAtom } from '../state/library-state'

const itemClass =
  'mk-navigation-item relative flex h-9 w-full items-center gap-3 rounded-[4px] px-3 text-left text-[13px] font-semibold text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50'

export function TaskCenterPopover({
  children,
  expanded,
}: {
  children?: ReactNode
  expanded: boolean
}) {
  const activeCount = useAtomValue(pendingTasksAtom).length
  const hasLatestResult = Boolean(useAtomValue(taskResultAtom))
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const label =
    activeCount > 0
      ? libraryText.tasksActiveCount(activeCount)
      : libraryText.tasksLabel()

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      {open && (
        <div
          aria-hidden
          className="fixed inset-0 z-40 cursor-default bg-transparent pointer-events-auto"
          data-task-center-backdrop
          onPointerDown={() => setOpen(false)}
        />
      )}
      <PopoverTrigger asChild>
        <button
          aria-label={label}
          className={`${itemClass} ${expanded ? '' : 'justify-center px-0'} data-[state=open]:bg-muted/60 data-[state=open]:text-foreground`}
          ref={triggerRef}
          title={!expanded ? label : undefined}
          type="button"
        >
          <ListTodo aria-hidden className="size-5 shrink-0" />
          {expanded && (
            <span className="truncate">{libraryText.tasksLabel()}</span>
          )}
          {activeCount > 0 && (
            <span
              aria-hidden
              className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none text-primary-foreground ${expanded ? 'ml-auto' : 'absolute right-0 top-0'}`}
            >
              {activeCount > 99 ? '99+' : activeCount}
            </span>
          )}
          {hasLatestResult && (
            <span
              aria-hidden
              className="absolute bottom-0 right-0 flex size-3 items-center justify-center rounded-full bg-background text-primary ring-1 ring-background"
            >
              <Check className="size-2" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-labelledby="task-center-title"
        className="max-h-[calc(100dvh-1rem)] w-[min(26rem,calc(100vw-5rem))] max-w-[calc(100vw-4rem)] overflow-y-auto p-3"
        collisionPadding={8}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
        side="right"
        sideOffset={8}
        role="dialog"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold" id="task-center-title">
            {libraryText.tasksLabel()}
          </h2>
          <button
            aria-label={commonText.close()}
            className="rounded p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => setOpen(false)}
            title={commonText.close()}
            type="button"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        {children}
      </PopoverContent>
    </Popover>
  )
}
