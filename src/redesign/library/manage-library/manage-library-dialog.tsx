import { useState } from 'react'
import { useAtomValue } from 'jotai'
import { pickDirectory } from '@/platform'
import { useNativeDesktopShell } from '@/platform/use-native-desktop-shell'
import { toast } from 'sonner'
import { Copy, FolderOpen, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FidelityButton } from '../../shared/components/fidelity-button'
import { FidelityIconButton } from '../../shared/components/fidelity-icon-button'
import { FidelityInput } from '../../shared/components/fidelity-input'
import {
  activeLibraryIdAtom,
  libraryListAtom,
  pendingTasksAtom,
} from '../../state/library-state'
import {
  activateLibrary,
  createLibrary,
  deleteLibrary,
  rebuildLibraryCache,
  renameLibrary,
} from '../../data/library-repository'
import { isLibrarySummary } from '../../data/redesign-types'
import type {
  LibraryEntry,
  LibraryStub,
  LibrarySummary,
} from '../../data/redesign-types'
import { openGameRoot, openLibraryRoot } from '../../shared/utils/app-opener'
import { pickWithNativeOrPathEntry } from '../../shared/utils/picker-gate'
import { runPickerAction } from '../../shared/utils/picker-errors'
import { commonText } from '../../i18n/common-text'
import { libraryText } from '../../i18n/library-text'
import { DeleteLibraryConfirmDialog } from './delete-library-confirm-dialog'
import { usePathInputDialog } from '../../shared/hooks/use-path-input-dialog'

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

function LibraryDetails({ library }: { library: LibrarySummary }) {
  const activeLibraryId = useAtomValue(activeLibraryIdAtom)
  const pendingTasks = useAtomValue(pendingTasksAtom)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [activating, setActivating] = useState(false)
  const [nameDraft, setNameDraft] = useState(library.name)
  const [renaming, setRenaming] = useState(false)

  const isActive = library.id === activeLibraryId
  const busy = pendingTasks.some((task) => task.libraryId === library.id)
  const nameDirty = nameDraft.trim() !== library.name && nameDraft.trim() !== ''

  async function handleActivate() {
    setActivating(true)
    try {
      await activateLibrary(library.id)
    } finally {
      setActivating(false)
    }
  }

  async function handleRename() {
    setRenaming(true)
    try {
      await renameLibrary({ libraryId: library.id, name: nameDraft.trim() })
    } finally {
      setRenaming(false)
    }
  }

  return (
    <>
      <div className="grid gap-5 px-6 py-5 md:grid-cols-[16.25rem_1fr]">
        <div>
          <SectionLabel
            title={libraryText.identitySection()}
            description={
              library.sptVersion
                ? `${libraryText.identityDescription()} · ${libraryText.sptVersion(library.sptVersion)}`
                : libraryText.identityDescription()
            }
          />
          <SectionLabel
            title={libraryText.pathsSection()}
            description={libraryText.pathsDescription()}
          />
        </div>

        <div className="min-w-0">
          <div className="mb-4 flex gap-2">
            <FidelityInput
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              aria-label={libraryText.nameLabel()}
              className="font-semibold"
            />
            <FidelityButton
              disabled={!nameDirty}
              busy={renaming}
              onClick={() => void handleRename()}
            >
              {libraryText.saveName()}
            </FidelityButton>
          </div>

          <PathRow
            label={libraryText.gameRootLabel()}
            path={library.gameRoot}
            onOpen={() => void openGameRoot(library)}
          />
          <PathRow
            label={libraryText.libraryRootLabel()}
            path={library.libraryRoot}
            onOpen={() => void openLibraryRoot(library)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <FidelityButton
            variant="ghost"
            className="text-[13px] font-semibold text-muted-foreground"
            disabled={!isActive}
            busy={busy}
            title={isActive ? undefined : libraryText.rebuildNeedsActive()}
            onClick={() => void rebuildLibraryCache(library.id)}
          >
            {!busy && <RefreshCw />}
            {libraryText.rebuildCache()}
          </FidelityButton>
          <FidelityButton
            variant="ghost"
            className="text-[13px] font-semibold text-destructive hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            {libraryText.deleteLibrary()}
          </FidelityButton>
        </div>
        <FidelityButton
          className="px-4"
          disabled={isActive}
          busy={activating}
          onClick={() => void handleActivate()}
        >
          {isActive ? libraryText.activated() : libraryText.activate()}
        </FidelityButton>
      </div>

      <DeleteLibraryConfirmDialog
        library={library}
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onDeleted={() => {}}
      />
    </>
  )
}

function SectionLabel({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="mb-7">
      <h3 className="font-heading mb-1 text-[13px] font-semibold text-foreground">
        {title}
      </h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

function PathRow({
  label,
  path,
  onOpen,
}: {
  label: string
  path: string
  onOpen: () => void
}) {
  const nativeDesktop = useNativeDesktopShell()
  async function handleCopy() {
    await navigator.clipboard.writeText(path)
    toast.success(libraryText.pathCopied())
  }

  return (
    <div className="mb-2 flex min-h-9 items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5">
      <span className="shrink-0 text-xs font-semibold text-foreground">
        {label}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
        title={path}
      >
        {path}
      </span>
      <FidelityIconButton
        size="sm"
        variant="secondary"
        className="bg-transparent"
        aria-label={libraryText.copyPath()}
        title={libraryText.copyPath()}
        onClick={() => void handleCopy()}
      >
        <Copy />
      </FidelityIconButton>
      {nativeDesktop && (
        <FidelityIconButton
          size="sm"
          variant="secondary"
          className="bg-transparent"
          aria-label={libraryText.openInExplorer()}
          title={libraryText.openInExplorer()}
          onClick={onOpen}
        >
          <FolderOpen />
        </FidelityIconButton>
      )}
    </div>
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
