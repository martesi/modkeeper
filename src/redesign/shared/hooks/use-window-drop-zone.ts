/*
 * Global window drop zone: the whole window accepts supported archive drops for the active library.
 * Unsupported files are rejected with a toast and NO backend call. Mounted once
 * by the initializers; in the browser prototype there is no window drop source, so this is inert.
 */
import { useEffect } from 'react'
import { onFileDrop, platformKind } from '@/platform'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { activeLibraryIdAtom } from '../../state/library-state'
import { installModArchives } from '../../data/library-repository'
import { splitArchivePaths } from '../utils/file-filters'
import { libraryText } from '../../i18n/library-text'

export function useWindowDropZone(): void {
  const activeLibraryId = useAtomValue(activeLibraryIdAtom)

  useEffect(() => {
    if (platformKind() === 'browser' || !activeLibraryId) return
    let disposed = false
    const unlistenPromise = onFileDrop((paths) => {
      const { archives, rejected } = splitArchivePaths(paths)
      if (rejected.length > 0)
        toast.error(libraryText.unsupportedArchiveRejected())
      if (archives.length > 0)
        void installModArchives({ libraryId: activeLibraryId, paths: archives })
    })
    return () => {
      disposed = true
      void unlistenPromise.then((unlisten) => {
        if (disposed) unlisten()
      })
    }
  }, [activeLibraryId])
}
