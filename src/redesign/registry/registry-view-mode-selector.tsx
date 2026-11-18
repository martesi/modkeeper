import { Grid2X2, LayoutGrid, List } from 'lucide-react'
import { useAtom } from 'jotai'
import {
  registryViewModeAtom,
  type RegistryViewMode,
} from '../state/registry-state'
import { libraryText } from '../i18n/library-text'
import { registryText } from '../i18n/registry-text'
import { LibraryActionIconButton } from '../library/library-action-icon-button'

const viewModes: {
  mode: RegistryViewMode
  label: () => string
  icon: typeof List
}[] = [
  { mode: 'list', label: libraryText.viewModeList, icon: List },
  { mode: 'grid', label: libraryText.viewModeGrid, icon: Grid2X2 },
  { mode: 'icons', label: libraryText.viewModeIcons, icon: LayoutGrid },
]

export function RegistryViewModeSelector() {
  const [viewMode, setViewMode] = useAtom(registryViewModeAtom)

  return (
    <div
      role="group"
      aria-label={registryText.viewModeLabel()}
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
