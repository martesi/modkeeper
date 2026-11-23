import { useLayoutEffect, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Check, ChevronLeft, ChevronRight, Download, Link2 } from 'lucide-react'
import { activeLibraryIdAtom } from '../state/library-state'
import type { ParentConstraintStatus } from './addon-constraints'
import type {
  AppSettings,
  ForgeDetail,
  ForgeVersionsPage,
  LibrarySummary,
  ModSummary,
} from '@/wails/contract'
import { saveSettings } from '../data/settings-repository'
import { registryText } from '../i18n/registry-text'
import { commonText } from '../i18n/common-text'
import { toast } from 'sonner'
import { LibraryActionIconButton } from '../library/library-action-icon-button'
import {
  filterForgeVersions,
  isForgeVersionIncompatible,
  shouldWarnForIncompatibleForgeVersion,
} from './forge-version-compatibility'

type ForgeVersion = ForgeVersionsPage['versions'][number]

export function ForgeVersionList({
  detail,
  versionsPage,
  activeLibrary,
  matchableMods,
  selectedLocalModId,
  hasParentBlock,
  parentStatus,
  isLibraryBusy,
  installingMap,
  matchingMap,
  isOffline,
  isRateLimited,
  rateLimitSecondsRemaining,
  isDetailStale,
  settings,
  versionPage,
  lastVersionPage,
  isVersionsLoading,
  error,
  onMatch,
  onInstall,
  onChangePage,
  onRetry,
}: {
  detail: ForgeDetail
  versionsPage: ForgeVersionsPage | null
  activeLibrary: LibrarySummary | null
  matchableMods: ModSummary[]
  selectedLocalModId: string
  hasParentBlock: boolean
  parentStatus: ParentConstraintStatus
  isLibraryBusy: boolean
  installingMap: Record<string, string>
  matchingMap: Record<string, boolean>
  isOffline: boolean
  isRateLimited: boolean
  rateLimitSecondsRemaining: number
  isDetailStale: boolean
  settings: AppSettings | null
  versionPage: number
  lastVersionPage: number
  isVersionsLoading: boolean
  error: string | null
  onMatch: (version: ForgeVersion) => void
  onInstall: (version: ForgeVersion, libraryId: string) => void
  onChangePage: (next: number | ((page: number) => number)) => void
  onRetry: () => void
}) {
  const [compatibleOnly, setCompatibleOnly] = useState(false)
  const [pendingInstall, setPendingInstall] = useState<{
    version: ForgeVersion
    libraryId: string
    spt: string
  } | null>(null)
  const [disableWarning, setDisableWarning] = useState(false)
  const activeLibraryId = useAtomValue(activeLibraryIdAtom)
  const activeLibraryIdRef = useRef(activeLibraryId)
  const currentPendingInstall =
    pendingInstall?.libraryId === activeLibraryId ? pendingInstall : null
  useLayoutEffect(() => {
    activeLibraryIdRef.current = activeLibraryId
  }, [activeLibraryId])

  const versions = versionsPage?.versions ?? []
  const visibleVersions = filterForgeVersions(
    versions,
    activeLibrary?.sptVersion,
    compatibleOnly,
  )

  function closeWarning() {
    setPendingInstall(null)
    setDisableWarning(false)
  }

  function confirmInstall() {
    const pending = pendingInstall
    if (!pending) return
    if (activeLibraryIdRef.current !== pending.libraryId) {
      closeWarning()
      toast.error(registryText.installLibraryChanged())
      return
    }
    closeWarning()
    if (!disableWarning || !settings) {
      onInstall(pending.version, pending.libraryId)
      return
    }
    void saveSettings({ warnIncompatibleForgeInstall: false }).then(() => {
      if (activeLibraryIdRef.current === pending.libraryId) {
        onInstall(pending.version, pending.libraryId)
        return
      }
      toast.error(registryText.installLibraryChanged())
    })
  }

  return (
    <>
      <AlertDialog
        open={currentPendingInstall !== null}
        onOpenChange={(open) => {
          if (!open) closeWarning()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {registryText.incompatibleInstallTitle()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {currentPendingInstall &&
                registryText.incompatibleInstallDescription(
                  currentPendingInstall.version.version,
                  currentPendingInstall.spt,
                )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={disableWarning}
              onChange={(event) =>
                setDisableWarning(event.currentTarget.checked)
              }
            />
            {registryText.dontShowIncompatibleWarning()}
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>{commonText.cancel()}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmInstall}>
              {registryText.installAnyway()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section aria-label={registryText.versionsHeader()} className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {registryText.versionsHeader()}
          </h3>
          {versionsPage && (
            <span className="text-xs text-muted-foreground">
              {visibleVersions.length} version(s)
            </span>
          )}
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={compatibleOnly}
            onChange={(event) => setCompatibleOnly(event.currentTarget.checked)}
          />
          {registryText.compatibleVersionsOnly()}
        </label>

        {versionsPage && visibleVersions.length > 0 ? (
          <div className="divide-y divide-border rounded-md border border-border bg-background/30">
            {visibleVersions.map((version) => (
              <ForgeVersionRow
                key={version.id}
                version={version}
                isLatest={version.id === versions[0]?.id && versionPage === 1}
                detail={detail}
                activeLibrary={activeLibrary}
                matchableMods={matchableMods}
                selectedLocalModId={selectedLocalModId}
                hasParentBlock={hasParentBlock}
                parentStatus={parentStatus}
                isLibraryBusy={isLibraryBusy}
                installingMap={installingMap}
                matchingMap={matchingMap}
                isOffline={isOffline}
                isRateLimited={isRateLimited}
                rateLimitSecondsRemaining={rateLimitSecondsRemaining}
                isDetailStale={isDetailStale}
                onMatch={onMatch}
                onInstall={(selectedVersion) => {
                  if (!activeLibrary) return
                  if (
                    shouldWarnForIncompatibleForgeVersion(
                      isForgeVersionIncompatible(
                        selectedVersion,
                        activeLibrary.sptVersion,
                      ),
                      settings?.warnIncompatibleForgeInstall !== false,
                    )
                  ) {
                    setPendingInstall({
                      version: selectedVersion,
                      libraryId: activeLibrary.id,
                      spt: activeLibrary.sptVersion ?? '',
                    })
                    return
                  }
                  onInstall(selectedVersion, activeLibrary.id)
                }}
              />
            ))}
          </div>
        ) : (
          <div className="p-3 text-center text-xs text-muted-foreground">
            {versionsPage && compatibleOnly
              ? registryText.noCompatibleVersions()
              : registryText.detailNoVersions()}
          </div>
        )}
        {error && (
          <div
            className="flex items-center justify-between gap-2 text-xs text-destructive"
            role="alert"
          >
            <span>{registryText.detailVersionsLoadFailed()}</span>
            <button
              type="button"
              className="rounded px-2 py-1 font-medium hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onRetry}
            >
              {registryText.detailRetryVersions()}
            </button>
          </div>
        )}
        {versionsPage && lastVersionPage > 1 && (
          <div className="flex items-center justify-end gap-2 pt-2">
            <LibraryActionIconButton
              icon={ChevronLeft}
              label={registryText.paginationPrev()}
              disabled={versionPage <= 1 || isVersionsLoading}
              onClick={() => onChangePage((page) => Math.max(1, page - 1))}
              className="size-7"
            />
            <span className="text-[11px] text-muted-foreground">
              {registryText.paginationPage(
                versionsPage.pagination.currentPage ?? versionPage,
                lastVersionPage,
              )}
            </span>
            <LibraryActionIconButton
              icon={ChevronRight}
              label={registryText.paginationNext()}
              disabled={versionPage >= lastVersionPage || isVersionsLoading}
              onClick={() =>
                onChangePage((page) => Math.min(lastVersionPage, page + 1))
              }
              className="size-7"
            />
          </div>
        )}
      </section>
    </>
  )
}

function ForgeVersionRow({
  version,
  isLatest,
  detail,
  activeLibrary,
  matchableMods,
  selectedLocalModId,
  hasParentBlock,
  parentStatus,
  isLibraryBusy,
  installingMap,
  matchingMap,
  isOffline,
  isRateLimited,
  rateLimitSecondsRemaining,
  isDetailStale,
  onMatch,
  onInstall,
}: {
  version: ForgeVersion
  isLatest: boolean
  detail: ForgeDetail
  activeLibrary: LibrarySummary | null
  matchableMods: ModSummary[]
  selectedLocalModId: string
  hasParentBlock: boolean
  parentStatus: ParentConstraintStatus
  isLibraryBusy: boolean
  installingMap: Record<string, string>
  matchingMap: Record<string, boolean>
  isOffline: boolean
  isRateLimited: boolean
  rateLimitSecondsRemaining: number
  isDetailStale: boolean
  onMatch: (version: ForgeVersion) => void
  onInstall: (version: ForgeVersion) => void
}) {
  const key = `${version.kind}:${version.itemId}:${version.id}`
  const isBusy = Boolean(installingMap[key])
  const incompatible = isForgeVersionIncompatible(
    version,
    activeLibrary?.sptVersion,
  )
  const installed = matchableMods.some(
    (mod) => mod.forgeGuid === detail.guid && mod.forgeVersionId === version.id,
  )
  const matchKey = `${version.kind}:${version.itemId}:${version.id}:${selectedLocalModId}`
  const matching = Boolean(selectedLocalModId && matchingMap[matchKey])
  const installDisabled =
    isOffline ||
    isRateLimited ||
    isDetailStale ||
    isBusy ||
    isLibraryBusy ||
    installed ||
    hasParentBlock ||
    !activeLibrary
  const tooltip =
    isRateLimited || isOffline || isDetailStale
      ? isRateLimited
        ? registryText.installDisabledRateLimited(rateLimitSecondsRemaining)
        : registryText.installDisabledOffline()
      : installed
        ? registryText.actionInstalled()
        : isBusy
          ? registryText.actionInstalling()
          : parentStatus.status === 'unverified'
            ? registryText.statusParentUnverified(parentStatus.parentName)
            : hasParentBlock
              ? registryText.detailRequiresParent(
                  detail.parent?.name ?? 'parent mod',
                )
              : incompatible
                ? registryText.statusSptIncompatible(
                    activeLibrary?.sptVersion ?? '',
                  )
                : registryText.actionInstall()

  return (
    <div className="flex items-center justify-between gap-3 p-3 text-xs">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">
            v{version.version}
          </span>
          {isLatest && (
            <span className="rounded bg-primary/10 px-1.5 py-0.2 text-[10px] font-medium text-primary">
              {registryText.latestVersion()}
            </span>
          )}
          {version.contentLength && (
            <span className="text-muted-foreground">
              {formatBytes(version.contentLength)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {version.sptVersionConstraint && (
            <span
              className={`rounded px-1.5 py-0.5 ${incompatible ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}
            >
              SPT {version.sptVersionConstraint}
            </span>
          )}
          {version.description && (
            <p className="line-clamp-1 italic">{version.description}</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <LibraryActionIconButton
          icon={Link2}
          label={registryText.actionMatchInstalled()}
          tooltip={registryText.actionMatchInstalled()}
          busy={matching}
          disabled={
            !activeLibrary ||
            !selectedLocalModId ||
            isLibraryBusy ||
            isOffline ||
            isRateLimited ||
            isDetailStale ||
            matching ||
            installed
          }
          onClick={() => onMatch(version)}
          className="size-8"
        />
        <LibraryActionIconButton
          icon={installed ? Check : Download}
          label={tooltip}
          tooltip={tooltip}
          busy={isBusy}
          disabled={installDisabled}
          onClick={() => onInstall(version)}
          className="size-8"
        />
      </div>
    </div>
  )
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '—'
  const kb = bytes / 1024
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`
}
