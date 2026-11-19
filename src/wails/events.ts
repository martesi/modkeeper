import { Events as WailsEvents } from '@wailsio/runtime'
import { events as tauriEvents } from '@gen/bindings'
import { TaskProgress, WorkspaceEvent } from '../../frontend/bindings/events'
import { wailsWindow } from './runtime'
import { getWailsMock } from './mock'

type Callback<T> = (event: { event: string; id: number; payload: T }) => void

function makeEvent<T>(name: string, tauriName: keyof typeof tauriEvents) {
  const listen = (callback: Callback<T>): Promise<() => void> => {
    const mockOn = getWailsMock()?.events?.on
    if (mockOn) {
      const unlisten = mockOn(name, (...args) =>
        callback({
          event: name,
          id: 0,
          payload: (args.length === 1 ? args[0] : args) as T,
        }),
      )
      return Promise.resolve(unlisten)
    }
    if (wailsWindow()?.__TAURI__)
      return tauriEvents[tauriName].listen(callback as never)
    return Promise.resolve(
      WailsEvents.On(name, (event) =>
        callback({ event: name, id: 0, payload: event.data as T }),
      ),
    )
  }
  const once = (callback: Callback<T>): Promise<() => void> => {
    const mockOn = getWailsMock()?.events?.on
    if (mockOn) {
      let unlisten = () => {}
      unlisten = mockOn(name, (...args) => {
        unlisten()
        callback({
          event: name,
          id: 0,
          payload: (args.length === 1 ? args[0] : args) as T,
        })
      })
      return Promise.resolve(unlisten)
    }
    if (wailsWindow()?.__TAURI__)
      return tauriEvents[tauriName].once(callback as never)
    return Promise.resolve(
      WailsEvents.Once(name, (event) =>
        callback({ event: name, id: 0, payload: event.data as T }),
      ),
    )
  }
  const emit = (payload: T) => {
    const mockEmit = getWailsMock()?.events?.emit
    if (mockEmit) {
      mockEmit(name, payload)
      return Promise.resolve()
    }
    if (wailsWindow()?.__TAURI__)
      return tauriEvents[tauriName].emit(payload as never)
    return WailsEvents.Emit(name, payload)
  }
  return Object.assign(
    (target: unknown) => {
      void target
      return { listen, once }
    },
    {
      listen,
      once,
      emit,
      emitTo: (_target: unknown, payload: T) => emit(payload),
    },
  )
}

export const events = {
  taskProgress: makeEvent<Parameters<typeof tauriEvents.taskProgress.emit>[0]>(
    TaskProgress,
    'taskProgress',
  ),
  workspaceEvent: makeEvent<
    Parameters<typeof tauriEvents.workspaceEvent.emit>[0]
  >(WorkspaceEvent, 'workspaceEvent'),
}
