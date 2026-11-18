import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { Plus, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FidelityButton } from '../shared/components/fidelity-button'
import {
  activeLibraryAtom,
  libraryBusyAtom,
  modListAtom,
} from '../state/library-state'
import { syncMods } from '../data/library-repository'
import { useArchiveFilePicker } from '../shared/hooks/use-archive-file-picker'
import { libraryText } from '../i18n/library-text'
import { LibraryActivateEmptyState } from './library-activate-empty-state'
import { LibraryDropEmptyState } from './library-drop-empty-state'
import { ModGridToolbar } from './mod-grid-toolbar'
import { ModGrid } from './mod-grid'
import { ManageLibraryDialog } from './manage-library/manage-library-dialog'

/**
 * Library screen with named library actions and the active workspace content.
 */
export function LibraryScreen() {
  const activeLibrary = useAtomValue(activeLibraryAtom)
  const mods = useAtomValue(modListAtom)
  const [manageOpen, setManageOpen] = useState(false)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'f'
      ) {
        return
      }
      if (document.querySelector('[role="dialog"][data-state="open"]')) return

      const searchInput = document.querySelector<HTMLInputElement>(
        '[data-library-search]',
      )
      if (!searchInput) return

      const target = event.target
      if (
        target instanceof HTMLElement &&
        target !== searchInput &&
        (target.isContentEditable ||
          target.closest('input, textarea, select, [contenteditable="true"]'))
      ) {
        return
      }

      event.preventDefault()
      searchInput.focus()
      searchInput.select()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-[26px] font-semibold leading-tight text-foreground">
            {libraryText.title()}
          </h1>
          <p className="text-[13px] text-muted-foreground">
            {activeLibrary
              ? libraryText.subtitleModsInstalled(mods.length)
              : libraryText.subtitleEmpty()}
          </p>
        </div>

        <LibraryHeaderToolbar onManageLibraries={() => setManageOpen(true)} />
      </div>

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
        <LibraryActivateEmptyState
          onManageLibraries={() => setManageOpen(true)}
        />
      )}

      <ManageLibraryDialog open={manageOpen} onOpenChange={setManageOpen} />
    </div>
  )
}

/**
 * Named library actions stay visible beside the page title; Manage remains available without an
 * active library.
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
  const libraryBusy = useAtomValue(libraryBusyAtom)
  const pickAndInstall = useArchiveFilePicker()

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      <FidelityButton variant="secondary" onClick={onManageLibraries}>
        {libraryText.manageLibraries()}
      </FidelityButton>
      {activeLibrary && (
        <>
          <FidelityButton
            variant="secondary"
            busy={libraryBusy}
            className={cn(
              activeLibrary.deployStale &&
                'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15',
            )}
            title={
              activeLibrary.deployStale ? libraryText.deployStale() : undefined
            }
            onClick={() => void syncMods(activeLibrary.id)}
          >
            {!libraryBusy && (
              <RefreshCw
                className={activeLibrary.deployStale ? 'text-primary' : ''}
                aria-hidden
              />
            )}
            {libraryBusy ? libraryText.syncing() : libraryText.sync()}
          </FidelityButton>
          <FidelityButton
            variant="primary"
            disabled={libraryBusy}
            onClick={() => void pickAndInstall()}
          >
            <Plus aria-hidden />
            {libraryText.addMod()}
          </FidelityButton>
        </>
      )}
    </div>
  )
}
