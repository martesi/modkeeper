import type { ComponentProps } from 'react'
import { Slot as SlotPrimitive } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  cn(
    'relative inline-flex shrink-0 items-center justify-center gap-2',
    'whitespace-nowrap rounded-sm text-[13px] font-semibold transition-colors',
    'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    'disabled:pointer-events-none disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none',
    '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:pointer-events-none',
  ),
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80',
        secondary:
          'border border-border bg-secondary text-foreground hover:bg-accent',
        outline:
          'border border-border bg-transparent text-foreground hover:bg-accent active:bg-accent',
        ghost:
          'bg-transparent text-foreground hover:bg-accent active:bg-accent',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        sm: 'h-7 px-2.5',
        md: 'h-8 px-3',
        lg: 'h-9 px-3.5',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

type FidelityButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    busy?: boolean
  }

export function FidelityButton({
  className,
  variant,
  size,
  asChild = false,
  busy = false,
  disabled,
  children,
  ...props
}: FidelityButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className)

  // Slot accepts a single child, so the busy spinner is a plain-button affordance only.
  if (asChild) {
    return (
      <SlotPrimitive.Slot
        data-slot="fidelity-button"
        data-variant={variant ?? 'primary'}
        className={classes}
        {...props}
      >
        {children}
      </SlotPrimitive.Slot>
    )
  }

  return (
    <button
      data-slot="fidelity-button"
      data-variant={variant ?? 'primary'}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className={classes}
      {...props}
    >
      {busy && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export { buttonVariants }
