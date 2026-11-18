import { useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useRouterState } from '@tanstack/react-router'
import { Maximize, Copy, Minus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { FidelityInput } from '../shared/components/fidelity-input'
import { commonText } from '../i18n/common-text'
import { libraryText } from '../i18n/library-text'
import { librarySearchAtom } from '../state/library-state'
import { NavigationToggle } from './navigation-toggle'
import {
  navigationExpandedAtom,
  narrowShellQuery,
  useEffectiveNavigationExpanded,
  useMediaQueryMatches,
} from './shell-state'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const [query, setQuery] = useAtom(librarySearchAtom)
  const [, setNavigationExpanded] = useAtom(navigationExpandedAtom)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement | null>(null)
  const narrow = useMediaQueryMatches(narrowShellQuery)
  // Forced-compact widths keep the stored preference but render the compact
  // rail, so the toggle reflects what is actually displayed.
  const effectiveNavigationExpanded = useEffectiveNavigationExpanded()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const searchEnabled = pathname.startsWith('/library')
  // The collapsed-field overlay only applies where search is available; it
  // closes by derivation when the route leaves /library.
  const searchOverlayOpen = searchOpen && narrow && searchEnabled
  const isMacOS =
    navigator.userAgent.includes('Macintosh') ||
    navigator.userAgent.includes('Mac OS X')
  const showCaptionButtons = isTauri() && !isMacOS

  // Narrow windows collapse the search field behind an icon button; Ctrl+F
  // opens the collapsed field so the keyboard path keeps working.
  useEffect(() => {
    if (!narrow || !searchEnabled) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'f'
      ) {
        return
      }
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      setSearchOpen(true)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [narrow, searchEnabled])

  useEffect(() => {
    if (!searchOverlayOpen) return
    const input =
      searchContainerRef.current?.querySelector<HTMLInputElement>('input')
    input?.focus()
    input?.select()
  }, [searchOverlayOpen])

  useEffect(() => {
    if (!isTauri()) return
    const appWindow = getCurrentWindow()
    if (isMacOS) {
      handleWindowOperation(appWindow.setTitleBarStyle('overlay'))
      return
    }
    handleWindowOperation(appWindow.setDecorations(false))

    let disposed = false
    let unlistenResize: (() => void) | undefined
    const syncMaximizedState = () => {
      void appWindow.isMaximized().then(
        (maximized) => {
          if (!disposed) setIsMaximized(maximized)
        },
        (error: unknown) =>
          console.error('[redesign] maximize state read failed', error),
      )
    }

    syncMaximizedState()
    void appWindow.onResized(syncMaximizedState).then(
      (unlisten) => {
        if (disposed) {
          unlisten()
          return
        }
        unlistenResize = unlisten
      },
      (error: unknown) =>
        console.error('[redesign] maximize state listener failed', error),
    )

    return () => {
      disposed = true
      unlistenResize?.()
    }
  }, [isMacOS])

  return (
    <header
      data-macos={isMacOS ? 'true' : undefined}
      data-caption={showCaptionButtons ? 'true' : undefined}
      className="mk-titlebar relative z-20 flex h-11 shrink-0 items-center justify-between border-b border-border bg-background/25"
    >
      <div aria-hidden data-tauri-drag-region className="absolute inset-0" />

      <div
        className={`relative z-10 flex h-11 items-center gap-2 pointer-events-none ${isMacOS ? 'pl-[76px]' : 'pl-2'}`}
      >
        <NavigationToggle
          expanded={effectiveNavigationExpanded}
          label={
            effectiveNavigationExpanded
              ? commonText.collapseNavigation()
              : commonText.expandNavigation()
          }
          narrow={narrow}
          setExpanded={setNavigationExpanded}
        />
        <span className="mk-titlebar-app-title pointer-events-none text-[13px] font-semibold text-foreground">
          {commonText.appName()}
        </span>
      </div>

      <button
        type="button"
        aria-label={
          searchEnabled
            ? libraryText.searchLabel()
            : commonText.searchUnavailable()
        }
        title={
          searchEnabled
            ? libraryText.searchLabel()
            : commonText.searchUnavailable()
        }
        disabled={!searchEnabled}
        aria-hidden={searchOverlayOpen || undefined}
        tabIndex={searchOverlayOpen ? -1 : undefined}
        className="mk-titlebar-search-toggle pointer-events-auto absolute left-1/2 top-1/2 z-10 size-8 -translate-x-1/2 -translate-y-1/2 rounded-[4px] text-muted-foreground outline-none transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        onClick={() => setSearchOpen(true)}
      >
        <Search className="size-4" aria-hidden />
      </button>

      <div
        ref={searchContainerRef}
        data-search-open={searchOverlayOpen ? 'true' : undefined}
        className="mk-titlebar-search absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1"
      >
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <FidelityInput
          type="search"
          value={searchEnabled ? query : ''}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (!searchOverlayOpen || event.key !== 'Escape') return
            setSearchOpen(false)
            event.currentTarget.blur()
          }}
          placeholder={
            searchEnabled
              ? libraryText.searchPlaceholder()
              : commonText.searchUnavailable()
          }
          aria-label={
            searchEnabled
              ? libraryText.searchLabel()
              : commonText.searchUnavailable()
          }
          data-library-search=""
          disabled={!searchEnabled}
          className={`h-8 rounded-[4px] pl-8 text-[13px] ${searchOverlayOpen ? 'pr-9' : ''}`}
        />
        <button
          type="button"
          aria-label={commonText.close()}
          title={commonText.close()}
          className="mk-titlebar-search-close pointer-events-auto absolute right-1 top-1/2 z-10 size-6 -translate-y-1/2 rounded-[4px] text-muted-foreground outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setSearchOpen(false)}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {showCaptionButtons && (
        <div className="relative z-10 flex h-11 shrink-0 items-stretch">
          <button
            type="button"
            aria-label={commonText.minimizeWindow()}
            title={commonText.minimizeWindow()}
            className="flex h-11 w-[46px] items-center justify-center text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => handleWindowOperation(getCurrentWindow().minimize())}
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={commonText.maximizeWindow()}
            title={commonText.maximizeWindow()}
            className="flex h-11 w-[46px] items-center justify-center text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() =>
              handleWindowOperation(getCurrentWindow().toggleMaximize())
            }
          >
            {isMaximized ? (
              <Copy className="size-4" aria-hidden />
            ) : (
              <Maximize className="size-4" aria-hidden />
            )}
          </button>
          <button
            type="button"
            aria-label={commonText.close()}
            title={commonText.close()}
            className="flex h-11 w-[46px] items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => handleWindowOperation(getCurrentWindow().close())}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </header>
  )
}

function handleWindowOperation(operation: Promise<void>): void {
  void operation.catch((error: unknown) => {
    console.error('[redesign] window operation failed', error)
    toast.error(commonText.somethingWentWrong())
  })
}
