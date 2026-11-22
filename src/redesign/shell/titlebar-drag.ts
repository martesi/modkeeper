import type { CSSProperties } from 'react'
import type { PlatformKind } from '@/platform'

/**
 * Wails v3 drags a frameless window from the CSS custom property
 * `--wails-draggable`, while Tauri uses the `data-tauri-drag-region`
 * attribute. The titlebar keeps both markers so one render serves both shells.
 */
export function titlebarDragStyle(
  platform: PlatformKind,
): CSSProperties | undefined {
  if (platform !== 'wails') return undefined
  return { '--wails-draggable': 'drag' } as CSSProperties
}
