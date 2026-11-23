import { hasNativeFilePicker } from '@/platform'

/**
 * Runs the native picker when the shell has one. Server and browser pages have
 * no native dialog, so both fall back to the in-app path-entry dialog.
 */
export function pickWithNativeOrPathEntry<T>(
  nativePick: () => Promise<T>,
  pathEntry: () => Promise<T>,
): Promise<T> {
  return hasNativeFilePicker() ? nativePick() : pathEntry()
}
