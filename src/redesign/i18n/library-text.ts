/*
 * Library-screen i18n namespace (frontend-redesign-spec.md §10): screen, toolbar, empty states,
 * bulk actions, the Manage Library dialog, and the tool registry.
 */
import { t } from '@lingui/core/macro'

export const libraryText = {
  title: () => t({ id: 'library.header.title', message: 'Library' }),
  workspaceLoading: () =>
    t({ id: 'library.status.workspaceLoading', message: 'Loading workspace…' }),
  workspaceLoadFailed: () =>
    t({
      id: 'library.status.workspaceLoadFailed',
      message: 'Could not load the workspace.',
    }),
  taskUpdatesUnavailable: () =>
    t({
      id: 'library.status.taskUpdatesUnavailable',
      message: 'Task updates are unavailable. The operation was not started.',
    }),
  libraryBusy: () =>
    t({
      id: 'library.status.libraryBusy',
      message: 'Another operation is still running for this library.',
    }),
  taskOutcomeUnknown: () =>
    t({
      id: 'library.status.taskOutcomeUnknown',
      message:
        'The operation may still be running. Refresh the workspace before trying again.',
    }),
  taskResultLabel: () =>
    t({ id: 'library.taskResult.label', message: 'Latest task result' }),
  dismissTaskResult: () =>
    t({ id: 'library.taskResult.dismiss', message: 'Dismiss task result' }),
  installImported: (successCount: number, submittedCount: number) =>
    t({
      id: 'library.taskResult.installImported',
      message: `Imported ${successCount} of ${submittedCount}`,
    }),
  installFailedCount: (count: number) =>
    t({
      id: 'library.taskResult.installFailedCount',
      message: `${count} archive(s) failed`,
    }),
  installCompleted: () =>
    t({
      id: 'library.taskResult.installCompleted',
      message: 'Import completed.',
    }),
  failedArchives: () =>
    t({ id: 'library.taskResult.failedArchives', message: 'Failed archives' }),
  moreFailedArchives: (count: number) =>
    t({
      id: 'library.taskResult.moreFailedArchives',
      message: `And ${count} more failed archive(s)`,
    }),
  fullPaths: () =>
    t({ id: 'library.taskResult.fullPaths', message: 'Full paths' }),
  retryFailedArchives: () =>
    t({ id: 'library.taskResult.retryFailed', message: 'Retry failed' }),
  retryUnavailable: () =>
    t({
      id: 'library.taskResult.retryUnavailable',
      message: 'Retry is available only for the active idle library.',
    }),
  unknownArchive: () =>
    t({ id: 'library.taskResult.unknownArchive', message: 'Unknown archive' }),
  syncSucceeded: () =>
    t({ id: 'library.taskResult.syncSucceeded', message: 'Sync completed.' }),
  syncFailed: () =>
    t({
      id: 'library.taskResult.syncFailed',
      message: 'Sync completed with an operation error.',
    }),
  moreSyncErrors: (count: number) =>
    t({
      id: 'library.taskResult.moreSyncErrors',
      message: `And ${count} more sync error(s)`,
    }),
  cacheRebuildFailed: () =>
    t({
      id: 'library.taskResult.cacheRebuildFailed',
      message: 'Cache rebuild failed.',
    }),
  cacheStateReady: () =>
    t({ id: 'library.taskResult.cacheReady', message: 'Cache state: Ready' }),
  cacheStateDirty: () =>
    t({ id: 'library.taskResult.cacheDirty', message: 'Cache state: Dirty' }),
  cacheStateRebuilding: () =>
    t({
      id: 'library.taskResult.cacheRebuilding',
      message: 'Cache state: Rebuilding',
    }),
  cacheDiagnostic: () =>
    t({
      id: 'library.taskResult.cacheDiagnostic',
      message: 'Backend message',
    }),
  subtitleEmpty: () =>
    t({
      id: 'library.header.subtitleEmpty',
      message: 'Click to create or activate a library',
    }),
  subtitleModsInstalled: (count: number) =>
    t({
      id: 'library.header.subtitleModsInstalled',
      message: `${count} mods installed`,
    }),
  sync: () => t({ id: 'library.actions.sync', message: 'Sync' }),
  syncing: () => t({ id: 'library.status.syncing', message: 'Syncing…' }),
  deployStale: () =>
    t({
      id: 'library.status.deployStale',
      message: 'Deployment out of date — sync now',
    }),
  deployUpToDate: () =>
    t({
      id: 'library.status.deployUpToDate',
      message: 'Deployment up to date',
    }),
  enableMod: (name: string) =>
    t({ id: 'library.card.enableMod', message: `Enable ${name}` }),
  selectMod: (name: string) =>
    t({ id: 'library.card.selectMod', message: `Select ${name}` }),
  // Import surfaces
  addMod: () => t({ id: 'library.actions.addMod', message: 'Add mod' }),
  emptyActivateTitle: () =>
    t({ id: 'library.empty.activateTitle', message: 'Activate a library' }),
  emptyActivateBody: () =>
    t({
      id: 'library.empty.activateBody',
      message:
        'Create or select a modding profile to start managing installed mods.',
    }),
  dropTitle: () =>
    t({
      id: 'library.empty.dropTitle',
      message: 'Drag and drop mod archives here to install',
    }),
  dropBrowse: () =>
    t({
      id: 'library.empty.dropBrowse',
      message: 'or click to browse local files',
    }),
  dropSupported: () =>
    t({ id: 'library.empty.dropSupported', message: 'SUPPORTED: .zip, .7z' }),
  manageLibraries: () =>
    t({ id: 'library.actions.manageLibraries', message: 'Manage libraries' }),
  archive: () => t({ id: 'library.import.archive', message: 'Mod archive' }),
  selectModArchives: () =>
    t({
      id: 'library.import.selectModArchives',
      message: 'Select mod archives',
    }),
  unsupportedArchiveRejected: () =>
    t({
      id: 'library.import.unsupportedArchiveRejected',
      message: 'Only .zip and .7z archives can be imported',
    }),

  // Toolbar
  selectAll: () =>
    t({ id: 'library.toolbar.selectAll', message: 'Select all' }),
  selectAllVisible: () =>
    t({
      id: 'library.toolbar.selectAllVisible',
      message: 'Select all visible mods',
    }),
  searchPlaceholder: () =>
    t({ id: 'library.toolbar.searchPlaceholder', message: 'Search mods…' }),
  searchLabel: () =>
    t({ id: 'library.toolbar.searchLabel', message: 'Search mods' }),
  sortLabel: () => t({ id: 'library.toolbar.sortLabel', message: 'Sort' }),
  sortNameAsc: () =>
    t({ id: 'library.toolbar.sortNameAsc', message: 'Name (A-Z)' }),
  sortNameDesc: () =>
    t({ id: 'library.toolbar.sortNameDesc', message: 'Name (Z-A)' }),
  sortUpdatedDesc: () =>
    t({ id: 'library.toolbar.sortUpdatedDesc', message: 'Recently updated' }),
  sortInstalledDesc: () =>
    t({
      id: 'library.toolbar.sortInstalledDesc',
      message: 'Recently installed',
    }),
  sortInstalledAsc: () =>
    t({ id: 'library.toolbar.sortInstalledAsc', message: 'Oldest installed' }),
  filterLabel: () =>
    t({ id: 'library.toolbar.filterLabel', message: 'Filter' }),
  filterAll: () => t({ id: 'library.toolbar.filterAll', message: 'All mods' }),
  filterEnabled: () =>
    t({ id: 'library.toolbar.filterEnabled', message: 'Enabled only' }),
  filterDisabled: () =>
    t({ id: 'library.toolbar.filterDisabled', message: 'Disabled only' }),
  typeFilterLabel: () =>
    t({ id: 'library.toolbar.typeFilterLabel', message: 'Type' }),
  typeFilterAll: () =>
    t({ id: 'library.toolbar.typeFilterAll', message: 'All types' }),
  typeFilterClient: () =>
    t({ id: 'library.toolbar.typeFilterClient', message: 'Client' }),
  typeFilterServer: () =>
    t({ id: 'library.toolbar.typeFilterServer', message: 'Server' }),
  typeFilterBoth: () =>
    t({ id: 'library.toolbar.typeFilterBoth', message: 'Both' }),
  typeFilterUnknown: () =>
    t({ id: 'library.toolbar.typeFilterUnknown', message: 'Unknown' }),
  actions: (count: number) =>
    t({ id: 'library.toolbar.actions', message: `Actions · ${count}` }),
  noVisibleMods: () =>
    t({
      id: 'library.grid.noVisibleMods',
      message: 'No mods match the current filter',
    }),
  noSearchOrFiltersResults: () =>
    t({
      id: 'library.grid.noSearchOrFiltersResults',
      message: 'No mods match your search or filters.',
    }),
  clearSearch: () =>
    t({ id: 'library.grid.clearSearch', message: 'Clear search' }),
  clearFilters: () =>
    t({ id: 'library.grid.clearFilters', message: 'Clear filters' }),

  // Bulk actions
  enableSelected: () =>
    t({ id: 'library.bulk.enableSelected', message: 'Enable selected' }),
  disableSelected: () =>
    t({ id: 'library.bulk.disableSelected', message: 'Disable selected' }),
  deleteSelected: () =>
    t({ id: 'library.bulk.deleteSelected', message: 'Delete selected' }),
  deleteModsTitle: (count: number) =>
    t({
      id: 'library.bulk.deleteModsTitle',
      message: `Delete ${count} mod(s)?`,
    }),
  deleteModsDescription: () =>
    t({
      id: 'library.bulk.deleteModsDescription',
      message: 'The selected mods are removed from the library on disk.',
    }),
  deleteConfirm: () =>
    t({ id: 'library.bulk.deleteConfirm', message: 'Delete' }),

  // Manage Library dialog
  manageDialogTitle: () =>
    t({ id: 'library.manage.dialogTitle', message: 'Manage Library' }),
  manageDialogDescription: () =>
    t({
      id: 'library.manage.dialogDescription',
      message: 'Configure paths for your modding libraries.',
    }),
  addLibraryTab: () =>
    t({ id: 'library.manage.addLibraryTab', message: 'Add library' }),
  selectGameRoot: () =>
    t({
      id: 'library.manage.selectGameRoot',
      message: 'Select the SPT game folder',
    }),
  identitySection: () =>
    t({ id: 'library.manage.identitySection', message: 'Library Identity' }),
  identityDescription: () =>
    t({
      id: 'library.manage.identityDescription',
      message: 'The display name for this library in your dashboard.',
    }),
  nameLabel: () => t({ id: 'library.manage.nameLabel', message: 'Name' }),
  saveName: () => t({ id: 'library.manage.saveName', message: 'Save' }),
  sptVersion: (version: string) =>
    t({ id: 'library.manage.sptVersion', message: `SPT ${version}` }),
  pathsSection: () =>
    t({ id: 'library.manage.pathsSection', message: 'Installation Paths' }),
  pathsDescription: () =>
    t({
      id: 'library.manage.pathsDescription',
      message: 'Required locations for game files and mod deployments.',
    }),
  gameRootLabel: () =>
    t({ id: 'library.manage.gameRootLabel', message: 'Game root' }),
  libraryRootLabel: () =>
    t({ id: 'library.manage.libraryRootLabel', message: 'Library root' }),
  copyPath: () => t({ id: 'library.manage.copyPath', message: 'Copy path' }),
  pathCopied: () =>
    t({ id: 'library.manage.pathCopied', message: 'Path copied' }),
  openInExplorer: () =>
    t({
      id: 'library.manage.openInExplorer',
      message: 'Open in file explorer',
    }),
  rebuildCache: () =>
    t({ id: 'library.manage.rebuildCache', message: 'Rebuild Cache' }),
  rebuildNeedsActive: () =>
    t({
      id: 'library.manage.rebuildNeedsActive',
      message: 'Activate this library to rebuild its cache',
    }),
  activate: () => t({ id: 'library.manage.activate', message: 'Activate' }),
  activated: () => t({ id: 'library.manage.activated', message: 'Activated' }),
  deleteLibrary: () =>
    t({ id: 'library.manage.deleteLibrary', message: 'Delete Library' }),
  deleteLibraryTitle: (name: string) =>
    t({ id: 'library.manage.deleteLibraryTitle', message: `Delete ${name}?` }),
  deleteLibraryDescription: () =>
    t({
      id: 'library.manage.deleteLibraryDescription',
      message: 'The library entry is removed from Modkeeper.',
    }),
  deleteFilesLabel: () =>
    t({
      id: 'library.manage.deleteFilesLabel',
      message: 'Also delete the library files on disk',
    }),
  unreadableLibrary: () =>
    t({
      id: 'library.manage.unreadableLibrary',
      message: 'Unreadable library',
    }),
  pathUnreachable: () =>
    t({ id: 'library.manage.pathUnreachable', message: 'Path unreachable' }),
  unreadableLibraryHint: () =>
    t({
      id: 'library.manage.unreadableLibraryHint',
      message:
        'This registered library could not be read. It can only be removed from the list.',
    }),
  removeEntry: () =>
    t({ id: 'library.manage.removeEntry', message: 'Remove entry' }),

  // Executable tools
  toolsSection: () =>
    t({ id: 'library.tools.section', message: 'Executable Tools' }),
  toolsDescription: () =>
    t({
      id: 'library.tools.description',
      message: "Launch utilities specific to this profile's configuration.",
    }),
  registerNewTool: () =>
    t({ id: 'library.tools.registerNewTool', message: '+ Register New Tool' }),
  launchToolLabel: (name: string) =>
    t({ id: 'library.tools.launch', message: `Launch ${name}` }),
  configureToolLabel: (name: string) =>
    t({ id: 'library.tools.configure', message: `Configure ${name}` }),
  launchingTool: (name: string) =>
    t({ id: 'library.tools.launching', message: `Launching ${name}…` }),
  toolLaunchFailed: (name: string) =>
    t({
      id: 'library.tools.launchFailed',
      message: `Could not launch ${name}`,
    }),
  toolSaved: () => t({ id: 'library.tools.saved', message: 'Tool saved' }),
  toolDeleted: () =>
    t({ id: 'library.tools.deleted', message: 'Tool deleted' }),
  configureToolTitle: () =>
    t({ id: 'library.tools.dialogTitle', message: 'Configure Tool' }),
  configureToolDescription: () =>
    t({
      id: 'library.tools.dialogDescription',
      message: 'External executable and launch parameters.',
    }),
  toolIdentity: () =>
    t({ id: 'library.tools.identity', message: 'Tool Identity' }),
  toolNamePlaceholder: () =>
    t({ id: 'library.tools.namePlaceholder', message: 'Tool name' }),
  toolIconPlaceholder: () =>
    t({
      id: 'library.tools.iconPlaceholder',
      message: 'Icon URL (optional)',
    }),
  executablePathLabel: () =>
    t({ id: 'library.tools.executablePath', message: 'Executable Path' }),
  executablePathPlaceholder: () =>
    t({
      id: 'library.tools.executablePathPlaceholder',
      message: 'System path to the target file',
    }),
  browse: () => t({ id: 'library.tools.browse', message: 'Browse' }),
  selectExecutable: () =>
    t({ id: 'library.tools.selectExecutable', message: 'Select executable' }),
  launchArgsLabel: () =>
    t({ id: 'library.tools.launchArgs', message: 'Launch Arguments' }),
  launchArgsHint: () =>
    t({
      id: 'library.tools.launchArgsHint',
      message: 'Stored, but not passed yet — launch uses the OS handler',
    }),
  deleteTool: () =>
    t({ id: 'library.tools.deleteTool', message: 'Delete Tool' }),
  saveChanges: () =>
    t({ id: 'library.tools.saveChanges', message: 'Save Changes' }),
  executable: () =>
    t({ id: 'library.tools.executable', message: 'Executable' }),
}
