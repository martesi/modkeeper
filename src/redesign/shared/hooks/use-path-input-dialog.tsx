import { useRef, useState } from 'react'
import {
  PathInputDialog,
  type PathInputDialogOptions,
} from '../components/path-input-dialog'

type PathInputResult = string[] | null

export function usePathInputDialog() {
  const [options, setOptions] = useState<PathInputDialogOptions>({
    mode: 'single',
    title: '',
    description: '',
    label: '',
    placeholder: '',
  })
  const [open, setOpen] = useState(false)
  const [requestId, setRequestId] = useState(0)
  const resolveRef = useRef<((value: PathInputResult) => void) | null>(null)

  function finish(value: PathInputResult) {
    setOpen(false)
    resolveRef.current?.(value)
    resolveRef.current = null
  }

  function requestPathInput(
    nextOptions: PathInputDialogOptions,
  ): Promise<PathInputResult> {
    setOptions(nextOptions)
    setRequestId((current) => current + 1)
    setOpen(true)
    return new Promise((resolve) => {
      resolveRef.current = resolve
    })
  }

  return {
    requestPathInput,
    pathInputDialog: (
      <PathInputDialog
        key={requestId}
        open={open}
        options={options}
        onSubmit={(paths) => finish(paths)}
        onCancel={() => finish(null)}
      />
    ),
  }
}
