# Wails backend port — execution plan

Baseline: `wails/integrate` (Wails v3.1.0, go module `github.com/martes/modkeeper`).
Source of truth for behavior: `src-tauri/` (Rust, 13.2k LOC). Do not delete `src-tauri/` yet.

## Definition of done

1. All 21 frontend-visible commands are implemented in Go behind the Wails `App` service with
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
| `rebuildLibraryCache` | `RebuildLibraryCache(models.RebuildLibraryCacheInput) (*models.OperationAccepted, error)` | WD |
| `getSettings` | `GetSettings() (config.AppSettings, error)` | WC |
| `saveSettings` | `SaveSettings(config.AppSettings) (config.AppSettings, error)` | WC |
| `forgeSearch` | `ForgeSearch(query string, modPage, addonPage, perPage int) (json.RawMessage, bool, error)` | WB |
| `forgeModDetail` | `ForgeModDetail(modID uint32) (json.RawMessage, bool, error)` | WB |
| `forgeModVersions` | `ForgeModVersions(modID uint32) (json.RawMessage, bool, error)` | WB |
| `forgeAddonVersions` | `ForgeAddonVersions(addonID uint32) (json.RawMessage, bool, error)` | WB |
| `forgeDownloadVersion` | `ForgeDownloadVersion(input models.ForgeDownloadVersionInput) (json.RawMessage, error)` | WB |
| `openPath` | `OpenPath(path string) error` | Wails runtime limitation; console fallback |
| `selectFiles` | `SelectFiles() ([]string, error)` | Wails runtime limitation; no-op fallback |
| `setWindowEffect` | `SetWindowEffect(effect string) error` | WX |
| `getVersion` | `GetVersion() string` | WA |

Wails derives the JS name by lowercasing the first letter of the exported method, so Go names must
match the TS names exactly. `ApplyWindowEffect` stays as-is.

## Wire contract (`backend/models`)

Rust serde is the authority. Go structs use camelCase JSON tags. Wire enum constants use Go type-prefixed names.
`omitempty` only where Rust uses `skip_serializing_if = "Option::is_none"`.

- `models.Error{Code string, Data any}` = `SError`. Codes are the Rust variant names verbatim:
  `UnsupportedSPTVersion`, `ParseError`, `IOError`, `GameOrServerRunning`, `ProcessRunning`,
  `UnableToDetermineModId`, `ModNotFound`, `FileOrDirectoryNotFound`, `FileCollision`, `Unexpected`,
  `UnhandledCompression`, `AsyncRuntimeError`, `NoActiveLibrary`, `InvalidLibrary`,
  `ModIdConflict`, `ConfigSaveFailed`, `TaskIdInUse`. Tuple variants put their fields in `Data`
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
installation remains opt-in; the Wails runtime has no openPath or file-drop API, so those
actions are console output or no-ops rather than native integrations.

## Work protocol

- One branch per work package, based on `wails/integrate`. Never touch `main`.
- Rebase or merge `wails/integrate` if it moves; resolve conflicts toward the plan above.
- Heavy jobs serialize (`GOGC=20 GOMAXPROCS=2`, `go test -p 2`) to avoid OOM.
- Run `gofmt` and `go vet ./backend/...` before handoff.
- Commit on your branch and report: branch, commit SHA, files added, gate results, matrix rows done.
