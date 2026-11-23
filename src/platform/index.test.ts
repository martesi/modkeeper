import { afterEach, describe, expect, mock, test } from 'bun:test'
import { isNativeDesktopShell } from '@/wails/runtime'
import * as platform from './index'

const originalWindow = globalThis.window
const originalOpen = originalWindow?.open
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
  // @ts-expect-error Restore original browser global.
  globalThis.window = originalWindow
  if (globalThis.window) window.open = originalOpen
  setWailsBuildFlag(originalWailsFlag)
})

describe('platform capability dispatch', () => {
  test('selects Wails or browser', () => {
    setWindow({ _wails: { environment: { OS: 'linux' } } })
    expect(platform.platformKind()).toBe('wails')
    setWindow({})
    expect(platform.platformKind()).toBe('browser')
  })

  test('does not expose desktop capabilities in browser mode or the mock', () => {
    setWailsBuildFlag('false')
    setWindow({})
    expect(isNativeDesktopShell()).toBe(false)
    expect(platform.hasNativeFilePicker()).toBe(false)
    expect(platform.hasNativeWindowChrome()).toBe(false)
    expect(platform.canOpenPath()).toBe(false)

    setWindow({ __MK_WAILS_MOCK__: {} })
    expect(platform.platformKind()).toBe('browser')
    expect(platform.hasNativeFilePicker()).toBe(false)
  })

  test('Wails environment exposes desktop capabilities', () => {
    setWindow({ _wails: { environment: { OS: 'linux' } } })
    expect(platform.platformKind()).toBe('wails')
    expect(platform.hasNativeFilePicker()).toBe(true)
    expect(platform.hasNativeWindowChrome()).toBe(true)
    expect(platform.canOpenPath()).toBe(true)
  })

  test('opens browser URLs in a local tab', async () => {
    setWailsBuildFlag('false')
    setWindow({})
    const open = mock(() => null)
    window.open = open
    await platform.openUrl('https://example.test')
    expect(open).toHaveBeenCalledWith(
      'https://example.test',
      '_blank',
      'noopener,noreferrer',
    )
  })

  test('does not open native pickers in browser mode', async () => {
    setWailsBuildFlag('false')
    setWindow({})
    expect(await platform.pickFiles()).toEqual([])
    expect(await platform.pickDirectory()).toBeNull()
  })
})
