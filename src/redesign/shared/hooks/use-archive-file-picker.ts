/*
 * Archive import picker: opens the native archive picker and feeds the selection into the
 * fire-and-track install. The picker and drop zone use the shared archive-format authority.
 */
import { useCallback } from 'react'
import { pickFiles, platformKind } from '@/platform'
import { useAtomValue } from 'jotai'
import {
  activeLibraryIdAtom,
  type PendingTaskSource,
} from '../../state/library-state'
import { installModArchives } from '../../data/library-repository'
import { SUPPORTED_ARCHIVE_EXTENSIONS } from '../utils/file-filters'
import { libraryText } from '../../i18n/library-text'
import { usePathInputDialog } from './use-path-input-dialog'

async function pickModArchives(): Promise<string[]> {
  return pickFiles({
    multiple: true,
    filters: [
      {
        name: libraryText.archive(),
        extensions: [...SUPPORTED_ARCHIVE_EXTENSIONS],
      },
    ],
    title: libraryText.selectModArchives(),
  })
}

/** Returns a callback that picks archives and tracks them under its initiating control. */
export function useArchiveFilePicker(source: PendingTaskSource = 'other') {
  const activeLibraryId = useAtomValue(activeLibraryIdAtom)
  const { requestPathInput, pathInputDialog } = usePathInputDialog()

  const pickAndInstall = useCallback(async () => {
    if (!activeLibraryId) return
    const paths =
      platformKind() === 'browser'
        ? await requestPathInput({
            mode: 'archives',
            title: libraryText.archivePathsTitle(),
            description: libraryText.archivePathsDescription(),
            label: libraryText.archivePathsLabel(),
            placeholder: libraryText.archivePathsPlaceholder(),
          })
        : await pickModArchives()
    if (!paths?.length) return
    await installModArchives({ libraryId: activeLibraryId, paths, source })
  }, [activeLibraryId, requestPathInput, source])

  return { pickAndInstall, pathInputDialog }
}
