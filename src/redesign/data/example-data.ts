/*
 * Prototype fixture for the redesign (consolidated-spec.md §8.4 / §12 mock-fallback path).
 *
 * The walking skeleton runs entirely against this when no Wails backend is present. It is a MUTABLE
 * in-memory workspace on purpose: the mock branches of the repository mutate it so a toggle followed
 * by a sync reflect each other, exactly as the real backend's returned workspace would.
 */
import type { LibraryWorkspace, ModSummary } from './redesign-types'
import { DEFAULT_ACCENT } from './settings-defaults'

const now = () => new Date().toISOString()

const LIBRARY_ID = 'lib-example'

function seedMods(): ModSummary[] {
  return [
    {
      id: 'mod-sain',
      installedAt: '2026-07-10T10:00:00Z',
      libraryId: LIBRARY_ID,
      name: 'SAIN — Solarint AI',
      type: 'server',
      isEnabled: true,
      updatedAt: now(),
    },
    {
      id: 'mod-realism',
      installedAt: '2026-07-11T10:00:00Z',
      libraryId: LIBRARY_ID,
      name: 'Realism Mod',
      type: 'both',
      isEnabled: false,
      updatedAt: now(),
    },
    {
      id: 'mod-questing',
      installedAt: '2026-07-12T10:00:00Z',
      libraryId: LIBRARY_ID,
      name: 'Questing Bots',
      type: 'server',
      isEnabled: true,
      updatedAt: now(),
    },
    {
      id: 'mod-ui-fixes',
      installedAt: '2026-07-13T10:00:00Z',
      libraryId: LIBRARY_ID,
      name: 'UI Fixes',
      type: 'client',
      isEnabled: true,
      updatedAt: now(),
    },
  ]
}

const SECOND_LIBRARY_ID = 'lib-test-bench'

export function emptyWorkspace(): LibraryWorkspace {
  return {
    libraries: [],
    modsByLibraryId: {},
    toolsByLibraryId: {},
    settings: {
      theme: 'system',
      accentColor: DEFAULT_ACCENT,
      language: 'en-US',
      enableModsOnInstall: true,
      warnIncompatibleForgeInstall: true,
      forgeEndpoint: '',
    },
  }
}

function seedWorkspace(): LibraryWorkspace {
  return {
    activeLibraryId: LIBRARY_ID,
    libraries: [
      {
        id: LIBRARY_ID,
        name: 'Main SPT Install',
        gameRoot: 'C:/SPT',
        libraryRoot: 'C:/SPT/.mod_keeper',
        sptVersion: '3.9.0',
        cacheStatus: { state: 'ready', lastRebuiltAt: now() },
        deployStale: false,
        updatedAt: now(),
        targetRuntime: 'windows',
        deploymentMethod: 'copy-first',
        policyUncertain: false,
        hostRuntime: 'linux',
      },
      // A second, inactive library so Manage Library's tabs/activate flows are exercisable.
      {
        id: SECOND_LIBRARY_ID,
        name: 'Test Bench',
        gameRoot: 'D:/SPT-testing',
        libraryRoot: 'D:/SPT-testing/.mod_keeper',
        sptVersion: '3.9.0',
        cacheStatus: { state: 'ready', lastRebuiltAt: now() },
        deployStale: false,
        updatedAt: now(),
        targetRuntime: 'windows',
        deploymentMethod: 'copy-first',
        policyUncertain: false,
        hostRuntime: 'linux',
      },
      // A registered-but-unreadable entry (C13): rendered as a bare path, remove-only.
      { path: 'E:/Archive/old-spt/.mod_keeper' },
    ],
    modsByLibraryId: { [LIBRARY_ID]: seedMods(), [SECOND_LIBRARY_ID]: [] },
    toolsByLibraryId: { [LIBRARY_ID]: [], [SECOND_LIBRARY_ID]: [] },
    settings: {
      theme: 'system',
      accentColor: DEFAULT_ACCENT,
      language: 'en-US',
      enableModsOnInstall: true,
      warnIncompatibleForgeInstall: true,
      forgeEndpoint: '',
    },
  }
}

let mockWorkspace: LibraryWorkspace = seedWorkspace()

export function getMockWorkspace(): LibraryWorkspace {
  return mockWorkspace
}

export function setMockWorkspace(workspace: LibraryWorkspace): void {
  mockWorkspace = workspace
}
