import { log, platformKind } from '@/platform'
import { z } from 'zod'

export const BOOT_ERROR_STORAGE_KEY = 'modkeeper.boot-error'
const bootErrorMessageSchema = z.string().max(2_000)

interface BootErrorStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function readBootError(storage?: BootErrorStorage): string | null {
  // Web Storage can throw synchronously; this boundary keeps fallback rendering usable.
  try {
    const message = (storage ?? window.localStorage).getItem(
      BOOT_ERROR_STORAGE_KEY,
    )
    if (message === null) return null

    const parsed = bootErrorMessageSchema.safeParse(message)
    if (!parsed.success) {
      console.error('[startup] persisted boot error was invalid')
      return null
    }
    return parsed.data
  } catch (error) {
    console.error('[startup] could not read persisted boot error', error)
    return null
  }
}

export function storeBootError(
  message: string,
  storage?: BootErrorStorage,
): void {
  // Web Storage can throw synchronously; this boundary keeps fallback rendering usable.
  try {
    const targetStorage = storage ?? window.localStorage
    targetStorage.setItem(
      BOOT_ERROR_STORAGE_KEY,
      bootErrorMessageSchema.parse(message.slice(0, 2_000)),
    )
  } catch (error) {
    console.error('[startup] could not persist boot error', error)
  }
}

export function clearBootError(storage?: BootErrorStorage): void {
  // Web Storage can throw synchronously; this boundary keeps fallback rendering usable.
  try {
    const targetStorage = storage ?? window.localStorage
    targetStorage.removeItem(BOOT_ERROR_STORAGE_KEY)
  } catch (error) {
    console.error('[startup] could not clear persisted boot error', error)
  }
}

export function logBootError(message: string, error: unknown): void {
  if (platformKind() === 'browser') return

  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  void log(`[startup] ${message}: ${detail}`).catch((loggingError: unknown) => {
    console.error('[startup] backend boot-error logging failed', loggingError)
  })
}

export function reportBootError(message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  storeBootError(`${message}: ${detail}`)
  console.error(`[startup] ${message}`, error)
  logBootError(message, error)
}
