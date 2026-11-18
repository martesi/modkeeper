import { createLazyFileRoute } from '@tanstack/react-router'
import { SettingsScreen } from '@/redesign/settings/settings-screen'

/**
 * Settings route adapter (consolidated-spec.md §10 route table). Original content preserved at
 * .local/2026-07-13_redesign/reference/current-frontend/routes/settings.lazy.tsx.
 */
export const Route = createLazyFileRoute('/settings')({
  component: SettingsScreen,
})
