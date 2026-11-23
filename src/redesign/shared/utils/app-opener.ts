/*
 * File-explorer opener (consolidated-spec.md §10): UI never imports the opener plugin directly —
 * it calls these wrappers, which no-op with a console note when no desktop host can open the path.
 */
import { canOpenPath, openPath as platformOpenPath } from '@/platform'
import { toast } from 'sonner'
import type { LibrarySummary, ModSummary } from '../../data/redesign-types'
import { commonText } from '../../i18n/common-text'

async function openPath(path: string): Promise<void> {
  if (!canOpenPath()) {
    // MOCK-FALLBACK: browser and server pages have no desktop file manager.
    console.info('[redesign] would open in file explorer:', path)
    return
  }
  await platformOpenPath(path).catch((error: unknown) => {
    toast.error(commonText.fileOpenerFailed())
    console.error('[redesign] openPath failed', error)
  })
}

export function openGameRoot(library: LibrarySummary): Promise<void> {
  return openPath(library.gameRoot)
}

export function openLibraryRoot(library: LibrarySummary): Promise<void> {
  return openPath(library.libraryRoot)
}

export function openModSource(mod: ModSummary): Promise<void> {
  if (!mod.sourcePath) return Promise.resolve()
  return openPath(mod.sourcePath)
}
