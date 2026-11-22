import { useEffect, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Link2,
  ShieldCheck,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { hasNativeWindowChrome, openUrl } from '@/platform'
import semver from 'semver'
import type { ForgeDetail, ForgeVersionsPage } from '@gen/bindings'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  selectedRegistryItemAtom,
  registryInstallingMapAtom,
  registryMatchingMapAtom,
  registryRateLimitedUntilAtom,
  registrySearchAtom,
} from '../state/registry-state'
import {
  activeLibraryAtom,
  modListAtom,
  libraryBusyAtom,
} from '../state/library-state'
import {
  evaluateAddonParentConstraint,
  getForgeModDetail,
  getForgeModVersions,
  installForgeVersion,
  matchInstalledMod,
} from '../data/registry-repository'
import { registryText } from '../i18n/registry-text'
import { LibraryActionIconButton } from '../library/library-action-icon-button'
import { RegistryThumbnail } from './registry-thumbnail'
import {
  ModBadge,
  AddonBadge,
  StandaloneBadge,
  FikaBadge,
  ParentStatusBadge,
  ParentLinkBadge,
} from './registry-item-badges'

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '—'
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

export function RegistryDetailInspector({
  isOffline = false,
  onOpenParentHelp,
}: {
  isOffline?: boolean
  onOpenParentHelp?: (item: ForgeDetail) => void
}) {
  const [selected, setSelected] = useAtom(selectedRegistryItemAtom)
  const setSearch = useSetAtom(registrySearchAtom)
  const activeLibrary = useAtomValue(activeLibraryAtom)
  const installedMods = useAtomValue(modListAtom)
  const isLibraryBusy = useAtomValue(libraryBusyAtom)
  const installingMap = useAtomValue(registryInstallingMapAtom)
  const matchingMap = useAtomValue(registryMatchingMapAtom)
  const rateLimitedUntil = useAtomValue(registryRateLimitedUntilAtom)
  const [currentEpoch, setCurrentEpoch] = useState(() => Date.now())
  const isRateLimited =
    rateLimitedUntil !== null && currentEpoch < rateLimitedUntil
  const rateLimitSecondsRemaining = isRateLimited
    ? Math.max(1, Math.ceil((rateLimitedUntil - currentEpoch) / 1000))
    : 0
  const matchableMods = activeLibrary
    ? installedMods.filter((mod) => mod.libraryId === activeLibrary.id)
    : []

  const [data, setData] = useState<{
    key: string
    detail: ForgeDetail
    versions: ForgeVersionsPage
    loadedVersionPage: number
  } | null>(null)
  const [versionPageState, setVersionPageState] = useState<{
    key: string | null
    page: number
  }>({ key: null, page: 1 })
  const [versionRetryKey, setVersionRetryKey] = useState(0)
  const [detailRetryKey, setDetailRetryKey] = useState(0)
  const [localModSelection, setLocalModSelection] = useState<{
    key: string | null
    modId: string
  }>({ key: null, modId: '' })
  const [loadError, setLoadError] = useState<{
    key: string
    message: string
  } | null>(null)

  const selectedKind = selected?.kind
  const selectedId = selected?.id
  const selectedKey =
    selectedKind && selectedId !== undefined
      ? `${selectedKind}:${selectedId}`
      : null
  const selectedLocalModId =
    localModSelection.key === selectedKey ? localModSelection.modId : ''
  const detail = data && data.key === selectedKey ? data.detail : null
  const versionsPage = data && data.key === selectedKey ? data.versions : null
  const lastVersionPage = versionsPage?.pagination.lastPage ?? 1
  const versionPage =
    versionPageState.key === selectedKey ? versionPageState.page : 1
  const error = loadError?.key === selectedKey ? loadError.message : null
  const isLoading = Boolean(selectedKey && !detail && !error)
  const isVersionsLoading = Boolean(
    selectedKey &&
    !error &&
    (!versionsPage ||
      data?.key !== selectedKey ||
      data?.loadedVersionPage !== versionPage),
  )

  useEffect(() => {
    if (rateLimitedUntil === null) return
    const timer = window.setInterval(() => {
      const now = Date.now()
      setCurrentEpoch(now)
      if (now >= rateLimitedUntil) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [rateLimitedUntil])

  function changeVersionPage(nextPage: number | ((page: number) => number)) {
    if (!selectedKey) return
    const currentPage =
      versionPageState.key === selectedKey ? versionPageState.page : 1
    const page =
      typeof nextPage === 'function' ? nextPage(currentPage) : nextPage
    setVersionPageState({ key: selectedKey, page })
  }

  useEffect(() => {
    if (
      !selectedKey ||
      !selectedKind ||
      selectedId === undefined ||
      isRateLimited
    ) {
      return
    }

    let isSubscribed = true
    const currentSelected = { kind: selectedKind, id: selectedId }
    const currentKey = selectedKey

    void Promise.all([
      getForgeModDetail(currentSelected.kind, currentSelected.id),
      getForgeModVersions(currentSelected.kind, currentSelected.id, 1),
    ])
      .then(([detailData, versionsData]) => {
        if (!isSubscribed) return
        setData({
          key: currentKey,
          detail: detailData,
          versions: versionsData,
          loadedVersionPage: 1,
        })
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (!isSubscribed) return
        console.error('[registry] detail request failed', err)
        setLoadError({
          key: currentKey,
          message: registryText.detailLoadFailed(),
        })
      })

    return () => {
      isSubscribed = false
    }
  }, [selectedKey, selectedKind, selectedId, detailRetryKey, isRateLimited])

  useEffect(() => {
    if (
      !selectedKey ||
      !selectedKind ||
      selectedId === undefined ||
      isRateLimited ||
      data?.key !== selectedKey ||
      data.loadedVersionPage === versionPage
    ) {
      return
    }

    let isSubscribed = true
    const currentSelected = { kind: selectedKind, id: selectedId }
    const currentKey = selectedKey

    void getForgeModVersions(
      currentSelected.kind,
      currentSelected.id,
      versionPage,
    )
      .then((versions) => {
        if (!isSubscribed) return
        setData((current) =>
          current?.key === currentKey
            ? { ...current, versions, loadedVersionPage: versionPage }
            : current,
        )
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (!isSubscribed) return
        console.error('[registry] versions request failed', err)
        setLoadError({
          key: currentKey,
          message: registryText.detailVersionsLoadFailed(),
        })
      })

    return () => {
      isSubscribed = false
    }
  }, [
    data,
    selectedKey,
    selectedKind,
    selectedId,
    versionPage,
    versionRetryKey,
    isRateLimited,
  ])

  if (!selected) return null

  function handleClose() {
    setSelected(null)
  }

  async function handleOpenExternal(url: string | null | undefined) {
    if (!url) return
    // A server or browser page opens the link in the user's local tab. Asking
    // the server host to open it would target a desktop nobody is looking at.
    if (!hasNativeWindowChrome()) {
      window.open(url, '_blank', 'noopener,noreferrer')
      return
    }
    try {
      await openUrl(url)
    } catch {
      window.open(url, '_blank')
    }
  }

  const parentStatus = detail
    ? evaluateAddonParentConstraint({ addon: detail, installedMods })
    : { status: 'standalone' as const }
  const hasParentBlock =
    parentStatus.status === 'missing' ||
    parentStatus.status === 'mismatch' ||
    parentStatus.status === 'unverified'
  const isDetailStale = Boolean(detail?.stale || versionsPage?.stale)
  const installDisabledOffline = isOffline || isDetailStale || isRateLimited

  return (
    <aside
      aria-label={detail?.name ?? registryText.title()}
      className="mk-registry-inspector-enter relative flex h-full w-[45vw] min-w-0 max-w-[45vw] shrink-0 flex-col overflow-hidden border-l border-border bg-card/90 backdrop-blur-md max-[800px]:absolute max-[800px]:inset-0 max-[800px]:z-20 max-[800px]:w-full max-[800px]:max-w-none"
    >
      {/* Top action bar */}
      <div className="flex items-center justify-between border-b border-border p-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {detail?.kind === 'addon'
            ? registryText.badgeAddon()
            : registryText.badgeMod()}{' '}
          {registryText.detailHeading()}
        </span>
        <button
          type="button"
          onClick={handleClose}
          aria-label={registryText.closeDetail()}
          title={registryText.closeDetail()}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {isRateLimited && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>
            {registryText.rateLimitedNotice(rateLimitSecondsRemaining)}
          </span>
        </div>
      )}
      {isDetailStale && (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--muted)] px-4 py-2 text-xs text-[var(--muted-foreground)]"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>{registryText.staleCacheNotice()}</span>
        </div>
      )}

      <div className="mk-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-3 sm:p-4">
        {isRateLimited && !detail ? (
          <div className="flex h-40 items-center justify-center text-center text-xs text-muted-foreground">
            {registryText.rateLimitedNotice(rateLimitSecondsRemaining)}
          </div>
        ) : isLoading && !detail ? (
          <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
            {registryText.detailLoading()}
          </div>
        ) : error && !detail ? (
          <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
            <p>{error}</p>
            <button
              type="button"
              className="mt-2 rounded px-2 py-1 font-medium hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setLoadError(null)
                setDetailRetryKey((key) => key + 1)
              }}
            >
              {registryText.detailRetryVersions()}
            </button>
          </div>
        ) : detail ? (
          <>
            {/* Header: Thumbnail + Title + Metadata */}
            <div className="flex items-start gap-3.5">
              <RegistryThumbnail
                name={detail.name}
                thumbnail={detail.thumbnail}
                kind={detail.kind}
                size="icons"
              />
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold leading-tight text-foreground">
                  {detail.name}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {detail.kind === 'mod' ? (
                    <ModBadge />
                  ) : detail.isDetached ? (
                    <StandaloneBadge />
                  ) : (
                    <AddonBadge />
                  )}
                  {detail.fikaCompatibility && <FikaBadge />}
                </div>

                {detail.detailUrl && (
                  <button
                    type="button"
                    onClick={() => handleOpenExternal(detail.detailUrl)}
                    className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <span>{registryText.actionViewOnForge()}</span>
                    <ExternalLink className="size-3" aria-hidden />
                  </button>
                )}
              </div>
            </div>

            {/* Addon Parent Requirement Card */}
            {detail.kind === 'addon' && !detail.isDetached && (
              <div className="rounded-md border border-[color-mix(in_srgb,var(--primary)_24%,transparent)] bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[var(--primary)]">
                    {registryText.parentModRequirements()}
                  </span>
                  <ParentStatusBadge status={parentStatus} />
                </div>
                <div className="mt-2 text-muted-foreground">
                  <p>
                    {registryText.detailParentRequirement(
                      detail.parent?.name ?? 'Parent Mod',
                      detail.modVersionConstraint ?? '*',
                    )}
                  </p>
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <ParentLinkBadge
                    parentName={detail.parent?.name ?? 'Parent Mod'}
                    onClick={() => {
                      const parent = detail.parent
                      if (parent?.id) {
                        setSelected({ kind: 'mod', id: parent.id })
                      } else if (parent?.name) {
                        setSearch(parent.name)
                        setSelected(null)
                      }
                    }}
                  />
                  {hasParentBlock && onOpenParentHelp && (
                    <button
                      type="button"
                      onClick={() => onOpenParentHelp(detail)}
                      className="text-xs text-[var(--muted-foreground)] hover:underline"
                    >
                      {registryText.detailResolveDependency()}
                    </button>
                  )}
                </div>
              </div>
            )}

            <section className="space-y-2 rounded-md border border-border bg-background/30 p-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {registryText.matchSectionHeader()}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {registryText.matchSectionDescription()}
                </p>
              </div>
              {matchableMods.length > 0 ? (
                <div className="space-y-1.5">
                  <label
                    className="text-xs font-medium text-foreground"
                    htmlFor="registry-local-mod-match"
                  >
                    {registryText.matchExistingInstallLabel()}
                  </label>
                  <Select
                    value={selectedLocalModId}
                    onValueChange={(modId) =>
                      setLocalModSelection({ key: selectedKey, modId })
                    }
                    disabled={!activeLibrary || isLibraryBusy || isRateLimited}
                  >
                    <SelectTrigger
                      id="registry-local-mod-match"
                      className="h-8 text-xs"
                    >
                      <SelectValue
                        placeholder={registryText.matchSelectPlaceholder()}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {matchableMods.map((mod) => (
                        <SelectItem key={mod.id} value={mod.id}>
                          {mod.name}
                          {mod.version ? ` — v${mod.version}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {registryText.matchNoLocalMods()}
                </p>
              )}
            </section>

            {/* Archive Safety Note */}
            <div className="flex items-start gap-2 rounded-md border border-border bg-background/50 p-2.5 text-xs text-muted-foreground">
              <ShieldCheck
                className="mt-0.5 size-4 shrink-0 text-[var(--primary)]"
                aria-hidden
              />
              <span>{registryText.archiveSafetyNote()}</span>
            </div>

            {/* Markdown Description */}
            {detail.description && (
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {registryText.detailDescription()}
                </h3>
                <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border border-border bg-background/30 p-3 text-xs leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {detail.description}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* Versions & Compatibility List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {registryText.versionsHeader()}
                </h3>
                {versionsPage && (
                  <span className="text-xs text-muted-foreground">
                    {versionsPage.versions.length} version(s)
                  </span>
                )}
              </div>

              {versionsPage && versionsPage.versions.length > 0 ? (
                <div className="divide-y divide-border rounded-md border border-border bg-background/30">
                  {versionsPage.versions.map((ver, idx) => {
                    const installKey = `${ver.kind}:${ver.itemId}:${ver.id}`
                    const isBusy = Boolean(installingMap[installKey])
                    const sptConstraint = ver.sptVersionConstraint ?? ''
                    const activeSpt = activeLibrary?.sptVersion
                    const activeSptSemver = activeSpt
                      ? semver.coerce(activeSpt)
                      : null
                    const isSptIncompatible = Boolean(
                      activeSptSemver &&
                      sptConstraint &&
                      semver.validRange(sptConstraint) &&
                      !semver.satisfies(activeSptSemver, sptConstraint),
                    )

                    const isInstalled = matchableMods.some((metadata) => {
                      return (
                        metadata.forgeGuid === detail.guid &&
                        metadata.forgeVersionId === ver.id
                      )
                    })
                    const matchKey = `${ver.kind}:${ver.itemId}:${ver.id}:${selectedLocalModId}`
                    const isMatching = Boolean(
                      selectedLocalModId && matchingMap[matchKey],
                    )

                    let tooltip = isInstalled
                      ? registryText.actionInstalled()
                      : registryText.actionInstall()
                    if (installDisabledOffline) {
                      tooltip = isRateLimited
                        ? registryText.installDisabledRateLimited(
                            rateLimitSecondsRemaining,
                          )
                        : registryText.installDisabledOffline()
                    } else if (isBusy) {
                      tooltip = registryText.actionInstalling()
                    } else if (parentStatus.status === 'unverified') {
                      tooltip = registryText.statusParentUnverified(
                        parentStatus.parentName,
                      )
                    } else if (hasParentBlock) {
                      tooltip = registryText.detailRequiresParent(
                        detail.parent?.name ?? 'parent mod',
                      )
                    } else if (isSptIncompatible) {
                      tooltip = registryText.statusSptIncompatible(
                        activeSpt ?? '',
                      )
                    }

                    return (
                      <div
                        key={ver.id}
                        className="flex items-center justify-between gap-3 p-3 text-xs"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground">
                              v{ver.version}
                            </span>
                            {idx === 0 && versionPage === 1 && (
                              <span className="rounded bg-primary/10 px-1.5 py-0.2 text-[10px] font-medium text-primary">
                                {registryText.latestVersion()}
                              </span>
                            )}
                            {ver.contentLength && (
                              <span className="text-muted-foreground">
                                {formatBytes(ver.contentLength)}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            {sptConstraint && (
                              <span
                                className={`rounded px-1.5 py-0.5 ${
                                  isSptIncompatible
                                    ? 'bg-destructive/10 text-destructive'
                                    : 'bg-muted text-muted-foreground'
                                }`}
                              >
                                SPT {sptConstraint}
                              </span>
                            )}
                            {ver.description && (
                              <p className="line-clamp-1 italic">
                                {ver.description}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Version Action Button */}
                        <div className="flex shrink-0 items-center gap-1.5">
                          <LibraryActionIconButton
                            icon={Link2}
                            label={registryText.actionMatchInstalled()}
                            tooltip={registryText.actionMatchInstalled()}
                            busy={isMatching}
                            disabled={
                              !activeLibrary ||
                              !selectedLocalModId ||
                              isLibraryBusy ||
                              isOffline ||
                              isRateLimited ||
                              isDetailStale ||
                              isMatching ||
                              isInstalled
                            }
                            onClick={() => {
                              if (!activeLibrary || !selectedLocalModId) return
                              void matchInstalledMod({
                                libraryId: activeLibrary.id,
                                installedModId: selectedLocalModId,
                                kind: ver.kind,
                                itemId: ver.itemId,
                                versionId: ver.id,
                              }).catch((error: unknown) => {
                                console.error(
                                  '[registry] existing install match failed',
                                  error,
                                )
                              })
                            }}
                            className="size-8"
                          />
                          <LibraryActionIconButton
                            icon={isInstalled ? Check : Download}
                            label={tooltip}
                            tooltip={tooltip}
                            busy={isBusy}
                            disabled={
                              installDisabledOffline ||
                              isBusy ||
                              isLibraryBusy ||
                              isInstalled ||
                              hasParentBlock ||
                              Boolean(isSptIncompatible) ||
                              !activeLibrary
                            }
                            onClick={() => {
                              if (!activeLibrary) return
                              void installForgeVersion({
                                libraryId: activeLibrary.id,
                                kind: ver.kind,
                                itemId: ver.itemId,
                                versionId: ver.id,
                              }).catch((error: unknown) => {
                                console.error(
                                  '[registry] install request failed',
                                  error,
                                )
                              })
                            }}
                            className="size-8"
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="p-3 text-center text-xs text-muted-foreground">
                  {registryText.detailNoVersions()}
                </div>
              )}
              {error && detail && (
                <div
                  className="flex items-center justify-between gap-2 text-xs text-destructive"
                  role="alert"
                >
                  <span>{registryText.detailVersionsLoadFailed()}</span>
                  <button
                    type="button"
                    className="rounded px-2 py-1 font-medium hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      setLoadError(null)
                      setVersionRetryKey((key) => key + 1)
                    }}
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
                    onClick={() =>
                      changeVersionPage((page) => Math.max(1, page - 1))
                    }
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
                    disabled={
                      versionPage >= lastVersionPage || isVersionsLoading
                    }
                    onClick={() =>
                      changeVersionPage((page) =>
                        Math.min(lastVersionPage, page + 1),
                      )
                    }
                    className="size-7"
                  />
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </aside>
  )
}
