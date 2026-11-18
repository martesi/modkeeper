import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const iconButtonVariants = cva(
  cn(
    'inline-flex shrink-0 items-center justify-center',
    'rounded-sm transition-colors',
    'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    'disabled:pointer-events-none disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100',
    '[&_svg]:shrink-0 [&_svg]:pointer-events-none',
  ),
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary:
          'border border-border bg-secondary text-foreground hover:bg-accent',
        /** The reference toolbar's tinted round tool button: primary at low alpha. */
        soft: 'bg-primary/15 text-primary hover:bg-primary/25',
        ghost:
          'bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        sm: 'size-7 [&_svg]:size-4',
        md: 'size-8 [&_svg]:size-[18px]',
        lg: 'size-9 [&_svg]:size-[18px]',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md',
    },
  },
)

type FidelityIconButtonProps = ComponentProps<'button'> &
  VariantProps<typeof iconButtonVariants> & {
    // Icon-only controls must be labeled for assistive tech (spec §12 accessibility).
    'aria-label': string
  }

export function FidelityIconButton({
  className,
  variant,
  size,
  ...props
}: FidelityIconButtonProps) {
  return (
    <button
      data-slot="fidelity-icon-button"
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { iconButtonVariants }
