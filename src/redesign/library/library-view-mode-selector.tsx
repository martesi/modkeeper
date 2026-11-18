import { Grid2X2, LayoutGrid, List } from 'lucide-react'
import { useAtom } from 'jotai'
import { libraryViewModeAtom } from '../state/library-state'
import { libraryText } from '../i18n/library-text'
import { LibraryActionIconButton } from './library-action-icon-button'

const viewModes = [
  { mode: 'list', label: libraryText.viewModeList, icon: List },
  { mode: 'grid', label: libraryText.viewModeGrid, icon: Grid2X2 },
  { mode: 'icons', label: libraryText.viewModeIcons, icon: LayoutGrid },
] as const

export function LibraryViewModeSelector() {
  const [viewMode, setViewMode] = useAtom(libraryViewModeAtom)

  return (
    <div
      role="group"
      aria-label={libraryText.viewModeLabel()}
      className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5"
    >
      {viewModes.map(({ mode, label, icon }) => (
        <LibraryActionIconButton
          key={mode}
          icon={icon}
          label={label()}
          aria-pressed={viewMode === mode}
          variant={viewMode === mode ? 'soft' : 'ghost'}
          className="size-8 rounded-sm [&_svg]:size-5"
          onClick={() => setViewMode(mode)}
        />
      ))}
    </div>
  )
}
