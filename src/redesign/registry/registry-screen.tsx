import { useEffect, useState, useMemo } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { AlertCircle, AlertTriangle, SearchX, X } from 'lucide-react'
import type {
  ForgeDetail,
  ForgeSearchItem,
  ForgeSearchResponse,
} from '@/wails/contract'
import { activeLibraryAtom } from '../state/library-state'
import {
  registryAddonPageAtom,
  registryKindFilterAtom,
  registryModPageAtom,
  registryRateLimitedUntilAtom,
  registrySearchAtom,
  registrySortAtom,
  registryStaleNoticeDismissedAtom,
  registryViewModeAtom,
  selectedRegistryItemAtom,
  clearRegistrySearchAtom,
} from '../state/registry-state'
import { searchForge } from '../data/registry-repository'
import { registryText } from '../i18n/registry-text'
import { FidelityButton } from '../shared/components/fidelity-button'
import { ManageLibraryDialog } from '../library/manage-library/manage-library-dialog'
import { RegistryToolbar } from './registry-toolbar'
import { RegistryListView } from './registry-list-view'
import { RegistryGridView } from './registry-grid-view'
import { RegistryIconsView } from './registry-icons-view'
import { RegistryDetailInspector } from './registry-detail-inspector'
import { RegistryOfflineEmptyState } from './registry-offline-empty-state'
import { RegistryNoLibraryEmptyState } from './registry-no-library-empty-state'
import { RegistryParentDialog } from './registry-parent-dialog'
import { resolveRegistryNoResults } from './registry-no-results'
import { classifyRegistryRequestFailure } from '../data/registry-errors'
import { allPageItems, allPageNumber } from './registry-pagination'

export function RegistryScreen() {
  const activeLibrary = useAtomValue(activeLibraryAtom)
  const [search, setSearch] = useAtom(registrySearchAtom)
  const [kindFilter] = useAtom(registryKindFilterAtom)
  const [sort] = useAtom(registrySortAtom)
  const [viewMode] = useAtom(registryViewModeAtom)
  const [modPage, setModPage] = useAtom(registryModPageAtom)
  const [addonPage, setAddonPage] = useAtom(registryAddonPageAtom)
  const [selectedItem, setSelectedItem] = useAtom(selectedRegistryItemAtom)
  const [rateLimitedUntil] = useAtom(registryRateLimitedUntilAtom)
  const [staleDismissed, setStaleDismissed] = useAtom(
    registryStaleNoticeDismissedAtom,
  )
  const [, clearSearch] = useAtom(clearRegistrySearchAtom)

  const [debouncedSearch, setDebouncedSearch] = useState(search)
  const [searchResult, setSearchResult] = useState<{
    key: string
    scopeKey: string
    response: ForgeSearchResponse
  } | null>(null)
  const [failedRequest, setFailedRequest] = useState<{
    key: string
    kind: 'offline' | 'request'
  } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [manageOpen, setManageOpen] = useState(false)
  const [parentHelpItem, setParentHelpItem] = useState<
    ForgeSearchItem | ForgeDetail | null
  >(null)
  const [currentEpoch, setCurrentEpoch] = useState(() => Date.now())
  const isRateLimited =
    rateLimitedUntil !== null && currentEpoch < rateLimitedUntil
  const scopeKey = [
    activeLibrary?.id ?? '',
    activeLibrary?.sptVersion ?? '',
    debouncedSearch,
  ].join('\u0000')
  const requestKey = [scopeKey, refreshKey, modPage, addonPage].join('\u0000')
  const searchResponse =
    searchResult?.key === requestKey ? searchResult.response : null
  const paginationResponse =
    searchResult?.scopeKey === scopeKey ? searchResult.response : null
  const needsPageReset =
    !paginationResponse && (modPage !== 1 || addonPage !== 1)
  const requestedModPage = Math.max(
    1,
    Math.min(modPage, paginationResponse?.mods.pagination.lastPage ?? modPage),
  )
  const requestedAddonPage = Math.max(
    1,
    Math.min(
      addonPage,
      paginationResponse?.addons.pagination.lastPage ?? addonPage,
    ),
  )
  const requestFailure =
    failedRequest?.key === requestKey ? failedRequest.kind : null
  const isOfflineError = requestFailure === 'offline'
  const isRequestError = requestFailure === 'request'
  const isLoading = Boolean(
    activeLibrary && !isRateLimited && !searchResponse && !requestFailure,
  )

  useEffect(() => {
    if (!rateLimitedUntil) return
    const timer = setInterval(() => {
      const now = Date.now()
      setCurrentEpoch(now)
      if (now >= rateLimitedUntil) {
        clearInterval(timer)
        setRefreshKey((key) => key + 1)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [rateLimitedUntil])

  // 300ms Debounce for Titlebar / local search input
  useEffect(() => {
    if (search === debouncedSearch) return
    const handler = setTimeout(() => {
      setDebouncedSearch(search)
      setModPage(1)
      setAddonPage(1)
    }, 300)
    return () => clearTimeout(handler)
  }, [search, debouncedSearch, setModPage, setAddonPage])

  // Fetch from Forge registry
  useEffect(() => {
    if (!activeLibrary) return
    if (isRateLimited) return
    if (needsPageReset) {
      setModPage(1)
      setAddonPage(1)
      return
    }

    let isSubscribed = true
    const currentRequestKey = requestKey

    void searchForge({
      query: debouncedSearch,
      modPage: requestedModPage,
      addonPage: requestedAddonPage,
      perPage: 20,
    })
      .then((data) => {
        if (!isSubscribed) return
        const lastModPage = Math.max(
          1,
          data.mods.pagination.lastPage ?? modPage,
        )
        const lastAddonPage = Math.max(
          1,
          data.addons.pagination.lastPage ?? addonPage,
        )
        if (
          requestedModPage > lastModPage ||
          requestedAddonPage > lastAddonPage
        ) {
          const allLastPage = Math.max(lastModPage, lastAddonPage)
          setModPage(
            Math.min(modPage, kindFilter === 'all' ? allLastPage : lastModPage),
          )
          setAddonPage(
            Math.min(
              addonPage,
              kindFilter === 'all' ? allLastPage : lastAddonPage,
            ),
          )
          setSearchResult({ key: currentRequestKey, scopeKey, response: data })
          return
        }
        setSearchResult({
          key: currentRequestKey,
          scopeKey,
          response: data,
        })
        setFailedRequest(null)
      })
      .catch((error: unknown) => {
        if (!isSubscribed) return
        // The bridge preserves only the HTTP status, not a range error body.
        // Rediscover once from page one; other failures retain their retry bounds.
        if (
          (modPage > 1 || addonPage > 1) &&
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'IOError' &&
          'data' in error &&
          typeof error.data === 'string' &&
          /^Forge returned HTTP (404|422)$/.test(error.data)
        ) {
          setSearchResult(null)
          setModPage(1)
          setAddonPage(1)
          return
        }
        setFailedRequest({
          key: currentRequestKey,
          kind: classifyRegistryRequestFailure(error),
        })
      })

    return () => {
      isSubscribed = false
    }
  }, [
    activeLibrary,
    debouncedSearch,
    modPage,
    addonPage,
    refreshKey,
    isRateLimited,
    requestKey,
    scopeKey,
    requestedModPage,
    requestedAddonPage,
    needsPageReset,
    kindFilter,
    setModPage,
    setAddonPage,
  ])

  // Merge items based on kind filter
  const displayedItems = useMemo(() => {
    if (!searchResponse) return []
    let list: ForgeSearchItem[] = []
    if (kindFilter === 'all') {
      list = allPageItems(modPage, {
        mods: {
          items: searchResponse.mods.items,
          lastPage: searchResponse.mods.pagination.lastPage ?? 1,
        },
        addons: {
          items: searchResponse.addons.items,
          lastPage: searchResponse.addons.pagination.lastPage ?? 1,
        },
      })
    } else if (kindFilter === 'mods') {
      list = [...searchResponse.mods.items]
    } else {
      list = [...searchResponse.addons.items]
    }

    if (sort === 'name-asc') {
      list.sort((a, b) => a.name.localeCompare(b.name))
    }
    return list
  }, [searchResponse, kindFilter, sort, modPage])

  const modTotalPages = Math.max(
    1,
    paginationResponse?.mods.pagination.lastPage ?? 1,
  )
  const addonTotalPages = Math.max(
    1,
    paginationResponse?.addons.pagination.lastPage ?? 1,
  )
  const totalItems =
    kindFilter === 'mods'
      ? (paginationResponse?.mods.pagination.total ?? 0)
      : kindFilter === 'addons'
        ? (paginationResponse?.addons.pagination.total ?? 0)
        : (paginationResponse?.mods.pagination.total ?? 0) +
          (paginationResponse?.addons.pagination.total ?? 0)

  function handleModPageChange(page: number) {
    setModPage(Math.min(Math.max(page, 1), modTotalPages))
  }

  function handleAddonPageChange(page: number) {
    setAddonPage(Math.min(Math.max(page, 1), addonTotalPages))
  }

  function handleAllPageChange(page: number) {
    const nextPage = allPageNumber(page, modTotalPages, addonTotalPages)
    setModPage(nextPage)
    setAddonPage(nextPage)
  }

  // 1. No Active Library
  if (!activeLibrary) {
    return (
      <div className="flex h-full min-h-[400px] flex-col">
        <RegistryNoLibraryEmptyState
          onManageLibraries={() => setManageOpen(true)}
        />
        <ManageLibraryDialog open={manageOpen} onOpenChange={setManageOpen} />
      </div>
    )
  }

  // 2. Completely Offline (No Cached Data)
  if (isOfflineError && !searchResponse && !isRateLimited) {
    return (
      <div className="flex h-full min-h-[400px] flex-col">
        <RegistryOfflineEmptyState
          onRetry={() => setRefreshKey((k) => k + 1)}
          isRetrying={isLoading}
        />
      </div>
    )
  }

  const isStale = Boolean(
    searchResponse?.mods.stale || searchResponse?.addons.stale,
  )
  const noResultsCopy = search
    ? resolveRegistryNoResults(search, activeLibrary.sptVersion)
    : null
  const rateLimitSecondsRemaining = isRateLimited
    ? Math.max(1, Math.ceil((rateLimitedUntil - currentEpoch) / 1000))
    : 0

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-2">
      {/* 429 Rate Limit Banner */}
      {isRateLimited && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            <span>
              {registryText.rateLimitedNotice(rateLimitSecondsRemaining)}
            </span>
          </div>
        </div>
      )}

      {/* Offline Stale Cache Warning Banner */}
      {isStale && !staleDismissed && (
        <div
          role="status"
          className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            <span>{registryText.staleCacheNotice()}</span>
          </div>
          <button
            type="button"
            onClick={() => setStaleDismissed(true)}
            className="rounded p-1 hover:bg-[var(--muted)]"
            aria-label={registryText.dismissNotice()}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}

      {/* Registry Toolbar */}
      <RegistryToolbar
        totalItems={totalItems}
        modPage={modPage}
        addonPage={addonPage}
        modTotalPages={modTotalPages}
        addonTotalPages={addonTotalPages}
        onModPageChange={handleModPageChange}
        onAddonPageChange={handleAddonPageChange}
        onAllPageChange={handleAllPageChange}
        isBusy={isLoading || isRateLimited}
        isRateLimited={isRateLimited}
      />

      {/* Main Content Area: Results + Optional Detail Inspector */}
      <div className="relative flex min-h-0 flex-1 flex-row items-stretch gap-2 overflow-hidden">
        {/* Results Container */}
        <div
          className={`mk-scrollbar min-w-0 flex-1 overflow-y-auto ${
            selectedItem ? 'max-[800px]:hidden' : ''
          }`}
        >
          {isRateLimited && !searchResponse ? (
            <div
              className="flex h-64 items-center justify-center text-sm text-muted-foreground"
              role="status"
            >
              {registryText.rateLimitedNotice(rateLimitSecondsRemaining)}
            </div>
          ) : isRequestError && !searchResponse ? (
            <div
              role="alert"
              className="flex h-64 flex-col items-center justify-center gap-2 p-6 text-center"
            >
              <AlertCircle
                className="size-8 text-muted-foreground"
                aria-hidden
              />
              <p className="text-sm font-medium text-foreground">
                {registryText.searchFailedTitle()}
              </p>
              <p className="max-w-md text-xs text-muted-foreground">
                {registryText.searchFailedDescription()}
              </p>
              <FidelityButton
                variant="outline"
                size="sm"
                onClick={() => setRefreshKey((key) => key + 1)}
                className="mt-1 text-xs"
              >
                {registryText.retrySearch()}
              </FidelityButton>
            </div>
          ) : isLoading && !searchResponse ? (
            <div
              className="flex h-64 items-center justify-center text-sm text-muted-foreground"
              role="status"
            >
              {registryText.searching()}
            </div>
          ) : displayedItems.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
              <SearchX className="size-8 opacity-60" aria-hidden />
              <p className="text-sm font-medium text-foreground">
                {noResultsCopy?.kind === 'known-spt'
                  ? registryText.emptyNoResults(
                      noResultsCopy.query,
                      noResultsCopy.sptVersion,
                    )
                  : noResultsCopy
                    ? registryText.emptyNoResultsUnknownSpt(noResultsCopy.query)
                    : registryText.emptyNoResultsSimple()}
              </p>
              <div className="mt-2 flex items-center gap-2">
                {search && (
                  <FidelityButton
                    variant="outline"
                    size="sm"
                    onClick={() => clearSearch()}
                    className="text-xs"
                  >
                    {registryText.clearSearch()}
                  </FidelityButton>
                )}
              </div>
            </div>
          ) : viewMode === 'list' ? (
            <RegistryListView
              items={displayedItems}
              selectedItem={selectedItem}
              onOpenParentHelp={(item) => setParentHelpItem(item)}
            />
          ) : viewMode === 'grid' ? (
            <RegistryGridView
              items={displayedItems}
              selectedItem={selectedItem}
              onOpenParentHelp={(item) => setParentHelpItem(item)}
            />
          ) : (
            <RegistryIconsView
              items={displayedItems}
              selectedItem={selectedItem}
            />
          )}
        </div>

        {/* Slide-in Detail Inspector Drawer */}
        {selectedItem && (
          <RegistryDetailInspector
            isOffline={isStale || isOfflineError}
            onOpenParentHelp={(detail) => setParentHelpItem(detail)}
          />
        )}
      </div>

      {/* Assistive Dialogs */}
      <ManageLibraryDialog open={manageOpen} onOpenChange={setManageOpen} />

      <RegistryParentDialog
        addon={parentHelpItem}
        open={Boolean(parentHelpItem)}
        onOpenChange={(open) => !open && setParentHelpItem(null)}
        onSearchParent={(parentName, parentId) => {
          if (parentId) {
            setSelectedItem({ kind: 'mod', id: parentId })
          } else {
            setSearch(parentName)
            setSelectedItem(null)
          }
        }}
      />
    </div>
  )
}
