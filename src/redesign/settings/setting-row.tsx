import type { ReactNode } from 'react'

/**
 * One settings row (reference Modkeeper.dc.html): bold label + description left, right-aligned
 * control. Wraps on narrow widths (spec §12 accessibility).
 */
export function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="font-heading mb-0.5 text-[13px] font-semibold text-foreground">
          {label}
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}
