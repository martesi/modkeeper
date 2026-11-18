import { Link } from '@tanstack/react-router'
import { commonText } from '../i18n/common-text'
import { libraryText } from '../i18n/library-text'

const navLinkBaseClass =
  'relative inline-flex items-center px-2 text-[13px] font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50'
const navLinkActiveClass =
  navLinkBaseClass.replace('text-muted-foreground', 'text-foreground') +
  ' after:absolute after:inset-x-2 after:bottom-[-1px] after:h-[3px] after:bg-primary'

export function TopNavigation() {
  return (
    <nav className="relative z-10 flex h-10 shrink-0 items-stretch gap-2 border-b border-border px-4">
      <Link
        to="/library"
        className={navLinkBaseClass}
        activeProps={{
          'aria-current': 'page',
          className: navLinkActiveClass,
        }}
      >
        {libraryText.title()}
      </Link>
      <Link
        to="/settings"
        className={navLinkBaseClass}
        activeProps={{
          'aria-current': 'page',
          className: navLinkActiveClass,
        }}
      >
        {commonText.settings()}
      </Link>
    </nav>
  )
}
