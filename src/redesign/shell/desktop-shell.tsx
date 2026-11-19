/* Full-height app shell. Dialog and toast portals mount outside the scrollable page. */
import type { ReactNode } from 'react'
import { useAtom } from 'jotai'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { AppBackground } from './app-background'
import { LeftNavigation } from './left-navigation'
import { scrollTopByPathAtom } from './shell-state'
import { TitleBar } from './titlebar'
import './desktop-shell.css'

type PendingScrollRestore = {
  pathname: string
  target: number
  lastActual: number
}

const scrollIntentKeys = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
  'Spacebar',
])

function savedScrollTop(positions: unknown, pathname: string): number {
  if (typeof positions !== 'object' || positions === null) return 0
  if (!Object.hasOwn(positions, pathname)) return 0
  const position = Object.getOwnPropertyDescriptor(positions, pathname)?.value
  return typeof position === 'number' &&
    Number.isFinite(position) &&
    position >= 0
    ? position
    : 0
}

function withRecentScrollTop(
  positions: Record<string, number>,
  pathname: string,
  scrollTop: number,
): Record<string, number> {
  const next = { ...positions }
  delete next[pathname]
  next[pathname] = scrollTop
  return next
}

function applyPendingScrollRestore(
  main: HTMLElement | null,
  pathname: string,
  pending: PendingScrollRestore | null,
  lastScrollTopByPath: Record<string, number>,
  setPending: (value: PendingScrollRestore | null) => void,
): void {
  if (!main || !pending || pending.pathname !== pathname) return
  if (main.scrollTop !== pending.lastActual) {
    setPending(null)
    return
  }

  main.scrollTop = pending.target
  pending.lastActual = main.scrollTop
  lastScrollTopByPath[pending.pathname] = main.scrollTop
  if (main.scrollTop === pending.target) setPending(null)
}

export function DesktopShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const [scrollTopByPath, setScrollTopByPath] = useAtom(scrollTopByPathAtom)
  const mainRef = useRef<HTMLElement | null>(null)
  const previousPathname = useRef(pathname)
  const restoredPathname = useRef<string | null>(null)
  const lastScrollTopByPath = useRef<Record<string, number>>({})
  const pendingScrollRestore = useRef<PendingScrollRestore | null>(null)
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    const main = mainRef.current
    if (!main) return

    const outgoingPathname = previousPathname.current
    if (outgoingPathname !== pathname) {
      if (scrollSaveTimer.current !== null) {
        clearTimeout(scrollSaveTimer.current)
        scrollSaveTimer.current = null
      }
      const pending = pendingScrollRestore.current
      const outgoingScrollTop =
        pending?.pathname === outgoingPathname
          ? pending.target
          : (lastScrollTopByPath.current[outgoingPathname] ?? main.scrollTop)
      setScrollTopByPath((positions) =>
        withRecentScrollTop(positions, outgoingPathname, outgoingScrollTop),
      )

      previousPathname.current = pathname
      restoredPathname.current = pathname
      pendingScrollRestore.current = {
        pathname,
        target: savedScrollTop(scrollTopByPath, pathname),
        lastActual: main.scrollTop,
      }
      applyPendingScrollRestore(
        main,
        pathname,
        pendingScrollRestore.current,
        lastScrollTopByPath.current,
        (value) => {
          pendingScrollRestore.current = value
        },
      )
      return
    }

    if (restoredPathname.current === pathname) return
    restoredPathname.current = pathname
    pendingScrollRestore.current = {
      pathname,
      target: savedScrollTop(scrollTopByPath, pathname),
      lastActual: main.scrollTop,
    }
    applyPendingScrollRestore(
      main,
      pathname,
      pendingScrollRestore.current,
      lastScrollTopByPath.current,
      (value) => {
        pendingScrollRestore.current = value
      },
    )
  }, [pathname, scrollTopByPath, setScrollTopByPath])

  useEffect(() => {
    const cancelRestoreForScrollKey = (event: KeyboardEvent) => {
      if (!pendingScrollRestore.current || !scrollIntentKeys.has(event.key))
        return
      const target = event.target
      if (target !== mainRef.current && target !== document.body) return
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches('input, textarea, select'))
      )
        return
      pendingScrollRestore.current = null
    }

    document.addEventListener('keydown', cancelRestoreForScrollKey)
    return () =>
      document.removeEventListener('keydown', cancelRestoreForScrollKey)
  }, [])

  useEffect(() => {
    const main = mainRef.current
    if (!main || typeof MutationObserver === 'undefined') return

    const restorePendingScroll = () =>
      applyPendingScrollRestore(
        mainRef.current,
        previousPathname.current,
        pendingScrollRestore.current,
        lastScrollTopByPath.current,
        (value) => {
          pendingScrollRestore.current = value
        },
      )
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(restorePendingScroll)
    const observeChildren = () => {
      resizeObserver?.disconnect()
      for (const child of main.children) resizeObserver?.observe(child)
      restorePendingScroll()
    }
    const mutationObserver = new MutationObserver((records) => {
      if (records.some((record) => record.target === main)) observeChildren()
      restorePendingScroll()
    })

    mutationObserver.observe(main, {
      attributes: true,
      attributeFilter: ['class', 'hidden', 'style'],
      characterData: true,
      childList: true,
      subtree: true,
    })
    observeChildren()

    return () => {
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
    }
  }, [])

  useEffect(
    () => () => {
      if (scrollSaveTimer.current !== null)
        clearTimeout(scrollSaveTimer.current)
      const pathname = previousPathname.current
      const pending = pendingScrollRestore.current
      const scrollTop =
        pending?.pathname === pathname
          ? pending.target
          : (mainRef.current?.scrollTop ??
            lastScrollTopByPath.current[pathname] ??
            0)
      setScrollTopByPath((positions) =>
        withRecentScrollTop(positions, pathname, scrollTop),
      )
    },
    [setScrollTopByPath],
  )

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden text-foreground">
      <AppBackground />
      <TitleBar />
      <div className="flex min-h-0 flex-1 flex-row">
        <LeftNavigation />
        <main
          ref={mainRef}
          className="mk-scrollbar relative min-w-0 flex-1 overflow-y-auto px-4 py-3"
          onScroll={(event) => {
            const currentPathname = previousPathname.current
            const scrollTop = event.currentTarget.scrollTop
            const pending = pendingScrollRestore.current
            if (pending?.pathname === currentPathname) {
              if (scrollTop === pending.lastActual) return
              pendingScrollRestore.current = null
            }

            lastScrollTopByPath.current[currentPathname] = scrollTop
            if (scrollSaveTimer.current !== null)
              clearTimeout(scrollSaveTimer.current)
            scrollSaveTimer.current = setTimeout(() => {
              scrollSaveTimer.current = null
              setScrollTopByPath((positions) =>
                withRecentScrollTop(
                  positions,
                  currentPathname,
                  lastScrollTopByPath.current[currentPathname] ?? scrollTop,
                ),
              )
            }, 150)
          }}
          onTouchMove={() => {
            pendingScrollRestore.current = null
          }}
          onWheel={() => {
            pendingScrollRestore.current = null
          }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
