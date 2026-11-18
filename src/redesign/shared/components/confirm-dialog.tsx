import type { ReactNode } from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FidelityButton } from './fidelity-button'

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  confirmLabel: ReactNode
  cancelLabel: ReactNode
  onConfirm: () => void
  destructive?: boolean
  busy?: boolean
  // Extra body content (e.g. a delete-files checkbox) between description and footer.
  children?: ReactNode
}

/** Confirmation dialog on the shadcn Dialog primitive (fix_plan_0.md §7). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  destructive = false,
  busy = false,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(28rem,calc(100vw-2rem))] rounded-lg bg-popover">
        <DialogHeader>
          <DialogTitle className="font-heading">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>
          <DialogClose asChild>
            <FidelityButton variant="ghost" disabled={busy}>
              {cancelLabel}
            </FidelityButton>
          </DialogClose>
          <FidelityButton
            variant={destructive ? 'destructive' : 'primary'}
            busy={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </FidelityButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
