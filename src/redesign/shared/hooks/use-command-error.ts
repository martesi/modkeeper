/*
 * SError → user-visible string (frontend-redesign-spec.md §10).
 *
 * The ONE place `SError.code` is mapped to translated text — an explicit lookup keyed by the exact
 * code string (a decapitalize convention would break on acronym-leading variants like `IOError`),
 * falling back to `errorText.unknown()` for any code without a mapping yet. Call sites never read
 * `SError.data` to build a message themselves.
 */
import { useCallback } from 'react'
import { toast } from 'sonner'
import type { SError } from '../../data/redesign-types'
import { errorText } from '../../i18n/error-text'

export function resolveCommandError(error: SError): string {
  switch (error.code) {
    case 'UnsupportedSPTVersion':
      return errorText.unsupportedSptVersion(error.data)
    case 'ParseError':
      return errorText.parseError(error.data)
    case 'IOError':
      return errorText.ioError(error.data)
    case 'GameOrServerRunning':
      return errorText.gameOrServerRunning()
    case 'ProcessRunning':
      return errorText.processRunning()
    case 'UnableToDetermineModId':
      return errorText.unableToDetermineModId()
    case 'ModNotFound':
      return errorText.modNotFound(error.data)
    case 'FileOrDirectoryNotFound':
      return errorText.fileOrDirectoryNotFound(error.data)
    case 'FileCollision':
      return errorText.fileCollision(error.data)
    case 'Unexpected':
      return errorText.unexpected()
    case 'UnhandledCompression':
      return errorText.unhandledCompression(error.data)
    case 'AsyncRuntimeError':
      return errorText.asyncRuntimeError(error.data)
    case 'NoActiveLibrary':
      return errorText.noActiveLibrary()
    case 'InvalidLibrary':
      return errorText.invalidLibrary(error.data[0], error.data[1])
    case 'ModIdConflict':
      return errorText.modIdConflict(error.data[0], error.data[1])
    case 'ConfigSaveFailed':
      return errorText.configSaveFailed(error.data)
    case 'TaskIdInUse':
      return errorText.taskIdInUse()
    default:
      return errorText.unknown()
  }
}

export function resolveCommandErrorSummary(error: SError): string {
  const message = resolveCommandError(error)
  const maximumLength = 180
  if (message.length <= maximumLength) return message
  return `${message.slice(0, maximumLength - 1).trimEnd()}…`
}

/**
 * Component-side convenience: toast the translated message, log `code`/`data` as secondary context
 * (the English detail trail lives in the backend log, §13).
 */
export function useCommandError() {
  return useCallback((error: SError) => {
    toast.error(resolveCommandError(error))
    console.error('[redesign] command error', error)
  }, [])
}
