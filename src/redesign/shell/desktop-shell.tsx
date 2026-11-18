/* Full-height app shell. Dialog and toast portals mount outside the scrollable page. */
import type { ReactNode } from 'react'
import { TaskResults } from '../library/task-results'
import { AppBackground } from './app-background'
import { TopNavigation } from './top-navigation'

export function DesktopShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-full flex-col text-foreground">
      <AppBackground />
      <TopNavigation />
      <main className="mk-scrollbar relative flex-1 overflow-y-auto px-4 py-3">
        <TaskResults />
        {children}
      </main>
    </div>
  )
}
