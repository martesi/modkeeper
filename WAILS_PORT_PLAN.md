# Wails backend port — execution plan

Baseline: `wails/integrate` (Wails v3.1.0, go module `github.com/martes/modkeeper`).
Source of truth for behavior: `src-tauri/` (Rust, 13.2k LOC). Do not delete `src-tauri/` yet.

## Definition of done

1. All 22 frontend-visible commands are implemented in Go behind the Wails `App` service with
   Rust-equivalent semantics and the same `{code, data}` error codes.
2. `PARITY_MATRIX.md` records exact current test coverage. Several Rust tests remain unported.
3. `nix develop -c go test -p 2 ./backend/...`, `bun run check`, and
   `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/run/agent/bin/chromium bun run test:e2e` pass.
4. `nix develop -c wails3 build` passes and a native smoke proves service binding + event delivery.
5. No frontend call path requires Tauri at runtime; the in-memory mock covers every command.

## Command surface (the real contract)

Frontend calls exactly these, via `src/wails/bridge.ts` → generated `frontend/bindings/.../app.ts`.

| TS name | Go service method | Owner |
|---|---|---|
| `getLibraryWorkspace` | `GetLibraryWorkspace() (*models.LibraryWorkspace, error)` | WC |
| `createLibrary` | `CreateLibrary(models.CreateLibraryInput) (*models.LibraryWorkspace, error)` | WC |
| `activateLibrary` | `ActivateLibrary(models.ActivateLibraryInput) (*models.LibraryWorkspace, error)` | WC |
| `renameLibrary` | `RenameLibrary(models.RenameLibraryInput) (*models.LibraryWorkspace, error)` | WC |
| `deleteLibrary` | `DeleteLibrary(models.DeleteLibraryInput) (*models.LibraryWorkspace, error)` | WC |
| `bulkUpdateMods` | `BulkUpdateMods(models.BulkUpdateModsInput) (*models.LibraryWorkspace, error)` | WD |
| `syncMods` | `SyncMods(models.SyncModsInput) (*models.OperationAccepted, error)` | WD |
| `installModArchives` | `InstallModArchives(models.InstallModArchivesInput) (*models.OperationAccepted, error)` | WD |
| `cancelTask` | `CancelTask(taskID, libraryID string) error` | WD |
| `rebuildLibraryCache` | `RebuildLibraryCache(models.RebuildLibraryCacheInput) (*models.OperationAccepted, error)` | WD |
| `getSettings` | `GetSettings() (config.AppSettings, error)` | WC |
| `saveSettings` | `SaveSettings(config.AppSettings) (config.AppSettings, error)` | WC |
| `forgeSearch` | `ForgeSearch(query string, modPage, addonPage, perPage int) (json.RawMessage, bool, error)` | WB |
| `forgeModDetail` | `ForgeModDetail(modID uint32) (json.RawMessage, bool, error)` | WB |
| `forgeModVersions` | `ForgeModVersions(modID uint32) (json.RawMessage, bool, error)` | WB |
| `forgeAddonVersions` | `ForgeAddonVersions(addonID uint32) (json.RawMessage, bool, error)` | WB |
| `forgeDownloadVersion` | `ForgeDownloadVersion(input models.ForgeDownloadVersionInput) (json.RawMessage, error)` | WB |
| `openPath` | `OpenPath(path string) error` | WX (directories: `Env.OpenFileManager`; files: `Browser.OpenFile`) |
| `log` | `Log(message string) error` | WX (Wails logger file sink) |
| `selectFiles` | `SelectFiles() ([]string, error)` | Wails runtime limitation; no-op fallback |
| `setWindowEffect` | `SetWindowEffect(effect string) error` | WX |
| `getVersion` | `GetVersion() string` | WA |

Wails derives the JS name by lowercasing the first letter of the exported method, so Go names must
match the TS names exactly. `ApplyWindowEffect` remains a bound method but is a compatibility no-op;
the effect is seeded from the saved theme when the window is created. `OpenPath` sends directories
to `Env.OpenFileManager` and files to `Browser.OpenFile`. `Log` writes through the Wails application
logger, which the desktop entrypoint points at `modkeeper.log` in the config directory. The log file
is append-only and does not rotate, matching Tauri's default `KeepAll` rotation policy; it grows
across runs.

## Wire contract (`backend/models`)

Rust serde is the authority. Go structs use camelCase JSON tags. Wire enum constants use Go type-prefixed names.
`omitempty` only where Rust uses `skip_serializing_if = "Option::is_none"`.

- `models.Error{Code string, Data any}` = `SError`. Codes are the Rust variant names verbatim:
  `UnsupportedSPTVersion`, `ParseError`, `IOError`, `GameOrServerRunning`, `ProcessRunning`,
  `UnableToDetermineModId`, `ModNotFound`, `FileOrDirectoryNotFound`, `FileCollision`, `Unexpected`,
  `UnhandledCompression`, `AsyncRuntimeError`, `NoActiveLibrary`, `InvalidLibrary`,
  `ModIdConflict`, `ConfigSaveFailed`, `TaskIdInUse`, `TaskNotFound`,
  `TaskAlreadyCancelled`, `TaskNotCancellable`. Tuple variants put their fields in `Data`
  (string for single, array for `FileCollision`, 2-array for `InvalidLibrary`/`ModIdConflict`).
- `LibraryWorkspace` keys: `activeLibraryId?`, `libraries`, `modsByLibraryId`, `toolsByLibraryId`,
  `settings`, `configWarning?`.
- `LibraryEntry` is **untagged**: either a summary object or a stub object `{"path": "..."}`. The landed model implements custom `MarshalJSON`/`UnmarshalJSON`; never emit a wrapper key.
- `WorkspaceEvent` is internally tagged `type` with custom `MarshalJSON`/`UnmarshalJSON`, snake_case values
  (`cache_rebuild_completed`, `mod_install_completed`, `sync_completed`) and camelCase fields
  (`taskId`, `libraryId`, `failures`, `workspace`, `cacheStatus`).
- `TaskProgressEvent` keeps explicit `null` for `percent`/`log` (already implemented).
- Contract tests must assert exact JSON strings for the three `WorkspaceEvent` variants and both
  `LibraryEntry` variants, mirroring `models/workspace.rs` tests.

## Package layout and dependency direction

```
backend/models/        wire records, errors, JSON contract tests        (WA)
backend/testenv/       temp fixtures: game/server trees, SPT metadata   (WA)
backend/security/      mod-id validation                                (WA)
backend/config/        persisted app config                             (exists)
backend/store/         config load/save + migration                     (exists)
backend/registry/      registered libraries, task-id guard              (exists)
backend/linker/        symlink/hardlink primitives                      (exists)
backend/modfs/         mod tree scan, id/type resolution                (exists)
backend/forge/         forge HTTP client + command results              (WB)
backend/spt/           layout + version discovery, metadata precedence  (WF)
backend/deployment/    deploy/purge engine, ownership fingerprints      (WE)
backend/recovery/      deletion journal recovery                         (WE)
backend/library/       service: workspace, CRUD, sync/install/bulk       (WC/WD)
backend/task_progress/ progress event sequencing                        (exists)
```

Direction: `models` ← everything. `library` → config, store, registry, linker, modfs, spt,
deployment, recovery, task_progress. No other package imports `library`. `testenv` is imported only
by `_test.go` files.

## Authoritative interfaces

### `models` (WA)

```go
type LibraryEntry struct{ /* Summary *LibrarySummary; Stub *LibraryStub */ }
func SummaryEntry(LibrarySummary) LibraryEntry
func StubEntry(path string) LibraryEntry
type CacheState string // constants CacheStateReady, CacheStateDirty, CacheStateRebuilding, CacheStateFailed
type CacheStatus struct{ State CacheState; // enum constants are prefixed, e.g. CacheStateReady Message *string; LastRebuiltAt *string }
type ModSummary struct{ ID, LibraryID, Name string; Type ModType; // enum constants are prefixed, e.g. ModTypeServer IsEnabled bool; SourcePath, InstalledPath, InstalledAt, UpdatedAt *string /* UpdatedAt non-pointer */ ... }
type LibrarySummary struct{ ID, Name, GameRoot, LibraryRoot string; SPTVersion *string; CacheStatus CacheStatus; DeployStale bool; UpdatedAt string }
type LibraryWorkspace struct{ ActiveLibraryID *string; Libraries []LibraryEntry; ModsByLibraryID map[string][]ModSummary; ToolsByLibraryID map[string][]ToolSummary; Settings config.AppSettings; ConfigWarning *string }
type OperationAccepted struct{ Accepted bool }
type WorkspaceEvent struct{ Type string; TaskID, LibraryID string; Failures any; Workspace LibraryWorkspace; CacheStatus *CacheStatus }
type CreateLibraryInput struct{ GameRoot string; LibraryRoot *string; Name *string }
type ActivateLibraryInput struct{ LibraryID string }
type RenameLibraryInput struct{ LibraryID, Name string }
type DeleteLibraryInput struct{ LibraryID string; DeleteFiles bool }
type BulkUpdateModsInput struct{ LibraryID string; ModIDs []string; Action BulkAction }
type SyncModsInput struct{ TaskID, LibraryID string }
type InstallModArchivesInput struct{ TaskID, LibraryID string; ArchivePaths []string }
type RebuildLibraryCacheInput struct{ TaskID, LibraryID string }
type ForgeDownloadVersionInput struct{ /* mirror src-tauri/src/models/forge.rs */ }
```

Extend the existing `models.Mod` (manifest.toml fields) rather than replacing it; keep
`json:"isActive"` and `json:"type"` and the `source` default of `local`.

Library manifests are decoded strictly like Rust's `LibraryDTO`, and legacy Go manifests that lack
`repoRoot` are invalid and receive no migration because Rust has required `repo_root` since before
v0.1.0 and no Wails release shipped.

`backend.Error` becomes `type Error = models.Error` and `failure` delegates to `models.Fail`.

### `testenv` (WA)

```go
func New(t testing.TB) *Env                 // temp library root, .mod_keeper layout, SPT metadata
type Env struct{ Root, GameRoot, LibraryRoot, ModsDir, StagingDir, ServerMods, ClientPlugins string }
func (e *Env) WriteServerExe(rel ...string) // default SPT/SPT.Server.exe; supports SPT_Runtime
func (e *Env) WriteClientExe()
func (e *Env) AddMod(id, name string, kind models.ModType) string
func WriteTree(t testing.TB, dir string, files map[string]string)
func (e *Env) SettingsTOML() string
```

### `security` (WA)

```go
func ValidateModID(id string) error        // rejects "", "..", abs paths, separators, stream names
func SafeJoin(libraryModsRoot, id string) (string, error)
```

### `spt` (WF)

```go
type Rules struct{ ServerMods, ServerExe, ServerRegistry, ClientPlugins, ClientConfig string }
func Discover(gameRoot string) (Rules, error)              // SPT vs SPT_Runtime, both => ParseError
func ReadVersion(gameRoot string) (string, error)          // registry.json / metadata precedence
func ValidateVersion(rules Rules, sptVersion string) error // UnsupportedSPTVersion
func MetadataDirs(gameRoot string) []string
```

### `deployment` (WE)

```go
type Layout struct{ LibraryRoot, GameRoot string; Rules spt.Rules }
type Report struct{ Failures []models.ModFailure; Deployed int }
func Sync(ctx context.Context, layout Layout, mods []models.Mod, progress task_progress.Reporter) (Report, error)
func Purge(ctx context.Context, layout Layout, mods []models.Mod) error
func DeployStale(layout Layout, mods []models.Mod) (bool, error)
```
Safety rules that must be preserved (Rust `library.rs`/`deletion.rs`):
- refuse a recorded deployment path that resolves outside the game root or was replaced;
- preflight all removals and all protected roots before unlinking anything;
- never follow a link out of the library when purging; keep unverifiable targets;
- quarantine with bounded names; refuse retry when a quarantine/journal is orphaned;
- copy mode reuses owned directories and rejects unowned merge targets.

### `library` (WC + WD)

WC owns `Service` lifecycle, workspace assembly, CRUD, settings, cache status.
WD owns sync/install/bulk/rebuild on the same `Service` (add methods to the same struct; WC lands
first, WD rebases on `wails/wc-library-crud`).

```go
type Service struct{ /* store, client, registry, tasks */ }
func New(cfgPath string) (*Service, error)
func (s *Service) Start() error   // startup recovery + background load; never blocks on Wails
```

### `forge` (WB)

Extend the existing client; add a `Service` with the five command methods above plus
`MatchInstalledMod` if needed by library ops (WD may call `forge.Service.DownloadVersion` directly).

## Rust test parity groups

## E2E definition and install-flow coverage

E2E is tiered by the boundary under test:

| Tier | Meaning |
|---|---|
| T1 — in-process integration | Calls the bound service against a real temporary filesystem. |
| T2 — process/filesystem E2E | Kills a real helper process, starts a fresh service, and checks disk recovery. |
| T3 — native UI E2E | Drives the packaged Wails application through its real window and native bindings. |

| Required flow | Current evidence | Gap |
|---|---|---|
| 1. Create a library from a game root | `TestAppSurfaceEndToEnd` (T1); `scripts/native-t3.sh` calls the bound command (T3) | The T3 flow does not exercise the product onboarding screen or native folder picker. |
| 2. Import one archive | `TestAppSurfaceEndToEnd` (T1); `scripts/native-t3.sh` calls the bound command and checks disk (T3) | The T3 flow does not exercise the product import screen. |
| 3. Import many archives (25 minimum) | `TestInstallManyArchives` (T1); `scripts/native-t3.sh` imports 25 through real IPC (T3) | The T3 flow does not exercise the product import screen. |
| 4. Cancel mid-import and verify cleanup/reuse | `TestCancelInstallBatchCommitsCompletedArchives` (T1); native T3 cancels and checks the resulting filesystem | Native cancellation is event-driven, so the number of committed members can vary; the flow asserts a partial batch. |
| 5. Kill during import and restart | `TestInstallProcessT2Journey` (T2, real helper SIGKILL) | Native T3 does not kill/restart during import. |

Cancellation commits completed archives. Each completed archive persists the
manifest before removing its transaction marker. Cancellation discards the staged
archive in progress. The manifest therefore matches the complete mod directories.
It emits `task_cancelled` and the existing `mod_install_completed` workspace event.
An unknown or finished ID returns `TaskNotFound`. A repeated cancel returns
`TaskAlreadyCancelled`.
Sync remains cancellable through the deployment context. Cache rebuild tasks return
`TaskNotCancellable`; they do not accept a cancellation request that would be ignored.

Install recovery uses versioned `backups/<id>.install.prepared` and
`backups/<id>.install.committed` markers. A prepared marker records the previous and
new manifest entries. An upgrade also retains `backups/<id>.snapshot`. Recovery treats
a committed marker as authoritative if both marker files exist. This makes the
prepared-to-committed transition gap-free: the committed marker is written, synced,
and its directory synced before the prepared marker is removed.

Installs copy into a temporary directory under `mods/`, then rename into place. The
manifest is persisted before the committed marker is written. A prepared-only marker
restores the snapshot, or removes the new directory for a first install, and restores
the previous manifest entry. A committed marker keeps the new tree and manifest
entry. Recovery removes markers before the snapshot. A snapshot without a marker is
discarded while the destination and manifest remain authoritative. A committed marker
with a missing or non-directory destination fails closed and preserves the manifest,
markers, and snapshot for repair. Startup and library activation run recovery before
exposing a library. The first workspace waits up to nine seconds for startup recovery.
A service-level read/write lock excludes activation, creation, rename, and deletion
while a task is admitted. Task admission is nonblocking while another mutation holds
the write slot. Both paths return the typed `LibraryBusy` error, which the UI translates
to a retry message.

The recovery guarantee is for process termination, including SIGKILL, not power loss
or storage-device failure. The marker file and marker directory are synced, but copied
mod files and manifest temporary files are not all fsynced. Do not treat this protocol
as a power-loss durability guarantee.

Legacy or invalid markers fail closed. Recovery does not change their marker, snapshot,
mod tree, or manifest, and the workspace surfaces an actionable warning. Preserve the
whole library and its backups. Restore a consistent mod tree and manifest from a
trusted backup, verify the library, and only then move the invalid marker outside the
library backups directory. Do not delete or edit a marker to force recovery.

T2 is `TestInstallProcessT2Journey`. The test binary helper creates a library from a
game root, imports one archive, imports 25 archives, cancels another 25-archive batch,
then blocks at a deterministic temporary-directory-created progress point. The parent
sends SIGKILL. A fresh service loads the same library, asserts recovery and workspace/
manifest/disk consistency, and performs a follow-up install. Synchronization uses
progress and stdout, not sleeps.

| Rust suite | Go package | Owner |
|---|---|---|
| `tests/store.rs`, `tests/install_preference.rs`, `tests/installation_time.rs` | store/models | WI |
| `tests/linker.rs`, `tests/mod_fs.rs` | linker/modfs | WI |
| `tests/registry.rs` | registry | WI |
| `tests/security.rs` | security | WA |
| `tests/spt_416.rs` | spt | WF |
| `tests/library.rs` | library + deployment + recovery | WC/WD/WE |
| `core/deletion/recovery_tests.rs` | recovery | WE |
| `models/*` inline tests | models | WA |
| `core/forge.rs` inline tests | forge | WB |

Every ported test keeps the Rust test name in Go form (`test_x` → `TestX`) so the matrix can be
ticked mechanically. Mark Windows-only process tests with `if runtime.GOOS != "windows" { t.Skip }`
and keep their assertions in an injectable inspector.

## Worktree and branch status

Branches are the current work-package branches; their status here reflects the
integrated code, not whether a branch has been deleted.

| Work | Branch | Status |
|---|---|---|
| Foundation/models | `wails/wa-foundation` | integrated |
| Forge | `wails/wb-forge` | integrated |
| Library CRUD | `wails/wc-library-crud` | integrated |
| Library operations | `wails/wd-library-ops` | integrated |
| Deployment | `wails/we-deployment` | integrated |
| SPT | `wails/wf-spt` | integrated |
| Frontend | `wails/wg-frontend` | integrated |
| Native build | `wails/wh-native` | integrated |
| Parity | `wails/wi-parity` | integrated; some Rust suites still have no Go equivalent |
| Recovery | `wails/wk-recovery` | integrated |
| Staging | `wails/wl-staging` | integrated |
| Process checks | `wails/wq-process` | integrated |
| Platform | `wails/wx-platform` | integrated |
| Documentation | `wails/wp-docs` | current |

Merged delivery summary: `wails/wa-foundation` established models, config, store, registry,
security and fixtures; `wails/wb-forge` added Forge client and commands; `wails/wc-library-crud`
added workspace, settings and library CRUD; `wails/wd-library-ops` added install, bulk actions,
sync and cache rebuild; `wails/we-deployment` added owned deployment and purge; `wails/wf-spt`
added SPT layout and metadata inspection; `wails/wg-frontend` added the Wails bridge and UI;
`wails/wh-native` added native builds and smoke coverage; `wails/wi-parity` added parity tests;
`wails/wk-recovery` added journal recovery; `wails/wl-staging` added safe archive staging;
`wails/wq-process` added process checks; `wails/wx-platform` added platform abstraction.

Remaining gaps: Windows junction behavior is not proven equivalent; inspecting a real SPT
installation remains opt-in; the server build has no user desktop, so `OpenPath` returns a typed
error there. Wails applies the Windows backdrop when it creates the window, so later theme changes
do not re-apply it.

macOS backdrop decision: the macOS backdrop/translucency is intentionally omitted and the window
keeps a solid background. Wails v3.1.0 needs `-tags private_mac_apis` for webview transparency
(`mac_public_api_darwin.go` makes the transparency call a no-op without it), no build path passes
that tag, and the effect cannot be verified on macOS hardware here. Keep the solid background until
a tagged macOS build is proven end to end.

## Work protocol

- One branch per work package, based on `wails/integrate`. Never touch `main`.
- Rebase or merge `wails/integrate` if it moves; resolve conflicts toward the plan above.
- Heavy jobs serialize (`GOGC=20 GOMAXPROCS=2`, `go test -p 2`) to avoid OOM.
- Run `gofmt` and `go vet ./backend/...` before handoff.
- Commit on your branch and report: branch, commit SHA, files added, gate results, matrix rows done.
