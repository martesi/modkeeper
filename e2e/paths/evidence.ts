import type { Evidence, TestRef } from './model-types'

const go = (name: string, pkg = 'backend'): TestRef => ({
  kind: 'go',
  package: pkg,
  name,
})
const mock = (name: string, spec = 'mock-workflows'): TestRef => ({
  kind: 'playwright',
  file: `e2e/playwright/${spec}.spec.ts`,
  name,
})
const native = (name: string, file = 'scripts/native-smoke.sh'): TestRef => ({
  kind: 'native',
  file,
  name,
})

const appJourney = go('TestAppSurfaceEndToEnd')
const processJourney = go('TestInstallProcessT2Journey')
const upgradeProcessJourney = go('TestInstallProcessT2UpgradeJourney')
const upgradePersistCrash = go(
  'TestCrashAfterInstallManifestPersistRollsBackFilesAndMetadata',
  'backend/library',
)
const recoveryCleanupCrash = go(
  'TestCrashDuringInstallRecoveryCleanupIsIdempotent',
  'backend/library',
)
const syncCrash = go('TestSyncProcessT2CrashAfterMutation')
const purgeCrash = go('TestPurgeProcessT2CrashAfterQuarantine')
const startupRecovery = go('TestStartRecoversInterruptedInstallArtifacts')
const cancelUI = mock(
  'running install task exposes a cancel action',
  'task-center',
)
const settings = go(
  'TestConfigStoreRoundTripAndLegacyDefaults',
  'backend/registry',
)
const forgeSearch = mock('forge search has fixture results and empty state')
const bulkUI = mock('bulk mod actions update enabled state')
const themeUI = mock('settings theme and accent persist after reload')

export const evidence: readonly Evidence[] = [
  covered('onboarding.empty-config.first-launch.backend-api', [
    go('TestTestLoadMissingFileYieldsDefault', 'backend/store'),
  ]),
  covered('onboarding.existing-config.saved-workspace.linux-process', [
    processJourney,
  ]),
  covered(
    'onboarding.existing-config.saved-workspace.browser-mock',
    [mock('workspace renders fixture library and mods')],
    true,
  ),
  covered('onboarding.corrupt-config.invalid-file.backend-api', [
    go(
      'TestCorruptConfigPreservedAndFailedSaveDoesNotMutate',
      'backend/registry',
    ),
  ]),
  covered('onboarding.unsupported-spt.configured-library.backend-api', [
    go(
      'TestTestActivateUnsupportedSptVersionFailsOnlyOnActivate',
      'backend/library',
    ),
  ]),
  covered('library.create-default-root.first-launch.backend-api', [
    go('TestTestCreateLibraryRegistersAndActivates', 'backend/library'),
  ]),
  covered('library.create-default-root.existing-root.backend-api', [
    go('TestTestCreateLibraryAdoptsExistingId', 'backend/library'),
  ]),
  covered('library.create-custom-root.first-launch.backend-api', [appJourney]),
  partial(
    'library.create-custom-root.first-launch.native-linux',
    [native('PASS native backend archive journeys', 'scripts/native-t3.sh')],
    'A query-gated test panel calls CreateLibrary directly. The run proves real Wails IPC and filesystem setup, not product onboarding or the native folder picker.',
  ),
  covered('library.create-from-typed-game-root.active-library.browser-mock', [
    mock('create library and activate it'),
  ]),
  covered('library.activate.inactive-library.backend-api', [
    go('TestTestActivateLibraryById', 'backend/library'),
    go(
      'TestActivateInactiveLibraryRecoversInterruptedInstall',
      'backend/library',
    ),
  ]),
  partial(
    'library.activate.inactive-library.browser-mock',
    [mock('create library and activate it')],
    'The activation button changes state for a seeded library; the spec does not verify the resulting workspace.',
  ),
  ...['active-library', 'inactive-library'].map((context) =>
    covered(`library.rename.${context}.backend-api`, [
      go('TestTestRenameLibraryActiveAndInactive', 'backend/library'),
    ]),
  ),
  covered('library.delete-keep-files.active-library.backend-api', [
    go('TestTestDeleteLibraryEntryKeepsFiles', 'backend/library'),
  ]),
  covered('library.delete-files.active-library.backend-api', [
    go('TestTestDeleteLibraryFilesRemovesDirectory', 'backend/library'),
  ]),
  covered('library.delete-files.config-write-fails.backend-filesystem', [
    go('TestDeletingALibraryKeepsFilesWhenConfigSaveFails', 'backend/library'),
  ]),
  covered('library.cross-major.major-changed.backend-api', [
    go(
      'TestDefaultLibraryRootMovesToAVersionedRootAfterAnSptMajorChange',
      'backend/library',
    ),
  ]),
  covered('import.one-archive.empty-library.backend-api', [appJourney]),
  partial(
    'import.one-archive.empty-library.native-linux',
    [native('PASS native backend archive journeys', 'scripts/native-t3.sh')],
    'A query-gated test panel calls InstallModArchives directly and checks archive output on disk. It does not exercise the product import screen.',
  ),
  gap(
    'import.switch-library-during-install.switch-during-install.backend-filesystem',
    'No integration test switches the active library while an admitted install runs. The install worker still reads the mutable active-library pointer, so library association is not proven.',
  ),
  covered('import.typed-paths.populated-library.browser-mock', [
    mock('archive import accepts typed paths and starts the install flow'),
  ]),
  covered('import.many-25.empty-library.backend-api', [
    go('TestInstallManyArchives'),
  ]),
  partial(
    'import.many-25.empty-library.native-linux',
    [native('PASS native backend archive journeys', 'scripts/native-t3.sh')],
    'A query-gated panel submits 25 archives through IPC. The test checks aggregate counts and selected boundary files, not all 25 rows or the product import screen.',
  ),
  partial(
    'import.many-25.populated-library.linux-process',
    [processJourney],
    'Asserts the aggregate count after all batches and restart, not the 25 individual IDs.',
  ),
  covered('import.upgrade-same-id.existing-mod.backend-api', [
    go('TestInstallUpgradeLeavesNoSnapshot'),
  ]),
  covered('import.install-on-true.empty-library.backend-api', [appJourney]),
  partial(
    'import.install-on-false.empty-library.backend-api',
    [
      go(
        'TestInstallPreferenceAppliesToNewModsAndPreservesUpdates',
        'backend/models',
      ),
    ],
    'The model applies the setting, but no archive goes through the full importer with it off.',
  ),
  covered('import.cancel-mid-batch.new-batch.backend-filesystem', [
    go('TestCancelInstallBatchCommitsCompletedArchives'),
  ]),
  partial(
    'import.cancel-mid-batch.new-batch.native-linux',
    [native('PASS native backend archive journeys', 'scripts/native-t3.sh')],
    'The test-only panel calls CancelTask through real Wails IPC and verifies that a partial batch reaches disk. IPC scheduling makes the committed count variable; it does not test the product import screen.',
  ),
  partial(
    'import.cancel-mid-batch.new-batch.linux-process',
    [processJourney],
    'Asserts committed mod count after restart and follow-up import, not the cancellation result event.',
  ),
  partial(
    'import.cancel-mid-batch.new-batch.browser-mock',
    [cancelUI],
    'The click reaches CancelTask with both IDs; mock cancellation does not verify retained files or a follow-up import.',
  ),
  covered('import.kill-fresh-import.populated-library.linux-process', [
    processJourney,
  ]),
  gap(
    'import.kill-mid-batch.partly-committed-batch.linux-process',
    'The process test kills a final one-archive task, not a partly committed task.',
  ),
  partial(
    'import.unsupported-compression.empty-library.backend-api',
    [
      go(
        'TestExtractMalformedAndUnsupportedLeaveDestinationUntouched',
        'backend/archive',
      ),
    ],
    'Tests the extractor; does not assert the importer result or workspace.',
  ),
  covered('mod.bulk-enable.single-mod.backend-api', [
    go('TestTestBulkUpdateSetsStaleAndNeverDeploys', 'backend/library'),
    appJourney,
  ]),
  partial(
    'mod.bulk-enable.selection.browser-mock',
    [bulkUI],
    'The server mod becomes enabled; the assertion does not check every selected mod.',
  ),
  covered('mod.bulk-disable.single-mod.backend-api', [appJourney]),
  partial(
    'mod.bulk-disable.selection.browser-mock',
    [bulkUI],
    'The server mod becomes disabled; the assertion does not check every selected mod.',
  ),
  partial(
    'mod.bulk-delete.single-mod.backend-api',
    [go('TestTestBulkUpdateDeleteRemovesMod', 'backend/library')],
    'Checks removal from the library model, not the returned workspace.',
  ),
  covered('mod.rebuild-cache.empty-library.backend-api', [appJourney]),
  partial(
    'mod.folder-rename.mismatched-folder.backend-filesystem',
    [go('TestTestCacheRebuildRenamesMismatchedFolder', 'backend/library')],
    'Asserts a real rename through the normalizer, not through a rebuild task.',
  ),
  covered('deploy.first-sync.enabled-mod.backend-api', [appJourney], true),
  covered('deploy.noop-sync.unchanged-plan.backend-filesystem', [
    go(
      'TestTestCopyDeploymentReusesOwnedDirectoriesAndNormalizesLegacyPaths',
      'backend/deployment',
    ),
  ]),
  covered('deploy.sync-after-toggle.previous-sync.backend-filesystem', [
    go('TestTestPurgeRemovesDeactivatedMods', 'backend/deployment'),
  ]),
  partial(
    'deploy.sync-after-toggle.shared-game-tree.backend-filesystem',
    [go('TestTestUntrackedFileSafetyInSharedFolder', 'backend/deployment')],
    'Checks deployed removal and surviving game data, but not the source library after sync.',
  ),
  covered('deploy.collision.shared-game-tree.backend-filesystem', [
    go(
      'TestTestUnownedDeploymentTargetIsPreservedAndBlocksSync',
      'backend/deployment',
    ),
  ]),
  covered('deploy.stale.previous-sync.backend-api', [
    go('TestReloadingALibraryRefreshesDeployStale', 'backend/deployment'),
  ]),
  partial(
    'deploy.purge.legacy-links.backend-filesystem',
    [
      go('TestPurgeNeverFollowsExternalDirectoryLinks', 'backend/deployment'),
      go(
        'TestCrossMajorMigrationPurgesLegacyLinksFromTheOldServerRoot',
        'backend/library',
      ),
    ],
    'Asserts external protection and legacy cleanup in separate fixtures.',
  ),
  covered('deploy.copy-mode.shared-game-tree.backend-filesystem', [
    go(
      'TestTestCopyDeploymentMergesIntoExistingGameDirectory',
      'backend/deployment',
    ),
  ]),
  covered('deploy.link-mode.shared-game-tree.backend-filesystem', [
    go('TestTestRecursiveLinkingLogic', 'backend/deployment'),
  ]),
  covered('deploy.task-progress.task-progress-fixture.browser-mock', [
    mock('task center opens and displays progress and its log', 'task-center'),
  ]),
  covered('forge.search-results.active-library.browser-mock', [forgeSearch]),
  covered('forge.search-empty.active-library.browser-mock', [forgeSearch]),
  covered('forge.rate-limit.rate-limited.backend-api', [
    go('TestRateLimitRetryAfterBlocksRequests', 'backend/forge'),
  ]),
  covered('forge.detail.active-library.backend-api', [
    go('TestModDetailWireUsesCamelCaseAndExplicitNulls', 'backend/forge'),
  ]),
  covered('forge.detail.addon.backend-api', [
    go('TestAddonDetailResolvesIncompleteParent', 'backend/forge'),
  ]),
  covered('forge.versions.later-page.backend-api', [
    go('TestFindVersionReadsLaterPagesAndCapsAt100', 'backend/forge'),
  ]),
  covered('forge.download.fresh-response.backend-filesystem', [
    go(
      'TestDownloadWritesBytesAndReportsProgressWithoutTouchingSourceArchive',
      'backend/forge',
    ),
  ]),
  covered('forge.download.size-mismatch.backend-filesystem', [
    go('TestDownloadSizeMismatchRemovesGeneratedArchive', 'backend/forge'),
  ]),
  partial(
    'forge.install.stale-metadata.backend-api',
    [go('TestStaleMetadataCannotInstallOrMatch', 'backend/forge')],
    'The metadata resolver rejects stale data; this does not drive the install task.',
  ),
  covered('settings.theme.open-settings.backend-api', [appJourney]),
  covered('settings.theme.after-reload.browser-mock', [themeUI]),
  gap(
    'settings.accent.after-reload.browser-mock',
    'The settings Playwright title mentions accent, but the test only asserts Dark after reload.',
  ),
  covered('settings.accent.after-reload.backend-api', [settings]),
  covered('settings.install-on.after-reload.backend-api', [settings]),
  covered('settings.persistence.after-reload.backend-api', [settings]),
  covered('settings.persistence.legacy-config.backend-api', [settings]),
  covered('recovery.crash-import-fresh.fresh-temp.linux-process', [
    processJourney,
    go(
      'TestCrashAfterFreshInstallReplacementRemovesFilesAndManifestEntry',
      'backend/library',
    ),
  ]),
  covered('recovery.crash-import-upgrade.snapshot-fixture.backend-filesystem', [
    go('TestStartRecoversInterruptedInstallArtifacts', 'backend'),
    go(
      'TestCommittedRecoveryPreservesSnapshotWhenDestinationIsUnavailable',
      'backend/library',
    ),
  ]),
  covered('recovery.stale-staging.abandoned-staging.backend-filesystem', [
    startupRecovery,
  ]),
  covered(
    'platform.native-bridge.registered-event.native-linux',
    [
      native('PASS settings JS→Go→JS value'),
      native('PASS frontend event listener ready'),
      native('PASS Go emitted registered event'),
      native('PASS event payload observed by frontend and reported to Go'),
    ],
    true,
  ),
  partial(
    'platform.native-ui.native-smoke-window.native-linux',
    [
      native(
        'PASS xdotool-driven native UI interaction',
        'scripts/native-t3.sh',
      ),
    ],
    'A test-only panel receives keyboard input and its status surface is screenshot-checked. This proves a painted native window and keyboard delivery, not a product workflow or native file-dialog test.',
  ),
  covered('recovery.crash-import-upgrade.upgrade-in-flight.linux-process', [
    upgradeProcessJourney,
    upgradePersistCrash,
    recoveryCleanupCrash,
    go(
      'TestCrashAfterCommittedMarkerKeepsUpgradeOnTwoRestarts',
      'backend/library',
    ),
  ]),
  covered('recovery.crash-sync.mid-deployment.linux-process', [syncCrash]),
  partial(
    'recovery.crash-purge.mid-quarantine.linux-process',
    [purgeCrash],
    'Kills after an owned link is moved, verifies the journal remains, then starts a new app and retries delete. The app returns the specific retained-journal refusal and preserves the external target; no recovery reconciles the quarantine.',
  ),
  gap(
    'library.delete-deployed.deployed-library.native-windows',
    'Delete with real Windows links and verify only owned game files are removed.',
    4,
  ),
  gap(
    'deploy.game-running.running-executable.native-windows',
    'Launch a real game executable and prove sync stops before any write.',
    5,
  ),
  gap(
    'deploy.server-running.running-executable.native-windows',
    'Launch a real SPT server executable and prove sync stops before any write.',
    6,
  ),
  gap(
    'deploy.link-mode.shared-game-tree.native-windows',
    'Use real Windows link and junction fixtures, not Linux symlinks.',
    7,
  ),
  gap(
    'platform.installer.previous-version.native-windows',
    'Upgrade a real Windows install and verify that existing preferences and libraries survive.',
    8,
  ),
  gap(
    'platform.installer.clean-windows.native-windows',
    'Start the installed release on a clean Windows host.',
    9,
  ),
  gap(
    'platform.webview2.prerequisite-missing.native-windows',
    'Start on a Windows host without WebView2 and verify actionable guidance.',
    10,
  ),
  gap(
    'library.create-custom-root.first-launch.browser-mock',
    'The typed-path spec enters a game root, not a custom library root.',
  ),
  gap(
    'library.tool-executable.active-library.browser-mock',
    'The tool picker shares the path dialog, but no browser test saves and verifies a tool.',
  ),
  gap(
    'import.one-archive.empty-library.browser-mock',
    'The typed-path spec submits two archives to a seeded library. It cannot prove extraction or filesystem writes.',
  ),
]

function covered(id: string, refs: readonly TestRef[], smoke?: true): Evidence {
  return { id, status: 'covered', refs, ...(smoke && { smoke }) }
}

function partial(id: string, refs: readonly TestRef[], note: string): Evidence {
  return { id, status: 'partial', refs, note }
}

function gap(id: string, note: string, priority?: number): Evidence {
  return {
    id,
    status: 'uncovered',
    refs: [],
    note,
    ...(priority && { priority }),
  }
}
