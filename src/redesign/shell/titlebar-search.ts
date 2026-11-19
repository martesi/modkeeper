export type TitlebarSearchKind = 'library' | 'registry'

export function getTitlebarSearchKind(
  pathname: string,
): TitlebarSearchKind | null {
  if (pathname.startsWith('/library')) return 'library'
  if (pathname.startsWith('/registry')) return 'registry'
  return null
}

export function setTitlebarSearchQuery(
  kind: TitlebarSearchKind | null,
  query: string,
  setLibraryQuery: (query: string) => void,
  setRegistryQuery: (query: string) => void,
): void {
  if (kind === 'library') setLibraryQuery(query)
  if (kind === 'registry') setRegistryQuery(query)
}

export function getTitlebarSearchShortcut(
  event: Pick<
    KeyboardEvent,
    | 'key'
    | 'ctrlKey'
    | 'metaKey'
    | 'altKey'
    | 'isComposing'
    | 'defaultPrevented'
  >,
): 'palette' | 'find' | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    !(event.ctrlKey || event.metaKey)
  ) {
    return null
  }
  const key = event.key.toLowerCase()
  if (key === 'k') return 'palette'
  if (key === 'f') return 'find'
  return null
}

export function openTitlebarPaletteForShortcut(
  event: Pick<
    KeyboardEvent,
    | 'key'
    | 'ctrlKey'
    | 'metaKey'
    | 'altKey'
    | 'isComposing'
    | 'defaultPrevented'
    | 'preventDefault'
  >,
  canSearch: boolean,
  isDialogOpen: boolean,
  openPalette: () => void,
): boolean {
  if (!canSearch || isDialogOpen || !getTitlebarSearchShortcut(event)) {
    return false
  }
  event.preventDefault()
  openPalette()
  return true
}

export function closeTitlebarPaletteOnEscape(
  event: Pick<KeyboardEvent, 'key'>,
  closePalette: () => void,
): boolean {
  if (event.key !== 'Escape') return false
  closePalette()
  return true
}

export function focusTitlebarPaletteInput(
  input: Pick<HTMLInputElement, 'focus' | 'select'> | null,
  event: { preventDefault: () => void },
  selectQuery = false,
): void {
  event.preventDefault()
  input?.focus()
  if (selectQuery) input?.select()
}
