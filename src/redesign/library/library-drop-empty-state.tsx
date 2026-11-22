import { platformKind } from '@/platform'
import { useNativeDesktopShell } from '@/platform/use-native-desktop-shell'
import { LibraryEmptyCard } from './library-empty-card'
import { useArchiveFilePicker } from '../shared/hooks/use-archive-file-picker'
import { runPickerAction } from '../shared/utils/picker-errors'
import { libraryText } from '../i18n/library-text'

/**
 * Active-library-but-no-mods state. Desktop shells open a native archive picker
 * and accept window drops. Server and browser pages have neither, so the card
 * opens the path-entry dialog instead and its copy does not promise a drop.
 */
export function LibraryDropEmptyState() {
  const { pickAndInstall, pathInputDialog } = useArchiveFilePicker()
  const nativePicker = useNativeDesktopShell()
  const serverMode = platformKind() === 'wails' && !nativePicker

  return (
    <>
      <LibraryEmptyCard
        onClick={() =>
          void runPickerAction(pickAndInstall, {
            message: libraryText.archiveImportActionFailed(),
            context: 'archive import action',
          })
        }
        badge={libraryText.dropSupported()}
      >
        <span className="font-heading text-[13px] font-semibold text-foreground">
          {nativePicker
            ? libraryText.dropTitle()
            : libraryText.pathEntryTitle()}
        </span>
        <span className="text-[13px] font-semibold text-primary underline">
          {nativePicker
            ? libraryText.dropBrowse()
            : serverMode
              ? libraryText.pathEntryServerAction()
              : libraryText.pathEntryAction()}
        </span>
      </LibraryEmptyCard>
      {pathInputDialog}
    </>
  )
}
