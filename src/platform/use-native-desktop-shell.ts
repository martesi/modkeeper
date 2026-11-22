import { useSyncExternalStore } from 'react'
import {
  getNativeDesktopSnapshot,
  subscribeNativeDesktopShell,
} from '@/wails/runtime'

/**
 * Reactive desktop capability. Wails injects its environment after navigation
 * and dispatches `wails:runtime-config-ready`, so a value captured during the
 * first render can be stale. The snapshot re-reads the injected environment.
 */
export function useNativeDesktopShell(): boolean {
  return useSyncExternalStore(
    subscribeNativeDesktopShell,
    getNativeDesktopSnapshot,
    () => false,
  )
}
