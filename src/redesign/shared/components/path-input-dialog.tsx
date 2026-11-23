import { useState, type FormEvent } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FidelityButton } from './fidelity-button'
import { FidelityInput } from './fidelity-input'
import { libraryText } from '../../i18n/library-text'
import { parsePathInput, type PathInputMode } from '../utils/path-input'
import { isWails } from '@/wails/runtime'
import { getWailsMock } from '@/wails/mock'
import { PathBrowser } from './path-browser'

export interface PathInputDialogOptions {
  mode: PathInputMode
  title: string
  description: string
  label: string
  placeholder: string
  selectDirectory?: boolean
}

interface PathInputDialogProps {
  open: boolean
  options: PathInputDialogOptions
  onSubmit: (paths: string[]) => void
  onCancel: () => void
}

export function PathInputDialog({
  open,
  options,
  onSubmit,
  onCancel,
}: PathInputDialogProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parsePathInput(value, options.mode)
    if (parsed.rejected.length > 0) {
      setError(libraryText.pathInputUnsupported())
      return
    }
    if (parsed.values.length === 0) {
      setError(libraryText.pathInputRequired())
      return
    }
    onSubmit(parsed.values)
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent className="w-[min(32rem,calc(100vw-2rem))] rounded-lg bg-popover">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-heading">{options.title}</DialogTitle>
            <DialogDescription>{options.description}</DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <label
              htmlFor="path-input-dialog-value"
              className="mb-1.5 block text-[13px] font-semibold"
            >
              {options.label}
            </label>
            {options.mode === 'archives' ? (
              <textarea
                id="path-input-dialog-value"
                autoFocus
                value={value}
                onChange={(event) => {
                  setValue(event.target.value)
                  setError(null)
                }}
                placeholder={options.placeholder}
                aria-invalid={error !== null}
                aria-describedby={error ? 'path-input-dialog-error' : undefined}
                className="min-h-28 w-full resize-y rounded-sm border border-border bg-secondary px-2.5 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
              />
            ) : (
              <FidelityInput
                id="path-input-dialog-value"
                autoFocus
                value={value}
                onChange={(event) => {
                  setValue(event.target.value)
                  setError(null)
                }}
                placeholder={options.placeholder}
                aria-invalid={error !== null}
                aria-describedby={error ? 'path-input-dialog-error' : undefined}
              />
            )}
            {error && (
              <p
                id="path-input-dialog-error"
                role="alert"
                className="mt-1.5 text-xs text-destructive"
              >
                {error}
              </p>
            )}
            {(isWails() || getWailsMock()?.commands?.listDirectory) && (
              <PathBrowser
                selectDirectory={options.selectDirectory ?? false}
                onSelect={(path) => {
                  setValue((current) =>
                    options.mode === 'archives' && current
                      ? `${current}\n${path}`
                      : path,
                  )
                  setError(null)
                }}
              />
            )}
          </div>
          <DialogFooter className="mt-5">
            <FidelityButton type="button" variant="ghost" onClick={onCancel}>
              {libraryText.pathInputCancel()}
            </FidelityButton>
            <FidelityButton type="submit">
              {libraryText.pathInputConfirm()}
            </FidelityButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
