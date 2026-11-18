'use client'

import * as React from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Trans } from '@lingui/react/macro'

interface ConfirmPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description: React.ReactNode
  confirmLabel?: React.ReactNode
  cancelLabel?: React.ReactNode
  variant?: 'default' | 'destructive'
  onConfirm: () => void
  trigger: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export function ConfirmPopover({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
  trigger,
  side = 'top',
}: ConfirmPopoverProps) {
  const handleConfirm = () => {
    onConfirm()
    onOpenChange(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side={side} className="w-80">
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">{title}</h4>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleCancel}>
              {cancelLabel || <Trans>Cancel</Trans>}
            </Button>
            <Button
              variant={variant === 'destructive' ? 'destructive' : 'default'}
              size="sm"
              onClick={handleConfirm}
            >
              {confirmLabel || <Trans>Confirm</Trans>}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
