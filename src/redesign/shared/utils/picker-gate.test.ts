import { afterEach, describe, expect, test } from 'vitest'
import { pickWithNativeOrPathEntry } from './picker-gate'

const originalWindow = globalThis.window
const originalWailsFlag = import.meta.env.WAILS

function setWindow(value: Record<string, unknown>) {
  // @ts-expect-error Tests install minimal runtime markers.
  globalThis.window = value
}

function setWailsBuildFlag(value: string | undefined) {
  const env = import.meta.env as Record<string, string | undefined>
  if (value === undefined) delete env.WAILS
  else env.WAILS = value
}

afterEach(() => {
  globalThis.window = originalWindow
  setWailsBuildFlag(originalWailsFlag)
})

describe('native picker versus path entry', () => {
  test('server mode opens the archive path dialog instead of the native picker', async () => {
    setWailsBuildFlag('true')
    setWindow({ _wails: {} })
    const calls: string[] = []

    const result = await pickWithNativeOrPathEntry(
      async () => {
        calls.push('native')
        return ['/local/archive.zip']
      },
      async () => {
        calls.push('path-dialog')
        return ['/srv/modkeeper/mods/archive.zip']
      },
    )

    expect(calls).toEqual(['path-dialog'])
    expect(result).toEqual(['/srv/modkeeper/mods/archive.zip'])
  })

  test('plain browser mode opens path entry instead of the native picker', async () => {
    setWailsBuildFlag('false')
    setWindow({})
    const calls: string[] = []

    const result = await pickWithNativeOrPathEntry(
      async () => {
        calls.push('native')
        return ['/local/archive.zip']
      },
      async () => {
        calls.push('path-dialog')
        return ['/srv/modkeeper/mods/archive.zip']
      },
    )

    expect(calls).toEqual(['path-dialog'])
    expect(result).toEqual(['/srv/modkeeper/mods/archive.zip'])
  })

  test('desktop mode uses the native picker', async () => {
    setWailsBuildFlag('true')
    setWindow({ _wails: { environment: { OS: 'linux' } } })
    const calls: string[] = []

    const result = await pickWithNativeOrPathEntry(
      async () => {
        calls.push('native')
        return ['/local/archive.zip']
      },
      async () => {
        calls.push('path-dialog')
        return ['/srv/modkeeper/mods/archive.zip']
      },
    )

    expect(calls).toEqual(['native'])
    expect(result).toEqual(['/local/archive.zip'])
  })
})
