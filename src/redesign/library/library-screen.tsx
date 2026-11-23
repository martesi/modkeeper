import { useLayoutEffect, useState } from 'react'
import { useAtomValue, useStore } from 'jotai'
import { Plus, RefreshCw, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  activeLibraryAtom,
  activeLibraryIdAtom,
  libraryBusyAtom,
  modListAtom,
  libraryScreenInstanceAtom,
  libraryRevealModIdAtom,
  pendingTasksAtom,
} from '../state/library-state'
import { syncMods } from '../data/library-repository'
import { useArchiveFilePicker } from '../shared/hooks/use-archive-file-picker'
import { libraryText } from '../i18n/library-text'
import { LibraryActivateEmptyState } from './library-activate-empty-state'
import { LibraryDropEmptyState } from './library-drop-empty-state'
import { ModGridToolbar } from './mod-grid-toolbar'
import { ModGrid } from './mod-grid'
import { ManageLibraryDialog } from './manage-library/manage-library-dialog'
import { LibraryActionIconButton } from './library-action-icon-button'

/**
 * Library screen with named library actions and the active workspace content.
 */
export function LibraryScreen() {
  const store = useStore()
  useLayoutEffect(() => {
    const instance = {}
    store.set(libraryScreenInstanceAtom, instance)
    return () => {
      if (store.get(libraryScreenInstanceAtom) === instance) {
        store.set(libraryScreenInstanceAtom, null)
        store.set(libraryRevealModIdAtom, null)
      }
    }
  }, [store])
  const activeLibrary = useAtomValue(activeLibraryAtom)
  const mods = useAtomValue(modListAtom)
  const [manageOpen, setManageOpen] = useState(false)

  return (
    <div
      className={
        activeLibrary ? 'flex flex-col gap-3' : 'flex h-full min-h-0 flex-col'
      }
    >
      {activeLibrary && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-[13px] text-muted-foreground">
            {libraryText.subtitleModsInstalled(mods.length)}
          </p>
          <LibraryHeaderToolbar onManageLibraries={() => setManageOpen(true)} />
        </div>
      )}

      {activeLibrary ? (
        mods.length === 0 ? (
          <LibraryDropEmptyState />
        ) : (
          <div className="flex flex-col gap-3">
            <ModGridToolbar />
            <ModGrid />
          </div>
        )
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <LibraryActivateEmptyState
            onManageLibraries={() => setManageOpen(true)}
          />
        </div>
      )}

      <ManageLibraryDialog open={manageOpen} onOpenChange={setManageOpen} />
    </div>
  )
}

/**
 * Library actions remain available in the section header; Manage works without an active library.
 *
 * Note: the reference labels the spinner "Rebuild cache"; the real operation the library needs
 * here is the deploy Sync (rebuild lives in the Manage Library footer).
 */
function LibraryHeaderToolbar({
  onManageLibraries,
}: {
  onManageLibraries: () => void
}) {
  const activeLibrary = useAtomValue(activeLibraryAtom)
  const activeLibraryId = useAtomValue(activeLibraryIdAtom)
  const libraryBusy = useAtomValue(libraryBusyAtom)
  const pendingTasks = useAtomValue(pendingTasksAtom)
  const { pickAndInstall, pathInputDialog } = useArchiveFilePicker('add-button')
  const [pickerPending, setPickerPending] = useState(false)
  const syncPending = pendingTasks.some(
    (task) =>
      task.libraryId === activeLibrary?.id && task.source === 'sync-button',
  )
  const installPending =
    pickerPending ||
    pendingTasks.some(
      (task) =>
        task.libraryId === activeLibrary?.id && task.source === 'add-button',
    )

  function handleSync() {
    if (!activeLibrary) return
    void syncMods(activeLibrary.id).catch((error: unknown) => {
      console.error('[redesign] sync action failed', error)
    })
  }

  function handleInstall() {
    if (!activeLibraryId) return
    setPickerPending(true)
    void pickAndInstall()
      .then(() => setPickerPending(false))
      .catch((error: unknown) => {
        setPickerPending(false)
        toast.error(libraryText.archiveImportActionFailed())
        console.error('[redesign] archive import action failed', error)
      })
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      <LibraryActionIconButton
        icon={Settings2}
        label={libraryText.manageLibraries()}
        variant="ghost"
        onClick={onManageLibraries}
      />
      {activeLibrary && (
        <>
          <LibraryActionIconButton
            icon={RefreshCw}
            label={libraryText.sync()}
            tooltip={
              activeLibrary.deployStale
                ? libraryText.deployStale()
                : libraryText.sync()
            }
            variant={activeLibrary.deployStale ? 'soft' : 'ghost'}
            busy={syncPending}
            disabled={libraryBusy}
            className={activeLibrary.deployStale ? 'text-primary' : undefined}
            onClick={handleSync}
          />
          <LibraryActionIconButton
            icon={Plus}
            label={libraryText.addMod()}
            variant="primary"
            busy={installPending}
            disabled={libraryBusy}
            onClick={handleInstall}
          />
        </>
      )}
      {pathInputDialog}
    </div>
  )
}
