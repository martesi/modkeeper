/*
 * Archive import picker: opens the native archive picker on desktop shells and the path-entry
 * dialog elsewhere, then feeds the selection into the fire-and-track install. The picker and drop
 * zone use the shared archive-format authority.
 */
import { useCallback } from 'react'
import { pickFiles } from '@/platform'
import { useAtomValue } from 'jotai'
import {
  activeLibraryIdAtom,
  type PendingTaskSource,
} from '../../state/library-state'
import { installModArchives } from '../../data/library-repository'
import { SUPPORTED_ARCHIVE_EXTENSIONS } from '../utils/file-filters'
import { pickWithNativeOrPathEntry } from '../utils/picker-gate'
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

/** Chooses between the native picker and the in-app path-entry dialog. */
export type ArchivePicker = (
  nativePick: () => Promise<string[]>,
  pathEntry: () => Promise<string[] | null>,
) => Promise<string[] | null>

/** Overrides the native/path picker and install boundary in tests. */
export type ArchiveFilePickerOptions = {
  pick?: ArchivePicker
  install?: typeof installModArchives
}

/** Returns a callback that picks archives and tracks them under its initiating control. */
export function useArchiveFilePicker(
  source: PendingTaskSource = 'other',
  options: ArchiveFilePickerOptions = {},
) {
  const activeLibraryId = useAtomValue(activeLibraryIdAtom)
  const { requestPathInput, pathInputDialog } = usePathInputDialog()
  const pick = options.pick ?? pickWithNativeOrPathEntry
  const install = options.install ?? installModArchives

  const pickAndInstall = useCallback(async () => {
    if (!activeLibraryId) return
    const paths = await pick(pickModArchives, () =>
      requestPathInput({
        mode: 'archives',
        title: libraryText.archivePathsTitle(),
        description: libraryText.archivePathsDescription(),
        label: libraryText.archivePathsLabel(),
        placeholder: libraryText.archivePathsPlaceholder(),
      }),
    )
    if (!paths?.length) return
    await install({ libraryId: activeLibraryId, paths, source })
  }, [activeLibraryId, install, pick, requestPathInput, source])

  return { pickAndInstall, pathInputDialog }
}
