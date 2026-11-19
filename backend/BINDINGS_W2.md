# W2 Wails binding contract

Expose these methods on the bound application service. JSON uses the existing
`src/gen/bindings.ts` camelCase field names. Go errors are returned as rejected
Wails calls; frontend adapters should normalize them to the existing `SError`
shape where required.

## W2-owned methods

| Wails method | Arguments | Result |
| --- | --- | --- |
| `GetSettings()` | none | `AppSettings` (`theme`, `accentColor`, `language`, `enableModsOnInstall`) |
| `SaveSettings(settings AppSettings)` | settings object | saved `AppSettings` |
| `ForgeSearch(query string, modPage uint32, addonPage uint32, perPage uint32)` | positional arguments | `ForgeSearchResponse` |
| `ForgeModDetail(kind ForgeKind, id uint32)` | positional arguments | `ForgeDetail` |
| `ForgeModVersions(kind ForgeKind, id uint32, page uint32)` | positional arguments | `ForgeVersionsPage` |
| `ForgeAddonVersions(id uint32, page uint32)` | positional arguments | `ForgeVersionsPage` |

`ForgeSearch` and all Forge detail/version calls require an active library with
a detectable SPT version, as in the Tauri commands. Forge cache entries are
stale only when a refresh request fails. Never cache download redirect targets.

## Shared frontend contract owned elsewhere

These names and payloads remain required for the Wails bridge, but are outside
W2's implementation: `GetLibraryWorkspace()`, `ActivateLibrary(input)`,
`CreateLibrary(input)`, `RenameLibrary(input)`, `DeleteLibrary(input)`,
`BulkUpdateMods(input)`, `SyncMods(input)`, `InstallModArchives(input)`,
`RebuildLibraryCache(input)`, `ForgeDownloadVersion(input)`,
`ForgeMatchInstalledMod(input)`, and `ApplyWindowEffect(isDark *bool)`.

Wails events use the existing event names and payloads:

- `task_progress`: `TaskProgressEvent` (`taskId`, `libraryId`, `operation`,
  `stage`, optional `percent`)
- `workspace-event`: discriminated `WorkspaceEvent` union

Do not emit different event casing; the W3 shim should subscribe under exactly
these names and translate only Wails transport details.
