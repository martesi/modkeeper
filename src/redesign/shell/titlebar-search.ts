export type TitlebarSearchKind = 'library' | 'registry'

export interface PendingLibraryReveal {
  id: string
  libraryId: string | null
  screen: object | null
  cancelled: boolean
}

export interface LibraryRevealSnapshot {
  libraryId: string | null
  screen: object | null
  modIds: readonly string[]
}

export interface RevealFocusTarget {
  scrollIntoView(options?: ScrollIntoViewOptions): void
  focus(options?: FocusOptions): void
}

export function getTitlebarSearchResults<T extends { name: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return [...items]
  return items.filter((item) =>
    item.name.toLocaleLowerCase().includes(normalized),
  )
}

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

export function clampTitlebarActiveIndex(
  resultCount: number,
  activeIndex: number,
): number {
  if (resultCount <= 0) return 0
  return Math.min(Math.max(activeIndex, 0), resultCount - 1)
}

export function stepTitlebarActiveIndex(
  resultCount: number,
  activeIndex: number,
  step: -1 | 1,
): number {
  const base = clampTitlebarActiveIndex(resultCount, activeIndex)
  return clampTitlebarActiveIndex(resultCount, base + step)
}

export function isPendingLibraryRevealLive(
  request: PendingLibraryReveal,
  snapshot: LibraryRevealSnapshot,
): boolean {
  if (request.cancelled || !request.screen || !request.libraryId) return false
  if (snapshot.libraryId !== request.libraryId) return false
  if (snapshot.screen !== request.screen) return false
  return snapshot.modIds.includes(request.id)
}

export function resolvePaletteCloseFocus<
  TRevealTarget extends RevealFocusTarget,
>(
  request: PendingLibraryReveal | null,
  snapshot: LibraryRevealSnapshot,
  findCard: (modId: string) => TRevealTarget | null,
): TRevealTarget | null {
  if (!request || !isPendingLibraryRevealLive(request, snapshot)) return null
  return findCard(request.id)
}
