import { describe, expect, test } from 'bun:test'
import {
  closeTitlebarPaletteOnEscape,
  focusTitlebarPaletteInput,
  getTitlebarSearchKind,
  openTitlebarPaletteForShortcut,
  setTitlebarSearchQuery,
} from './titlebar-search'

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
