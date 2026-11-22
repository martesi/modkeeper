import { commands as tauriCommands } from '@gen/bindings'
import * as wailsApp from '../../frontend/bindings/github.com/martes/modkeeper/backend/app'
import { isWails } from './runtime'
import { getWailsMock } from './mock'

type Commands = typeof tauriCommands

interface WireError {
  code: string
  data: unknown
}

function isWireError(value: unknown): value is WireError {
  return (
    !!value &&
    typeof value === 'object' &&
    'code' in value &&
    typeof value.code === 'string' &&
    'data' in value
  )
}

function decodeWailsDomainError(error: unknown): Promise<WireError | null> {
  if (!error || typeof error !== 'object' || !('cause' in error))
    return Promise.resolve(null)

  const cause = error.cause
  if (isWireError(cause)) return Promise.resolve(cause)
  if (typeof cause !== 'string') return Promise.resolve(null)

  return Promise.resolve()
    .then((): unknown => JSON.parse(cause))
    .then(
      (value) => (isWireError(value) ? value : null),
      () => null,
    )
}

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
  if (wails)
    return Promise.resolve()
      .then(wails)
      .then(
        (value) =>
          value && typeof value === 'object' && 'status' in value
            ? value
            : { status: 'ok', data: value },
        (error: unknown) =>
          decodeWailsDomainError(error).then((domainError) =>
            domainError
              ? { status: 'error', error: domainError }
              : Promise.reject(error),
          ),
      )
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

export function cancelInstallTask(
  taskId: string,
  libraryId: string,
): Promise<void> {
  const mock = getWailsMock()?.commands?.cancelTask
  if (mock)
    return Promise.resolve(mock(taskId, libraryId)).then(() => undefined)
  if (isWails()) return Promise.resolve(wailsApp.CancelTask(taskId, libraryId))
  return Promise.reject(new Error('CancelTask is only available in Wails'))
}

/**
 * Opens a file or directory with the platform opener. Wails has no JavaScript
 * opener, so this bound Go method replaces the Tauri opener plugin. The browser
 * mock never reaches this path because `platformKind()` stays `browser`.
 */
export function openPathInFileManager(path: string): Promise<void> {
  if (isWails()) return Promise.resolve(wailsApp.OpenPath(path))
  return Promise.reject(new Error('OpenPath is only available in Wails'))
}

/**
 * Writes a frontend diagnostic through the Wails application logger. main.go
 * points that logger at the config directory, replacing Tauri's log plugin.
 */
export function logToFile(message: string): Promise<void> {
  if (isWails()) return Promise.resolve(wailsApp.Log(message))
  return Promise.reject(new Error('Log is only available in Wails'))
}
