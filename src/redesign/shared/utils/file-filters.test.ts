import { describe, expect, test } from 'bun:test'
import {
  getSupportedArchiveExtension,
  isSupportedArchivePath,
  splitArchivePaths,
  stripSupportedArchiveExtension,
} from './file-filters'

describe('supported archive paths', () => {
  test('accepts ZIP and 7z extensions without regard to case', () => {
    expect(getSupportedArchiveExtension('mod.zip')).toBe('zip')
    expect(getSupportedArchiveExtension('mod.ZIP')).toBe('zip')
    expect(getSupportedArchiveExtension('mod.7z')).toBe('7z')
    expect(getSupportedArchiveExtension('mod.7Z')).toBe('7z')
  })

  test('recognizes paths with slash and backslash separators', () => {
    expect(isSupportedArchivePath('/mods/author/mod.ZIP')).toBe(true)
    expect(isSupportedArchivePath('C:\\mods\\author\\mod.7z')).toBe(true)
  })

  test('checks only the final extension for multi-dot and missing extensions', () => {
    expect(isSupportedArchivePath('mod.release.backup.zip')).toBe(true)
    expect(isSupportedArchivePath('mod.zip.backup')).toBe(false)
    expect(isSupportedArchivePath('mod')).toBe(false)
    expect(isSupportedArchivePath('mod.')).toBe(false)
  })

  test('strips only the supported final extension', () => {
    expect(stripSupportedArchiveExtension('/mods/mod.release.ZIP')).toBe(
      '/mods/mod.release',
    )
    expect(stripSupportedArchiveExtension('C:\\mods\\mod.7z')).toBe(
      'C:\\mods\\mod',
    )
    expect(stripSupportedArchiveExtension('mod.zip.backup')).toBe(
      'mod.zip.backup',
    )
  })

  test('splits accepted and rejected paths while preserving input order', () => {
    const paths = [
      'first.ZIP',
      'notes.txt',
      'folder/second.7z',
      'third.tar',
      'last.zip',
    ]

    expect(splitArchivePaths(paths)).toEqual({
      archives: ['first.ZIP', 'folder/second.7z', 'last.zip'],
      rejected: ['notes.txt', 'third.tar'],
    })
  })
})
