import { afterEach, describe, expect, test } from 'bun:test'
import { isNativeDesktopShell } from '@/wails/runtime'
import {
  closeTitlebarPaletteOnEscape,
  focusTitlebarPaletteInput,
  getTitlebarSearchKind,
  openTitlebarPaletteForShortcut,
  setTitlebarSearchQuery,
} from './titlebar-search'
import { showWindowControls } from './titlebar-chrome'

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

describe('titlebar window controls', () => {
  test('are absent without native window chrome', () => {
    setWailsBuildFlag('true')
    setWindow({ _wails: {} })
    expect(showWindowControls(false, isNativeDesktopShell())).toBe(false)

    setWailsBuildFlag('false')
    setWindow({})
    expect(showWindowControls(false, isNativeDesktopShell())).toBe(false)
  })

  test('render for non-macOS desktop shells only', () => {
    setWailsBuildFlag('true')
    setWindow({ _wails: { environment: { OS: 'linux' } } })
    expect(showWindowControls(false, isNativeDesktopShell())).toBe(true)
    expect(showWindowControls(true, isNativeDesktopShell())).toBe(false)

    setWailsBuildFlag('false')
    setWindow({ __TAURI__: {} })
    expect(showWindowControls(false, isNativeDesktopShell())).toBe(true)
  })
})

describe('titlebar command palette', () => {
  test('opens with Ctrl+K and Ctrl+F only when search is available', () => {
    let openCount = 0
    let prevented = 0
    const openPalette = () => {
      openCount += 1
    }
    const ctrlK = {
      key: 'k',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      preventDefault: () => {
        prevented += 1
      },
    }

    expect(
      openTitlebarPaletteForShortcut(ctrlK, true, false, openPalette),
    ).toBe(true)
    expect(
      openTitlebarPaletteForShortcut(ctrlK, false, false, openPalette),
    ).toBe(false)
    expect(openTitlebarPaletteForShortcut(ctrlK, true, true, openPalette)).toBe(
      false,
    )

    const ctrlF = { ...ctrlK, key: 'f' }
    expect(
      openTitlebarPaletteForShortcut(ctrlF, true, false, openPalette),
    ).toBe(true)
    expect(openCount).toBe(2)
    expect(prevented).toBe(2)
  })

  test('Escape closes and opening autofocuses the palette input', () => {
    let isOpen = true
    expect(
      closeTitlebarPaletteOnEscape({ key: 'Escape' }, () => {
        isOpen = false
      }),
    ).toBe(true)
    expect(isOpen).toBe(false)

    let prevented = false
    let focused = false
    let selected = false
    focusTitlebarPaletteInput(
      {
        focus: () => (focused = true),
        select: () => (selected = true),
      },
      { preventDefault: () => (prevented = true) },
      true,
    )
    expect(prevented).toBe(true)
    expect(focused).toBe(true)
    expect(selected).toBe(true)
  })

  test('routes palette typing into each page search atom', () => {
    let libraryQuery = ''
    let registryQuery = ''
    const setLibraryQuery = (query: string) => {
      libraryQuery = query
    }
    const setRegistryQuery = (query: string) => {
      registryQuery = query
    }

    const libraryRoute = getTitlebarSearchKind('/library/123')
    const registryRoute = getTitlebarSearchKind('/registry')
    expect(getTitlebarSearchKind('/settings')).toBeNull()
    setTitlebarSearchQuery(
      libraryRoute,
      'installed mod',
      setLibraryQuery,
      setRegistryQuery,
    )
    setTitlebarSearchQuery(
      registryRoute,
      'Forge addon',
      setLibraryQuery,
      setRegistryQuery,
    )
    expect(libraryQuery).toBe('installed mod')
    expect(registryQuery).toBe('Forge addon')
  })
})
