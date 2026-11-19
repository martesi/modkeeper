# Rust-to-Go test parity matrix

Status is `pending-backend` until the Go package/API exists. Proposed Go names use Go test convention `Test` + Rust test name converted to PascalCase. Fixtures are described in `wails-testplan/fixtures.md`.

Sibling-worktree check found W2's partial Go backend at
`/agt/xdg/data/opencode/worktree/faf48e/wails-w2-registry/backend`:
`config`, `store`, `forge`, and `registry` source plus a nested `go.mod`.
This backend is not in this worktree. W4 has only a `go.mod` scaffold and no
Go source. Tests against the sibling packages cannot be compiled from this
worktree without copying backend packages or adding a cross-worktree dependency;
both would violate the isolation/no-duplication constraints. The two smallest
store parity candidates are `test_load_missing_file_yields_default` and
`test_save_round_trip`; add them when W2's backend is merged into this tree.

## Readiness checklist

- [ ] Backend package/API is merged into this worktree; retain its nested Go
  module instead of adding a root `go.mod`.
- [ ] Resolve package ownership with W1/W2 before adding `*_parity_test.go`.
- [ ] Start with missing-config default and config save/load round-trip parity.
- [ ] Reuse `t.TempDir`, synthetic SPT metadata, local fixture files, and fake
  transports from `wails-testplan/fixtures.md`.
- [ ] Keep platform-specific process/link tests behind explicit capability
  checks; do not relax their safety assertions.
- [ ] Run Go tests package-by-package first, then the full backend suite.
- [ ] Keep `bun run check` green after frontend test changes.

## `src-tauri/tests/common/mod.rs`

Fixture/assertion summary: shared temp game/repo roots; dummy game/server executables and SPT 4 registry JSON; create_test_mod makes server/client tree. No standalone tests.

| Rust helper | Proposed Go fixture helper | Status | Notes |
|---|---|---|---|
| `setup_test_env` | `testenv.NewGameLibrary` | pending-backend | Canonical temp roots, executable stubs, SPT metadata |
| `create_test_mod` | `testenv.WriteModTree` | pending-backend | Parameterize server/client tree |

## `src-tauri/tests/install_preference.rs`

Fixture/assertion summary: TOML settings defaults/round-trip; temp game/repo plus server mod tree; checks enabled defaults, install/update state persistence, local overwrite clears Forge metadata.

| Rust test | Proposed Go package/test | Status | Fixtures / assertions to preserve |
|---|---|---|---|
| `install_preference_defaults_and_round_trips` | `backend/install_preference.TestInstallPreferenceDefaultsAndRoundTrips` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `install_preference_applies_to_new_mods_and_preserves_updates` | `backend/install_preference.TestInstallPreferenceAppliesToNewModsAndPreservesUpdates` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `local_overwrite_clears_forge_identity_metadata` | `backend/install_preference.TestLocalOverwriteClearsForgeIdentityMetadata` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |

## `src-tauri/tests/installation_time.rs`

Fixture/assertion summary: temp library + server mod tree; validates optional legacy timestamp, install timestamp preservation through update/toggle/cache rebuild/reload/workspace DTO, folder-time fallback read-only, hash-driven cache rename.

| Rust test | Proposed Go package/test | Status | Fixtures / assertions to preserve |
|---|---|---|---|
| `legacy_mod_manifests_remain_readable` | `backend/installation_time.TestLegacyModManifestsRemainReadable` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `install_time_survives_updates_toggles_rebuilds_and_reload` | `backend/installation_time.TestInstallTimeSurvivesUpdatesTogglesRebuildsAndReload` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `legacy_folder_time_is_exposed_read_only_and_preserved_on_update` | `backend/installation_time.TestLegacyFolderTimeIsExposedReadOnlyAndPreservedOnUpdate` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_cache_rebuild_renames_mismatched_folder` | `backend/installation_time.TestTestCacheRebuildRenamesMismatchedFolder` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |

## `src-tauri/tests/library.rs`

Fixture/assertion summary: shared setup_test_env, config/instance handles, staged mods; temp files, symlinks/junctions, forged manifests, redirected paths, permission cases, copy/deploy snapshots and journals; checks create/load/sync/deploy/purge safety, persistence, workspace events/state. See test names below; test-specific assertions in function intent.

| Rust test | Proposed Go package/test | Status | Fixtures / assertions to preserve |
|---|---|---|---|
| `test_library_init_and_add_mod` | `backend/library.TestTestLibraryInitAndAddMod` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_default_library_root_stores_relative_game_root` | `backend/library.TestTestDefaultLibraryRootStoresRelativeGameRoot` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `default_library_root_moves_to_a_versioned_root_after_an_spt_major_change` | `backend/library.TestDefaultLibraryRootMovesToAVersionedRootAfterAnSptMajorChange` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `deleting_a_cross_major_library_blocks_on_an_unverifiable_copy` | `backend/library.TestDeletingACrossMajorLibraryBlocksOnAnUnverifiableCopy` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `deleting_a_cross_major_library_refuses_a_replaced_deployment` | `backend/library.TestDeletingACrossMajorLibraryRefusesAReplacedDeployment` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `deleting_a_library_refuses_a_deployment_path_redirected_within_the_game_root` | `backend/library.TestDeletingALibraryRefusesADeploymentPathRedirectedWithinTheGameRoot` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `updating_a_deployed_mod_refreshes_and_removal_unlinks_stale_copies` | `backend/library.TestUpdatingADeployedModRefreshesAndRemovalUnlinksStaleCopies` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `sync_preflights_changed_removals_before_purging_recorded_links` | `backend/library.TestSyncPreflightsChangedRemovalsBeforePurgingRecordedLinks` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `removing_a_mod_refuses_a_deployment_path_redirected_within_the_game_root` | `backend/library.TestRemovingAModRefusesADeploymentPathRedirectedWithinTheGameRoot` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `sync_refuses_redirected_recorded_directories_when_artifacts_are_missing` | `backend/library.TestSyncRefusesRedirectedRecordedDirectoriesWhenArtifactsAreMissing` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `removing_a_mod_preflights_shared_directories_before_unlinking_artifacts` | `backend/library.TestRemovingAModPreflightsSharedDirectoriesBeforeUnlinkingArtifacts` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `purge_preflights_all_protected_roots_before_traversal` | `backend/library.TestPurgePreflightsAllProtectedRootsBeforeTraversal` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `purge_preflights_all_walks_before_unlinking_links` | `backend/library.TestPurgePreflightsAllWalksBeforeUnlinkingLinks` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `purge_resolves_relative_link_targets_from_the_link_parent` | `backend/library.TestPurgeResolvesRelativeLinkTargetsFromTheLinkParent` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `purge_keeps_dangling_external_targets_unverified` | `backend/library.TestPurgeKeepsDanglingExternalTargetsUnverified` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `purge_handles_non_utf8_link_targets_without_recreating_them` | `backend/library.TestPurgeHandlesNonUtf8LinkTargetsWithoutRecreatingThem` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `purge_handles_long_link_names_with_a_bounded_quarantine_name` | `backend/library.TestPurgeHandlesLongLinkNamesWithABoundedQuarantineName` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `purge_blocks_an_orphaned_quarantine_link_on_retry` | `backend/library.TestPurgeBlocksAnOrphanedQuarantineLinkOnRetry` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `purge_blocks_a_retained_recovery_manifest_on_retry` | `backend/library.TestPurgeBlocksARetainedRecoveryManifestOnRetry` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `purge_keeps_a_recovery_manifest_when_its_quarantine_is_missing` | `backend/library.TestPurgeKeepsARecoveryManifestWhenItsQuarantineIsMissing` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `purge_preflights_link_parent_permissions_before_unlinking` | `backend/library.TestPurgePreflightsLinkParentPermissionsBeforeUnlinking` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `purge_handles_chained_junctions_during_quarantine` | `backend/library.TestPurgeHandlesChainedJunctionsDuringQuarantine` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `deleting_a_library_validates_purge_before_removing_deployment` | `backend/library.TestDeletingALibraryValidatesPurgeBeforeRemovingDeployment` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `deleting_a_library_validates_purge_walks_before_removing_deployment` | `backend/library.TestDeletingALibraryValidatesPurgeWalksBeforeRemovingDeployment` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `retiring_reconciled_records_prevents_old_library_replay` | `backend/library.TestRetiringReconciledRecordsPreventsOldLibraryReplay` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `creating_a_new_major_library_allows_an_already_removed_old_tree` | `backend/library.TestCreatingANewMajorLibraryAllowsAnAlreadyRemovedOldTree` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `cross_major_migration_purges_legacy_links_from_the_old_server_root` | `backend/library.TestCrossMajorMigrationPurgesLegacyLinksFromTheOldServerRoot` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `readding_a_game_root_reuses_a_compatible_versioned_library_after_a_patch_change` | `backend/library.TestReaddingAGameRootReusesACompatibleVersionedLibraryAfterAPatchChange` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_collision_detection` | `backend/library.TestTestCollisionDetection` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_recursive_linking_logic` | `backend/library.TestTestRecursiveLinkingLogic` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_purge_removes_deactivated_mods` | `backend/library.TestTestPurgeRemovesDeactivatedMods` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_copy_deployment_reuses_owned_directories_and_normalizes_legacy_paths` | `backend/library.TestTestCopyDeploymentReusesOwnedDirectoriesAndNormalizesLegacyPaths` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_legacy_copy_deployment_fingerprints_are_migrated_on_load` | `backend/library.TestTestLegacyCopyDeploymentFingerprintsAreMigratedOnLoad` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_copy_deployment_merges_into_existing_game_directory` | `backend/library.TestTestCopyDeploymentMergesIntoExistingGameDirectory` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_unowned_deployment_target_is_preserved_and_blocks_sync` | `backend/library.TestTestUnownedDeploymentTargetIsPreservedAndBlocksSync` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_to_dto_uses_hash_id` | `backend/library.TestTestToDtoUsesHashId` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_upgrade_success_leaves_no_snapshot` | `backend/library.TestTestUpgradeSuccessLeavesNoSnapshot` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_upgrade_snapshot_restores_prior_contents` | `backend/library.TestTestUpgradeSnapshotRestoresPriorContents` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_untracked_file_safety_in_shared_folder` | `backend/library.TestTestUntrackedFileSafetyInSharedFolder` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_persistence_cycle` | `backend/library.TestTestPersistenceCycle` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_mod_id_case_normalization` | `backend/library.TestTestModIdCaseNormalization` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_derive_library_root` | `backend/library.TestTestDeriveLibraryRoot` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_validate_library_structure_valid` | `backend/library.TestTestValidateLibraryStructureValid` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_validate_library_structure_missing_manifest` | `backend/library.TestTestValidateLibraryStructureMissingManifest` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_validate_library_structure_missing_directory` | `backend/library.TestTestValidateLibraryStructureMissingDirectory` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_cache_rebuild_conflict_error` | `backend/library.TestTestCacheRebuildConflictError` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_create_library_registers_and_activates` | `backend/library.TestTestCreateLibraryRegistersAndActivates` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_create_library_adopts_existing_id` | `backend/library.TestTestCreateLibraryAdoptsExistingId` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_create_library_invalid_existing_dir_fails` | `backend/library.TestTestCreateLibraryInvalidExistingDirFails` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_activate_library_by_id` | `backend/library.TestTestActivateLibraryById` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_activate_unsupported_spt_version_fails_only_on_activate` | `backend/library.TestTestActivateUnsupportedSptVersionFailsOnlyOnActivate` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_rename_library_active_and_inactive` | `backend/library.TestTestRenameLibraryActiveAndInactive` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_delete_library_entry_keeps_files` | `backend/library.TestTestDeleteLibraryEntryKeepsFiles` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_delete_library_files_removes_directory` | `backend/library.TestTestDeleteLibraryFilesRemovesDirectory` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `deleting_a_library_keeps_files_when_config_save_fails` | `backend/library.TestDeletingALibraryKeepsFilesWhenConfigSaveFails` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `deleting_a_library_leaves_nonempty_recorded_directories_in_place` | `backend/library.TestDeletingALibraryLeavesNonemptyRecordedDirectoriesInPlace` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_delete_library_unregistered_id_fails` | `backend/library.TestTestDeleteLibraryUnregisteredIdFails` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_bulk_update_sets_stale_and_never_deploys` | `backend/library.TestTestBulkUpdateSetsStaleAndNeverDeploys` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_bulk_update_rejects_non_active_library` | `backend/library.TestTestBulkUpdateRejectsNonActiveLibrary` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_bulk_update_delete_removes_mod` | `backend/library.TestTestBulkUpdateDeleteRemovesMod` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_overlapping_mod_writes_settle_to_a_requested_state` | `backend/library.TestTestOverlappingModWritesSettleToARequestedState` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_assembly_unreadable_manifest_is_path_only_stub` | `backend/library.TestTestAssemblyUnreadableManifestIsPathOnlyStub` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_assembly_reports_mods_and_deploy_stale` | `backend/library.TestTestAssemblyReportsModsAndDeployStale` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |

## `src-tauri/tests/linker.rs`

Fixture/assertion summary: temp source/target files and dirs; checks symlink/hardlink content and target, unlink preserves source, idempotence, collision AlreadyExists, missing unlink.

| Rust test | Proposed Go package/test | Status | Fixtures / assertions to preserve |
|---|---|---|---|
| `test_file_symlink` | `backend/linker.TestTestFileSymlink` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_directory_link` | `backend/linker.TestTestDirectoryLink` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_unlink_logic` | `backend/linker.TestTestUnlinkLogic` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_link_already_exists_correctly` | `backend/linker.TestTestLinkAlreadyExistsCorrectly` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_collision_detection` | `backend/linker.TestTestCollisionDetection` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_unlink_non_existent_path` | `backend/linker.TestTestUnlinkNonExistentPath` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_hardlink_create_and_remove` | `backend/linker.TestTestHardlinkCreateAndRemove` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |

## `src-tauri/tests/mod_fs.rs`

Fixture/assertion summary: temp server/client SPT trees; checks hashed ID/type, ignored non-DLL, executable scan, recursive overwrite, invalid structure error, deterministic ordering.

| Rust test | Proposed Go package/test | Status | Fixtures / assertions to preserve |
|---|---|---|---|
| `test_resolve_id_server_only` | `backend/mod_fs.TestTestResolveIdServerOnly` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_resolve_id_client_only` | `backend/mod_fs.TestTestResolveIdClientOnly` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_resolve_id_combined` | `backend/mod_fs.TestTestResolveIdCombined` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_resolve_id_ignores_non_dll_in_client_plugins` | `backend/mod_fs.TestTestResolveIdIgnoresNonDllInClientPlugins` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_executables_detection` | `backend/mod_fs.TestTestExecutablesDetection` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_copy_recursive_overwrite_and_deep_nesting` | `backend/mod_fs.TestTestCopyRecursiveOverwriteAndDeepNesting` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_new_fails_for_invalid_structure` | `backend/mod_fs.TestTestNewFailsForInvalidStructure` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_deterministic_id_sorting` | `backend/mod_fs.TestTestDeterministicIdSorting` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |

## `src-tauri/tests/registry.rs`

Fixture/assertion summary: temp config + dummy library; in-memory AppRegistry and watch channel; task-ID exclusion/reuse, active-library validation, startup wait notification. Two process-inspection tests are Windows-only.

| Rust test | Proposed Go package/test | Status | Fixtures / assertions to preserve |
|---|---|---|---|
| `startup_library_waits_for_background_load_completion` | `backend/registry.TestStartupLibraryWaitsForBackgroundLoadCompletion` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_task_id_in_use_rejected_until_finished` | `backend/registry.TestTestTaskIdInUseRejectedUntilFinished` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_assert_active_library_rejects_non_active` | `backend/registry.TestTestAssertActiveLibraryRejectsNonActive` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_process_guard_detects_running_process` | `backend/registry.TestTestProcessGuardDetectsRunningProcess` | pending-backend | Windows-only process API; use OS guard/injected process inspector. |
| `test_process_initialization_failure_does_not_report_safe_to_deploy` | `backend/registry.TestTestProcessInitializationFailureDoesNotReportSafeToDeploy` | pending-backend | Windows-only process API; use OS guard/injected process inspector. |

## `src-tauri/tests/security.rs`

Fixture/assertion summary: temp library and outside sentinel file; unknown ID and traversal/absolute/stream-like forged IDs must error without touching external files.

| Rust test | Proposed Go package/test | Status | Fixtures / assertions to preserve |
|---|---|---|---|
| `deleting_unknown_or_unsafe_mod_ids_preserves_external_files` | `backend/security.TestDeletingUnknownOrUnsafeModIdsPreservesExternalFiles` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |

## `src-tauri/tests/spt_416.rs`

Fixture/assertion summary: temp game trees for SPT/SPT_Runtime + JSON deps metadata; ZIP and directory packages; validates SPT 4/5 import/deploy/remove, collisions, version mismatch, layout rediscovery, staging roots, metadata precedence/invalid data, ambiguous roots. Real-install inspection is ignored and requires installed SPT.

| Rust test | Proposed Go package/test | Status | Fixtures / assertions to preserve |
|---|---|---|---|
| `spt_416_imports_deploys_and_removes_mods` | `backend/spt_416.TestSpt416ImportsDeploysAndRemovesMods` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `spt_500_runtime_layout_imports_and_deploys_mods` | `backend/spt_416.TestSpt500RuntimeLayoutImportsAndDeploysMods` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `loading_a_4x_library_rejects_an_spt_5_installation` | `backend/spt_416.TestLoadingA4xLibraryRejectsAnSpt5Installation` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `syncing_an_open_4x_library_rejects_an_spt_5_installation` | `backend/spt_416.TestSyncingAnOpen4xLibraryRejectsAnSpt5Installation` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `syncing_rediscovers_the_server_layout_before_version_validation` | `backend/spt_416.TestSyncingRediscoversTheServerLayoutBeforeVersionValidation` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `staging_accepts_old_and_new_roots_without_mutating_source` | `backend/spt_416.TestStagingAcceptsOldAndNewRootsWithoutMutatingSource` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `server_metadata_takes_precedence_and_invalid_data_is_rejected` | `backend/spt_416.TestServerMetadataTakesPrecedenceAndInvalidDataIsRejected` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `ambiguous_server_roots_are_rejected` | `backend/spt_416.TestAmbiguousServerRootsAreRejected` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `inspect_real_installation_read_only` | `backend/spt_416.TestInspectRealInstallationReadOnly` | pending-backend | Headless-inapplicable; keep opt-in only, requires real SPT installation. |

## `src-tauri/tests/store.rs`

Fixture/assertion summary: temp TOML configs/libraries; migration adopts manifest IDs or mints for unreadable/missing manifests, defaults for missing/partial config, corrupt file preserved, save roundtrip/atomic cleanup/failure preservation, find/delete handles and unknown-handle error.

| Rust test | Proposed Go package/test | Status | Fixtures / assertions to preserve |
|---|---|---|---|
| `test_migration_adopts_manifest_ids` | `backend/store.TestTestMigrationAdoptsManifestIds` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_migration_mints_id_only_without_readable_manifest` | `backend/store.TestTestMigrationMintsIdOnlyWithoutReadableManifest` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_load_missing_file_yields_default` | `backend/store.TestTestLoadMissingFileYieldsDefault` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_missing_accent_field_defaults_to_default` | `backend/store.TestTestMissingAccentFieldDefaultsToDefault` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_load_corrupt_file_errors_and_leaves_file_untouched` | `backend/store.TestTestLoadCorruptFileErrorsAndLeavesFileUntouched` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_save_round_trip` | `backend/store.TestTestSaveRoundTrip` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_saved_pink_accent_round_trips_unchanged` | `backend/store.TestTestSavedPinkAccentRoundTripsUnchanged` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_save_failure_surfaces_config_save_failed_and_preserves_target` | `backend/store.TestTestSaveFailureSurfacesConfigSaveFailedAndPreservesTarget` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_find_library_by_handle_matches_id_or_path` | `backend/store.TestTestFindLibraryByHandleMatchesIdOrPath` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_delete_library_entry_accepts_path_handle` | `backend/store.TestTestDeleteLibraryEntryAcceptsPathHandle` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `test_delete_library_entry_rejects_unknown_handle` | `backend/store.TestTestDeleteLibraryEntryRejectsUnknownHandle` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |

## `src-tauri/src/core/deletion/recovery_tests.rs`

Fixture/assertion summary: temp config, journal TOML and quarantine objects; registered staged recovery restores original, committed recovery deletes quarantine, conflicting library and missing config block recovery and preserve journal/quarantine, missing config directory is ignored.

| Rust test | Proposed Go package/test | Status | Fixtures / assertions to preserve |
|---|---|---|---|
| `recovery_restores_staged_objects_for_registered_library` | `backend/recovery.TestRecoveryRestoresStagedObjectsForRegisteredLibrary` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `recovery_finishes_committed_cleanup_for_unregistered_library` | `backend/recovery.TestRecoveryFinishesCommittedCleanupForUnregisteredLibrary` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `recovery_blocks_a_different_library_claiming_the_same_root` | `backend/recovery.TestRecoveryBlocksADifferentLibraryClaimingTheSameRoot` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `recovery_ignores_a_missing_config_directory` | `backend/recovery.TestRecoveryIgnoresAMissingConfigDirectory` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
| `recovery_blocks_a_journal_when_the_config_file_is_missing` | `backend/recovery.TestRecoveryBlocksAJournalWhenTheConfigFileIsMissing` | pending-backend | Use suite fixture; retain named behavior and negative-path assertions. |
