import { useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResize,
  platformKind,
  setWindowChrome,
  toggleMaximizeWindow,
} from '@/platform'
import { useRouterState } from '@tanstack/react-router'
import { Maximize, Copy, Minus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { FidelityInput } from '../shared/components/fidelity-input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { commonText } from '../i18n/common-text'
import { libraryText } from '../i18n/library-text'
import { registryText } from '../i18n/registry-text'
import { librarySearchAtom } from '../state/library-state'
import { registrySearchAtom } from '../state/registry-state'
import { NavigationToggle } from './navigation-toggle'
import {
  navigationExpandedAtom,
  narrowShellQuery,
  useEffectiveNavigationExpanded,
  useMediaQueryMatches,
} from './shell-state'
import {
  closeTitlebarPaletteOnEscape,
  focusTitlebarPaletteInput,
  getTitlebarSearchKind,
  getTitlebarSearchShortcut,
  openTitlebarPaletteForShortcut,
  setTitlebarSearchQuery,
} from './titlebar-search'
import { TitleBarDragRegion } from './titlebar-drag'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const searchKind = getTitlebarSearchKind(pathname)
  const [libraryQuery, setLibraryQuery] = useAtom(librarySearchAtom)
  const [registryQuery, setRegistryQuery] = useAtom(registrySearchAtom)
  const query = searchKind === 'registry' ? registryQuery : libraryQuery
  const [, setNavigationExpanded] = useAtom(navigationExpandedAtom)
  const [paletteOpenPath, setPaletteOpenPath] = useState<string | null>(null)
  const paletteInputRef = useRef<HTMLInputElement | null>(null)
  const selectPaletteQueryOnOpen = useRef(false)
  const narrow = useMediaQueryMatches(narrowShellQuery)
  // Forced-compact widths keep the stored preference but render the compact
  // rail, so the toggle reflects what is actually displayed.
  const effectiveNavigationExpanded = useEffectiveNavigationExpanded()
  const searchEnabled = searchKind !== null
  const paletteOpen = searchEnabled && paletteOpenPath === pathname
  const searchLabel =
    searchKind === 'registry'
      ? registryText.searchLabel()
      : searchKind === 'library'
        ? libraryText.searchLabel()
        : commonText.searchUnavailable()
  const searchPlaceholder =
    searchKind === 'registry'
      ? registryText.searchPlaceholder()
      : searchKind === 'library'
        ? libraryText.searchPlaceholder()
        : commonText.searchUnavailable()
  const isMacOS =
    navigator.userAgent.includes('Macintosh') ||
    navigator.userAgent.includes('Mac OS X')
  const showCaptionButtons = platformKind() !== 'browser' && !isMacOS

  // The titlebar entry opens the same centered palette at every width. Ctrl+F
  // remains available for the former wide-field and narrow collapsed-field paths.
  useEffect(() => {
    if (!searchEnabled) return
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = getTitlebarSearchShortcut(event)
      const opened = openTitlebarPaletteForShortcut(
        event,
        searchEnabled,
        Boolean(document.querySelector('[role="dialog"][data-state="open"]')),
        () => setPaletteOpenPath(pathname),
      )
      if (opened) {
        selectPaletteQueryOnOpen.current = shortcut === 'find'
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pathname, searchEnabled])

  useEffect(() => {
    if (platformKind() === 'browser') return
    if (isMacOS) {
      handleWindowOperation(setWindowChrome('overlay'))
      return
    }
    handleWindowOperation(setWindowChrome('frameless'))

    let disposed = false
    let unlistenResize: (() => void) | undefined
    const syncMaximizedState = () => {
      void isWindowMaximized().then(
        (maximized) => {
          if (!disposed) setIsMaximized(maximized)
        },
        (error: unknown) =>
          console.error('[redesign] maximize state read failed', error),
      )
    }

    syncMaximizedState()
    void onWindowResize(syncMaximizedState).then(
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
    <Dialog
      open={paletteOpen}
      onOpenChange={(open) => setPaletteOpenPath(open ? pathname : null)}
    >
      <header
        data-macos={isMacOS ? 'true' : undefined}
        data-caption={showCaptionButtons ? 'true' : undefined}
        className="mk-titlebar relative z-20 flex h-11 shrink-0 items-center justify-between border-b border-border bg-background/25"
      >
        <TitleBarDragRegion platform={platformKind()} />

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

        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={searchLabel}
            title={searchLabel}
            disabled={!searchEnabled}
            className="mk-titlebar-search-trigger pointer-events-auto absolute left-1/2 top-1/2 z-10 flex h-8 -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-[4px] border border-border bg-secondary px-2.5 text-left text-[13px] text-muted-foreground outline-none transition-colors hover:border-ring/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="mk-titlebar-search-placeholder min-w-0 flex-1 truncate">
              {searchPlaceholder}
            </span>
            <kbd className="mk-titlebar-search-shortcut rounded-sm border border-border px-1 py-0.5 text-[10px] leading-none text-muted-foreground">
              {isMacOS ? '⌘ K' : 'Ctrl K'}
            </kbd>
          </button>
        </DialogTrigger>

        {showCaptionButtons && (
          <div className="relative z-10 flex h-11 shrink-0 items-stretch">
            <button
              type="button"
              aria-label={commonText.minimizeWindow()}
              title={commonText.minimizeWindow()}
              className="flex h-11 w-[46px] items-center justify-center text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => handleWindowOperation(minimizeWindow())}
            >
              <Minus className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={commonText.maximizeWindow()}
              title={commonText.maximizeWindow()}
              className="flex h-11 w-[46px] items-center justify-center text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => handleWindowOperation(toggleMaximizeWindow())}
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
              onClick={() => handleWindowOperation(closeWindow())}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </header>
      <DialogContent
        className="w-[min(40rem,calc(100vw-2rem))] gap-0 overflow-hidden rounded-lg bg-popover p-0 sm:max-w-none"
        onOpenAutoFocus={(event) => {
          focusTitlebarPaletteInput(
            paletteInputRef.current,
            event,
            selectPaletteQueryOnOpen.current,
          )
          selectPaletteQueryOnOpen.current = false
        }}
        onEscapeKeyDown={(event) =>
          closeTitlebarPaletteOnEscape(event, () => setPaletteOpenPath(null))
        }
      >
        <DialogTitle className="sr-only">{searchLabel}</DialogTitle>
        <DialogDescription className="sr-only">
          {commonText.searchPaletteDescription()}
        </DialogDescription>
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search
            className="size-5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <FidelityInput
            ref={paletteInputRef}
            type="search"
            value={searchEnabled ? query : ''}
            onChange={(event) =>
              setTitlebarSearchQuery(
                searchKind,
                event.target.value,
                setLibraryQuery,
                setRegistryQuery,
              )
            }
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
            data-command-palette-search=""
            className="h-14 border-0 bg-transparent px-0 text-base shadow-none focus-visible:border-transparent focus-visible:ring-0"
          />
          <kbd className="shrink-0 rounded-sm border border-border px-1.5 py-1 text-[11px] text-muted-foreground">
            Esc
          </kbd>
        </div>
        <p className="px-4 py-3 text-[12px] text-muted-foreground">
          {searchPlaceholder}
        </p>
      </DialogContent>
    </Dialog>
  )
}

function handleWindowOperation(operation: Promise<void>): void {
  void operation.catch((error: unknown) => {
    console.error('[redesign] window operation failed', error)
    toast.error(commonText.somethingWentWrong())
  })
}
