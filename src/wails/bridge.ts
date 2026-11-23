import * as wailsApp from '../../frontend/bindings/github.com/martes/modkeeper/backend/app'
import type { Commands } from './contract'
import { isWails } from './runtime'
import { getWailsMock } from './mock'

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
  return Promise.reject(new Error('Command is not available in this runtime'))
}

/**
 * Wails v3 bindings are generated in frontend/bindings by `wails3 generate bindings`.
 */
export const commands: Commands = Object.fromEntries(
  Object.entries(wailsApp)
    .filter(
      ([methodName]) => !['Log', 'OpenPath', 'Start'].includes(methodName),
    )
    .map(([methodName, appMethod]) => [
    methodName[0]!.toLowerCase() + methodName.slice(1),
    (...args: unknown[]) => {
      const name = methodName[0]!.toLowerCase() + methodName.slice(1)
      const mock = getWailsMock()?.commands?.[name]
      let method: (() => unknown) | undefined
      if (isWails()) {
        method = () => (appMethod as (...args: unknown[]) => unknown)(...args)
      }
      return dispatchCommand(
        mock ? () => mock(...args) : undefined,
        method,
      )
    },
    ]),
) as unknown as Commands

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
 * opener, so this bound Go method replaces the Wails opener plugin. The browser
 * mock never reaches this path because `platformKind()` stays `browser`.
 */
export function openPathWithPlatformOpener(path: string): Promise<void> {
  if (isWails()) return Promise.resolve(wailsApp.OpenPath(path))
  return Promise.reject(new Error('OpenPath is only available in Wails'))
}

/**
 * Writes a frontend diagnostic through the Wails application logger. main.go
 * points that logger at the config directory, replacing Wails's log plugin.
 */
export function logToFile(message: string): Promise<void> {
  if (isWails()) return Promise.resolve(wailsApp.Log(message))
  return Promise.reject(new Error('Log is only available in Wails'))
}
