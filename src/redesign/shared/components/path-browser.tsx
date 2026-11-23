import { useEffect, useState } from 'react'
import { homeDirectory, listDirectory, type DirectoryEntry } from '@/wails/fs'
import { FidelityButton } from './fidelity-button'
import { libraryText } from '../../i18n/library-text'

export function PathBrowser({
  selectDirectory,
  onSelect,
}: {
  selectDirectory: boolean
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [directory, setDirectory] = useState('')
  const [entries, setEntries] = useState<DirectoryEntry[]>([])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let active = true
    const load = directory ? Promise.resolve(directory) : homeDirectory()
    void load
      .then(async (path) => ({ path, entries: await listDirectory(path) }))
      .then(
        (result) => {
          if (!active) return
          if (!directory) setDirectory(result.path)
          setEntries(result.entries)
          setLoading(false)
        },
        (cause: unknown) => {
          if (!active) return
          console.error('[path-browser] failed to list directory', cause)
          setEntries([])
          setError(true)
          setLoading(false)
        },
      )
    return () => {
      active = false
    }
  }, [open, directory])

  const parent = parentDirectory(directory)
  function navigate(path: string) {
    setLoading(true)
    setError(false)
    setDirectory(path)
  }
  return (
    <div className="mt-3">
      <FidelityButton
        type="button"
        variant="ghost"
        onClick={() => {
          if (!open) {
            setLoading(true)
            setError(false)
          }
          setOpen(!open)
        }}
      >
        {open ? libraryText.hideFolders() : libraryText.browseFolders()}
      </FidelityButton>
      {open && (
        <div className="mt-2 max-h-48 overflow-y-auto rounded border border-border bg-popover p-2">
          <p className="mb-2 break-all text-xs text-muted-foreground">
            {directory}
          </p>
          <div className="mb-2 flex gap-2">
            <FidelityButton
              type="button"
              variant="ghost"
              disabled={!parent || loading}
              onClick={() => parent && navigate(parent)}
            >
              {libraryText.parentFolder()}
            </FidelityButton>
            {selectDirectory && (
              <FidelityButton
                type="button"
                disabled={!directory || loading || error}
                onClick={() => onSelect(directory)}
              >
                {libraryText.selectFolder()}
              </FidelityButton>
            )}
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {libraryText.browseFoldersFailed()}
            </p>
          )}
          {!loading &&
            entries
              .filter((entry) => !selectDirectory || entry.IsDir)
              .map((entry) => (
                <button
                  key={entry.Name}
                  type="button"
                  className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    const separator =
                      directory.includes('\\') && !directory.includes('/')
                        ? '\\'
                        : '/'
                    const next = `${directory.replace(/[\\/]+$/, '')}${separator}${entry.Name}`
                    if (entry.IsDir) navigate(next)
                    else onSelect(next)
                  }}
                >
                  {entry.Name}
                  {entry.IsDir ? '/' : ''}
                </button>
              ))}
        </div>
      )}
    </div>
  )
}

function parentDirectory(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, '')
  const separator = Math.max(
    trimmed.lastIndexOf('/'),
    trimmed.lastIndexOf('\\'),
  )
  if (separator < 0) return null
  if (separator === 0) return trimmed[0] ?? null
  if (separator === 2 && /^[A-Za-z]:/.test(trimmed)) return trimmed.slice(0, 3)
  return trimmed.slice(0, separator)
}
