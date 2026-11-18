import { useState } from 'react'
import { ConfirmDialog } from '../../shared/components/confirm-dialog'
import { FidelityCheckbox } from '../../shared/components/fidelity-checkbox'
import { deleteLibrary } from '../../data/library-repository'
import { libraryText } from '../../i18n/library-text'
import { commonText } from '../../i18n/common-text'
import type { LibrarySummary } from '../../data/redesign-types'

/**
 * Delete confirmation (consolidated-spec.md §12.4): the checkbox decides between two DISTINCT
 * backend paths — entry-only removal vs. deleting the library files on disk. Entry-only is never
 * routed to the destructive variant; the flag resets closed→open so a previous choice can't leak.
 */
export function DeleteLibraryConfirmDialog({
  library,
  open,
  onOpenChange,
  onDeleted,
}: {
  library: LibrarySummary
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) {
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [pending, setPending] = useState(false)

  function handleOpenChange(next: boolean) {
    if (next) setDeleteFiles(false)
    onOpenChange(next)
  }

  async function handleConfirm() {
    setPending(true)
    try {
      const outcome = await deleteLibrary({
        libraryId: library.id,
        deleteFiles,
      })
      if (outcome.status !== 'success') return
      onOpenChange(false)
      onDeleted()
    } finally {
      setPending(false)
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={libraryText.deleteLibraryTitle(library.name)}
      description={libraryText.deleteLibraryDescription()}
      confirmLabel={libraryText.deleteConfirm()}
      cancelLabel={commonText.cancel()}
      destructive
      busy={pending}
      onConfirm={() => void handleConfirm()}
    >
      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <FidelityCheckbox
          checked={deleteFiles}
          onCheckedChange={setDeleteFiles}
          aria-label={libraryText.deleteFilesLabel()}
        />
        {libraryText.deleteFilesLabel()}
      </label>
    </ConfirmDialog>
  )
}
