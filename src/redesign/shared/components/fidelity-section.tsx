import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type FidelitySectionProps = ComponentProps<'section'> & {
  title: ReactNode
  description?: ReactNode
  // Right-aligned controls in the section header (e.g. a section-level action button).
  actions?: ReactNode
}

export function FidelitySection({
  title,
  description,
  actions,
  className,
  children,
  ...props
}: FidelitySectionProps) {
  return (
    <section
      data-slot="fidelity-section"
      className={cn('flex flex-col gap-3', className)}
      {...props}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-heading text-[13px] font-semibold text-foreground">
            {title}
          </h3>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </header>
      {children}
    </section>
  )
}
