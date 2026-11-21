import { useState, type ReactNode } from 'react'
import { pickFiles, platformKind } from '@/platform'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FidelityButton } from '../../shared/components/fidelity-button'
import { FidelityInput } from '../../shared/components/fidelity-input'
import { ToolIconGlyph } from '../tool-icon-glyph'
import {
  saveTool,
  deleteTool,
  type ToolDraft,
} from '../../data/tools-repository'
import { libraryText } from '../../i18n/library-text'
import { commonText } from '../../i18n/common-text'
import type { LibraryId, ToolSummary } from '../../data/redesign-types'
import { usePathInputDialog } from '../../shared/hooks/use-path-input-dialog'

/**
 * Configure Tool dialog (reference Modkeeper.dc.html): tool identity (name + optional icon URL),
 * executable path with a native Browse picker, and launch arguments. Arguments are stored but not
 * passed yet — launching goes through the opener plugin until the backend tool commands land
 * (tools-repository BACKEND GAP note).
 */
export function ConfigureToolDialog({
  libraryId,
  tool,
  open,
  onOpenChange,
}: {
  libraryId: LibraryId
  /** null → registering a new tool. */
  tool: ToolSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { requestPathInput, pathInputDialog } = usePathInputDialog()

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(48rem,calc(100vw-2rem))] rounded-lg bg-popover sm:max-w-none">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl font-semibold">
              {libraryText.configureToolTitle()}
            </DialogTitle>
            <DialogDescription>
              {libraryText.configureToolDescription()}
            </DialogDescription>
          </DialogHeader>
          {/* Keyed so the draft resets whenever a different tool (or "new") opens. */}
          <ConfigureToolForm
            key={tool?.id ?? 'new'}
            libraryId={libraryId}
            tool={tool}
            onClose={() => onOpenChange(false)}
            requestPathInput={requestPathInput}
          />
        </DialogContent>
      </Dialog>
      {pathInputDialog}
    </>
  )
}

function ConfigureToolForm({
  libraryId,
  tool,
  onClose,
  requestPathInput,
}: {
  libraryId: LibraryId
  tool: ToolSummary | null
  onClose: () => void
  requestPathInput: ReturnType<typeof usePathInputDialog>['requestPathInput']
}) {
  const [draft, setDraft] = useState<ToolDraft>({
    name: tool?.name ?? '',
    executablePath: tool?.executablePath ?? '',
    launchArgs: tool?.launchArgs ?? '',
    iconDataUrl: tool?.iconDataUrl ?? '',
  })

  const valid = draft.name.trim() !== '' && draft.executablePath.trim() !== ''

  function set(field: keyof ToolDraft) {
    return (event: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((prev) => ({ ...prev, [field]: event.target.value }))
  }

  async function handleBrowse() {
    const path =
      platformKind() === 'browser'
        ? ((
            await requestPathInput({
              mode: 'single',
              title: libraryText.executablePathDialogTitle(),
              description: libraryText.executablePathDialogDescription(),
              label: libraryText.executablePathLabel(),
              placeholder: libraryText.executablePathPlaceholder(),
            })
          )?.[0] ?? null)
        : await pickExecutable()
    if (path) setDraft((prev) => ({ ...prev, executablePath: path }))
  }

  function handleSave() {
    saveTool({ libraryId, toolId: tool?.id ?? null, draft })
    onClose()
  }

  function handleDelete() {
    if (!tool) return
    deleteTool({ libraryId, toolId: tool.id })
    onClose()
  }

  const previewTool: ToolSummary = {
    id: tool?.id ?? 'draft',
    libraryId,
    name: draft.name,
    executablePath: draft.executablePath,
    iconDataUrl: draft.iconDataUrl.trim() || undefined,
    launchArgs: draft.launchArgs.trim() || undefined,
    updatedAt: tool?.updatedAt ?? '',
  }

  return (
    <>
      <div className="grid gap-x-5 gap-y-4 md:grid-cols-[12.5rem_1fr]">
        <FieldLabel>{libraryText.toolIdentity()}</FieldLabel>
        <FidelityInput
          value={draft.name}
          onChange={set('name')}
          placeholder={libraryText.toolNamePlaceholder()}
          aria-label={libraryText.toolNamePlaceholder()}
        />

        <div className="hidden md:block" />
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-primary [&_svg]:size-4">
            <ToolIconGlyph tool={previewTool} />
          </span>
          <FidelityInput
            value={draft.iconDataUrl}
            onChange={set('iconDataUrl')}
            placeholder={libraryText.toolIconPlaceholder()}
            aria-label={libraryText.toolIconPlaceholder()}
          />
        </div>

        <FieldLabel>{libraryText.executablePathLabel()}</FieldLabel>
        <div className="flex gap-2">
          <FidelityInput
            value={draft.executablePath}
            onChange={set('executablePath')}
            placeholder={libraryText.executablePathPlaceholder()}
            aria-label={libraryText.executablePathLabel()}
          />
          <FidelityButton
            variant="secondary"
            onClick={() => void handleBrowse()}
          >
            {libraryText.browse()}
          </FidelityButton>
        </div>

        <FieldLabel>{libraryText.launchArgsLabel()}</FieldLabel>
        <div className="flex flex-col gap-1">
          <FidelityInput
            value={draft.launchArgs}
            onChange={set('launchArgs')}
            placeholder="-debug -nolog"
            aria-label={libraryText.launchArgsLabel()}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            {libraryText.launchArgsHint()}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <div>
          {tool && (
            <FidelityButton
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={handleDelete}
            >
              {libraryText.deleteTool()}
            </FidelityButton>
          )}
        </div>
        <div className="flex items-center gap-3">
          <FidelityButton variant="ghost" onClick={onClose}>
            {commonText.cancel()}
          </FidelityButton>
          <FidelityButton disabled={!valid} onClick={handleSave}>
            {libraryText.saveChanges()}
          </FidelityButton>
        </div>
      </div>
    </>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="pt-2 text-[13px] font-semibold text-foreground">
      {children}
    </span>
  )
}

async function pickExecutable(): Promise<string | null> {
  const [selection] = await pickFiles({
    title: libraryText.selectExecutable(),
    filters: [
      { name: libraryText.executable(), extensions: ['exe', 'bat', 'cmd'] },
    ],
  })
  return selection ?? null
}
