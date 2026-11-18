import { useAtomValue, useSetAtom } from 'jotai'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  clearLibraryFiltersAtom,
  clearLibrarySearchAtom,
  librarySearchAtom,
  libraryStatusFilterAtom,
  libraryTypeFilterAtom,
  libraryViewModeAtom,
  modListAtom,
  visibleModsAtom,
} from '../state/library-state'
import { ModTitleCard } from './mod-title-card'
import { libraryText } from '../i18n/library-text'
import { FidelityButton } from '../shared/components/fidelity-button'

/**
 * Mod grid: auto-fill columns at a 220px minimum, stable card
 * heights. Renders the derived visible list — filter/search/sort live in the state layer.
 */
export function ModGrid() {
  const mods = useAtomValue(visibleModsAtom)
  const allMods = useAtomValue(modListAtom)
  const search = useAtomValue(librarySearchAtom)
  const statusFilter = useAtomValue(libraryStatusFilterAtom)
  const typeFilter = useAtomValue(libraryTypeFilterAtom)
  const viewMode = useAtomValue(libraryViewModeAtom)
  const clearSearch = useSetAtom(clearLibrarySearchAtom)
  const clearFilters = useSetAtom(clearLibraryFiltersAtom)

  function handleOverflowKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      event.currentTarget.scrollBy({ left: 48 })
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      event.currentTarget.scrollBy({ left: -48 })
    }
  }

  if (mods.length === 0) {
    if (allMods.length === 0) {
      return (
        <p className="py-12 text-center text-[13px] text-muted-foreground">
          {libraryText.noVisibleMods()}
        </p>
      )
    }

    const canClearSearch = search !== ''
    const canClearFilters = statusFilter !== 'all' || typeFilter !== 'all'

    return (
      <div className="flex flex-col items-center gap-2 py-5 text-center text-[13px]">
        <p className="text-muted-foreground">
          {libraryText.noSearchOrFiltersResults()}
        </p>
        {(canClearSearch || canClearFilters) && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {canClearSearch && (
              <FidelityButton variant="primary" onClick={() => clearSearch()}>
                {libraryText.clearSearch()}
              </FidelityButton>
            )}
            {canClearFilters && (
              <FidelityButton
                variant={canClearSearch ? 'secondary' : 'primary'}
                onClick={() => clearFilters()}
              >
                {libraryText.clearFilters()}
              </FidelityButton>
            )}
          </div>
        )}
      </div>
    )
  }

  if (viewMode === 'list') {
    return (
      <div
        role="region"
        aria-label={libraryText.viewModeList()}
        tabIndex={0}
        onKeyDown={handleOverflowKeyDown}
        className="overflow-x-auto focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <table className="w-full min-w-[420px] table-fixed border-separate border-spacing-y-1 text-left">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="w-9 px-2" />
              <th scope="col" className="px-2 py-1">
                {libraryText.columnName()}
              </th>
              <th scope="col" className="w-32 whitespace-nowrap px-2 py-1">
                {libraryText.columnType()}
              </th>
              <th scope="col" className="w-24 whitespace-nowrap px-2 py-1">
                {libraryText.columnStatus()}
              </th>
            </tr>
          </thead>
          <tbody>
            {mods.map((mod) => (
              <ModTitleCard key={mod.id} mod={mod} viewMode={viewMode} />
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (viewMode === 'icons') {
    return (
      <div className="flex flex-wrap gap-2">
        {mods.map((mod) => (
          <ModTitleCard key={mod.id} mod={mod} viewMode={viewMode} />
        ))}
      </div>
    )
  }

  return (
    <div
      role="region"
      aria-label={libraryText.viewModeGrid()}
      tabIndex={0}
      onKeyDown={handleOverflowKeyDown}
      className="overflow-x-auto focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="grid w-full min-w-[220px] gap-2 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
        {mods.map((mod) => (
          <ModTitleCard key={mod.id} mod={mod} viewMode={viewMode} />
        ))}
      </div>
    </div>
  )
}
