/*
 * Registry repository (registry-ui-design.md §3, §6).
 *
 * The UI calls these functions, never the generated bindings directly. The
 * Wails bridge routes each command to Wails, the in-memory mock, or Tauri, and
 * normalizes both transports to the shared CommandResult shape.
 * Provides browser mock fallback for dev/testing when platformKind() === 'browser'.
 */
import { platformKind } from '@/platform'
import { getDefaultStore } from 'jotai'
import { toast } from 'sonner'
import { commands } from '@/wails'
import type {
  ForgeDetail,
  ForgeDownloadVersionInput,
  ForgeKind,
  ForgeMatchInstalledModInput,
  ForgeSearchItem,
  ForgeSearchResponse,
  ForgeVersionsPage,
  OperationAccepted,
  SError,
} from '@/wails/contract'
import {
  addPendingTask,
  isLibraryTaskPending,
  removePendingTask,
  setWorkspace,
} from '../state/library-state'
import {
  registryInstallingMapAtom,
  registryMatchingMapAtom,
  registryRateLimitedUntilAtom,
} from '../state/registry-state'
import { registryText } from '../i18n/registry-text'
import { commonText } from '../i18n/common-text'
import { libraryText } from '../i18n/library-text'
import { parseRetryAfterSeconds } from './registry-errors'
import {
  ensureWorkspaceEventBus,
  listenWorkspaceEvent,
  loadLibraryWorkspace,
} from './library-repository'
import {
  clearRegistryInstallTimeout,
  runRegistryInstallTask,
} from './registry-install-task'

const store = getDefaultStore()

import {
  evaluateAddonParentConstraint,
  getAddonParentInfo,
  type ParentConstraintStatus,
} from '../registry/addon-constraints'

export {
  evaluateAddonParentConstraint,
  getAddonParentInfo,
  type ParentConstraintStatus,
}

// Global listener to clear installing busy flags when workspace events arrive
let hasInstalledListener = false
function ensureInstallListener() {
  if (hasInstalledListener) return
  hasInstalledListener = true
  listenWorkspaceEvent((event) => {
    if (event.type === 'mod_install_completed') {
      const currentMap = store.get(registryInstallingMapAtom)
      const nextMap = { ...currentMap }
      let changed = false
      for (const [key, taskId] of Object.entries(nextMap)) {
        if (taskId === event.taskId) {
          clearRegistryInstallTimeout(event.taskId)
          delete nextMap[key]
          changed = true
        }
      }
      if (changed) {
        store.set(registryInstallingMapAtom, nextMap)
      }
    }
  })
}

// --- Browser Mock Fixtures ---

const mockMods: ForgeSearchItem[] = [
  {
    kind: 'mod',
    id: 2658,
    guid: '7bpencil.weaponcamoandstickers',
    name: 'Camo And Stickers',
    slug: 'camo-and-stickers',
    teaser:
      'Fully customizable weapon camo and sticker attachment system for SPT.',
    thumbnail: 'https://sp-mod.com/storage/mods/2658/thumb.png',
    detailUrl: 'https://sp-mod.com/mods/2658/camo-and-stickers',
    fikaCompatibility: true,
    parentModId: null,
    parentModGuid: null,
    parentModName: null,
    parentModDetailUrl: null,
    modVersionConstraint: null,
    isDetached: null,
  },
  {
    kind: 'mod',
    id: 1042,
    guid: 'solarint.sain',
    name: 'SAIN — Solarint AI',
    slug: 'sain-solarint-ai',
    teaser:
      'Complete overhaul of Tarkov bot combat AI, decision making, and personality.',
    thumbnail: null,
    detailUrl: 'https://sp-mod.com/mods/1042/sain',
    fikaCompatibility: true,
    parentModId: null,
    parentModGuid: null,
    parentModName: null,
    parentModDetailUrl: null,
    modVersionConstraint: null,
    isDetached: null,
  },
  {
    kind: 'mod',
    id: 1105,
    guid: 'fontaine.realism',
    name: 'SPT Realism Mod',
    slug: 'spt-realism-mod',
    teaser:
      'Comprehensive ballistics, armor, stance, and medical realism mechanics.',
    thumbnail: null,
    detailUrl: 'https://sp-mod.com/mods/1105/realism',
    fikaCompatibility: false,
    parentModId: null,
    parentModGuid: null,
    parentModName: null,
    parentModDetailUrl: null,
    modVersionConstraint: null,
    isDetached: null,
  },
]

const mockAddons: ForgeSearchItem[] = [
  {
    kind: 'addon',
    id: 209,
    guid: '7bpencil.caliberpaintmarkers',
    name: 'Simple Caliber and Ammo paint markers',
    slug: 'simple-caliber-paint-markers',
    teaser: 'Color-coded paint marker decals for magazine identification.',
    thumbnail: null,
    detailUrl: 'https://sp-mod.com/addons/209/simple-caliber-paint-markers',
    fikaCompatibility: true,
    parentModId: 2658,
    parentModGuid: '7bpencil.weaponcamoandstickers',
    parentModName: 'Camo And Stickers',
    parentModDetailUrl: 'https://sp-mod.com/mods/2658/camo-and-stickers',
    modVersionConstraint: '^1.20',
    isDetached: false,
  },
  {
    kind: 'addon',
    id: 315,
    guid: 'standalone.profileeditor',
    name: 'Profile Editor Decoupled CLI',
    slug: 'profile-editor-cli',
    teaser: 'Standalone CLI utility for batch profile repair.',
    thumbnail: null,
    detailUrl: 'https://sp-mod.com/addons/315/profile-editor-cli',
    fikaCompatibility: null,
    parentModId: null,
    parentModGuid: null,
    parentModName: null,
    parentModDetailUrl: null,
    modVersionConstraint: null,
    isDetached: true,
  },
]

export async function searchForge({
  query,
  modPage = 1,
  addonPage = 1,
  perPage = 20,
}: {
  query: string
  modPage?: number
  addonPage?: number
  perPage?: number
}): Promise<ForgeSearchResponse> {
  ensureInstallListener()

  if (platformKind() === 'browser') {
    const q = query.trim().toLowerCase()
    const filteredMods = mockMods.filter(
      (m) =>
        !q ||
        m.name.toLowerCase().includes(q) ||
        (m.teaser && m.teaser.toLowerCase().includes(q)),
    )
    const filteredAddons = mockAddons.filter(
      (a) =>
        !q ||
        a.name.toLowerCase().includes(q) ||
        (a.teaser && a.teaser.toLowerCase().includes(q)),
    )

    return {
      sptVersion: '3.8.3',
      mods: {
        items: filteredMods,
        pagination: {
          currentPage: modPage,
          lastPage: Math.max(1, Math.ceil(filteredMods.length / perPage)),
          perPage,
          total: filteredMods.length,
        },
        stale: false,
      },
      addons: {
        items: filteredAddons,
        pagination: {
          currentPage: addonPage,
          lastPage: Math.max(1, Math.ceil(filteredAddons.length / perPage)),
          perPage,
          total: filteredAddons.length,
        },
        stale: false,
      },
    }
  }

  const result = await commands.forgeSearch(query, modPage, addonPage, perPage)
  if (result.status === 'error') {
    handleForgeError(result.error)
    throw result.error
  }
  return result.data
}

export async function getForgeModDetail(
  kind: ForgeKind,
  id: number,
): Promise<ForgeDetail> {
  if (platformKind() === 'browser') {
    const item = [...mockMods, ...mockAddons].find(
      (i) => i.kind === kind && i.id === id,
    )
    return {
      kind,
      id,
      guid: item?.guid ?? 'unknown.guid',
      name: item?.name ?? 'Unknown Mod',
      slug: item?.slug ?? null,
      teaser: item?.teaser ?? null,
      description: `# ${item?.name ?? 'Mod'}\n\nThis is a sample description with markdown support for Forge catalog items.\n\n- Feature 1\n- Feature 2\n- Comprehensive compatibility`,
      thumbnail: item?.thumbnail ?? null,
      detailUrl: item?.detailUrl ?? null,
      fikaCompatibility: item?.fikaCompatibility ?? null,
      parentModId: item?.parentModId ?? null,
      parent: item?.parentModId
        ? {
            id: item.parentModId,
            guid: item.parentModGuid ?? '',
            name: item.parentModName ?? '',
            detailUrl: item.parentModDetailUrl ?? null,
          }
        : null,
      modVersionConstraint: item?.modVersionConstraint ?? null,
      isDetached: item?.isDetached ?? null,
      stale: false,
    }
  }

  const result = await commands.forgeModDetail(kind, id)
  if (result.status === 'error') {
    handleForgeError(result.error)
    throw result.error
  }
  return result.data
}

export async function getForgeModVersions(
  kind: ForgeKind,
  id: number,
  page: number = 1,
): Promise<ForgeVersionsPage> {
  if (platformKind() === 'browser') {
    return {
      kind,
      itemId: id,
      versions: [
        {
          kind,
          itemId: id,
          id: id * 100 + 1,
          version: '1.21.0',
          description: 'Latest release with bugfixes and updated assets.',
          link: `https://sp-mod.com/mod/download/${id}/v1.21.0`,
          contentLength: 329728,
          sptVersionConstraint: '^3.8.0',
          fikaCompatibility: 'compatible',
          dependencies: [],
        },
        {
          kind,
          itemId: id,
          id: id * 100 + 2,
          version: '1.20.9',
          description: 'Initial support for SPT 3.8.x.',
          link: `https://sp-mod.com/mod/download/${id}/v1.20.9`,
          contentLength: 318000,
          sptVersionConstraint: '^3.8.0',
          fikaCompatibility: 'compatible',
          dependencies: [],
        },
        {
          kind,
          itemId: id,
          id: id * 100 + 3,
          version: '1.19.2',
          description: 'Legacy build for SPT 3.7.x.',
          link: `https://sp-mod.com/mod/download/${id}/v1.19.2`,
          contentLength: 310500,
          sptVersionConstraint: '^3.7.0',
          fikaCompatibility: 'unknown',
          dependencies: [],
        },
      ],
      pagination: {
        currentPage: page,
        lastPage: 1,
        perPage: 20,
        total: 3,
      },
      stale: false,
    }
  }

  const result =
    kind === 'addon'
      ? await commands.forgeAddonVersions(id, page)
      : await commands.forgeModVersions('mod', id, page)

  if (result.status === 'error') {
    handleForgeError(result.error)
    throw result.error
  }
  return result.data
}

export async function installForgeVersion({
  libraryId,
  kind,
  itemId,
  versionId,
}: {
  libraryId: string
  kind: ForgeKind
  itemId: number
  versionId: number
}): Promise<OperationAccepted> {
  ensureInstallListener()
  const key = `${kind}:${itemId}:${versionId}`
  return runRegistryInstallTask({
    isTauri: platformKind() !== 'browser',
    ensureReady: ensureWorkspaceEventBus,
    onNotReady: () => toast.error(libraryText.taskUpdatesUnavailable()),
    canStart: () => !isLibraryTaskPending(libraryId),
    onBusy: () => toast.error(libraryText.libraryBusy()),
    createTaskId: () => crypto.randomUUID(),
    registerPending: (taskId) => {
      addPendingTask({ taskId, libraryId, source: 'other' })
      store.set(registryInstallingMapAtom, {
        ...store.get(registryInstallingMapAtom),
        [key]: taskId,
      })
    },
    clearPending: (taskId) => {
      removePendingTask(taskId)
      clearInstallingVersion(key, taskId)
    },
    invoke: (taskId) => {
      const input: ForgeDownloadVersionInput = {
        taskId,
        libraryId,
        kind,
        itemId,
        versionId,
      }
      return commands.forgeDownloadVersion(input)
    },
    mockComplete: (taskId) => {
      clearRegistryInstallTimeout(taskId)
      removePendingTask(taskId)
      clearInstallingVersion(key, taskId)
      toast.success(`Installed ${kind} version successfully`)
    },
    schedule: (callback) => setTimeout(callback, 1500),
    onDomainError: handleForgeError,
    onTransportError: (error) => {
      console.warn(
        '[registry] forge install transport failed; outcome may be unknown',
        error,
      )
      toast.error(libraryText.taskOutcomeUnknown(), {
        action: {
          label: commonText.refresh(),
          onClick: () => void loadLibraryWorkspace(),
        },
      })
    },
    onTimeout: () => {
      toast.error(libraryText.taskOutcomeUnknown(), {
        action: {
          label: commonText.refresh(),
          onClick: () => void loadLibraryWorkspace(),
        },
      })
    },
  })
}

export async function matchInstalledMod(input: ForgeMatchInstalledModInput) {
  const key = `${input.kind}:${input.itemId}:${input.versionId}:${input.installedModId}`
  if (platformKind() === 'browser') {
    toast.success('Matched mod with Forge metadata (mock)')
    return
  }

  store.set(registryMatchingMapAtom, {
    ...store.get(registryMatchingMapAtom),
    [key]: true,
  })

  return commands
    .forgeMatchInstalledMod(input)
    .catch((error: unknown) => {
      console.warn('[registry] Forge match transport failed', error)
      toast.error(commonText.backendUnavailable())
      throw error
    })
    .then((result) => {
      if (result.status === 'error') {
        handleForgeError(result.error)
        throw result.error
      }
      setWorkspace(result.data)
      toast.success(registryText.matchSuccess())
      return result.data
    })
    .finally(() => {
      const current = store.get(registryMatchingMapAtom)
      const next = { ...current }
      delete next[key]
      store.set(registryMatchingMapAtom, next)
    })
}

function clearInstallingVersion(key: string, taskId: string): void {
  const current = store.get(registryInstallingMapAtom)
  if (current[key] !== taskId) return
  const next = { ...current }
  delete next[key]
  store.set(registryInstallingMapAtom, next)
}

function handleForgeError(error: SError): void {
  const message =
    'data' in error && error.data
      ? Array.isArray(error.data)
        ? error.data.join(', ')
        : String(error.data)
      : error.code

  if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
    const seconds = parseRetryAfterSeconds(message) ?? 30
    store.set(registryRateLimitedUntilAtom, Date.now() + seconds * 1000)
    toast.error(registryText.rateLimitedNotice(seconds))
    return
  }

  if (message.includes('requires installed parent')) {
    toast.error(
      registryText.errorParentMissing(registryText.genericParentModName()),
    )
    return
  }

  if (
    message.includes('requires parent') &&
    message.includes('installed version is')
  ) {
    toast.error(message)
    return
  }

  toast.error(message || error.code)
}
