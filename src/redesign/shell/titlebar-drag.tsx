import type { CSSProperties } from 'react'
import type { PlatformKind } from '@/platform'

/**
 * Wails v3 drags a frameless window from the CSS custom property
 * `--wails-draggable` CSS custom property.
 */
export function titlebarDragStyle(
  platform: PlatformKind,
): CSSProperties | undefined {
  if (platform !== 'wails') return undefined
  return { '--wails-draggable': 'drag' } as CSSProperties
}

export function TitleBarDragRegion({ platform }: { platform: PlatformKind }) {
  return (
    <div
      aria-hidden
      style={titlebarDragStyle(platform)}
      className="absolute inset-0"
    />
  )
}
