import { useEffect, useRef } from 'react'
import { libraryText } from '../i18n/library-text'
import type { ModSummary } from '../data/redesign-types'

export const TITLEBAR_SEARCH_RESULTS_ID = 'titlebar-search-results'

export function TitlebarSearchResults({
  mods,
  activeIndex,
  onChoose,
}: {
  mods: readonly ModSummary[]
  activeIndex: number
  onChoose: (mod: ModSummary) => void
}) {
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({
      block: 'nearest',
    })
  }, [activeIndex, mods])
  if (mods.length === 0) {
    return (
      <div role="status" className="px-4 py-4 text-sm text-muted-foreground">
        {libraryText.noPaletteResults()}
      </div>
    )
  }

  return (
    <ul
      ref={listRef}
      id={TITLEBAR_SEARCH_RESULTS_ID}
      role="listbox"
      aria-label={libraryText.searchLabel()}
      className="max-h-80 overflow-y-auto p-2"
    >
      {mods.map((mod, index) => (
        <li
          id={`palette-result-${mod.id}`}
          data-mod-id={mod.id}
          role="option"
          aria-selected={index === activeIndex}
          className="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent aria-selected:bg-accent aria-selected:text-accent-foreground"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(mod)}
          key={mod.id}
        >
          <span className="truncate">{mod.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {libraryText.locateMod()}
          </span>
        </li>
      ))}
    </ul>
  )
}
