import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { settingsText } from '../i18n/settings-text'

// One shipped locale today; the control exists so adding a catalog is a one-line change here.
const LOCALES: { value: string; label: string }[] = [
  { value: 'en-US', label: 'English (US)' },
]

/**
 * Language select on the shadcn Select (fix_plan_0.md §2): saving triggers `changeLocale` via the
 * applier.
 */
export function LanguageSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (language: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={settingsText.language()}
        className="h-8 min-w-40 justify-between rounded-sm border-border bg-secondary px-2.5 text-[13px] font-semibold"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        position="popper"
        className="rounded-lg border-border bg-popover"
      >
        {LOCALES.map((locale) => (
          <SelectItem key={locale.value} value={locale.value}>
            {locale.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
