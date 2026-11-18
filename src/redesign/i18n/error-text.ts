/*
 * Error i18n namespace (frontend-redesign-spec.md §10 "Error Code → i18n Mapping").
 *
 * The backend sends only `SError.code` + positional `data` — never prose (§7g). One member per
 * known code, plus `unknown` as the safety net so a new backend variant can never surface a raw
 * code string in the UI. The code→member lookup itself lives in `shared/hooks/use-command-error.ts`;
 * call sites go through that, never this object with hand-built `data` access.
 */
import { t } from '@lingui/core/macro'

export const errorText = {
  unsupportedSptVersion: (version: string) =>
    t({
      id: 'error.unsupportedSptVersion',
      message: `This SPT version is not supported: ${version}`,
    }),
  parseError: (detail: string) =>
    t({
      id: 'error.parseError',
      message: `A file could not be read: ${detail}`,
    }),
  ioError: (detail: string) =>
    t({ id: 'error.ioError', message: `A file operation failed: ${detail}` }),
  gameOrServerRunning: () =>
    t({
      id: 'error.gameOrServerRunning',
      message: 'Close the game and server before continuing',
    }),
  processRunning: () =>
    t({
      id: 'error.processRunning',
      message: 'A conflicting process is still running',
    }),
  unableToDetermineModId: () =>
    t({
      id: 'error.unableToDetermineModId',
      message: 'Could not determine an identity for this mod',
    }),
  modNotFound: (modId: string) =>
    t({ id: 'error.modNotFound', message: `Mod not found: ${modId}` }),
  fileOrDirectoryNotFound: (path: string) =>
    t({ id: 'error.fileOrDirectoryNotFound', message: `Not found: ${path}` }),
  fileCollision: (files: string[]) =>
    t({
      id: 'error.fileCollision',
      message: `These files are claimed by more than one mod: ${files.join(', ')}`,
    }),
  unexpected: () =>
    t({ id: 'error.unexpected', message: 'An unexpected error occurred' }),
  unhandledCompression: (format: string) =>
    t({
      id: 'error.unhandledCompression',
      message: `Unsupported archive format: ${format}`,
    }),
  asyncRuntimeError: (detail: string) =>
    t({
      id: 'error.asyncRuntimeError',
      message: `A background operation failed: ${detail}`,
    }),
  noActiveLibrary: () =>
    t({ id: 'error.noActiveLibrary', message: 'No library is active' }),
  invalidLibrary: (path: string, reason: string) =>
    t({
      id: 'error.invalidLibrary',
      message: `The library at ${path} could not be opened: ${reason}`,
    }),
  modIdConflict: (existing: string, incoming: string) =>
    t({
      id: 'error.modIdConflict',
      message: `Mod identity conflict between ${existing} and ${incoming}`,
    }),
  configSaveFailed: (detail: string) =>
    t({
      id: 'error.configSaveFailed',
      message: `App configuration could not be saved: ${detail}`,
    }),
  taskIdInUse: () =>
    t({
      id: 'error.taskIdInUse',
      message: 'This operation is already in progress',
    }),
  unknown: () =>
    t({ id: 'error.unknown', message: 'An unexpected error occurred' }),
}
