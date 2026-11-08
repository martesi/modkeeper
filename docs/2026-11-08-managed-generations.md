# Managed SPT generations: phase 1 plan

Date: 8 November 2026, Asia/Shanghai.

Update: the user's accepted requirements are in [the implementation brief](2026-11-08-implementation-brief.md). Full game copies are disallowed. The CLI must run without WebView setup. Go is being tested for build-storage cost. Windows and WSL execution are required.
Repository: /home/bryan/dev/modkeeper on Abrego.
Source baseline: a00e179029019d2d7888db87549ec79032432759.
Status: design and small filesystem checks. No game installation was changed.

## Required result

Modkeeper will own the game installation used by SPT. An update will create a new generation. The previous generation will remain available. Rollback will select its old game files, SPT files, mods, configuration, and saved data. Newer data will not be merged into the old generation.

The critical question is file ownership. A link does not isolate writes. A preserved directory cannot provide reliable rollback if another generation can change its files.

## Storage proposal

Use a stable linked game path. Give each generation its own writable game tree and mod repository.

| Location | Contents and rule |
| --- | --- |
| `bases/<eft-build-id>/` | A manager-owned copy of one exact EFT build. Keep it unchanged. Do not point it at the changing retail installation. |
| `generations/<id>/game/` | The complete game and SPT installation. Clone by copy-on-write only after a capability test. Otherwise make a full copy. |
| `generations/<id>/library/` | That generation's Modkeeper mod repository, manifest, deployment records, and cache. |
| `generations/<id>/generation.toml` | Base ID, SPT version, channel, build ID, archive hash, parent ID, source, and completion state. |
| `current` | A symlink or Windows junction to the selected generation's game directory. |
| Existing app configuration | The authoritative active generation ID. The manager repairs the current link from this ID after recovery. |

This proposal satisfies the linked game-path requirement. It does not yet share writable files between generations. Full copies can require much more disk space than shared game assets. The next phase must resolve whether this fallback is acceptable.

Shared immutable assets can be a later storage option. A shared directory needs proof that the game, launcher, framework, and mods cannot change its contents. Do not assume that all EFT files are immutable.

A global cache may contain immutable downloaded archives. Running games must not write through links into that cache.

## Why whole-directory sharing is unsafe

The inspected SPT 5.0 launcher removes game files before launch. Its cleanup list includes BattlEye, Logs, ConsistencyInfo, several executables, and EscapeFromTarkov_Data/Plugins/x86_64/hwecho.dll. Its cleanup helper descends into directories.

Its patcher also writes patched files and .spt-bak backups. On Linux, restoration skips directories marked as reparse points. Thus, a linked game-data directory can permit writes into a shared base or change restoration behavior.

Sources: [GameHelper.cs](https://github.com/SP-Tushonka/launcher/blob/4e57d9b99900b7c38c07b6c8305a1481477ed7f5/SPTushonka.Core/Helpers/GameHelper.cs), [FilePatcher.cs](https://github.com/SP-Tushonka/launcher/blob/4e57d9b99900b7c38c07b6c8305a1481477ed7f5/SPTushonka.Core/Patching/FilePatcher.cs).

Launch the selected generation by its real path. Set the server and launcher working directory to its SPT_Runtime directory. Check the launcher's stored GamePath. A stale absolute path must not launch or modify an older generation.

Sources: [launcher paths](https://github.com/SP-Tushonka/launcher/blob/4e57d9b99900b7c38c07b6c8305a1481477ed7f5/SPTushonka.Core/Spt/Paths.cs), [configured game path](https://github.com/SP-Tushonka/launcher/blob/4e57d9b99900b7c38c07b6c8305a1481477ed7f5/SPTushonka.Core/Configuration/ConfigHelper.cs).

## SPT 5.0 facts that control the design

The official guide identifies SPT 5.0 as Bleeding Edge. It requires a complete copy of the matching Live game. Each archive targets one exact EFT build. The guide has no installer or downgrade patcher. It requires .NET 10 Desktop Runtime and ASP.NET Core Runtime. A change to Modkeeper's language cannot remove SPT's runtime requirements.

SPT 4.x profiles are not supported by that 5.0 guide. Do not copy active 4.x mods or profiles into 5.0 automatically. Import the first 5.0 archive as an explicit test build.

Source: [SPT 5.0 installation guide, updated 11 October 2026](https://github.com/SP-Tushonka/wiki/blob/main/SPT_50/bleeding-edge-install-instructions.md).

The inspected development server declares SPT 5.0.0, .NET 10, and EFT 1.3.0.1.48558. This identifies source commit 87d702ddc9412337cd6fcd7f4824d4647d57390d. It does not identify the latest distributed archive.

Store the archive's own target and hash. Several incompatible Bleeding Edge builds can use the same 5.0.0 version string. Keep the full build identity and channel; the current Modkeeper parser strips versions to three numeric fields.

Sources: [Build.props](https://github.com/SP-Tushonka/server-csharp/blob/87d702ddc9412337cd6fcd7f4824d4647d57390d/Build.props), [core.json](https://github.com/SP-Tushonka/server-csharp/blob/87d702ddc9412337cd6fcd7f4824d4647d57390d/Libraries/SPTushonka.Server.Assets/SPT_Data/configs/core.json). Local parser: src-tauri/src/core/version.rs.

The 5.0 client modules use IL2CPP. Their build references BepInEx.Unity.IL2CPP and generated interop files. The launcher expects the official core plugin at BepInEx/plugins/sptushonka/SPTushonka.Core.dll. Add release-specific paths and file ownership rules. A wider version range alone is not SPT 5.0 support.

Sources: [module build properties](https://github.com/SP-Tushonka/modules/blob/bb205121fa55c6e0bfcb6b0d2f5d32fa2e99a096/Directory.Build.props), [launcher path constants](https://github.com/SP-Tushonka/launcher/blob/4e57d9b99900b7c38c07b6c8305a1481477ed7f5/SPTushonka.Core/Spt/Paths.cs).

## State that belongs to each generation

Preserve the complete generation boundary first. Do not reduce rollback to profile files.

| State | Examples |
| --- | --- |
| Saves and server state | SPT_Runtime/user/profiles, mod databases, and other mod-owned data |
| Server extensions | SPT_Runtime/user/mods and user/patchers |
| Launcher and game settings | user/Launcher, user/sptsettings, user/sptappdata, user/sptRegistry |
| Client framework and mods | BepInEx, including plugins, configuration, interop, and generated files |
| Patching state | Patched game files and .spt-bak files |
| Manager state | Per-generation mod repository, enabled mods, load order, installation records, deployment ownership, and compatibility metadata |
| Other game-local state | Logs, caches, and unknown files inside the owned generation |

Rebuild known path-dependent caches in the new generation when needed. Leave the old generation intact.

Sources: [launcher paths](https://github.com/SP-Tushonka/launcher/blob/4e57d9b99900b7c38c07b6c8305a1481477ed7f5/SPTushonka.Core/Spt/Paths.cs), [server ModLoader](https://github.com/SP-Tushonka/server-csharp/blob/87d702ddc9412337cd6fcd7f4824d4647d57390d/SPTushonka.Server/Modding/ModLoader.cs).

External state requires an explicit boundary. Check Windows registry, AppData, external mod databases, and Wine prefixes during the real launch check. If Linux/Proton is supported, a private Wine prefix per generation is the default proposal. Place required mutable state under generation ownership or record the exact rollback limit. Copying the game directory alone does not restore external state. Modkeeper's own global theme and language settings remain application settings.

## Base import

Import from a stopped and stable retail installation. The retail updater must not change files during the import. Validate the completed managed copy against the required EFT build and a recorded file manifest. The executable version alone does not prove that all game assets belong to the same build. Keep the retail source outside manager cleanup.

## Update rules

The official update guide permits overlay updates within the same SPT minor series. Major or minor changes require a new installation. Ordinary copying merges files and leaves old files that have no replacement.

Source: [Updating SPT](https://github.com/SP-Tushonka/wiki/blob/main/SPT_4x/Updating_SPT.md).

Use these rules:

1. For an approved patch with the same SPT minor series and exact EFT build, clone the complete current generation. Apply the new package only to staging.
2. For another EFT build, SPT major, or SPT minor, create a clean generation from the matching base.
3. For 4.x to 5.0, start with clean profiles and compatible mods. Keep 4.x available for rollback.
4. For Bleeding Edge, require explicit compatibility evidence for each package. Equal semantic versions do not prove compatibility.
5. Distinguish a full package from a delta package. Absence from a delta does not mean deletion.
6. Remove obsolete package-owned files only when ownership and unchanged content are established. Stop for modified files or ownership conflicts.
7. Keep user and mod data out of package cleanup. Do not apply a general deletion rule to every file missing from the new archive.

## Operation sequence

1. Obtain an exclusive manager operation lock.
2. Verify that the game, server, launcher, and other known writers have stopped. Do not force-close them or copy live mutable data.
3. Select the exact base and archive. Check free space for the staging copy and required reserve.
4. Create a staging directory on the selected storage volume.
5. Copy or clone the complete generation boundary as required by the update rule.
6. Rebuild managed links and known stored paths. Check that each destination stays in the new generation.
7. Apply the archive with the existing path and entry validation. Check all destination ancestors before writes.
8. Apply the approved package cleanup plan. Validate the required files and exact versions.
9. Flush the new metadata and write a completion record.
10. Record the pending selection change. Update the active generation ID and the current link.
11. Load fresh in-memory library state for the selected real path. Mark the selection transaction complete.
12. Preserve the previous generation. Launch from the selected real path and verify the result.

Every background operation must capture a generation ID and real path before it begins. It must not repeatedly resolve current while another operation can switch that link.

Copying a tree can retain absolute links into the old generation. A relative link is acceptable only when its resolved destination remains inside the new generation. Rebuild Modkeeper's known links from their recorded ownership. Reject or explicitly handle unknown external links. Do not run a recursive copier through unverified links.

## Crash recovery and rollback

Staging is never a valid active generation. Recovery selects only a directory with a valid completion record.

On Linux, the small test replaced a symlink through a rename. That result does not prove native Windows junction replacement is atomic. Use a small pending-selection record on Windows. Recover the authoritative active ID and repair the alias before launch.

The current atomic_write helper uses a temporary file and rename. It does not establish a complete multi-file, power-loss-safe transaction. Add the required flush and recovery behavior for generation selection. Keep this as a small explicit operation, without adding a database or general workflow framework.

Rollback selects the previous complete generation. It does not copy newer saves into that generation. A resumed old generation becomes writable again and develops its own later state.

Keep old generations until the user deletes them. Deletion must refuse the active generation and any referenced base. Unreadable ownership metadata must stop automatic deletion. Cleanup must not follow links outside the selected owned tree.

## Reuse and required changes

| Existing code | Use in the new design |
| --- | --- |
| core/library_service.rs and core/global_service.rs | Preserve semantic operations. Add generation selection around them. |
| core/linker.rs | Reuse link creation/removal and capability probes where valid. The present probe prefers copies. |
| core/deployment.rs and core/cleanup.rs | Reuse path and collision planning. Strengthen copy ownership with recorded content hashes. Rebuild links after cloning. |
| utils/archive.rs | Retain archive path checks, duplicate detection, and supported ZIP/7z behavior. |
| core/mod_snapshot.rs | Retain transient failure recovery. It is not a persistent generation history. |
| store/app_config.rs | Extend the existing active selection. Keep generation metadata with the generation. |
| models/paths.rs and core/version.rs | Add verified 5.0 layouts and complete package identity. The current version rule accepts only ^4. |
| core/registry.rs and utils/process.rs | Extend writer detection. The existing Windows check covers only canonical game/server paths; Linux needs a real check. |

Source review also found that copied-file ownership is currently based on file existence. That is insufficient to distinguish a deployed file from a later user replacement. Package cleanup must use a stronger ownership record. This is a source-review finding; no claim is made that this user-facing failure was reproduced in this phase.

The current library persists manifest, cache, and deployment files separately. Its sync path can purge old deployment artifacts before it completes a new deployment. These operations need the generation boundary and recovery checks before they can provide version rollback.

## Evidence from this phase

The existing SPT integration fixture was run on Abrego:

```sh
nix develop .#default --command cargo test --locked \
  --manifest-path src-tauri/Cargo.toml --test spt_416
```

Result: 4 passed, 0 failed, 1 ignored. The ignored test requires a real game path. The passing version test confirms that the current application rejects 5.0.0.

A synthetic fixture ran on the repository's filesystem. It verified:

- A directory symlink write changes the source tree.
- A hardlink write changes the shared file.
- An incomplete stage leaves the selected generation unchanged.
- A full-copy update leaves the base and previous generation unchanged.
- An obsolete file can be removed only from the new generation.
- Selecting the old generation restores its old save data.

The clone probe using cp --reflink=always returned Operation not supported. The project mount is ext4. This result applies to that mount only. Probe the actual game storage volume during the next phase.

These checks do not establish real SPT compatibility. No SPT archive was installed. No real server, launcher, or game was started.

## Acceptance gates for implementation

Use focused fixtures for package replacement/deletion, failed staging, stale absolute links, and selection recovery. Preserve the existing archive and deployment tests.

The first real game check must use an exact known EFT build and matching SPT archive. Start the server and launcher from the managed path. Reach the game menu with a clean profile. Verify the launched path, working directory, and generation-local state. Compare retail source, managed base, and inactive generation hashes before and after launch.

Then update, change a save and mod setting, and roll back. Confirm that the old files and old data return. Repeat on each supported platform. Test native Windows separately from links created through WSL.

## Phase-end decisions

1. Choose the next implementation focus: generation engine, GPUI prototype, or a Go prototype.
2. Decide whether full-copy fallback is acceptable, or whether shared immutable assets are required in the first release.
3. Set the first release target: native Windows only, or Windows plus Linux/Proton. Include WSL control if it is required.

The data rollback rule is settled and does not need confirmation.
