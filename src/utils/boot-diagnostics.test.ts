import { afterEach, describe, expect, vi, test } from 'vitest'
import {
  BOOT_ERROR_STORAGE_KEY,
  clearBootError,
  readBootError,
  storeBootError,
} from './boot-diagnostics'

afterEach(() => vi.restoreAllMocks())

function createStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('boot error storage', () => {
  test('persists, reads, and clears the message used by the HTML fallback', () => {
    const storage = createStorage()

    storeBootError('Entry module failed to load', storage)

    expect(storage.getItem(BOOT_ERROR_STORAGE_KEY)).toBe(
      'Entry module failed to load',
    )
    expect(readBootError(storage)).toBe('Entry module failed to load')

    clearBootError(storage)

    expect(readBootError(storage)).toBeNull()
  })

  test('ignores stored boot errors longer than the supported limit', () => {
    const storage = createStorage()
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    storage.setItem(BOOT_ERROR_STORAGE_KEY, 'x'.repeat(2_001))

    expect(readBootError(storage)).toBeNull()
    expect(logError).toHaveBeenCalledWith(
      '[startup] persisted boot error was invalid',
    )
  })

  test('returns null when no boot error has been stored', () => {
    expect(readBootError(createStorage())).toBeNull()
  })

  test('replaces the stored message when a later boot error is recorded', () => {
    const storage = createStorage()

    storeBootError('First failure', storage)
    storeBootError('Latest failure', storage)

    expect(readBootError(storage)).toBe('Latest failure')
  })
})
