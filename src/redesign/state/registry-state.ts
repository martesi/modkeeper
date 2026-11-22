/*
 * Registry state atoms (registry-ui-design.md §3.1).
 */
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { ForgeKind } from '@/wails/contract'

export type RegistryKindFilter = 'all' | 'mods' | 'addons'

export type RegistrySort = 'forge-default' | 'name-asc'

export type RegistryViewMode = 'list' | 'grid' | 'icons'

export type SelectedRegistryItem = {
  kind: ForgeKind
  id: number
}

/** Active query string, isolated from librarySearchAtom. */
export const registrySearchAtom = atom<string>('')

/** Filter between mods and companion addons. */
export const registryKindFilterAtom = atom<RegistryKindFilter>('all')

/** Selected sort dimension. */
export const registrySortAtom = atom<RegistrySort>('forge-default')

/** View presentation: list, grid, or icons (persisted). */
export const registryViewModeAtom = atomWithStorage<RegistryViewMode>(
  'modkeeper.registry.viewMode',
  'list',
)

/** Independent pagination state for base mods. */
export const registryModPageAtom = atom<number>(1)

/** Independent pagination state for companion addons. */
export const registryAddonPageAtom = atom<number>(1)

/** Item currently open in the detail inspector drawer. */
export const selectedRegistryItemAtom = atom<SelectedRegistryItem | null>(null)

/** In-flight installations keyed by `kind:itemId:versionId` and task id. */
export const registryInstallingMapAtom = atom<Record<string, string>>({})

/** In-flight existing-install matches keyed by `kind:itemId:versionId:modId`. */
export const registryMatchingMapAtom = atom<Record<string, boolean>>({})

/** Rate limit expiration epoch in ms when receiving HTTP 429. */
export const registryRateLimitedUntilAtom = atom<number | null>(null)

/** Whether the user dismissed the offline stale cache warning banner for this session. */
export const registryStaleNoticeDismissedAtom = atom<boolean>(false)

export const clearRegistrySearchAtom = atom(null, (_get, set) => {
  set(registrySearchAtom, '')
  set(registryModPageAtom, 1)
  set(registryAddonPageAtom, 1)
})

export const resetRegistryFiltersAtom = atom(null, (_get, set) => {
  set(registryKindFilterAtom, 'all')
  set(registrySortAtom, 'forge-default')
  set(registryModPageAtom, 1)
  set(registryAddonPageAtom, 1)
})
