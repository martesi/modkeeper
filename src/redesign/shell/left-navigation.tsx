import { Link, useRouterState } from '@tanstack/react-router'
import { BookOpen, Compass, Settings } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { commonText } from '../i18n/common-text'
import { libraryText } from '../i18n/library-text'
import { registryText } from '../i18n/registry-text'
import { TaskCenterPanel } from '../library/task-results'
import { useEffectiveNavigationExpanded } from './shell-state'
import { TaskCenterPopover } from './task-center-popover'

const itemClass =
  'mk-navigation-item relative flex h-9 w-full items-center gap-3 rounded-[4px] px-3 text-left text-[13px] font-semibold text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50'
const activeItemClass = 'bg-muted/60 text-foreground'

const primaryItems = [
  {
    to: '/library',
    label: libraryText.title,
    icon: BookOpen,
    matches: (pathname: string) => pathname.startsWith('/library'),
  },
  {
    to: '/registry',
    label: registryText.title,
    icon: Compass,
    matches: (pathname: string) => pathname.startsWith('/registry'),
  },
] as const

export function LeftNavigation() {
  // The persisted preference applies unless the window is too narrow to fit
  // the expanded rail; below the narrow breakpoint the compact rail is forced.
  const expanded = useEffectiveNavigationExpanded()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const onSettings = pathname === '/settings'
  const navigationRef = useRef<HTMLElement | null>(null)
  const [indicatorTop, setIndicatorTop] = useState<number | null>(null)

  useLayoutEffect(() => {
    const navigation = navigationRef.current
    if (!navigation) return

    const positionIndicator = () => {
      const activeItem = navigation.querySelector<HTMLElement>(
        '[aria-current="page"]',
      )
      if (!activeItem) {
        setIndicatorTop(null)
        return
      }
      const navigationBounds = navigation.getBoundingClientRect()
      const itemBounds = activeItem.getBoundingClientRect()
      setIndicatorTop(
        itemBounds.top - navigationBounds.top + (itemBounds.height - 16) / 2,
      )
    }

    positionIndicator()
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(positionIndicator)
    resizeObserver?.observe(navigation)
    for (const child of navigation.children) resizeObserver?.observe(child)
    window.addEventListener('resize', positionIndicator)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', positionIndicator)
    }
  }, [expanded, pathname])

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-border/60 bg-background/20 ${expanded ? 'w-[184px]' : 'w-12'}`}
    >
      <nav
        ref={navigationRef}
        id="primary-navigation"
        aria-label={commonText.primaryNavigation()}
        className="relative flex min-h-0 flex-1 flex-col gap-1 p-1"
      >
        {primaryItems.map(({ to, label, icon: Icon, matches }) => {
          const isCurrent = matches(pathname)
          return (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: false }}
              aria-current={isCurrent ? 'page' : undefined}
              aria-label={label()}
              title={!expanded ? label() : undefined}
              className={`${itemClass} ${expanded ? '' : 'justify-center px-0'} ${isCurrent ? activeItemClass : ''}`}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              {expanded && <span className="truncate">{label()}</span>}
            </Link>
          )
        })}

        <div
          role="separator"
          aria-orientation="horizontal"
          className="flex-1"
        />

        <TaskCenterPopover expanded={expanded}>
          <TaskCenterPanel />
        </TaskCenterPopover>

        <Link
          to="/settings"
          aria-current={onSettings ? 'page' : undefined}
          aria-label={commonText.settings()}
          title={!expanded ? commonText.settings() : undefined}
          className={`${itemClass} ${expanded ? '' : 'justify-center px-0'} ${onSettings ? activeItemClass : ''}`}
        >
          <Settings className="size-5 shrink-0" aria-hidden />
          {expanded && (
            <span className="truncate">{commonText.settings()}</span>
          )}
        </Link>

        <span
          aria-hidden
          className="mk-navigation-indicator pointer-events-none absolute right-1 top-0 z-10 h-4 w-[3px] rounded-l-[3px] bg-primary"
          style={{
            transform: `translateY(${indicatorTop ?? 0}px)`,
            opacity: indicatorTop === null ? 0 : 1,
          }}
        />
      </nav>
    </aside>
  )
}
