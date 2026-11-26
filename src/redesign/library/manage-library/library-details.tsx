import { useState } from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { Copy, FolderOpen, RefreshCw } from 'lucide-react'
import { FidelityButton } from '../../shared/components/fidelity-button'
import { FidelityIconButton } from '../../shared/components/fidelity-icon-button'
import { FidelityInput } from '../../shared/components/fidelity-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  activeLibraryIdAtom,
  pendingTasksAtom,
} from '../../state/library-state'
import {
  activateLibrary,
  loadLibraryWorkspace,
  rebuildLibraryCache,
  renameLibrary,
  setDeploymentPolicy,
} from '../../data/library-repository'
import { isLibrarySummary } from '../../data/redesign-types'
import type {
  LibrarySummary,
  DeploymentMethod,
  TargetRuntime,
} from '../../data/redesign-types'
import { openGameRoot, openLibraryRoot } from '../../shared/utils/app-opener'
import { libraryText } from '../../i18n/library-text'
import { DeleteLibraryConfirmDialog } from './delete-library-confirm-dialog'
import { useNativeDesktopShell } from '@/platform/use-native-desktop-shell'

export function LibraryDetails({ library }: { library: LibrarySummary }) {
  const activeLibraryId = useAtomValue(activeLibraryIdAtom)
  const pendingTasks = useAtomValue(pendingTasksAtom)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [activating, setActivating] = useState(false)
  const [nameDraft, setNameDraft] = useState(library.name)
  const [renaming, setRenaming] = useState(false)
  const [runtimeDraft, setRuntimeDraft] = useState<TargetRuntime>(
    library.targetRuntime,
  )
  const [methodDraft, setMethodDraft] = useState<DeploymentMethod>(
    library.deploymentMethod,
  )
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [policyOutcomeUnknown, setPolicyOutcomeUnknown] = useState(false)

  const isActive = library.id === activeLibraryId
  const busy = pendingTasks.some((task) => task.libraryId === library.id)
  const nameDirty = nameDraft.trim() !== library.name && nameDraft.trim() !== ''
  const policyDirty =
    runtimeDraft !== library.targetRuntime ||
    methodDraft !== library.deploymentMethod
  const policyEditable =
    isActive &&
    !busy &&
    !library.policyUncertain &&
    !policyOutcomeUnknown &&
    library.hostRuntime === 'linux'

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

  async function handleSavePolicy() {
    if (!policyEditable || savingPolicy || !policyDirty) return
    setSavingPolicy(true)
    const outcome = await setDeploymentPolicy({
      libraryId: library.id,
      targetRuntime: runtimeDraft,
      deploymentMethod: methodDraft,
    })
    setPolicyOutcomeUnknown(outcome.policyOutcomeUnknown)
    const saved = outcome.workspace.libraries.find(
      (entry) => isLibrarySummary(entry) && entry.id === library.id,
    )
    if (
      !outcome.policyOutcomeUnknown &&
      saved &&
      isLibrarySummary(saved) &&
      !saved.policyUncertain
    ) {
      setRuntimeDraft(saved.targetRuntime)
      setMethodDraft(saved.deploymentMethod)
    }
    setSavingPolicy(false)
  }

  async function handleRefreshPolicyStatus() {
    const workspace = await loadLibraryWorkspace()
    const refreshed = workspace?.libraries.find(
      (entry) => isLibrarySummary(entry) && entry.id === library.id,
    )
    const uncertain =
      !refreshed || !isLibrarySummary(refreshed) || refreshed.policyUncertain
    setPolicyOutcomeUnknown(uncertain)
    if (!uncertain && isLibrarySummary(refreshed)) {
      setRuntimeDraft(refreshed.targetRuntime)
      setMethodDraft(refreshed.deploymentMethod)
    }
  }

  function changeRuntime(value: string) {
    if (value !== 'windows' && value !== 'linux') return
    setRuntimeDraft(value)
    if (value === 'linux' && methodDraft === 'copy-first')
      setMethodDraft('copy')
  }

  function changeMethod(value: string) {
    if (value === 'copy' || value === 'link') setMethodDraft(value)
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
          <SectionLabel
            title={libraryText.deploymentPolicySection()}
            description={libraryText.deploymentPolicyDescription()}
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
          <div className="mt-5 grid gap-3 rounded-md border border-border bg-secondary/50 p-3">
            <label className="grid gap-1 text-xs font-semibold text-foreground">
              {libraryText.targetRuntimeLabel()}
              <Select
                value={runtimeDraft}
                onValueChange={changeRuntime}
                disabled={!policyEditable || savingPolicy}
              >
                <SelectTrigger aria-label={libraryText.targetRuntimeLabel()}>
                  <SelectValue
                    placeholder={libraryText.policyRecoveryRequired()}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="windows" disabled>
                    {libraryText.windowsRuntimeUnverified()}
                  </SelectItem>
                  <SelectItem
                    value="linux"
                    disabled={library.hostRuntime !== 'linux'}
                  >
                    {libraryText.linuxRuntime()}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-foreground">
              {libraryText.deploymentMethodLabel()}
              <Select
                value={methodDraft}
                onValueChange={changeMethod}
                disabled={
                  !policyEditable || runtimeDraft !== 'linux' || savingPolicy
                }
              >
                <SelectTrigger aria-label={libraryText.deploymentMethodLabel()}>
                  <SelectValue
                    placeholder={libraryText.policyRecoveryRequired()}
                  />
                </SelectTrigger>
                <SelectContent>
                  {methodDraft === 'copy-first' && (
                    <SelectItem value="copy-first" disabled>
                      {libraryText.legacyCopyFirst()}
                    </SelectItem>
                  )}
                  <SelectItem value="copy">
                    {libraryText.copyMethod()}
                  </SelectItem>
                  <SelectItem value="link">
                    {libraryText.linkMethod()}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
            <p className="text-xs text-muted-foreground">
              {library.policyUncertain || policyOutcomeUnknown
                ? libraryText.policyRecoveryRequired()
                : library.hostRuntime === 'wsl'
                  ? libraryText.wslPolicyUnverified()
                  : library.hostRuntime === 'windows'
                    ? libraryText.windowsPolicyUnverified()
                    : library.hostRuntime !== 'linux'
                      ? libraryText.unknownHostPolicyUnverified()
                      : libraryText.policyActiveIdleOnly()}
            </p>
            <div>
              <FidelityButton
                disabled={!policyEditable || !policyDirty || savingPolicy}
                busy={savingPolicy}
                onClick={() => void handleSavePolicy()}
              >
                {libraryText.saveDeploymentPolicy()}
              </FidelityButton>
            </div>
            {(library.policyUncertain || policyOutcomeUnknown) && (
              <FidelityButton
                variant="ghost"
                disabled={savingPolicy}
                onClick={() => void handleRefreshPolicyStatus()}
              >
                {libraryText.refreshPolicyStatus()}
              </FidelityButton>
            )}
          </div>
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
