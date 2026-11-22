import { toast } from 'sonner'

/**
 * A picker click starts a fire-and-track action. Keep a rejected promise from
 * becoming an unhandled rejection: show the caller's error toast and log it.
 */
export async function runPickerAction(
  action: () => Promise<void>,
  failure: { message: string; context: string },
): Promise<void> {
  try {
    await action()
  } catch (error) {
    toast.error(failure.message)
    console.error(`[redesign] ${failure.context} failed`, error)
  }
}
