import { describe, expect, it } from 'bun:test'
import { getDefaultStore } from 'jotai'
import type { ForgeSearchItem, ModSummary } from '@/wails/contract'
import {
  evaluateAddonParentConstraint,
  getAddonParentInfo,
} from './addon-constraints'
import {
  clearRegistrySearchAtom,
  registryAddonPageAtom,
  registryInstallingMapAtom,
  registryKindFilterAtom,
  registryModPageAtom,
  registrySearchAtom,
  registrySortAtom,
  registryViewModeAtom,
  resetRegistryFiltersAtom,
  selectedRegistryItemAtom,
} from '../state/registry-state'
import { parseRetryAfterSeconds } from '../data/registry-errors'

describe('registry state atoms', () => {
  it('initializes with default query, sort, and view mode values', () => {
    const store = getDefaultStore()
    expect(store.get(registrySearchAtom)).toBe('')
    expect(store.get(registryKindFilterAtom)).toBe('all')
    expect(store.get(registrySortAtom)).toBe('forge-default')
    expect(store.get(registryViewModeAtom)).toBe('list')
    expect(store.get(registryModPageAtom)).toBe(1)
    expect(store.get(registryAddonPageAtom)).toBe(1)
    expect(store.get(selectedRegistryItemAtom)).toBeNull()
    expect(store.get(registryInstallingMapAtom)).toEqual({})
  })

  it('resets query and pagination when clearRegistrySearchAtom is invoked', () => {
    const store = getDefaultStore()
    store.set(registrySearchAtom, 'custom search query')
    store.set(registryModPageAtom, 5)
    store.set(registryAddonPageAtom, 3)

    store.set(clearRegistrySearchAtom)
    expect(store.get(registrySearchAtom)).toBe('')
    expect(store.get(registryModPageAtom)).toBe(1)
    expect(store.get(registryAddonPageAtom)).toBe(1)
  })

  it('resets filters and pagination with resetRegistryFiltersAtom', () => {
    const store = getDefaultStore()
    store.set(registryKindFilterAtom, 'addons')
    store.set(registrySortAtom, 'name-asc')
    store.set(registryModPageAtom, 4)

    store.set(resetRegistryFiltersAtom)
    expect(store.get(registryKindFilterAtom)).toBe('all')
    expect(store.get(registrySortAtom)).toBe('forge-default')
    expect(store.get(registryModPageAtom)).toBe(1)
    expect(store.get(registryAddonPageAtom)).toBe(1)
  })
})

describe('Forge retry timing', () => {
  it('parses the backend retry-after wording and header form', () => {
    expect(parseRetryAfterSeconds('HTTP 429: retry after 45 seconds')).toBe(45)
    expect(parseRetryAfterSeconds('Retry-After: 12')).toBe(12)
    expect(parseRetryAfterSeconds('rate limited')).toBeNull()
  })
})

describe('addon parent constraint evaluation', () => {
  const installedMods = [
    {
      id: 'installed-camo-mod',
      libraryId: 'lib-1',
      name: 'Camo And Stickers',
      type: 'server',
      isEnabled: true,
      updatedAt: '2026-07-10T10:00:00Z',
      source: 'forge',
      forgeKind: 'mod',
      forgeId: 2658,
      forgeGuid: '7bpencil.weaponcamoandstickers',
      version: '1.21.0',
    },
  ] as unknown as ModSummary[]

  function addonWithConstraint(constraint: string): ForgeSearchItem {
    return {
      kind: 'addon',
      id: 209,
      guid: '7bpencil.caliberpaintmarkers',
      name: 'Simple Caliber paint markers',
      slug: null,
      teaser: null,
      thumbnail: null,
      detailUrl: null,
      fikaCompatibility: null,
      parentModId: 2658,
      parentModGuid: '7bpencil.weaponcamoandstickers',
      parentModName: 'Camo And Stickers',
      parentModDetailUrl: null,
      modVersionConstraint: constraint,
      isDetached: false,
    }
  }

  it('uses Rust caret semantics for bare partial versions', () => {
    const result = evaluateAddonParentConstraint({
      addon: addonWithConstraint('1.21'),
      installedMods: [{ ...installedMods[0], version: '1.22.0' }],
    })

    expect(result.status).toBe('satisfied')
  })

  it('preserves prereleases when checking parent constraints', () => {
    const prereleaseParent = {
      ...installedMods[0],
      version: '1.21.0-alpha.2',
    }
    const defaultCaret = evaluateAddonParentConstraint({
      addon: addonWithConstraint('^1.21.0'),
      installedMods: [prereleaseParent],
    })
    const prereleaseRange = evaluateAddonParentConstraint({
      addon: addonWithConstraint('>=1.21.0-alpha.1, <1.22.0'),
      installedMods: [prereleaseParent],
    })

    expect(defaultCaret.status).toBe('mismatch')
    expect(prereleaseRange.status).toBe('satisfied')
  })

  it('does not coerce non-semver installed versions into a match', () => {
    const result = evaluateAddonParentConstraint({
      addon: addonWithConstraint('^1.21.0'),
      installedMods: [
        { ...installedMods[0], version: 'v1.21.0' },
      ] as unknown as ModSummary[],
    })

    expect(result).toMatchObject({
      status: 'unverified',
      reason: 'missing-version',
    })
  })

  it('requires the exact Forge mod identity from the backend parent gate', () => {
    const addon = addonWithConstraint('^1.20')
    const wrongForgeId = evaluateAddonParentConstraint({
      addon,
      installedMods: [{ ...installedMods[0], forgeId: 999 }],
    })
    const localSource = evaluateAddonParentConstraint({
      addon,
      installedMods: [{ ...installedMods[0], source: 'local' }],
    })
    const addonKind = evaluateAddonParentConstraint({
      addon,
      installedMods: [{ ...installedMods[0], forgeKind: 'addon' }],
    })
    const caseMismatch = evaluateAddonParentConstraint({
      addon: addonWithConstraint('^1.20'),
      installedMods: [
        { ...installedMods[0], forgeGuid: '7BPENCIL.weaponcamoandstickers' },
      ],
    })
    const noParentId = evaluateAddonParentConstraint({
      addon: { ...addon, parentModId: null },
      installedMods,
    })

    for (const result of [
      wrongForgeId,
      localSource,
      addonKind,
      caseMismatch,
      noParentId,
    ]) {
      expect(result).toMatchObject({
        status: 'unverified',
        reason: 'missing-identity',
      })
    }
  })

  it('treats base mods and detached addons as standalone', () => {
    const baseMod: ForgeSearchItem = {
      kind: 'mod',
      id: 2658,
      guid: '7bpencil.weaponcamoandstickers',
      name: 'Camo And Stickers',
      slug: null,
      teaser: null,
      thumbnail: null,
      detailUrl: null,
      fikaCompatibility: null,
      parentModId: null,
      parentModGuid: null,
      parentModName: null,
      parentModDetailUrl: null,
      modVersionConstraint: null,
      isDetached: null,
    }
    expect(
      evaluateAddonParentConstraint({ addon: baseMod, installedMods }),
    ).toEqual({
      status: 'standalone',
    })

    const detachedAddon: ForgeSearchItem = {
      ...baseMod,
      kind: 'addon',
      isDetached: true,
    }
    expect(
      evaluateAddonParentConstraint({ addon: detachedAddon, installedMods }),
    ).toEqual({ status: 'standalone' })
  })

  it('detects satisfied parent mod constraint when parent is installed', () => {
    const addon: ForgeSearchItem = {
      kind: 'addon',
      id: 209,
      guid: '7bpencil.caliberpaintmarkers',
      name: 'Simple Caliber paint markers',
      slug: null,
      teaser: null,
      thumbnail: null,
      detailUrl: null,
      fikaCompatibility: null,
      parentModId: 2658,
      parentModGuid: '7bpencil.weaponcamoandstickers',
      parentModName: 'Camo And Stickers',
      parentModDetailUrl: null,
      modVersionConstraint: '^1.20',
      isDetached: false,
    }

    const result = evaluateAddonParentConstraint({ addon, installedMods })
    expect(result.status).toBe('satisfied')
    if (result.status === 'satisfied') {
      expect(result.parentName).toBe('Camo And Stickers')
      expect(result.installedMod.name).toBe('Camo And Stickers')
    }
  })

  it('does not infer a parent identity from a matching display name', () => {
    const localOnlyMods: ModSummary[] = [
      {
        id: 'local-camo-mod',
        libraryId: 'lib-1',
        name: 'Camo And Stickers',
        type: 'server',
        isEnabled: true,
        updatedAt: '2026-07-10T10:00:00Z',
      },
    ]
    const addon: ForgeSearchItem = {
      kind: 'addon',
      id: 209,
      guid: '7bpencil.caliberpaintmarkers',
      name: 'Simple Caliber paint markers',
      slug: null,
      teaser: null,
      thumbnail: null,
      detailUrl: null,
      fikaCompatibility: null,
      parentModId: 2658,
      parentModGuid: '7bpencil.weaponcamoandstickers',
      parentModName: 'Camo And Stickers',
      parentModDetailUrl: null,
      modVersionConstraint: '^1.20',
      isDetached: false,
    }

    expect(
      evaluateAddonParentConstraint({ addon, installedMods: localOnlyMods }),
    ).toMatchObject({ status: 'unverified', reason: 'missing-identity' })
  })

  it('blocks installation when a matched parent has no known version', () => {
    const addon: ForgeSearchItem = {
      kind: 'addon',
      id: 209,
      guid: '7bpencil.caliberpaintmarkers',
      name: 'Simple Caliber paint markers',
      slug: null,
      teaser: null,
      thumbnail: null,
      detailUrl: null,
      fikaCompatibility: null,
      parentModId: 2658,
      parentModGuid: '7bpencil.weaponcamoandstickers',
      parentModName: 'Camo And Stickers',
      parentModDetailUrl: null,
      modVersionConstraint: '^1.20',
      isDetached: false,
    }
    const parentWithoutVersion = [
      {
        ...installedMods[0],
        version: undefined,
      },
    ] as unknown as ModSummary[]

    expect(
      evaluateAddonParentConstraint({
        addon,
        installedMods: parentWithoutVersion,
      }),
    ).toMatchObject({ status: 'unverified', reason: 'missing-version' })
  })

  it('detects parent version mismatch when installed version violates constraint', () => {
    const modsWithOlderVersion = [
      {
        id: 'installed-camo-mod',
        libraryId: 'lib-1',
        name: 'Camo And Stickers',
        type: 'server' as const,
        isEnabled: true,
        updatedAt: '2026-07-10T10:00:00Z',
        source: 'forge' as const,
        forgeKind: 'mod' as const,
        forgeId: 2658,
        forgeGuid: '7bpencil.weaponcamoandstickers',
        version: '1.18.0',
      },
    ] as unknown as ModSummary[]

    const addon: ForgeSearchItem = {
      kind: 'addon',
      id: 209,
      guid: '7bpencil.caliberpaintmarkers',
      name: 'Simple Caliber paint markers',
      slug: null,
      teaser: null,
      thumbnail: null,
      detailUrl: null,
      fikaCompatibility: null,
      parentModId: 2658,
      parentModGuid: '7bpencil.weaponcamoandstickers',
      parentModName: 'Camo And Stickers',
      parentModDetailUrl: null,
      modVersionConstraint: '^1.20',
      isDetached: false,
    }

    const result = evaluateAddonParentConstraint({
      addon,
      installedMods: modsWithOlderVersion,
    })
    expect(result.status).toBe('mismatch')
    if (result.status === 'mismatch') {
      expect(result.installedVersion).toBe('1.18.0')
      expect(result.constraint).toBe('^1.20')
    }
  })

  it('flags missing parent when required parent mod is absent from library', () => {
    const addon: ForgeSearchItem = {
      kind: 'addon',
      id: 999,
      guid: 'author.otheraddon',
      name: 'Other Addon',
      slug: null,
      teaser: null,
      thumbnail: null,
      detailUrl: null,
      fikaCompatibility: null,
      parentModId: 777,
      parentModGuid: 'missing.parent',
      parentModName: 'Missing Master Mod',
      parentModDetailUrl: null,
      modVersionConstraint: '^2.0',
      isDetached: false,
    }

    const result = evaluateAddonParentConstraint({ addon, installedMods })
    expect(result.status).toBe('missing')
    if (result.status === 'missing') {
      expect(result.parentName).toBe('Missing Master Mod')
      expect(result.parentModId).toBe(777)
    }
  })

  it('extracts parent info uniformly across search items and details', () => {
    const detail = {
      kind: 'addon' as const,
      id: 209,
      guid: 'addon.guid',
      name: 'Addon Name',
      parent: {
        id: 2658,
        guid: 'parent.guid',
        name: 'Parent From Detail',
      },
      modVersionConstraint: '>=1.0.0',
    }
    const info = getAddonParentInfo(detail)
    expect(info.parentName).toBe('Parent From Detail')
    expect(info.parentId).toBe(2658)
    expect(info.constraint).toBe('>=1.0.0')
  })
})
