# Deployment port

## API

- `Layout{LibraryRoot, GameRoot, Rules}` and `Layout.Paths()` expose the Rust library path rules.
- `Plan(mods, layout)` probes both volumes and prefers copy mode. `PlanWithKinds` supports link fallback tests.
- `Preflight(layout, plan)` validates recorded removals, recorded directories, desired destinations, protected roots, and all compatibility purge walks.
- `Deploy(layout, plan)` reconciles artifacts and writes `deployment.toml`.
- `Purge(layout, mods)` removes compatibility links only. It does not remove recorded copies. Use an empty deployment plan to reconcile copies when no mods remain.
- `DeployStale(layout, mods)` checks recorded ownership, current source contents, and desired activation state.
- `Sync(ctx, layout, mods, Reporter)` reports the five Rust sync stages. `*task_progress.Emitter` implements `Reporter`.
- `LoadState` / `SaveState` and `LoadCache` / `SaveCache` preserve Rust TOML names. Fingerprints use BLAKE3, not a Go-specific hash.
- `ProtectedPaths` / `IsProtected` use exact protected-root equality, as Rust does.

## Safety boundaries

`contained` rejects parent redirects even when they point within the game root. Directory checks also reject a redirected final component. `preflightState` validates every recorded artifact and directory before recorded removal. Copy ownership uses the recorded destination fingerprint, so a source update can replace an old copy while a user-edited destination blocks sync.

The plan preserves the system ownership sentinel for normalized `SPT/user/mods` and `BepInEx/plugins` ancestors. Shared folders expand into separate artifacts. Existing non-protected game directories may receive absent files without claiming ownership of the game directory. Existing unowned protected mod folders block deployment.

Purge validates all protected roots before traversal, and finishes all walks before quarantine. It does not follow child links. It resolves relative targets from the link parent and retains targets that cannot be canonicalized. Native target bytes remain intact because quarantine uses rename, not link recreation. Quarantine names have a fixed bound independent of the original name. A version-2 Rust-readable journal is synced before renames. The full quarantine batch is checked before unlink; each object is checked again immediately before unlink. Rollback restores original objects. A retained journal or orphaned `.mkp-` link blocks retry. Recovery of retained state belongs to `backend/recovery`.

Legacy absolute directory records normalize on load. Missing copy fingerprints are migrated only when regular destination and source files still match. The migration writes the new deployment record.

## Integration notes

No changes to `models.Mod`, `backend/app.go`, `backend/library`, or recovery are required by this package. `models.Mod.Enabled` is the current Go name for Rust `is_active`.

The foundation on the base branch does not yet contain `models.Error` or `models.ModFailure`. This package therefore exports local `Error{Code, Data}` and `ModFailure` records. Replace these with aliases to the foundation records during integration. Sync is all-or-nothing: fatal errors are returned, and successful reports have an empty failure list.

The task's direct `Purge(layout, mods)` signature is used rather than the earlier plan's context-taking signature. Context cancellation is checked at sync stage boundaries. Manifest/cache rebuild, clean-state persistence, version-major validation, and service admission remain library responsibilities.

Windows junction creation depends on `backend/linker`, whose current implementation uses `os.Symlink` for junctions. This package does not claim verified native Windows junction parity. Linux synthetic-tree tests verify symlinks, copies, containment, and purge behavior. Directory fsync is skipped on Windows, matching Rust.

## Parity rows

All 19 deployment/purge test names requested for the port have Go equivalents. Eighteen run without skips. `TestTestUpgradeSuccessLeavesNoSnapshot` verifies deployment refresh and absence of a deployment-created snapshot, then skips archive-overwrite snapshot lifecycle assertions: `backend/library` archive overwrite and `mod_snapshot` belong to WI/WD.

Additional tests cover orphaned quarantine, retained journals, unlink-parent permissions, external directory links, runtime target mapping, Rust TOML field names, progress ordering, cancellation, and late destination collisions before recorded unlink.
