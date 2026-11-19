import { commands as tauriCommands } from '@gen/bindings'
import * as wailsApp from '../../frontend/bindings/github.com/martes/modkeeper/backend/app'
import { isWails } from './runtime'
import { getWailsMock } from './mock'

type Commands = typeof tauriCommands

export function dispatchCommand(
  mock: (() => unknown) | undefined,
  wails: (() => unknown) | undefined,
  tauri: () => unknown,
): Promise<unknown> {
  if (mock)
    return Promise.resolve(mock()).then((value) =>
      value && typeof value === 'object' && 'status' in value
        ? value
        : { status: 'ok', data: value },
    )
  if (wails) return Promise.resolve(wails())
  return Promise.resolve(tauri())
}

/**
 * Tauri and Wails service methods share this positional-argument adapter.
 * Wails v3 bindings are generated in frontend/bindings by `wails3 generate bindings`.
 */
export const commands: Commands = Object.fromEntries(
  Object.entries(tauriCommands).map(([name, tauriCall]) => [
    name,
    (...args: unknown[]) => {
      const mock = getWailsMock()?.commands?.[name]
      let method: (() => unknown) | undefined
      if (isWails()) {
        const appMethod = wailsApp[
          (name[0]!.toUpperCase() + name.slice(1)) as keyof typeof wailsApp
        ] as ((...args: unknown[]) => unknown) | undefined
        if (appMethod) method = () => appMethod(...args)
      }
      return dispatchCommand(
        mock ? () => mock(...args) : undefined,
        method,
        () => Reflect.apply(tauriCall, undefined, args),
      )
    },
  ]),
) as Commands
