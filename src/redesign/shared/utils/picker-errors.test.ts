import { afterEach, describe, expect, vi, test } from 'vitest'
import { toast } from 'sonner'
import { runPickerAction } from './picker-errors'

afterEach(() => vi.restoreAllMocks())

describe('runPickerAction', () => {
  test('shows the caller error toast when the picker rejects', async () => {
    const errorToast = vi
      .spyOn(toast, 'error')
      .mockImplementation(() => 'toast')
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('picker unavailable')

    await runPickerAction(() => Promise.reject(failure), {
      message: 'Could not start the archive import.',
      context: 'archive import action',
    })

    expect(errorToast).toHaveBeenCalledWith(
      'Could not start the archive import.',
    )
    expect(logError).toHaveBeenCalledWith(
      '[redesign] archive import action failed',
      failure,
    )
  })

  test('does not toast when the picker action succeeds', async () => {
    const errorToast = vi
      .spyOn(toast, 'error')
      .mockImplementation(() => 'toast')
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let ran = false

    await runPickerAction(
      async () => {
        ran = true
      },
      { message: 'unused', context: 'unused' },
    )

    expect(ran).toBe(true)
    expect(errorToast).not.toHaveBeenCalled()
    expect(logError).not.toHaveBeenCalled()
  })
})
