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

/** In-memory bus for serve-mode/browser E2E: listeners + emit without a native runtime. */
export function createInMemoryWailsMock(): WailsMock {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  return {
    events: {
      on: (name, callback) => {
        let set = listeners.get(name)
        if (!set) {
          set = new Set()
          listeners.set(name, set)
        }
        set.add(callback)
        return () => {
          set.delete(callback)
        }
      },
      emit: (name, ...args) => {
        for (const callback of listeners.get(name) ?? []) callback(...args)
      },
    },
  }
}
