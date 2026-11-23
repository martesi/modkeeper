import { useEffect, useRef, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResize,
  platformKind,
  setWindowChrome,
  toggleMaximizeWindow,
} from '@/platform'
import { useNativeDesktopShell } from '@/platform/use-native-desktop-shell'
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
  DialogClose,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { commonText } from '../i18n/common-text'
import { libraryText } from '../i18n/library-text'
import { registryText } from '../i18n/registry-text'
import {
  librarySearchAtom,
  activeLibraryIdAtom,
  libraryScreenInstanceAtom,
  prepareLocateLibraryModAtom,
  modListAtom,
} from '../state/library-state'
import { registrySearchAtom } from '../state/registry-state'
import { NavigationToggle } from './navigation-toggle'
import {
  navigationExpandedAtom,
  narrowShellQuery,
  useEffectiveNavigationExpanded,
  useMediaQueryMatches,
} from './shell-state'
import {
  clampTitlebarActiveIndex,
  stepTitlebarActiveIndex,
  closeTitlebarPaletteOnEscape,
  focusTitlebarPaletteInput,
  getTitlebarSearchKind,
  getTitlebarSearchShortcut,
  isPendingLibraryRevealLive,
  openTitlebarPaletteForShortcut,
  resolvePaletteCloseFocus,
  setTitlebarSearchQuery,
  getTitlebarSearchResults,
} from './titlebar-search'
import { TitleBarDragRegion } from './titlebar-drag'
import { showWindowControls } from './titlebar-chrome'
import {
  TITLEBAR_SEARCH_RESULTS_ID,
  TitlebarSearchResults,
} from './titlebar-search-results'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const searchKind = getTitlebarSearchKind(pathname)
  const [libraryQuery, setLibraryQuery] = useAtom(librarySearchAtom)
  const [registryQuery, setRegistryQuery] = useAtom(registrySearchAtom)
  const mods = useAtomValue(modListAtom)
  const prepareLocateMod = useSetAtom(prepareLocateLibraryModAtom)
  const store = useStore()
  const query = searchKind === 'registry' ? registryQuery : libraryQuery
  const [, setNavigationExpanded] = useAtom(navigationExpandedAtom)
  const [paletteOpenPath, setPaletteOpenPath] = useState<string | null>(null)
  const [activeResult, setActiveResult] = useState(0)
  const results = getTitlebarSearchResults(mods, query)
  const autocompleteOpen = searchKind === 'library'
  const safeActive = clampTitlebarActiveIndex(results.length, activeResult)
  const activeOption = autocompleteOpen ? results[safeActive] : undefined
  const paletteInputRef = useRef<HTMLInputElement | null>(null)
  const selectPaletteQueryOnOpen = useRef(false)
  const pendingReveal = useRef<{
    id: string
    libraryId: string | null
    screen: object | null
    cancelled: boolean
  } | null>(null)
  const cancelPendingReveal = () => {
    if (pendingReveal.current) pendingReveal.current.cancelled = true
  }
  useEffect(() => {
    const checkContext = () => {
      const request = pendingReveal.current
      if (
        request &&
        !isPendingLibraryRevealLive(request, {
          libraryId: store.get(activeLibraryIdAtom),
          screen: store.get(libraryScreenInstanceAtom),
          modIds: store.get(modListAtom).map((mod) => mod.id),
        })
      )
        request.cancelled = true
    }
    const unsubscribe = [
      activeLibraryIdAtom,
      libraryScreenInstanceAtom,
      modListAtom,
    ].map((value) => store.sub(value, checkContext))
    document.addEventListener('pointerdown', cancelPendingReveal, true)
    document.addEventListener('keydown', cancelPendingReveal, true)
    return () => {
      document.removeEventListener('pointerdown', cancelPendingReveal, true)
      document.removeEventListener('keydown', cancelPendingReveal, true)
      unsubscribe.forEach((stop) => stop())
    }
  }, [store])
  const chooseMod = (id: string) => {
    prepareLocateMod(id)
    pendingReveal.current = {
      id,
      libraryId: store.get(activeLibraryIdAtom),
      screen: store.get(libraryScreenInstanceAtom),
      cancelled: false,
    }
    setPaletteOpenPath(null)
  }
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
  const nativeWindowChrome = useNativeDesktopShell()
  const showCaptionButtons = showWindowControls(isMacOS, nativeWindowChrome)
  const macNativeChrome = isMacOS && nativeWindowChrome

  // The titlebar entry opens the same centered palette at every width. Ctrl+F
  // remains available for the former wide-field and narrow collapsed-field paths.
  useEffect(() => {
    if (!searchEnabled) return
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = getTitlebarSearchShortcut(event)
      selectPaletteQueryOnOpen.current = shortcut === 'find'
      const opened = openTitlebarPaletteForShortcut(
        event,
        searchEnabled,
        Boolean(document.querySelector('[role="dialog"][data-state="open"]')),
        () => {
          setActiveResult(0)
          setPaletteOpenPath(pathname)
        },
      )
      if (!opened) selectPaletteQueryOnOpen.current = false
      if (opened && shortcut === 'find') {
        requestAnimationFrame(() =>
          selectUnchangedPaletteQuery(paletteInputRef.current, query),
        )
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pathname, query, searchEnabled])

  useEffect(() => {
    if (!nativeWindowChrome) return
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
  }, [isMacOS, nativeWindowChrome])

  return (
    <Dialog
      open={paletteOpen}
      onOpenChange={(open) => setPaletteOpenPath(open ? pathname : null)}
    >
      <header
        data-macos={macNativeChrome ? 'true' : undefined}
        data-caption={showCaptionButtons ? 'true' : undefined}
        className="mk-titlebar relative z-20 flex h-11 shrink-0 items-center justify-between border-b border-border bg-background/25"
      >
        <TitleBarDragRegion
          platform={nativeWindowChrome ? platformKind() : 'browser'}
        />

        <div
          className={`relative z-10 flex h-11 items-center gap-2 pointer-events-none ${macNativeChrome ? 'pl-[76px]' : 'pl-2'}`}
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
            onClick={() => {
              setActiveResult(0)
            }}
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
        hideClose
        className="w-[min(40rem,calc(100vw-2rem))] gap-0 overflow-hidden rounded-lg bg-popover p-0 sm:max-w-none"
        onOpenAutoFocus={(event) => {
          const selectQuery = selectPaletteQueryOnOpen.current
          focusTitlebarPaletteInput(paletteInputRef.current, event, selectQuery)
          if (selectQuery) {
            const input = paletteInputRef.current
            const value = input?.value
            requestAnimationFrame(() => {
              if (value !== undefined) selectUnchangedPaletteQuery(input, value)
            })
          }
          selectPaletteQueryOnOpen.current = false
        }}
        onCloseAutoFocus={(event) => {
          const request = pendingReveal.current
          pendingReveal.current = null
          const card = resolvePaletteCloseFocus(
            request,
            {
              libraryId: store.get(activeLibraryIdAtom),
              screen: store.get(libraryScreenInstanceAtom),
              modIds: store.get(modListAtom).map((mod) => mod.id),
            },
            (id) => findLibraryCardElement(id),
          )
          if (!card) return
          event.preventDefault()
          card.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          card.focus({ preventScroll: true })
        }}
        onEscapeKeyDown={(event) =>
          closeTitlebarPaletteOnEscape(event, () => setPaletteOpenPath(null))
        }
      >
        <DialogTitle className="sr-only">{searchLabel}</DialogTitle>
        <DialogDescription className="sr-only">
          {commonText.searchPaletteDescription()}
        </DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <FidelityInput
            ref={paletteInputRef}
            type="search"
            value={searchEnabled ? query : ''}
            onChange={(event) => {
              const nextQuery = event.target.value
              setActiveResult(0)
              setTitlebarSearchQuery(
                searchKind,
                nextQuery,
                setLibraryQuery,
                setRegistryQuery,
              )
            }}
            onKeyDownCapture={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Escape') {
                event.preventDefault()
                setPaletteOpenPath(null)
                return
              }
              if (searchKind !== 'library') return
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveResult((index) =>
                  stepTitlebarActiveIndex(results.length, index, 1),
                )
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveResult((index) =>
                  stepTitlebarActiveIndex(results.length, index, -1),
                )
              }
              if (event.key === 'Enter' && results[safeActive]) {
                event.preventDefault()
                chooseMod(results[safeActive].id)
              }
            }}
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
            role={autocompleteOpen ? 'combobox' : undefined}
            aria-expanded={autocompleteOpen ? results.length > 0 : undefined}
            aria-controls={
              autocompleteOpen && results.length > 0
                ? TITLEBAR_SEARCH_RESULTS_ID
                : undefined
            }
            aria-autocomplete={autocompleteOpen ? 'list' : undefined}
            aria-activedescendant={
              activeOption ? `palette-result-${activeOption.id}` : undefined
            }
            data-command-palette-search=""
            className="h-14 border-0 bg-transparent px-0 text-base shadow-none focus-visible:border-transparent focus-visible:ring-0"
          />
          <kbd className="shrink-0 rounded-sm border border-border px-1 py-0.5 text-[10px] leading-none text-muted-foreground">
            Esc
          </kbd>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogClose asChild>
                <button
                  type="button"
                  aria-label={commonText.close()}
                  className="flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </DialogClose>
            </TooltipTrigger>
            <TooltipContent>{commonText.closeWithEscape()}</TooltipContent>
          </Tooltip>
        </div>
        {autocompleteOpen ? (
          <div aria-live="polite">
            <TitlebarSearchResults
              mods={results}
              activeIndex={safeActive}
              onChoose={(mod) => chooseMod(mod.id)}
            />
          </div>
        ) : (
          <p className="px-4 py-3 text-[12px] text-muted-foreground">
            {searchPlaceholder}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function findLibraryCardElement(modId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-mod-id="${CSS.escape(modId)}"]:not([role="option"])`,
  )
}

function selectUnchangedPaletteQuery(
  input: HTMLInputElement | null,
  value: string,
) {
  if (
    input &&
    document.activeElement === input &&
    input.value === value &&
    input.selectionStart === input.selectionEnd
  )
    input.select()
}

function handleWindowOperation(operation: Promise<void>): void {
  void operation.catch((error: unknown) => {
    console.error('[redesign] window operation failed', error)
    toast.error(commonText.somethingWentWrong())
  })
}
