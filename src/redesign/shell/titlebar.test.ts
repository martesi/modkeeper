import { afterEach, describe, expect, test } from 'bun:test'
import { isNativeDesktopShell } from '@/wails/runtime'
import {
  clampTitlebarActiveIndex,
  stepTitlebarActiveIndex,
  closeTitlebarPaletteOnEscape,
  getTitlebarSearchResults,
  focusTitlebarPaletteInput,
  getTitlebarSearchKind,
  getTitlebarSearchShortcut,
  openTitlebarPaletteForShortcut,
  resolvePaletteCloseFocus,
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
  test('matches autocomplete results', () => {
    const mods = [
      { id: '1', name: 'Alpha Mod' },
      { id: '2', name: 'Beta' },
    ]
    expect(getTitlebarSearchResults(mods, 'alpha')).toEqual([mods[0]])
    expect(getTitlebarSearchResults(mods, '')).toEqual(mods)
  })

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

  test('composition keystrokes never open the palette', () => {
    const composingK = {
      key: 'k',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      isComposing: true,
      defaultPrevented: false,
      preventDefault: () => {},
    }
    expect(getTitlebarSearchShortcut(composingK)).toBeNull()
    expect(
      openTitlebarPaletteForShortcut(composingK, true, false, () => {
        throw new Error('composing input must not open the palette')
      }),
    ).toBe(false)
  })

  test('clamps the active option when the result list shrinks', () => {
    expect(clampTitlebarActiveIndex(0, 0)).toBe(0)
    expect(clampTitlebarActiveIndex(0, 5)).toBe(0)
    expect(clampTitlebarActiveIndex(3, 1)).toBe(1)
    expect(clampTitlebarActiveIndex(3, 9)).toBe(2)
    expect(clampTitlebarActiveIndex(3, -2)).toBe(0)
  })

  test('Arrow Up moves from the clamped visible result after the list shrinks', () => {
    const storedActive = 9
    const resultCount = 3
    const visibleActive = clampTitlebarActiveIndex(resultCount, storedActive)
    const nextActive = stepTitlebarActiveIndex(resultCount, storedActive, -1)

    expect(visibleActive).toBe(2)
    expect(nextActive).toBe(1)
  })

  test('keyboard activation after shrinking lands on a valid option', () => {
    const mods = [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
      { id: 'c', name: 'Gamma' },
    ]
    const activeResult = 2
    const shrunk = mods.slice(0, 1)
    const safeActive = clampTitlebarActiveIndex(shrunk.length, activeResult)
    const chosen = shrunk[safeActive]
    expect(chosen?.id).toBe('a')
    // aria-activedescendant must reference an option rendered in the list.
    expect(
      shrunk.some(
        (mod) => `palette-result-${mod.id}` === `palette-result-${chosen?.id}`,
      ),
    ).toBe(true)
  })

  test('live reveal request with a rendered card resolves to that card', () => {
    const screen = {}
    const card = {
      scrollIntoView: () => {},
      focus: () => {},
    }
    expect(
      resolvePaletteCloseFocus(
        { id: 'mod-1', libraryId: 'lib-1', screen, cancelled: false },
        { libraryId: 'lib-1', screen, modIds: ['mod-1'] },
        (id) => (id === 'mod-1' ? card : null),
      ),
    ).toBe(card)
  })

  test('cancelled reveal restores focus to the trigger instead of stealing it', () => {
    const screen = {}
    const stubCard = {
      scrollIntoView: () => {},
      focus: () => {},
    }
    expect(
      resolvePaletteCloseFocus(
        { id: 'mod-1', libraryId: 'lib-1', screen, cancelled: true },
        { libraryId: 'lib-1', screen, modIds: ['mod-1'] },
        () => stubCard,
      ),
    ).toBeNull()
  })

  test('missing card restores focus to the trigger instead of the body', () => {
    const screen = {}
    expect(
      resolvePaletteCloseFocus(
        { id: 'mod-1', libraryId: 'lib-1', screen, cancelled: false },
        { libraryId: 'lib-1', screen, modIds: ['mod-1'] },
        () => null,
      ),
    ).toBeNull()
  })

  test('later navigation or library changes never steal focus', () => {
    const screen = {}
    const request = {
      id: 'mod-1',
      libraryId: 'lib-1',
      screen,
      cancelled: false,
    }
    const snapshot = {
      libraryId: 'lib-1',
      screen,
      modIds: ['mod-1'],
    }
    const findCard = () => ({
      scrollIntoView: () => {},
      focus: () => {},
    })
    expect(
      resolvePaletteCloseFocus(
        request,
        { ...snapshot, libraryId: 'other-library' },
        findCard,
      ),
    ).toBeNull()
    expect(
      resolvePaletteCloseFocus(request, { ...snapshot, screen: {} }, findCard),
    ).toBeNull()
    expect(
      resolvePaletteCloseFocus(request, { ...snapshot, modIds: [] }, findCard),
    ).toBeNull()
    expect(resolvePaletteCloseFocus(null, snapshot, findCard)).toBeNull()
  })
})
