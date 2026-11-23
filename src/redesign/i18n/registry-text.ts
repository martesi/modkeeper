/*
 * Registry-screen i18n namespace (registry-ui-design.md §8).
 */
import { t } from '@lingui/core/macro'

export const registryText = {
  title: () => t({ id: 'registry.header.title', message: 'Registry' }),
  navTitle: () => t({ id: 'registry.nav.title', message: 'Registry' }),
  navTooltip: () =>
    t({
      id: 'registry.nav.tooltip',
      message: 'Browse and install mods from Forge',
    }),
  searchPlaceholder: () =>
    t({
      id: 'registry.search.placeholder',
      message: 'Search Forge mods & addons…',
    }),
  searchLabel: () =>
    t({ id: 'registry.search.label', message: 'Search Forge mod registry' }),
  filterAll: () =>
    t({ id: 'registry.toolbar.filterAll', message: 'All Items' }),
  filterMods: () => t({ id: 'registry.toolbar.filterMods', message: 'Mods' }),
  filterAddons: () =>
    t({ id: 'registry.toolbar.filterAddons', message: 'Addons' }),
  sptFilter: (version: string) =>
    t({
      id: 'registry.toolbar.sptFilter',
      message: `Compatible with SPT ${version}`,
    }),
  sptFilterLabel: () =>
    t({
      id: 'registry.toolbar.sptFilterLabel',
      message: 'SPT Compatibility Filter',
    }),
  badgeMod: () => t({ id: 'registry.badge.mod', message: 'Mod' }),
  badgeAddon: () => t({ id: 'registry.badge.addon', message: 'Addon' }),
  badgeExtends: (parentName: string) =>
    t({ id: 'registry.badge.extends', message: `Extends ${parentName}` }),
  badgeFika: () => t({ id: 'registry.badge.fika', message: 'Fika Compatible' }),
  badgeStandalone: () =>
    t({ id: 'registry.badge.standalone', message: 'Standalone Tool' }),
  statusParentInstalled: (version: string) =>
    t({
      id: 'registry.status.parentInstalled',
      message: `Parent v${version} installed`,
    }),
  statusParentMissing: (parentName: string) =>
    t({
      id: 'registry.status.parentMissing',
      message: `Requires ${parentName}`,
    }),
  statusParentUnverified: (parentName: string) =>
    t({
      id: 'registry.status.parentUnverified',
      message: `Cannot verify ${parentName}`,
    }),
  statusSptCompatible: (version: string) =>
    t({
      id: 'registry.status.sptCompatible',
      message: `Compatible with SPT ${version}`,
    }),
  statusSptUnknown: () =>
    t({ id: 'registry.status.sptUnknown', message: 'SPT Compatible' }),
  statusSptUntested: () =>
    t({ id: 'registry.status.sptUntested', message: 'Untested' }),
  statusSptIncompatible: (version: string) =>
    t({
      id: 'registry.status.sptIncompatible',
      message: `Incompatible with SPT ${version}`,
    }),
  statusParentMismatch: (
    parentName: string,
    constraint: string,
    version: string,
  ) =>
    t({
      id: 'registry.status.parentMismatch',
      message: `Requires ${parentName} ${constraint} (installed: v${version})`,
    }),
  actionInstall: () =>
    t({ id: 'registry.actions.install', message: 'Install' }),
  actionReinstall: () =>
    t({ id: 'registry.actions.reinstall', message: 'Reinstall' }),
  actionInstalled: () =>
    t({ id: 'registry.actions.installed', message: 'Installed' }),
  actionMatchInstalled: () =>
    t({
      id: 'registry.actions.matchInstalled',
      message: 'Match existing install to this version',
    }),
  actionUpdate: (version: string) =>
    t({ id: 'registry.actions.update', message: `Update to v${version}` }),
  actionInstalling: () =>
    t({ id: 'registry.actions.installing', message: 'Installing…' }),
  actionInstallParentFirst: () =>
    t({
      id: 'registry.actions.installParentFirst',
      message: 'Install Parent Mod First',
    }),
  actionRequiresMod: () =>
    t({ id: 'registry.actions.requiresMod', message: 'Requires Mod' }),
  actionViewOnForge: () =>
    t({ id: 'registry.actions.viewOnForge', message: 'View on Forge' }),
  sortLabel: () =>
    t({ id: 'registry.toolbar.sortLabel', message: 'Sort Registry' }),
  sortForgeDefault: () =>
    t({ id: 'registry.toolbar.sortForgeDefault', message: 'Forge Default' }),
  sortDownloads: () =>
    t({ id: 'registry.toolbar.sortDownloads', message: 'Most Downloaded' }),
  sortPublished: () =>
    t({ id: 'registry.toolbar.sortPublished', message: 'Newest' }),
  sortUpdated: () =>
    t({ id: 'registry.toolbar.sortUpdated', message: 'Recently Updated' }),
  sortName: () =>
    t({ id: 'registry.toolbar.sortName', message: 'Alphabetical' }),
  paginationPage: (current: number, total: number) =>
    t({
      id: 'registry.toolbar.pageInfo',
      message: `Page ${current} of ${total}`,
    }),
  paginationPrev: () =>
    t({ id: 'registry.toolbar.prevPage', message: 'Previous page' }),
  paginationNext: () =>
    t({ id: 'registry.toolbar.nextPage', message: 'Next page' }),
  paginationModsGroup: () =>
    t({ id: 'registry.toolbar.paginationMods', message: 'Mods pages' }),
  paginationAddonsGroup: () =>
    t({ id: 'registry.toolbar.paginationAddons', message: 'Addon pages' }),
  versionsHeader: () =>
    t({
      id: 'registry.detail.versionsHeader',
      message: 'Versions & Compatibility',
    }),
  compatibleVersionsOnly: () =>
    t({
      id: 'registry.detail.compatibleOnly',
      message: 'Compatible with this SPT version',
    }),
  incompatibleInstallTitle: () =>
    t({
      id: 'registry.install.incompatible.title',
      message: 'Version may be incompatible',
    }),
  incompatibleInstallDescription: (version: string, spt: string) =>
    t({
      id: 'registry.install.incompatible.description',
      message: `Version ${version} does not list support for SPT ${spt}. Install it anyway?`,
    }),
  dontShowIncompatibleWarning: () =>
    t({
      id: 'registry.install.incompatible.dontShow',
      message: 'Do not show this warning again',
    }),
  installAnyway: () =>
    t({
      id: 'registry.install.incompatible.confirm',
      message: 'Install anyway',
    }),
  dependenciesHeader: () =>
    t({ id: 'registry.detail.dependenciesHeader', message: 'Dependencies' }),
  archiveSafetyNote: () =>
    t({
      id: 'registry.detail.archiveSafetyNote',
      message:
        'Archive structure and safety are verified locally upon download.',
    }),
  parentModRequirements: () =>
    t({
      id: 'registry.detail.parentRequirements',
      message: 'Parent Mod Requirement',
    }),
  parentGateTitle: () =>
    t({ id: 'registry.parentGate.title', message: 'Parent Mod Check' }),
  parentGateMissing: (name: string, constraint: string) =>
    t({
      id: 'registry.parentGate.missing',
      message: `${name} must be installed at ${constraint} before this addon.`,
    }),
  parentGateMismatch: (name: string, constraint: string, version: string) =>
    t({
      id: 'registry.parentGate.mismatch',
      message: `${name} ${constraint} is required, but ${version} is installed.`,
    }),
  parentGateUnverified: (name: string) =>
    t({
      id: 'registry.parentGate.unverified',
      message: `Modkeeper cannot verify the installed identity and version for ${name}. Match it to Forge before installing this addon.`,
    }),
  parentGateSearch: () =>
    t({
      id: 'registry.parentGate.search',
      message: 'Open Parent Mod',
    }),
  detailLoading: () =>
    t({ id: 'registry.detail.loading', message: 'Loading details…' }),
  detailHeading: () => t({ id: 'registry.detail.heading', message: 'Details' }),
  detailDescription: () =>
    t({ id: 'registry.detail.description', message: 'Description' }),
  detailSearchParent: () =>
    t({ id: 'registry.detail.searchParent', message: 'Search for Parent Mod' }),
  detailResolveDependency: () =>
    t({
      id: 'registry.detail.resolveDependency',
      message: 'Resolve dependency',
    }),
  detailNoVersions: () =>
    t({ id: 'registry.detail.noVersions', message: 'No versions available.' }),
  detailVersionsLoadFailed: () =>
    t({
      id: 'registry.detail.versionsLoadFailed',
      message:
        'Could not load this versions page. Try selecting the page again.',
    }),
  detailLoadFailed: () =>
    t({
      id: 'registry.detail.loadFailed',
      message:
        'Could not load registry details. Check the connection and retry.',
    }),
  detailRetryVersions: () =>
    t({ id: 'registry.detail.retryVersions', message: 'Retry' }),
  matchSectionHeader: () =>
    t({ id: 'registry.detail.matchHeader', message: 'Match Existing Install' }),
  matchSectionDescription: () =>
    t({
      id: 'registry.detail.matchDescription',
      message:
        'Choose a local mod to record its Forge identity and version. This does not download or change files.',
    }),
  matchExistingInstallLabel: () =>
    t({
      id: 'registry.detail.matchExistingInstallLabel',
      message: 'Local mod',
    }),
  matchSelectPlaceholder: () =>
    t({
      id: 'registry.detail.matchSelectPlaceholder',
      message: 'Select a local mod…',
    }),
  matchNoLocalMods: () =>
    t({
      id: 'registry.detail.matchNoLocalMods',
      message: 'No local mods are available to match.',
    }),
  matchSuccess: () =>
    t({
      id: 'registry.toast.matchSuccess',
      message: 'Linked the local mod to Forge metadata.',
    }),
  detailParentRequirement: (name: string, constraint: string) =>
    t({
      id: 'registry.detail.parentRequirement',
      message: `Requires: ${name} (${constraint})`,
    }),
  detailRequiresParent: (name: string) =>
    t({
      id: 'registry.detail.requiresParent',
      message: `Requires ${name} installed first`,
    }),
  iconsParentRequired: () =>
    t({ id: 'registry.icons.parentRequired', message: 'Parent mod required' }),
  genericParentModName: () =>
    t({ id: 'registry.entity.parentMod', message: 'parent mod' }),
  errorParentMissing: (parentName: string) =>
    t({
      id: 'registry.errors.parentMissing',
      message: `Cannot install addon: required ${parentName} is not installed.`,
    }),
  errorParentVersionMissing: (parentGuid: string) =>
    t({
      id: 'registry.errors.parentVersionMissing',
      message: `Cannot install addon: Forge parent ${parentGuid} has no recorded version.`,
    }),
  errorParentMismatch: (
    parentName: string,
    constraint: string,
    version: string,
  ) =>
    t({
      id: 'registry.errors.parentMismatch',
      message: `Cannot install addon: requires parent mod '${parentName}' at ${constraint}, but installed version is v${version}.`,
    }),
  errorContentLengthMismatch: (actual: number, expected: number) =>
    t({
      id: 'registry.errors.contentLengthMismatch',
      message: `Download size mismatch: received ${actual} bytes, expected ${expected} bytes.`,
    }),
  staleCacheNotice: () =>
    t({
      id: 'registry.status.staleCacheNotice',
      message: 'Showing cached Forge data. You are currently offline.',
    }),
  installDisabledOffline: () =>
    t({
      id: 'registry.status.installDisabledOffline',
      message: 'Cannot download or install mods while offline.',
    }),
  installDisabledRateLimited: (seconds: number) =>
    t({
      id: 'registry.status.installDisabledRateLimited',
      message: `Forge requests are paused for ${seconds}s.`,
    }),
  rateLimitedNotice: (seconds: number) =>
    t({
      id: 'registry.status.rateLimitedNotice',
      message: `Forge request limit reached. Throttled for ${seconds}s.`,
    }),
  emptyNoResults: (query: string, sptVersion: string) =>
    t({
      id: 'registry.empty.noResults',
      message: `No mods or addons found matching '${query}' for SPT ${sptVersion}.`,
    }),
  emptyNoResultsUnknownSpt: (query: string) =>
    t({
      id: 'registry.empty.noResultsUnknownSpt',
      message: `No mods or addons found matching '${query}'. The SPT version is unknown, so compatibility cannot be determined.`,
    }),
  emptyNoResultsSimple: () =>
    t({
      id: 'registry.empty.noResultsSimple',
      message: 'No mods or addons found matching your filter criteria.',
    }),
  clearSearch: () =>
    t({ id: 'registry.empty.clearSearch', message: 'Clear Search' }),
  searching: () =>
    t({ id: 'registry.status.searching', message: 'Searching Forge…' }),
  searchFailedTitle: () =>
    t({
      id: 'registry.status.searchFailedTitle',
      message: 'Forge search failed',
    }),
  searchFailedDescription: () =>
    t({
      id: 'registry.status.searchFailedDescription',
      message: 'Forge returned an error. Retry the search in a moment.',
    }),
  retrySearch: () =>
    t({ id: 'registry.status.retrySearch', message: 'Retry Search' }),
  dismissNotice: () =>
    t({ id: 'registry.status.dismissNotice', message: 'Dismiss notice' }),
  showIncompatible: () =>
    t({
      id: 'registry.empty.showIncompatible',
      message: 'Show Incompatible Versions',
    }),
  emptyOfflineTitle: () =>
    t({
      id: 'registry.empty.offlineTitle',
      message: 'Forge Registry Unreachable',
    }),
  emptyOfflineDescription: () =>
    t({
      id: 'registry.empty.offlineDescription',
      message:
        'Unable to connect to sp-mod.com and no cached data is available.',
    }),
  retryConnection: () =>
    t({ id: 'registry.empty.retryConnection', message: 'Retry Connection' }),
  emptyNoLibraryTitle: () =>
    t({
      id: 'registry.empty.noLibraryTitle',
      message: 'No Active SPT Library',
    }),
  emptyNoLibraryDescription: () =>
    t({
      id: 'registry.empty.noLibraryDescription',
      message: 'Select or create an SPT library to browse compatible mods.',
    }),
  manageLibrary: () =>
    t({ id: 'registry.empty.manageLibrary', message: 'Manage Libraries' }),
  closeDetail: () =>
    t({ id: 'registry.detail.close', message: 'Close details' }),
  viewModeLabel: () =>
    t({ id: 'registry.toolbar.viewModeLabel', message: 'Registry View Mode' }),
  downloadsCount: (count: number) =>
    t({ id: 'registry.item.downloadsCount', message: `${count} downloads` }),
  byAuthor: (author: string) =>
    t({ id: 'registry.item.byAuthor', message: `by ${author}` }),
  latestVersion: () =>
    t({ id: 'registry.detail.latestVersion', message: 'Latest' }),
  sptCompatible: () =>
    t({ id: 'registry.detail.sptCompatible', message: 'Compatible' }),
  sptIncompatible: () =>
    t({ id: 'registry.detail.sptIncompatible', message: 'Incompatible' }),
}
