import { cn } from '@/lib/utils'
import { DEFAULT_ACCENT } from '../data/settings-defaults'
import { ACCENT_SWATCHES } from './accent-palette'
import { settingsText } from '../i18n/settings-text'

/**
 * Accent swatch strip (reference Modkeeper.dc.html `accentOptions`): 32px dots; the selected one
 * gets a white inner border plus an accent-colored halo, the rest sit dimmed. Applies immediately
 * and persists. Selection needs no glyph, so no foreground-contrast concern here — the derived
 * `--primary-foreground` (§4) covers the filled controls.
 */
export function AccentSwatches({
  value,
  onChange,
}: {
  value: string
  onChange: (color: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3.5">
      {ACCENT_SWATCHES.map((swatch) => {
        const selected = value.toLowerCase() === swatch.value.toLowerCase()
        const color =
          swatch.value === DEFAULT_ACCENT ? 'var(--primary)' : swatch.value
        return (
          <button
            key={swatch.value}
            type="button"
            aria-label={settingsText.accentSwatch(swatch.name)}
            aria-pressed={selected}
            title={swatch.name}
            onClick={() => onChange(swatch.value)}
            className={cn(
              'size-7 rounded-full border-2 transition-[opacity,box-shadow]',
              'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              selected
                ? 'border-white opacity-100 shadow-[0_0_0_2px_var(--swatch-color)]'
                : 'border-transparent opacity-55 hover:opacity-100',
            )}
            style={
              {
                backgroundColor: color,
                '--swatch-color': color,
              } as React.CSSProperties
            }
          />
        )
      })}
    </div>
  )
}
