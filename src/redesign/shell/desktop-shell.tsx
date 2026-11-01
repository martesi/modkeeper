/*
 * Desktop shell (reference Modkeeper.dc.html frame): a full-height column — scrollable content on
 * top, the centered nav dock in-flow at the bottom (not overlaid, so content never hides behind
 * it). No sticky header: screens render their own reference-style page headers. Toast and dialog
 * portals render to <body> (sonner Toaster is mounted app-wide in main.tsx; Radix dialogs portal
 * themselves), so the shell doesn't re-mount them.
 */
import type { ReactNode } from 'react'
import { AppBackground } from './app-background'
import { BottomNavigation } from './bottom-navigation'

export function DesktopShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-full flex-col text-foreground">
      <AppBackground />
      <main className="mk-scrollbar relative flex-1 overflow-y-auto px-4 py-3">
        {children}
      </main>
      <BottomNavigation />
    </div>
  )
}
