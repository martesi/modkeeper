import { platformKind } from '@/platform'

/**
 * Neutral browser/Linux fallback. In Tauri on Windows and macOS it renders nothing so the
 * transparent window can show its native surface.
 */
export function AppBackground() {
  if (platformKind() !== 'browser' && !navigator.userAgent.includes('Linux'))
    return null
  return (
    <div
      aria-hidden
      className="mk-page-gradient fixed inset-0 -z-10 transition-colors"
    />
  )
}
