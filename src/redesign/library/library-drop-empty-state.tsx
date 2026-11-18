import { LibraryEmptyCard } from './library-empty-card'
import { useArchiveFilePicker } from '../shared/hooks/use-archive-file-picker'
import { libraryText } from '../i18n/library-text'

/**
 * Active-library-but-no-mods state: the whole card opens a picker filtered to supported archives;
 * the global window drop zone (initializers) covers drag-and-drop.
 */
export function LibraryDropEmptyState() {
  const pickAndInstall = useArchiveFilePicker()

  return (
    <LibraryEmptyCard
      onClick={() => void pickAndInstall()}
      badge={libraryText.dropSupported()}
    >
      <p className="font-heading text-[13px] font-semibold text-foreground">
        {libraryText.dropTitle()}
      </p>
      <p className="text-[13px] font-semibold text-primary underline">
        {libraryText.dropBrowse()}
      </p>
    </LibraryEmptyCard>
  )
}
