/*
 * Import-surface archive authority: the picker and window drop zone both use this module for
 * supported extensions. The backend remains authoritative for actual archive acceptance.
 */

export const SUPPORTED_ARCHIVE_EXTENSIONS = ['zip', '7z'] as const
export type SupportedArchiveExtension =
  (typeof SUPPORTED_ARCHIVE_EXTENSIONS)[number]

export function getSupportedArchiveExtension(
  path: string,
): SupportedArchiveExtension | undefined {
  const filename = path.split(/[\\/]/).pop()
  if (
    !filename ||
    (filename.startsWith('.') && !filename.slice(1).includes('.'))
  ) {
    return undefined
  }
  const extension = filename.split('.').pop()?.toLowerCase()
  return SUPPORTED_ARCHIVE_EXTENSIONS.find(
    (candidate) => candidate === extension,
  )
}

export function isSupportedArchivePath(path: string): boolean {
  return getSupportedArchiveExtension(path) !== undefined
}

export function stripSupportedArchiveExtension(path: string): string {
  const extension = getSupportedArchiveExtension(path)
  if (!extension) return path
  return path.slice(0, -(extension.length + 1))
}

export interface SplitArchivePaths {
  archives: string[]
  rejected: string[]
}

export function splitArchivePaths(paths: string[]): SplitArchivePaths {
  const archives: string[] = []
  const rejected: string[] = []
  for (const path of paths) {
    if (isSupportedArchivePath(path)) {
      archives.push(path)
      continue
    }
    rejected.push(path)
  }
  return { archives, rejected }
}
