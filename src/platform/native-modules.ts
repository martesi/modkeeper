/**
 * Loaders for the desktop JavaScript packages that sit behind the platform
 * boundary. Keeping the dynamic imports here gives tests one seam to replace
 * without process-global module mocks, which leak across files under Bun.
 */
export const nativeModules = {
  wails: () => import('@wailsio/runtime'),
  appBindings: () => import('@/wails'),
}

export type NativeModules = typeof nativeModules
