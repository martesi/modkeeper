import { useState } from 'react'
import { useAtomValue } from 'jotai'
import { Plus, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FidelityIconButton } from '../shared/components/fidelity-icon-button'
import {
  activeLibraryAtom,
  activeLibraryToolsAtom,
  libraryBusyAtom,
  modListAtom,
} from '../state/library-state'
import { syncMods } from '../data/library-repository'
import { launchTool } from '../data/tools-repository'
import { useArchiveFilePicker } from '../shared/hooks/use-archive-file-picker'
import { libraryText } from '../i18n/library-text'
import { LibraryActivateEmptyState } from './library-activate-empty-state'
import { LibraryDropEmptyState } from './library-drop-empty-state'
import { ModGridToolbar } from './mod-grid-toolbar'
import { ModGrid } from './mod-grid'
import { ManageLibraryDialog } from './manage-library/manage-library-dialog'
import { ToolIconGlyph } from './tool-icon-glyph'
import type { ToolSummary } from '../data/redesign-types'

/**
 * Library screen (reference Modkeeper.dc.html library view): clickable page header (opens Manage
 * Library) with the pill toolbar on the right — registered tools, sync, add mod — then the content
 * branch: activate empty state / drop zone / toolbar + grid.
 */
export function LibraryScreen() {
  const activeLibrary = useAtomValue(activeLibraryAtom)
  const mods = useAtomValue(modListAtom)
  const [manageOpen, setManageOpen] = useState(false)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="cursor-pointer rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          title={libraryText.manageLibraries()}
        >
          <h1 className="font-heading text-[26px] font-extrabold leading-tight text-foreground">
            {libraryText.title()}
          </h1>
          <p className="text-[13px] text-muted-foreground">
            {activeLibrary
              ? libraryText.subtitleModsInstalled(mods.length)
              : libraryText.subtitleEmpty()}
          </p>
        </button>

        {activeLibrary && <LibraryHeaderToolbar />}
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
 * The reference's floating pill toolbar: one round button per registered tool, a divider, the
 * sync affordance (spins while the library is busy, primary-tinted while the deployment is
 * stale), and the primary add-mod button.
 *
 * Note: the reference labels the spinner "Rebuild cache"; the real operation the library needs
 * here is the deploy Sync (rebuild lives in the Manage Library footer).
 */
function LibraryHeaderToolbar() {
  const activeLibrary = useAtomValue(activeLibraryAtom)
  const tools = useAtomValue(activeLibraryToolsAtom)
  const libraryBusy = useAtomValue(libraryBusyAtom)
  const pickAndInstall = useArchiveFilePicker()

  if (!activeLibrary) return null

  const syncTitle = libraryBusy
    ? libraryText.syncing()
    : activeLibrary.deployStale
      ? libraryText.deployStale()
      : libraryText.sync()

  return (
    <div className="mk-glass-standard flex shrink-0 items-center gap-2 rounded-full border border-border bg-card py-2 pl-3 pr-2.5 shadow-lg">
      {tools.map((tool) => (
        <ToolLaunchButton key={tool.id} tool={tool} />
      ))}
      {tools.length > 0 && <span className="h-4 w-px bg-border" aria-hidden />}
      <FidelityIconButton
        size="sm"
        className="rounded-full"
        aria-label={syncTitle}
        title={syncTitle}
        disabled={libraryBusy}
        onClick={() => void syncMods(activeLibrary.id)}
      >
        <RefreshCw
          className={cn(
            libraryBusy && 'animate-spin',
            activeLibrary.deployStale && 'text-primary',
          )}
        />
      </FidelityIconButton>
      <FidelityIconButton
        variant="primary"
        size="sm"
        className="rounded-full"
        aria-label={libraryText.addMod()}
        title={libraryText.addMod()}
        disabled={libraryBusy}
        onClick={() => void pickAndInstall()}
      >
        <Plus />
      </FidelityIconButton>
    </div>
  )
}

function ToolLaunchButton({ tool }: { tool: ToolSummary }) {
  return (
    <FidelityIconButton
      variant="soft"
      size="sm"
      className="rounded-full"
      aria-label={libraryText.launchToolLabel(tool.name)}
      title={tool.name}
      onClick={() => void launchTool(tool)}
    >
      <ToolIconGlyph tool={tool} />
    </FidelityIconButton>
  )
}
