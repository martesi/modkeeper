import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function FidelityInput({
  className,
  ...props
}: ComponentProps<'input'>) {
  return (
    <input
      data-slot="fidelity-input"
      className={cn(
        'h-8 w-full min-w-0 rounded-sm px-2.5 text-[13px]',
        'border border-border bg-secondary text-foreground',
        'transition-colors placeholder:text-muted-foreground',
        'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:text-destructive',
        className,
      )}
      {...props}
    />
  )
}
