import { translateError } from './error'
import type { LibraryCreationRequirement, SError } from '@gen/bindings'
import { tSelectGameRootDirectory } from '@/utils/translation'
import { msg, t } from '@lingui/core/macro'
import { pickDirectory } from '@/platform'

/**
 * Adds a library by prompting the user to select a game root directory, or uses the provided game root.
 * The backend automatically:
 * - Derives repoRoot from gameRoot as gameRoot/.mod_keeper
 * - If a library already exists at that location and is valid, opens it
 * - If no library exists, creates a new one
 * @param createLibrary - Function to add the library (from useLibrarySwitch hook)
 * @param gameRoot - Optional game root directory path. If provided, skips the dialog and uses this path directly.
 */
export function addLibraryFromDialog(
  createLibrary: (requirement: LibraryCreationRequirement) => Promise<unknown>,
  gameRoot?: string,
): Promise<void> {
  const getGameRoot = gameRoot
    ? Promise.resolve(gameRoot)
    : pickDirectory({ title: tSelectGameRootDirectory() }).then((selected) => {
        if (!selected || typeof selected !== 'string') {
          return Promise.reject(new Error('User cancelled'))
        }
        return selected
      })

  return getGameRoot
    .then((selectedGameRoot) => {
      const libraryName = t(msg`Unknown library`)
      return createLibrary({
        name: libraryName,
        gameRoot: selectedGameRoot,
        repoRoot: null,
      }).then(() => undefined)
    })
    .catch((err) => {
      if (err instanceof Error && err.message === 'User cancelled') {
        return undefined
      }
      const errorMessage =
        err instanceof Error
          ? err.message
          : translateError(err as SError) || 'Failed to add library'
      console.error('Failed to add library:', errorMessage)
      throw new Error(errorMessage)
    })
}
