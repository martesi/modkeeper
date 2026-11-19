import { commands as tauriCommands } from '@gen/bindings'
import { wailsMethod } from './runtime'

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
      return method
        ? Promise.resolve(method(...args))
        : tauriCall(...(args as never))
    },
  ]),
) as Commands
