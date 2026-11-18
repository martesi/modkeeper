import { createFileRoute } from '@tanstack/react-router'
import { LibraryScreen } from '@/redesign/library/library-screen'

/**
 * Library index adapter (consolidated-spec.md §10 route table). Original content preserved at
 * .local/2026-07-13_redesign/reference/current-frontend/routes/library.index.tsx.
 */
export const Route = createFileRoute('/library/')({
  component: LibraryScreen,
})
