import { commands as tauriCommands } from '@gen/bindings'
import { wailsMethod } from './runtime'
import { getWailsMock } from './mock'

type Commands = typeof tauriCommands

/**
 * Same method names and argument signatures as generated Specta commands.
 * Wails bindings take positional arguments; Tauri remains the browser/native
 * fallback until the Wails runtime is detected.
 */
export const commands: Commands = Object.fromEntries(
  Object.entries(tauriCommands).map(([name, tauriCall]) => [
    name,
    (...args: unknown[]) => {
      const method = wailsMethod(name)
      if (method) return Promise.resolve(method(...args))
      const mock = getWailsMock()?.commands?.[name]
      if (mock) return Promise.resolve(mock(...args))
      return Reflect.apply(tauriCall, undefined, args)
    },
  ]),
) as Commands
