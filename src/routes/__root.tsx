import { createRootRoute, Outlet } from '@tanstack/react-router'
import { RedesignRoot } from '@/redesign/app/redesign-root'

/**
 * Root route adapter (consolidated-spec.md §10 route table).
 *
 * The transition-only §10a legacy toggle is gone: the legacy tree was runtime-broken against the
 * renamed backend commands, and a persisted flag booting into it crashed the frontend before
 * `get_library_workspace` ever fired — tripping the backend init watchdog into a silent exit(1)
 * with the window still hidden. Original content preserved at
 * .local/2026-07-13_redesign/reference/current-frontend/routes/__root.tsx.
 */
export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <RedesignRoot>
      <Outlet />
    </RedesignRoot>
  )
}
