import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { atomWithStorage, createJSONStorage } from 'jotai/utils'
import { z } from 'zod'

type ScrollPositionMap = Record<string, number>
const maxScrollPositionEntries = 100

const scrollPositionMapSchema = z.record(z.string().min(1), z.number())

function isScrollPositionMap(value: unknown): value is ScrollPositionMap {
  const parsed = scrollPositionMapSchema.safeParse(value)
  if (!parsed.success) return false
  return Object.values(parsed.data).every(
    (scrollTop) => Number.isFinite(scrollTop) && scrollTop >= 0,
  )
}

function sanitizeScrollPositionMap(value: unknown): ScrollPositionMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return {}
  const entries = Object.entries(value).filter(
    ([pathname, scrollTop]) =>
      pathname.length > 0 &&
      typeof scrollTop === 'number' &&
      Number.isFinite(scrollTop) &&
      scrollTop >= 0,
  )
  return Object.fromEntries(entries.slice(-maxScrollPositionEntries))
}

const baseStorage = createJSONStorage<ScrollPositionMap>()
// Web Storage is synchronous and can throw on policy or quota errors; keep this boundary non-fatal.
function withStorageFallback<Value>(
  operation: string,
  readOrWrite: () => Value,
  fallback: Value,
): Value {
  try {
    return readOrWrite()
  } catch (error) {
    console.warn(
      `[redesign] scroll position storage ${operation} failed`,
      error,
    )
    return fallback
  }
}

const scrollPositionStorage = {
  getItem: (key: string, initialValue: ScrollPositionMap) =>
    withStorageFallback(
      'read',
      () => {
        const value = baseStorage.getItem(key, initialValue)
        return isScrollPositionMap(value) ? value : initialValue
      },
      initialValue,
    ),
  setItem: (key: string, value: ScrollPositionMap) => {
    withStorageFallback(
      'write',
      () => baseStorage.setItem(key, sanitizeScrollPositionMap(value)),
      undefined,
    )
  },
  removeItem: (key: string) => {
    withStorageFallback('remove', () => baseStorage.removeItem(key), undefined)
  },
  subscribe: (
    key: string,
    callback: (value: ScrollPositionMap) => void,
    initialValue: ScrollPositionMap,
  ) => {
    const unsubscribe = withStorageFallback<(() => void) | undefined>(
      'subscribe',
      () =>
        baseStorage.subscribe?.(
          key,
          (value: unknown) =>
            callback(isScrollPositionMap(value) ? value : initialValue),
          initialValue,
        ),
      undefined,
    )
    if (!unsubscribe) return undefined
    return () => {
      withStorageFallback('unsubscribe', () => unsubscribe(), undefined)
    }
  },
}

export const navigationExpandedAtom = atomWithStorage(
  'modkeeper.shell.navigationExpanded',
  true,
  undefined,
  { getOnInit: true },
)

export const scrollTopByPathAtom = atomWithStorage<ScrollPositionMap>(
  'modkeeper.shell.scrollTopByPath.v1',
  {},
  scrollPositionStorage,
  { getOnInit: true },
)

// Below 360px the expanded rail starves page content and the titlebar search
// field cannot stay usable, so the shell forces its compact variants there.
// Above that the persisted preferences apply unchanged.
export const narrowShellQuery = '(max-width: 360px)'

export function getEffectiveNavigationExpanded(
  expanded: boolean,
  narrow: boolean,
): boolean {
  return expanded && !narrow
}

export function toggleNavigationPreference(
  narrow: boolean,
  setExpanded: (update: (expanded: boolean) => boolean) => void,
): void {
  if (narrow) return
  setExpanded((expanded) => !expanded)
}

export function useMediaQueryMatches(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return matches
}

export function useEffectiveNavigationExpanded(): boolean {
  const expanded = useAtomValue(navigationExpandedAtom)
  const narrow = useMediaQueryMatches(narrowShellQuery)
  return getEffectiveNavigationExpanded(expanded, narrow)
}
