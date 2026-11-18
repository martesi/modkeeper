import { cn } from '@/lib/utils'
import type { ThemeMode } from '@gen/bindings'
import { settingsText } from '../i18n/settings-text'

/**
 * Segmented System/Light/Dark control on a neutral Fluent track. Stable
 * dimensions — the selected state changes color only, never size.
 */
export function ThemeModeControl({
  value,
  onChange,
}: {
  value: ThemeMode
  onChange: (mode: ThemeMode) => void
}) {
  const options: { mode: ThemeMode; label: string }[] = [
    { mode: 'system', label: settingsText.themeSystem() },
    { mode: 'light', label: settingsText.themeLight() },
    { mode: 'dark', label: settingsText.themeDark() },
  ]

  return (
    <div
      role="radiogroup"
      aria-label={settingsText.appearance()}
      className="inline-flex h-8 gap-0.5 rounded-md border border-border bg-secondary p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.mode}
          type="button"
          role="radio"
          aria-checked={value === option.mode}
          onClick={() => onChange(option.mode)}
          className={cn(
            'h-7 rounded-sm border border-transparent px-3 text-xs font-semibold',
            'outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
            value === option.mode
              ? 'border-border bg-card text-foreground'
              : 'text-muted-foreground hover:bg-accent',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
