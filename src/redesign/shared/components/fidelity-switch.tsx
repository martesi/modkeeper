import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

type FidelitySwitchProps = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  /** Announced while an awaited change is settling (local per-click pending). */
  busy?: boolean
  // Switches render no text of their own, so a label is mandatory (spec §12 accessibility).
  'aria-label': string
  className?: string
}

/**
 * Styled wrapper over the shadcn Switch with a compact 36×20 track.
 */
export function FidelitySwitch({
  busy = false,
  className,
  ...props
}: FidelitySwitchProps) {
  return (
    <Switch
      data-slot="fidelity-switch"
      aria-busy={busy || undefined}
      className={cn(
        'h-5 w-9',
        '[&_[data-slot=switch-thumb]]:size-4',
        '[&_[data-slot=switch-thumb][data-state=unchecked]]:translate-x-0',
        '[&_[data-slot=switch-thumb][data-state=checked]]:translate-x-4',
        className,
      )}
      {...props}
    />
  )
}
