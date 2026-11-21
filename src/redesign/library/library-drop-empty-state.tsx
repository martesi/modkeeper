import { LibraryEmptyCard } from './library-empty-card'
import { useArchiveFilePicker } from '../shared/hooks/use-archive-file-picker'
import { libraryText } from '../i18n/library-text'

/**
 * Active-library-but-no-mods state: the whole card opens a picker filtered to supported archives;
 * the global window drop zone (initializers) covers drag-and-drop.
 */
export function LibraryDropEmptyState() {
  const { pickAndInstall, pathInputDialog } = useArchiveFilePicker()

  return (
    <>
      <LibraryEmptyCard
        onClick={() => void pickAndInstall()}
        badge={libraryText.dropSupported()}
      >
        <span className="font-heading text-[13px] font-semibold text-foreground">
          {libraryText.dropTitle()}
        </span>
        <span className="text-[13px] font-semibold text-primary underline">
          {libraryText.dropBrowse()}
        </span>
      </LibraryEmptyCard>
      {pathInputDialog}
    </>
  )
}
