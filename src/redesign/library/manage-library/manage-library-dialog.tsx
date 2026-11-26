import { useState } from 'react'
import { useAtomValue } from 'jotai'
import { pickDirectory } from '@/platform'
import { Plus, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { activeLibraryIdAtom, libraryListAtom } from '../../state/library-state'
import { createLibrary, deleteLibrary } from '../../data/library-repository'
import { FidelityButton } from '../../shared/components/fidelity-button'
import { isLibrarySummary } from '../../data/redesign-types'
import type { LibraryEntry, LibraryStub } from '../../data/redesign-types'
import { pickWithNativeOrPathEntry } from '../../shared/utils/picker-gate'
import { runPickerAction } from '../../shared/utils/picker-errors'
import { commonText } from '../../i18n/common-text'
import { libraryText } from '../../i18n/library-text'
import { usePathInputDialog } from '../../shared/hooks/use-path-input-dialog'
import { LibraryDetails } from './library-details'

/**
 * Manage Library dialog: profile tabs across
 * every registered entry (readable summaries AND path-only stubs, C13) plus a dashed plus tab
 * that picks a game folder and creates+selects. The body is the reference's two-column layout —
 * section labels left, controls right — covering identity and installation paths. Rebuild Cache is fire-and-track and only valid for the ACTIVE library (§7e rejects
 * non-active libraryIds), so it is disabled elsewhere with a hint.
 */
export function ManageLibraryDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const libraries = useAtomValue(libraryListAtom)
  const activeLibraryId = useAtomValue(activeLibraryIdAtom)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const { requestPathInput, pathInputDialog } = usePathInputDialog()

  // Selection is resolved against the CURRENT list every render, so a deleted entry or a fresh
  // workspace can never leave a dangling tab selected.
  const selected =
    libraries.find((entry) => entryKey(entry) === selectedKey) ??
    libraries.find(
      (entry) => isLibrarySummary(entry) && entry.id === activeLibraryId,
    ) ??
    libraries[0] ??
    null

  async function handleAddLibrary() {
    const gameRoot = await pickWithNativeOrPathEntry<string | null>(
      () => pickDirectory({ title: libraryText.selectGameRoot() }),
      async () =>
        (
          await requestPathInput({
            mode: 'single',
            selectDirectory: true,
            title: libraryText.gameRootPathTitle(),
            description: libraryText.gameRootPathDescription(),
            label: libraryText.gameRootPathLabel(),
            placeholder: libraryText.gameRootPathPlaceholder(),
          })
        )?.[0] ?? null,
    )
    if (!gameRoot) return
    const outcome = await createLibrary({ gameRoot })
    if (outcome.status !== 'success') return
    // create+select (§12.4): the created library becomes the active one.
    if (outcome.workspace.activeLibraryId)
      setSelectedKey(outcome.workspace.activeLibraryId)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="mk-scrollbar flex max-h-[88vh] w-[min(67.5rem,calc(100vw-2rem))] flex-col gap-0 overflow-y-auto rounded-lg bg-popover p-0 sm:max-w-none">
          <DialogHeader className="px-6 pb-1 pt-6">
            <DialogTitle className="font-heading text-xl font-semibold">
              {libraryText.manageDialogTitle()}
            </DialogTitle>
            <DialogDescription className="text-[13px]">
              {libraryText.manageDialogDescription()}
            </DialogDescription>
          </DialogHeader>

          <div
            className="flex flex-wrap items-center gap-2 px-6 pb-1 pt-4"
            role="tablist"
          >
            {libraries.map((entry) => {
              const key = entryKey(entry)
              const isSelected = selected !== null && key === entryKey(selected)
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setSelectedKey(key)}
                  className={cn(
                    'h-8 max-w-56 truncate rounded-md px-3 text-[13px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    isSelected
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : 'border border-border bg-secondary font-semibold text-foreground hover:bg-accent',
                  )}
                >
                  {isLibrarySummary(entry)
                    ? entry.name
                    : libraryText.unreadableLibrary()}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() =>
                void runPickerAction(handleAddLibrary, {
                  message: commonText.somethingWentWrong(),
                  context: 'add library action',
                })
              }
              aria-label={libraryText.addLibraryTab()}
              title={libraryText.addLibraryTab()}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-md',
                'border border-dashed border-border text-muted-foreground outline-none transition-colors',
                'hover:border-primary hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50',
              )}
            >
              <Plus className="size-4.5" aria-hidden />
            </button>
          </div>

          {selected === null ? null : isLibrarySummary(selected) ? (
            <LibraryDetails key={selected.id} library={selected} />
          ) : (
            <StubDetails stub={selected} />
          )}
        </DialogContent>
      </Dialog>
      {pathInputDialog}
    </>
  )
}

/** Registered-but-unreadable entry (C13): warning row + bare path, remove-only. */
function StubDetails({ stub }: { stub: LibraryStub }) {
  const [pending, setPending] = useState(false)

  async function handleRemove() {
    setPending(true)
    try {
      // The stub has no id, only its registered path — the path is the only handle the frontend
      // can pass for the entry-only (never destructive) removal.
      await deleteLibrary({ libraryId: stub.path, deleteFiles: false })
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div className="px-6 py-5">
        <div className="flex items-center gap-3 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm bg-destructive/15 text-destructive">
            <TriangleAlert className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-foreground">
              {libraryText.pathUnreachable()}
            </p>
            <p
              className="truncate text-[13px] text-muted-foreground"
              title={stub.path}
            >
              {stub.path}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {libraryText.unreadableLibraryHint()}
        </p>
      </div>
      <div className="flex items-center justify-end border-t border-border px-9 py-5">
        <FidelityButton
          variant="ghost"
          size="sm"
          className="text-[13px] font-semibold text-destructive hover:text-destructive"
          busy={pending}
          onClick={() => void handleRemove()}
        >
          {libraryText.removeEntry()}
        </FidelityButton>
      </div>
    </>
  )
}

function entryKey(entry: LibraryEntry): string {
  return isLibrarySummary(entry) ? entry.id : entry.path
}
