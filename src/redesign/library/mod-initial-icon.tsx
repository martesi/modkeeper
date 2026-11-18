import type { ModType } from '../data/redesign-types'

/**
 * The reference card's tinted initial tile (Modkeeper.dc.html `mod.iconStyle`). The reference
 * seeds a color per mod, but ModSummary carries none (C6) — the tint is keyed to the ModType via
 * the chart tokens instead, so type stays visually scannable.
 */
const TINT_BY_TYPE: Record<ModType, string> = {
  client: 'var(--chart-2)',
  server: 'var(--chart-1)',
  both: 'var(--chart-3)',
  unknown: 'var(--muted-foreground)',
}

export function ModInitialIcon({
  name,
  type,
  enabled = true,
  size = 'md',
}: {
  name: string
  type: ModType
  enabled?: boolean
  size?: 'sm' | 'md' | 'grid' | 'icons'
}) {
  const tint = enabled ? TINT_BY_TYPE[type] : 'var(--muted-foreground)'
  const sizeClass = {
    sm: 'size-6 text-[10px]',
    md: 'size-8 text-[13px]',
    grid: 'size-12 text-[16px]',
    icons: 'size-16 text-[20px]',
  }[size]
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-sm font-heading font-semibold ${sizeClass}`}
      style={{
        backgroundColor: enabled
          ? `color-mix(in srgb, ${tint} 13%, transparent)`
          : 'var(--muted)',
        color: tint,
      }}
      aria-hidden
    >
      {(name[0] ?? '?').toUpperCase()}
    </span>
  )
}
