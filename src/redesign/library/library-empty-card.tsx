import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The shared flat empty-state surface with caller-supplied prompt/action content. When `onClick` is given the whole surface is one big
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
        'relative flex w-full max-w-[60rem] flex-col items-center gap-2',
        'rounded-lg px-4 py-4',
        'text-center text-foreground',
        onClick &&
          'cursor-pointer outline-none transition-colors hover:bg-primary/5 focus-visible:ring-[3px] focus-visible:ring-ring/50',
      )}
    >
      {children}
      {badge && (
        <span className="mt-1.5 rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {badge}
        </span>
      )}
    </Tag>
  )
}
