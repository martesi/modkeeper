/** Injectable browser transport for Playwright and other agent-driven tests.
 * Install before app startup. Command keys are generated camelCase names.
 * Event names are exactly `task_progress` and `workspace-event`.
 */
export type WailsMock = {
  commands?: Record<string, (...args: unknown[]) => unknown>
  events?: {
    on?: (name: string, callback: (...args: unknown[]) => void) => () => void
    emit?: (name: string, ...args: unknown[]) => void
  }
}

declare global {
  interface Window {
    __MK_WAILS_MOCK__?: WailsMock
  }
}

export function getWailsMock(): WailsMock | undefined {
  return typeof window === 'undefined' ? undefined : window.__MK_WAILS_MOCK__
}

export function installWailsMock(mock: WailsMock): () => void {
  if (typeof window === 'undefined')
    throw new Error('Mock transport requires a window')
  window.__MK_WAILS_MOCK__ = mock
  return () => {
    if (window.__MK_WAILS_MOCK__ === mock) delete window.__MK_WAILS_MOCK__
  }
}
