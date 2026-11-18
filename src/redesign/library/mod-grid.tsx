import { useAtomValue, useSetAtom } from 'jotai'
import {
  clearLibraryFiltersAtom,
  clearLibrarySearchAtom,
  librarySearchAtom,
  libraryStatusFilterAtom,
  libraryTypeFilterAtom,
  modListAtom,
  visibleModsAtom,
} from '../state/library-state'
import { ModTitleCard } from './mod-title-card'
import { libraryText } from '../i18n/library-text'
import { FidelityButton } from '../shared/components/fidelity-button'

/**
 * Mod grid: auto-fill columns at a 260px minimum, stable card
 * heights. Renders the derived visible list — filter/search/sort live in the state layer.
 */
export function ModGrid() {
  const mods = useAtomValue(visibleModsAtom)
  const allMods = useAtomValue(modListAtom)
  const search = useAtomValue(librarySearchAtom)
  const statusFilter = useAtomValue(libraryStatusFilterAtom)
  const typeFilter = useAtomValue(libraryTypeFilterAtom)
  const clearSearch = useSetAtom(clearLibrarySearchAtom)
  const clearFilters = useSetAtom(clearLibraryFiltersAtom)

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
      <div className="flex flex-col items-center gap-3 py-6 text-center text-[13px]">
        <p className="text-muted-foreground">
          {libraryText.noSearchOrFiltersResults()}
        </p>
        {(canClearSearch || canClearFilters) && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {canClearSearch && (
              <FidelityButton variant="secondary" onClick={() => clearSearch()}>
                {libraryText.clearSearch()}
              </FidelityButton>
            )}
            {canClearFilters && (
              <FidelityButton
                variant="secondary"
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

  return (
    <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
      {mods.map((mod) => (
        <ModTitleCard key={mod.id} mod={mod} />
      ))}
    </div>
  )
}
