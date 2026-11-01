import { useAtomValue } from 'jotai'
import { visibleModsAtom } from '../state/library-state'
import { ModTitleCard } from './mod-title-card'
import { libraryText } from '../i18n/library-text'

/**
 * Mod grid (reference Modkeeper.dc.html): auto-fill columns at a 300px minimum, stable card
 * heights. Renders the derived visible list — filter/search/sort live in the state layer.
 */
export function ModGrid() {
  const mods = useAtomValue(visibleModsAtom)

  if (mods.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        {libraryText.noVisibleMods()}
      </p>
    )
  }

  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
      {mods.map((mod) => (
        <ModTitleCard key={mod.id} mod={mod} />
      ))}
    </div>
  )
}
