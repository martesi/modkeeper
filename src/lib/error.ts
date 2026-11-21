import { msg, t } from '@lingui/core/macro'
import type { SError } from '@gen/bindings'

/**
 * Translates SError to user-friendly messages using lingui
 */
export function translateError(error: SError): string {
  if (typeof error === 'string') {
    switch (error) {
      case 'GameOrServerRunning':
        return t(
          msg`The game or server is currently running. Please close it before performing this operation.`,
        )
      case 'ProcessRunning':
        return t(
          msg`Mod related process is currently running. Please close it and try again.`,
        )
      case 'UnableToDetermineModId':
        return t(
          msg`Unable to determine the mod ID. Please check the mod files and try again.`,
        )
      case 'NoActiveLibrary':
      case 'Unexpected':
        return t(msg`An unexpected error occurred. Please try again.`)
      default:
        return t(msg`An error occurred. Please try again.`)
    }
  }

  if ('UnsupportedSPTVersion' in error) {
    return t(
      msg`Unsupported SPT version. Please check the supported version of this Mod Manager. If you think this is an error, please report the issue to the developer.`,
    )
  }

  if ('ParseError' in error) {
    return t(
      msg`A parsing error occurred. The file may be corrupted or in an invalid format.`,
    )
  }

  if ('IOError' in error) {
    return t(
      msg`A file system error occurred. Please check your file permissions or if something is opened and try again.`,
    )
  }

  if ('FileOrDirectoryNotFound' in error) {
    return t(
      msg`The requested file or directory was not found. Please check the path and try again.`,
    )
  }

  // @TODO This should be displayed differently
  if ('FileCollision' in error) {
    return t(
      msg`File conflicts detected. Some mods may have conflicting files.`,
    )
  }

  if ('UnhandledCompression' in error) {
    return t(
      msg`The archive format is not supported. Please extract them to a folder manually.`,
    )
  }

  if ('AsyncRuntimeError' in error) {
    return t(msg`An internal error occurred. Please try again.`)
  }

  if ('LibraryBusy' in error) {
    return t(msg`A task is in progress. Retry when it finishes.`)
  }

  if ('InvalidLibrary' in error) {
    // InvalidLibrary is serialized as a tuple [path, reason]
    const [path, reason] = error.InvalidLibrary as [string, string]
    return t(
      msg`Invalid library found at ${path}: ${reason}. Please repair, recreate, or delete the library.`,
    )
  }

  return t(msg`An unknown error occurred. Please try again.`)
}
