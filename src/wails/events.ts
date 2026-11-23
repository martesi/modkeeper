import { Events as WailsEvents } from '@wailsio/runtime'
import {
  TaskProgress as TaskProgressEventName,
  WorkspaceEvent as WorkspaceEventName,
} from '../../frontend/bindings/events'
import type { TaskProgressEvent, WorkspaceEvent } from './contract'
import { getWailsMock } from './mock'

type Callback<T> = (event: { event: string; id: number; payload: T }) => void

function makeEvent<T>(name: string) {
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
  taskProgress: makeEvent<TaskProgressEvent>(TaskProgressEventName),
  workspaceEvent: makeEvent<WorkspaceEvent>(WorkspaceEventName),
}
