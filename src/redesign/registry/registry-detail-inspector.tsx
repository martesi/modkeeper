import { useEffect, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { AlertCircle, AlertTriangle, X } from 'lucide-react'
import { settingsAtom } from '../state/settings-state'
import type { ForgeDetail, ForgeVersionsPage } from '@/wails/contract'
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
import { RegistryDetailContent } from './registry-detail-content'
import { ForgeVersionList } from './forge-version-list'

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
  const settings = useAtomValue(settingsAtom)
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

  const parentStatus = detail
    ? evaluateAddonParentConstraint({ addon: detail, installedMods })
    : { status: 'standalone' as const }
  const hasParentBlock =
    parentStatus.status === 'missing' ||
    parentStatus.status === 'mismatch' ||
    parentStatus.status === 'unverified'
  const isDetailStale = Boolean(detail?.stale || versionsPage?.stale)
  function startInstall(
    version: ForgeVersionsPage['versions'][number],
    libraryId: string,
  ) {
    void installForgeVersion({
      libraryId,
      kind: version.kind,
      itemId: version.itemId,
      versionId: version.id,
    }).catch((error: unknown) => {
      console.error('[registry] install request failed', error)
    })
  }

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
            <RegistryDetailContent
              detail={detail}
              parentStatus={parentStatus}
              hasParentBlock={hasParentBlock}
              matchableMods={matchableMods}
              selectedLocalModId={selectedLocalModId}
              isLibraryBusy={isLibraryBusy}
              isRateLimited={isRateLimited}
              onSelectLocalMod={(modId) =>
                setLocalModSelection({ key: selectedKey, modId })
              }
              onSelectParent={(parent) => {
                if (parent?.id) {
                  setSelected({ kind: 'mod', id: parent.id })
                } else if (parent?.name) {
                  setSearch(parent.name)
                  setSelected(null)
                }
              }}
              onOpenParentHelp={onOpenParentHelp}
            />

            <ForgeVersionList
              key={activeLibrary?.id ?? 'no-active-library'}
              detail={detail}
              versionsPage={versionsPage}
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
              settings={settings}
              versionPage={versionPage}
              lastVersionPage={lastVersionPage}
              isVersionsLoading={isVersionsLoading}
              error={error}
              onMatch={(version) => {
                if (!activeLibrary || !selectedLocalModId) return
                void matchInstalledMod({
                  libraryId: activeLibrary.id,
                  installedModId: selectedLocalModId,
                  kind: version.kind,
                  itemId: version.itemId,
                  versionId: version.id,
                }).catch((matchError: unknown) => {
                  console.error(
                    '[registry] existing install match failed',
                    matchError,
                  )
                })
              }}
              onInstall={startInstall}
              onChangePage={changeVersionPage}
              onRetry={() => {
                setLoadError(null)
                setVersionRetryKey((key) => key + 1)
              }}
            />
          </>
        ) : null}
      </div>
    </aside>
  )
}
