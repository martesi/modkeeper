import type { ComponentProps } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'
import { FidelityIconButton } from '../shared/components/fidelity-icon-button'

type LibraryActionIconButtonProps = Omit<
  ComponentProps<typeof FidelityIconButton>,
  'aria-label' | 'children'
> & {
  label: string
  tooltip?: string
  icon: LucideIcon
  busy?: boolean
}

/** Toolbar action button with its own pending indicator and stable tooltip. */
export function LibraryActionIconButton({
  label,
  tooltip,
  icon: Icon,
  busy = false,
  className,
  disabled,
  ...props
}: LibraryActionIconButtonProps) {
  return (
    <FidelityIconButton
      {...props}
      aria-label={label}
      title={tooltip ?? label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className={className}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Icon className="size-5" aria-hidden />
      )}
    </FidelityIconButton>
  )
}
