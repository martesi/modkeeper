import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import {
  BOOT_ERROR_STORAGE_KEY,
  clearBootError,
  readBootError,
  storeBootError,
} from './boot-diagnostics'

afterEach(() => mock.restore())

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
    const logError = spyOn(console, 'error').mockImplementation(() => {})
    storage.setItem(BOOT_ERROR_STORAGE_KEY, 'x'.repeat(2_001))

    expect(readBootError(storage)).toBeNull()
    expect(logError).toHaveBeenCalledWith(
      '[startup] persisted boot error was invalid',
    )
  })
})
