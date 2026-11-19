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

async function pickModArchives(): Promise<string[]> {
  if (platformKind() === 'browser') {
    // MOCK-FALLBACK: no native picker in the browser prototype — pretend one archive was chosen so
    // the install flow stays exercisable end-to-end.
    console.info('[redesign] no native file picker, simulating a selection')
    return ['C:/downloads/Example Mod.zip']
  }
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
export function useArchiveFilePicker(
  source: PendingTaskSource = 'other',
): () => Promise<void> {
  const activeLibraryId = useAtomValue(activeLibraryIdAtom)

  return useCallback(async () => {
    if (!activeLibraryId) return
    const paths = await pickModArchives()
    if (paths.length === 0) return
    await installModArchives({
      libraryId: activeLibraryId,
      paths,
      source,
    })
  }, [activeLibraryId, source])
}
