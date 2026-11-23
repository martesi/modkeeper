/**
 * Loaders for the desktop JavaScript packages that sit behind the platform
 * boundary. Keeping the dynamic imports here gives tests one seam to replace
 * without process-global module mocks, which leak across files under Bun.
 */
export const nativeModules = {
  tauriDialog: () => import('@tauri-apps/plugin-dialog'),
  tauriOpener: () => import('@tauri-apps/plugin-opener'),
  tauriWindow: () => import('@tauri-apps/api/window'),
  tauriLog: () => import('@tauri-apps/plugin-log'),
  wails: () => import('@wailsio/runtime'),
  appBindings: () => import('@/wails'),
}

export type NativeModules = typeof nativeModules
