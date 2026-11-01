import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The shared dashed empty-state card (reference Modkeeper.dc.html): accent dot, caller-supplied
 * prompt/action content, optional corner badge. When `onClick` is given the whole card is one big
 * button (the drop state) — callers that render their own button inside must NOT pass `onClick`.
 */
export function LibraryEmptyCard({
  onClick,
  badge,
  children,
}: {
  onClick?: () => void
  badge?: ReactNode
  children: ReactNode
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'mk-glass-standard relative flex w-full max-w-[60rem] flex-col items-center gap-2',
        'rounded-[1.25rem] border-2 border-dashed border-border bg-card px-4 py-4',
        'text-center text-foreground',
        onClick &&
          'cursor-pointer outline-none transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:ring-[3px] focus-visible:ring-ring/50',
      )}
    >
      <span className="size-7 rounded-full bg-primary/15" aria-hidden />
      {children}
      {badge && (
        <span className="mt-1.5 rounded-xl bg-secondary px-3 py-1.5 text-[10px] font-bold tracking-[0.05em] text-muted-foreground">
          {badge}
        </span>
      )}
    </Tag>
  )
}
