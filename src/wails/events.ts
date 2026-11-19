import { events as tauriEvents } from '@gen/bindings'
import { wailsWindow } from './runtime'

type Callback<T> = (event: { event: string; id: number; payload: T }) => void

function makeEvent<T>(name: string) {
  const listen = (callback: Callback<T>): Promise<() => void> => {
    const runtime = wailsWindow()?.runtime
    if (!runtime?.EventsOn)
      return tauriEvents[name as keyof typeof tauriEvents].listen(
        callback as never,
      )
    let active = true
    const unlisten = runtime.EventsOn(name, (...args) => {
      if (active)
        callback({
          event: name,
          id: 0,
          payload: (args.length === 1 ? args[0] : args) as T,
        })
    })
    return Promise.resolve(() => {
      active = false
      if (typeof unlisten === 'function') unlisten()
    })
  }
  const once = (callback: Callback<T>): Promise<() => void> => {
    const runtime = wailsWindow()?.runtime
    if (!runtime?.EventsOnce)
      return tauriEvents[name as keyof typeof tauriEvents].once(
        callback as never,
      )
    let active = true
    runtime.EventsOnce(name, (...args) => {
      if (active)
        callback({
          event: name,
          id: 0,
          payload: (args.length === 1 ? args[0] : args) as T,
        })
      active = false
    })
    return Promise.resolve(() => {
      active = false
    })
  }
  return Object.assign(
    (target: unknown) => {
      void target
      return { listen, once }
    },
    {
      listen,
      once,
      emit: (payload: T) => {
        const runtime = wailsWindow()?.runtime
        if (runtime?.EventsEmit) {
          runtime.EventsEmit(name, payload)
          return Promise.resolve()
        }
        return tauriEvents[name as keyof typeof tauriEvents].emit(
          payload as never,
        )
      },
      emitTo: (_target: unknown, payload: T) => {
        const runtime = wailsWindow()?.runtime
        if (runtime?.EventsEmit) {
          runtime.EventsEmit(name, payload)
          return Promise.resolve()
        }
        return tauriEvents[name as keyof typeof tauriEvents].emitTo(
          _target as never,
          payload as never,
        )
      },
    },
  )
}

export const events = {
  taskProgress:
    makeEvent<Parameters<typeof tauriEvents.taskProgress.emit>[0]>(
      'task_progress',
    ),
  workspaceEvent:
    makeEvent<Parameters<typeof tauriEvents.workspaceEvent.emit>[0]>(
      'workspace-event',
    ),
}
