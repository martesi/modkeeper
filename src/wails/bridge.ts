import { commands as tauriCommands } from '@gen/bindings'
import * as wailsApp from '../../frontend/bindings/github.com/martes/modkeeper/backend/app'
import { isWails } from './runtime'
import { getWailsMock } from './mock'

type Commands = typeof tauriCommands

/**
 * Tauri and Wails service methods share this positional-argument adapter.
 * Wails v3 bindings are generated in frontend/bindings by `wails3 generate bindings`.
 */
export const commands: Commands = Object.fromEntries(
  Object.entries(tauriCommands).map(([name, tauriCall]) => [
    name,
    (...args: unknown[]) => {
      const mock = getWailsMock()?.commands?.[name]
      if (mock) return Promise.resolve(mock(...args))
      if (isWails()) {
        const method = wailsApp[
          (name[0]!.toUpperCase() + name.slice(1)) as keyof typeof wailsApp
        ] as ((...args: unknown[]) => unknown) | undefined
        if (method) return Promise.resolve(method(...args))
      }
      return Reflect.apply(tauriCall, undefined, args)
    },
  ]),
) as Commands
