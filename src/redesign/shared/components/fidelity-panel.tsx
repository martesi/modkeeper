import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const panelVariants = cva('text-foreground border', {
  variants: {
    variant: {
      standard: 'bg-card border-border',
      strong: 'bg-popover border-border-strong',
      solid: 'bg-background border-border',
    },
    radius: {
      panel: 'rounded-lg',
      dialog: 'rounded-lg',
      card: 'rounded-md',
      control: 'rounded-sm',
    },
  },
  defaultVariants: {
    variant: 'standard',
    radius: 'panel',
  },
})

type FidelityPanelProps = ComponentProps<'div'> &
  VariantProps<typeof panelVariants>

export function FidelityPanel({
  className,
  variant,
  radius,
  ...props
}: FidelityPanelProps) {
  return (
    <div
      data-slot="fidelity-panel"
      className={cn(panelVariants({ variant, radius }), className)}
      {...props}
    />
  )
}

export { panelVariants }
