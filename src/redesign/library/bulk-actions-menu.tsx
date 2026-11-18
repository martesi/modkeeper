import { useState } from 'react'
import { useAtomValue } from 'jotai'
import { Loader2, ListChecks, Play, Square, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '../shared/components/confirm-dialog'
import { LibraryActionIconButton } from './library-action-icon-button'
import {
  activeLibraryIdAtom,
  libraryBusyAtom,
  selectedModIdsAtom,
} from '../state/library-state'
import { bulkUpdateMods } from '../data/library-repository'
import type { BulkModAction } from '../data/redesign-types'
import { libraryText } from '../i18n/library-text'
import { commonText } from '../i18n/common-text'

/**
 * Selection-gated bulk actions with a per-button pending indicator and delete confirmation.
 */
export function BulkActionsMenu() {
  const activeLibraryId = useAtomValue(activeLibraryIdAtom)
  const libraryBusy = useAtomValue(libraryBusyAtom)
  const selectedIds = useAtomValue(selectedModIdsAtom)
  const [pendingAction, setPendingAction] = useState<BulkModAction | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const count = selectedIds.size
  const pending = pendingAction !== null
  const disabled = count === 0 || libraryBusy || pending || !activeLibraryId

  async function run(action: BulkModAction) {
    if (!activeLibraryId || pendingAction) return
    setPendingAction(action)
    try {
      const outcome = await bulkUpdateMods({
        libraryId: activeLibraryId,
        modIds: [...selectedIds],
        action,
      })
      if (outcome.status === 'success') setConfirmDelete(false)
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <LibraryActionIconButton
            icon={ListChecks}
            label={libraryText.actionsLabel()}
            disabled={disabled}
            busy={pending}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          className="min-w-[11.5rem] rounded-lg p-1"
        >
          <DropdownMenuItem
            className="rounded-sm"
            disabled={pending}
            onSelect={(event) => {
              event.preventDefault()
              void run('enable')
            }}
          >
            {pendingAction === 'enable' ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Play aria-hidden />
            )}
            {libraryText.enableSelected()}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="rounded-sm"
            disabled={pending}
            onSelect={(event) => {
              event.preventDefault()
              void run('disable')
            }}
          >
            {pendingAction === 'disable' ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Square aria-hidden />
            )}
            {libraryText.disableSelected()}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            className="rounded-sm"
            disabled={pending}
            onSelect={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden />
            {libraryText.deleteSelected()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={libraryText.deleteModsTitle(count)}
        description={libraryText.deleteModsDescription()}
        confirmLabel={libraryText.deleteConfirm()}
        cancelLabel={commonText.cancel()}
        destructive
        busy={pendingAction === 'delete'}
        onConfirm={() => void run('delete')}
      />
    </>
  )
}
