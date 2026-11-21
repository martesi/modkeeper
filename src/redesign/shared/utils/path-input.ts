import { splitArchivePaths } from './file-filters'

export type PathInputMode = 'single' | 'archives'

export interface ParsedPathInput {
  values: string[]
  rejected: string[]
}

export function parsePathInput(
  value: string,
  mode: PathInputMode,
): ParsedPathInput {
  const paths = value
    .split(mode === 'archives' ? /[\n,]/ : /\n/)
    .map((path) => path.trim())
    .filter(Boolean)
  const uniquePaths = [...new Set(paths)]

  if (mode === 'single')
    return { values: uniquePaths.slice(0, 1), rejected: [] }

  const split = splitArchivePaths(uniquePaths)
  return { values: split.archives, rejected: split.rejected }
}
