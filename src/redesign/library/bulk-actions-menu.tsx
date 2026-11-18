import { useState } from 'react'
import { useAtomValue } from 'jotai'
import { ChevronDown, Play, Square, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FidelityButton } from '../shared/components/fidelity-button'
import { ConfirmDialog } from '../shared/components/confirm-dialog'
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
 * Bulk `ACTIONS · count` menu (reference Modkeeper.dc.html toolbar) on the shadcn DropdownMenu
 * (fix_plan_0.md §7): enable/disable/delete over the current selection via `bulkUpdateMods` —
 * plain awaited, local pending, delete behind a local confirmation.
 */
export function BulkActionsMenu() {
  const activeLibraryId = useAtomValue(activeLibraryIdAtom)
  const libraryBusy = useAtomValue(libraryBusyAtom)
  const selectedIds = useAtomValue(selectedModIdsAtom)
  const [pending, setPending] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const count = selectedIds.size
  const disabled = count === 0 || libraryBusy || pending || !activeLibraryId

  async function run(action: BulkModAction) {
    if (!activeLibraryId) return
    setPending(true)
    try {
      const outcome = await bulkUpdateMods({
        libraryId: activeLibraryId,
        modIds: [...selectedIds],
        action,
      })
      if (outcome.status === 'success') setConfirmDelete(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <FidelityButton
            disabled={disabled}
            busy={pending}
            className="text-[13px] font-semibold"
          >
            {libraryText.actions(count)}
            <ChevronDown />
          </FidelityButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          className="min-w-[11.5rem] rounded-lg p-1"
        >
          <DropdownMenuItem
            className="rounded-sm"
            onSelect={() => void run('enable')}
          >
            <Play aria-hidden />
            {libraryText.enableSelected()}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="rounded-sm"
            onSelect={() => void run('disable')}
          >
            <Square aria-hidden />
            {libraryText.disableSelected()}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            className="rounded-sm"
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
        busy={pending}
        onConfirm={() => void run('delete')}
      />
    </>
  )
}
