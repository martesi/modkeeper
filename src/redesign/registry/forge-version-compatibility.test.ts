import { expect, test } from 'vitest'
import type { ForgeVersionsPage } from '@/wails/contract'
import {
  filterForgeVersions,
  isForgeVersionIncompatible,
  shouldWarnForIncompatibleForgeVersion,
} from './forge-version-compatibility'

const versions: ForgeVersionsPage['versions'] = [
  {
    kind: 'mod',
    itemId: 42,
    id: 1,
    version: '2.0.0',
    description: null,
    link: 'https://example.test/2.zip',
    contentLength: 1,
    sptVersionConstraint: '^4.0.0',
    fikaCompatibility: 'unknown',
    dependencies: [],
  },
  {
    kind: 'mod',
    itemId: 42,
    id: 2,
    version: '1.0.0',
    description: null,
    link: 'https://example.test/1.zip',
    contentLength: 1,
    sptVersionConstraint: '^3.9.0',
    fikaCompatibility: 'unknown',
    dependencies: [],
  },
]

test('compatibility toggle filters only the current versions page', () => {
  expect(filterForgeVersions(versions, '3.9.1', false)).toEqual(versions)
  expect(filterForgeVersions(versions, '3.9.1', true)).toEqual([versions[1]])
})

test('incompatible versions warn until the persisted preference is disabled', () => {
  const incompatible = isForgeVersionIncompatible(versions[0]!, '3.9.1')
  expect(shouldWarnForIncompatibleForgeVersion(incompatible, true)).toBe(true)
  expect(shouldWarnForIncompatibleForgeVersion(incompatible, false)).toBe(false)
  expect(shouldWarnForIncompatibleForgeVersion(false, true)).toBe(false)
})
