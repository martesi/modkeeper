# Parallel native and managed-storage trials

Date: 8–9 November 2026. Status: trial execution complete; current-host spot checks complete.

## Decision from this phase

The WebView requirement is fixed in the Rust trial by separating the CLI build and startup path from the UI. GPUI is not required for that fix. The original Linux `--help` failure was reproduced; the new CLI performs real library and mod operations without a display or WebView setup.

For the next application migration trial, Go with Gio is the preferred route if storage use is the deciding factor. Its combined Linux and Windows native UI build cache is much smaller in this trial. The Go port still needs feature and test parity work. The Rust CLI split remains a working reference and the GPUI route preserves the existing Rust core and its full test suite.

The original 28.19 GB target is accumulated build state, not a necessary footprint for every Rust project. The persisted Rust trial profiles disable debug information and incremental output, and the core emits only an rlib. The resulting Linux CLI build and tests occupy 0.44 GB. This is a different scope from the historical full target; no percentage reduction is presented as an equal-workload benchmark. Cargo's [profile documentation](https://doc.rust-lang.org/cargo/reference/profiles.html) describes the debug and incremental controls.

The next implementation gate is a working Windows storage backend on the intended game drive. No full game-copy fallback will be added. A ReFS clone path or a tested restricted dummy/overlay layout must pass a real update and rollback before the manager can promise convenient SPT generation management.

## Unstated critical question

Can the manager expose the complete SPT runtime that the launcher, game, server,
updater, and mods expect while guaranteeing that every write stays inside the
selected managed generation and the retail installation remains byte-for-byte
unchanged? This is the causal gate behind storage, rollback, process detection,
and SPT-version compatibility. A directory symlink, junction, or hardlink is
not evidence of write isolation; the answer requires an actual native runtime
test of the chosen filesystem mechanism.

## Accepted scope

The accepted requirements are in [the implementation brief](2026-11-08-implementation-brief.md). All three trials start from jj commit `97933a386580a5ec18509d5a08a1f42c5a0465e2`. They are separate workspaces and are not merged or pushed.

| Track | Workspace | Bookmark |
|---|---|---|
| Rust CLI and GPUI | `/home/bryan/dev/modkeeper-gpui` | `trial/gpui` |
| Go | `/home/bryan/dev/modkeeper-go` | `trial/go` |
| Managed generations | `/home/bryan/dev/modkeeper-managed` | `trial/managed` |

Abrego permits two simultaneous ACP prompt runs. The GPUI ACP session runs one managed-storage child through its supported agent interface. All three execution contexts were verified as `gpt-5.6-luna` with `max` effort. The child uses explicit paths in its assigned managed-storage workspace.

## Original build storage

These are allocated bytes from the original workspace, before changing or deleting any build output. The values are not a clean-build benchmark.

| Original path | Allocated bytes | Decimal GB |
|---|---:|---:|
| `src-tauri/target` | 28,194,848,768 | 28.19 |
| `target/debug` | 24,644,018,176 | 24.64 |
| `target/debug/deps` | 17,070,223,360 | 17.07 |
| `target/debug/incremental` | 4,211,023,872 | 4.21 |
| `target/debug/build` | 2,724,061,184 | 2.72 |
| Windows GNU target | 1,579,450,368 | 1.58 |
| Native release | 1,038,422,016 | 1.04 |
| Explicit Linux release target | 932,941,824 | 0.93 |

The debug tree contains several hash variants of application and test binaries. Their presence does not establish that every variant is unused. A file-inode inventory excluded 1,550 duplicate hardlink paths before summing file allocation. Its unique-file total is 24,630,456,320 bytes; directory allocation accounts for the difference from `du`.

The existing `mod_keeper` executable is 322,164,256 logical bytes. An ELF section read found 264,881,170 bytes of `.debug*` sections, or 82.2% of this one executable. That ratio must not be applied to the entire build tree. The original manifest also requests `staticlib`, `cdylib`, and `rlib`; the static library alone is 916,580,808 logical bytes.

The original executable directly imports `libwebkit2gtk-4.1`, `libjavascriptcoregtk-4.1`, `libgtk-3`, and `libsoup-3.0`. The ACP agent ran its `--help` path with isolated application directories and no display. It attempted GTK initialization and exited with status 101. The current issue is therefore reproduced for the Linux executable.

## Execution and filesystem access

The AgentDock measurement container was a Linux environment on a WSL2 kernel
with no usable Windows interop executable, host-drive route, WSL interop socket,
configured SSH route, graphics device, or FUSE device. The current Codex host
can see `/mnt/c` and Windows binaries, but `cmd.exe`/`powershell.exe` fail with
the WSL interop socket error and `/proc/sys/fs/binfmt_misc/WSLInterop` is absent.
Native Windows execution is therefore still unavailable. All three tracks
produced linked Windows GNU or Go cross-builds; these remain separate from
native execution.

The AgentDock source workspace was on ext4. Real `FICLONE` probes of nonempty
temporary files on that workspace volume, `/tmp`, and `/agt` all returned errno
95, operation not supported. The current Codex host also rejected a non-empty
`cp --reflink=always` probe on `/tmp`; it has no `/agt` mount. Temporary probe
files were removed. No full game copy fallback is allowed. Transaction tests
using an injected clone backend, if used, are simulation and do not establish
physical CoW support.

## Review gates

- Build and run useful CLI commands with no display and no WebView setup or linkage.
- Compare clean build and test storage by scope, including module caches and GUI build costs where measured.
- Exercise Rust and Go library files in both directions, including multi-file server mod identity and runtime-layout mapping.
- Check loaded deployment paths and existing parent links before filesystem mutations.
- Confirm that writer checks do not confuse Linux process visibility with stopped Windows processes.
- Exercise generation selection, recovery, old-data rollback, failed cloning, and unsupported-filesystem behavior on synthetic data.
- Identify all native Windows, real CoW, and real SPT 5.0 runtime checks that still need an accessible test environment.

## Results

### Independently verified Rust CLI

The default executable ran directly, outside the Nix development shell, with `DISPLAY`, `WAYLAND_DISPLAY`, and `LD_LIBRARY_PATH` unset. The review used a temporary SPT_Runtime 4.1.6 fixture with dummy executables. `--help`, library creation, combined client/server ZIP import, sync, and list all returned status 0. The server mod had two files, and the client had one DLL. All three contents were checked after deployment. The app used `SPT_Runtime` and did not create an extra `SPT` directory.

An archive with `../escaped.txt` returned status 4 with a structured JSON error. No escaped file appeared, and the prior deployed mod contents remained intact.

An independent ELF parser found only `libgcc_s.so.1`, `libc.so.6`, and `ld-linux-x86-64.so.2` in `DT_NEEDED`. The final executable is 15,391,632 logical bytes. The Linux CLI build and full test target occupies 440,442,880 allocated bytes.

`cargo tree --locked --edges normal,build --prefix none --format '{p}'` for the default CLI reported 124 unique packages including the root on Linux, and 140 on Windows MSVC. No Tauri, Specta, GPUI, GTK, or WebKit package is active in that graph. Relative to the phase-1 production graphs of 373 and 293, this excludes 249 Linux packages and 153 Windows packages from the default CLI build. The separate GPUI graph must be counted on its own. Lockfile entries for optional legacy features are not compiled dependencies.

The root review fixture is `/agt/xdg/state/agentdock/tmp/modkeeper-root-review-tzbfyqd6`. It contains only synthetic review data and is retained with the command-result JSON for this phase. The final results distinguish command execution, cross-compilation, GUI execution, and pending native Windows checks.

### Rust and Go file compatibility

The independent cross-check first reproduced a defect: Go omitted a nil `executables` list from `cache.toml`, and the Rust CLI rejected the library. The Go agent fixed collection serialization at the persistence boundary and added a regression. A fresh fixture then passed 15 actual CLI operations with display and library-path variables unset:

- Go read a Rust-created library and its deployed mod state.
- Rust loaded a fresh empty Go-created library.
- Both produced mod ID `nrBBtQDCOxbKXY6mX113EQ` for the same combined client and two-file server archive.
- Go deployed the three files into the correct SPT_Runtime and BepInEx paths, with contents checked.
- Rust loaded and synced the Go library, then Go loaded the result.
- Go disabled and synced the mod; Rust loaded the disabled state.
- Go enabled and synced it again; all three file contents returned.
- Go removed it; Rust loaded the empty mod collection.

Evidence is in the temporary review fixture's `cross-format-results-v2.json`. This establishes compatibility for the exercised library, cache, and copy-deployment records. It is not a claim of full UI, application-settings, or all deployment-mode parity.

### Storage options without a full game copy

The implementation trial uses explicit OS cloning and fails when cloning is unavailable. Other routes were checked against primary documentation:

| Route | What it provides | Remaining constraint |
|---|---|---|
| ReFS block clone | Separate file identities sharing data blocks until writes | Source and target must be on a compatible same volume; aligned ranges, attributes, and independent writes need native checks. |
| Linux reflink | Explicit file cloning on supported filesystems | The available ext4 and tmpfs volumes reject it. There is no copy fallback. |
| Symlinks or hardlinks | A second name for existing data | They do not isolate writes to the linked data. |
| ProjFS | Projected names and data hydration | Requested data is written to a local placeholder. It does not guarantee storage-free reads of large assets. |
| Windows BindLink | Built-in read-only bindings, merge mode, and path exceptions | Requires administrator access. Backing entries win collisions, and new writes normally target backing. It is not automatic CoW. |
| WinFsp overlay | A place to implement read-through lower data and private writes | Requires a filesystem driver and a tested overlay implementation, including deletes and renames. |

Sources: [ReFS block cloning](https://learn.microsoft.com/en-us/windows/win32/fileio/block-cloning), [ProjFS file-data callback](https://learn.microsoft.com/en-us/windows/win32/api/projectedfslib/nc-projectedfslib-prj_get_file_data_cb), [BindLink API](https://learn.microsoft.com/en-us/windows/win32/api/bindlink/nf-bindlink-createbindlink), [BindLink flags and write semantics](https://learn.microsoft.com/en-us/windows/win32/api/bindlink/ne-bindlink-create_bind_link_flags), and [WinFsp filesystem API](https://github.com/winfsp/winfsp/blob/master/doc/WinFsp-API-winfsp.h.md).

A restricted dummy tree that binds only known immutable assets read-only and keeps every mutable path private is a Windows test candidate. That is an inference from the BindLink API, not a verified SPT result. Launcher cleanup and patch writes must be checked against the exact SPT build before calling such a layout supported. BindLinks must also be restored after a system restart.

[USVFS](https://github.com/ModOrganizer2/usvfs) was also considered. Its process-local API hooks provide virtual links, but this must not be treated as verified CoW: the project's [open write-isolation request](https://github.com/ModOrganizer2/modorganizer/issues/352) describes writes reaching original files. No hook library or driver was installed in this phase.

### Native GPUI execution

The separate pinned GPUI 0.2.2 package compiled and ran under an owned Xvfb display in the WSL2 Linux container. The test loaded the same synthetic library used for the CLI checks. Root inspected the rendered screenshot, and the app log contains two successful library-operation entries: initial load and a real Refresh click. The tested screenshot is `/tmp/modkeeper-gpui-interaction.Cv2bQC/after.png`.

The default-feature-disabled GPUI package enables X11 and the Windows manifest feature. Its normal-plus-build graph contains 567 packages on Linux and 506 on Windows MSVC, including both application packages. The corresponding phase-1 Tauri counts were 373 and 293. The native UI removes the WebView requirement; it does not reduce the Rust package count. The CLI remains an independent 124/140-package graph.

A real build exposed an upstream compatibility break: GPUI 0.2.2 pulls xattr 0.2.3, which references the removed Linux/Android `libc::ENOATTR` alias. The trial vendors the exact xattr source and licenses and changes only that platform alias to `ENODATA`. See the [libc issue](https://github.com/rust-lang/libc/issues/1356) and [current xattr platform implementation](https://github.com/Stebalien/xattr/blob/master/src/sys/linux_macos.rs). This patch is a maintenance cost of the chosen published GPUI version.

### Native UI performance gate

No 10-run native Windows/Linux cold-start, warm-start, idle-memory,
active-memory, peak-memory, or process-count benchmark was completed. The GPUI
and Gio Xvfb runs establish functional window startup and interaction only;
Xvfb timings and memory are not native desktop performance evidence. The
startup/memory comparison therefore remains open and cannot decide between
Rust/GPUI and Go/Gio on its own.

### Independently verified storage boundary

The standalone storage CLI ran with no display or library-path variables. A real 1 MiB synthetic source on this filesystem was rejected by `base-import`, no complete base was published, no probe directory remained under the managed root, and the original SHA-256 digest was unchanged.

Root then prepared two tiny complete-generation fixtures by writing test data directly. Actual CLI select, rollback, and recover commands verified that selecting the old generation exposes its old save and mod data while the newer generation remains present. A valid pending journal recovered; an invalid target was rejected without changing the selected generation. A caller-created writer sentinel blocked selection. These checks validate selection and recovery over prepared data; they are not a positive CoW creation/update test or a test of real game-process detection.

The independent review also reproduced acceptance of `..` as a generation ID. The agent added an alphanumeric-first-character rule to reject traversal and internal stage/probe names. The rebuilt executable rejected `.`, `..`, `.stage-hidden`, and `.managed-source-probe-1`, with the selected generation unchanged. The recheck is recorded in `identifier-recheck.json` under `/agt/xdg/state/agentdock/tmp/modkeeper-root-managed-tuy4ulzu`.

### SPT 5.0 boundary

Both actual CLI implementations still reject a synthetic SPT 5.0.0 installation: Rust exits 3 with `UnsupportedSPTVersion`, and Go exits 1 with the existing `^4` support rule. This trial does not enable production SPT 5.0 support. The storage engine is a separate prototype; it is not wired into either native frontend or the existing library model.

The current official [SPT 5.0 bleeding-edge instructions](https://github.com/SP-Tushonka/wiki/blob/main/SPT_50/bleeding-edge-install-instructions.md) say this is testing-only, has no installer or downgrade patcher, requires the Live installation to remain plus a complete copy, and requires extracting a build-specific archive over that copy before starting `SPT.Server` and `SPT.Launcher` from `SPT_Runtime`. They also require the .NET Desktop and ASP.NET Core runtimes. This directly conflicts with the no-full-copy product requirement. The manager must not claim SPT 5.0 support until it has a tested full-tree presentation with private writes, or the upstream installation contract changes.

The next implementation phase must apply the exact SPT/EFT version contract, integrate launch and stopped-writer control, rebase known manager and launcher paths, and test real SPT 5.0 update/rollback behavior on the selected Windows storage backend. A cooperative sentinel alone cannot prove that the game, launcher, and server are stopped.


### Final build and runtime checks

| Check | Observed result |
|---|---|
| Rust default core suite | 82 passed; one real-installation test ignored. |
| Optional legacy Tauri library | `cargo check --features tauri --lib` passed. |
| Rust CLI and GPUI Linux | CLI operations passed; native GPUI rendered and Refresh ran the library operation. |
| Rust Windows CLI and GPUI | Both linked for `x86_64-pc-windows-gnu`; no native Windows execution. |
| Go core | `go test ./...` and `go vet ./...` passed; independent 15-command Rust/Go compatibility flow passed. |
| Go Gio Linux | Readable initial window, changed library name after a real Refresh click, and normal close with exit status 0. |
| Go Windows CLI and Gio | Both linked for Windows AMD64 with CGO disabled; no native Windows execution. |
| Managed storage | Recorded trial: one unit and ten storage tests; current-host continuation: one unit and 13 storage tests; formatting passed and the Windows GNU CLI linked. |
| Physical CoW | Available volumes reject a non-empty clone. Failure and source preservation passed; positive clone/update is still untested. |

The Go window test first captured a black frame and exposed a close-loop defect. The final run used an owned XDG runtime directory and software Mesa under Xvfb. The window loop now returns the destroy error and its goroutine exits with the proper status. An explicit `WM_DELETE_WINDOW` client message produced `APP_STATUS=0`; forced X client termination was not accepted as the close test. The final visual evidence is `/home/bryan/dev/modkeeper-go/.go-trial-cache/gui-fixture/final-after.png`. The independent reviewer also inspected the readable changed-name image.

The Go Windows process guard now treats an inaccessible process with a matching server/client basename as active. Its scope still excludes the launcher, and the Windows API path has not been run natively. The managed prototype's writer sentinel is cooperative only. Both require real launch/process integration before production generation updates.

The current Codex-host recheck used isolated temporary targets: the Rust CLI
suite passed 82 tests with one real-installation test ignored, the Go CLI passed
`go test ./...` and `go vet ./...`, the Windows Go process-test package compiled
for `windows/amd64`, and the managed suite passed 1 unit plus 13 storage tests;
the managed Windows GNU binary also built. These checks confirm the current
source tree and remain Linux/cross-build evidence, not native Windows coverage.

The final managed source preserves Linux permissions, passes all required Windows disk-space output pointers, and bounds tail copying to the unaligned remainder. The supplied package override files are copied without an enforced size, type, or origin policy. The current prototype has no full-tree copy fallback; trusted SPT package validation and large asset exclusions still belong to integration.

### Final storage accounting

Values below are allocated bytes from `du -B1` on the actual cache directories. Decimal GB means 1,000,000,000 bytes. These are isolated trial snapshots, including the listed tests, target platforms and development iterations. They are not matched-feature release benchmarks.

| Scope | Allocated bytes | Decimal GB |
|---|---:|---:|
| Rust Linux CLI build and full tests | 440,442,880 | 0.440 |
| GPUI target, Linux and Windows check/build | 4,452,962,304 | 4.453 |
| Separate Rust Windows CLI target | 631,476,224 | 0.631 |
| Rust CLI/GPUI target subtotal | 5,524,881,408 | 5.525 |
| Extra legacy Tauri compile-check target | 1,006,596,096 | 1.007 |
| Go retained CLI build/test cache, Linux and Windows | 421,978,112 | 0.422 |
| Go retained Gio build cache, Linux and Windows | 360,108,032 | 0.360 |
| Go retained CLI module downloads | 239,902,720 | 0.240 |
| Go retained GUI module downloads | 702,251,008 | 0.702 |
| Go four-binary artifact directory, including small records | 48,881,664 | 0.049 |
| Go retained build/download/artifact subtotal | 1,773,121,536 | 1.773 |
| Separate cold Go CLI build/test cache | 259,141,632 | 0.259 |
| Separate cold Go CLI module downloads | 235,810,816 | 0.236 |
| Standalone managed Linux/Windows target | 12,443,648 | 0.012 |
| Shared Cargo registry after all trials | 1,432,649,728 | 1.433 |

The Cargo registry is shared in `/agt/.cargo/registry` on tmpfs for the recorded
AgentDock measurements; it includes downloads used by several Rust scopes and
cannot all be charged to one app. The checked-in shell hooks now prefer
`/agt/xdg/cache/rust` when that shared root exists, so a future run must record
which explicit `CARGO_HOME` was used rather than silently treating these two
roots as one cache. Go CLI and GUI module caches were isolated, so they contain
duplicated downloads. The cold Go experiment is an extra measurement scope, not
another required app cache. Toolchains, Nix store closures and system graphics
packages are excluded from these tables for both languages. Build-cache reuse
can change the cost of a later project.

The GPUI target was 2,026,811,392 allocated bytes after the Linux-only build; its final value includes the Windows check and linked build. The earlier agent note differs from the later root snapshot by one 4 KiB filesystem block. The original 28,194,848,768-byte target remains intact. No old target, game installation or user mod data was cleaned.

### Final executable sizes

These are logical file lengths. Rust uses development builds with debug information disabled and incremental output disabled. Go uses normal `go build -trimpath`. These are development artifacts, not a controlled release-size comparison.

| Artifact | Linux bytes | Windows bytes |
|---|---:|---:|
| Rust CLI | 15,391,632 | 30,225,621 |
| GPUI | 74,799,944 | 131,167,073 |
| Go CLI | 9,096,309 | 9,202,176 |
| Gio | 15,953,384 | 14,618,624 |
| Managed storage CLI | 1,355,256 | 2,079,372 |

Root read the final ELF and PE headers directly. The Linux Go CLI imports libc, pthread and libresolv, with no GUI library. It is headless but is not a statically linked artifact. The Windows Go builds use CGO disabled. Both native Linux GUI paths import their graphics libraries and have no WebView requirement. All retained Windows files currently use console subsystem 3, including the development GUI executables. Installer, console hiding, signing and native Windows runtime checks remain separate packaging work.

### Scope left for the next phase

The native windows provide library status and Refresh. Neither is a complete replacement for the current React UI. The new Go core supports the exercised library, archive and copy-deployment operations; application settings, launcher integration, link deployment modes, complete archive codec/encryption parity and the full Rust test contract still need a port or an explicit scope decision. No performance claim is made for startup time or idle memory.

The phase-1 frontend inventory found 55 direct declarations and 994 unique Bun lock identities. A complete native frontend can retire that frontend graph. The trial worktrees retain the old frontend as a reference, so those files have not been deleted. Cargo package counts and Go module counts are different units and should not be added together as a complexity score.

A restricted dummy layout can only be accepted after mutable paths are private and shared asset paths have a verified write boundary. Read-only file links or native bindings are possible design candidates; ordinary links alone do not provide CoW. BindLink, ProjFS, USVFS and WinFsp were investigated, but an NTFS overlay has not been implemented or validated in this phase.

The managed prototype is intentionally clone-gated: on the available volumes it
fails before publishing rather than silently falling back to a full copy or a
write-through link. That is a safe failure mode, not a completed implementation
of the no-CoW requirement.

Before real SPT 5.0 support, validate the exact SPT/EFT build pair, stop the server/launcher/game and the retail updater, rebase launcher and manager paths into the selected generation, and keep enabled mods, load order, repository records and ownership state with that generation. Audit writes outside the generation, including AppData, registry and any Wine prefix. A rollback restores old contained data; it does not merge newer saves. Use the [SPT 5.0 installation contract](https://github.com/SP-Tushonka/wiki/blob/main/SPT_50/bleeding-edge-install-instructions.md) and the exact downloaded package, rather than enabling version 5 by changing the current `^4` gate alone.

Required native checks are Windows launch and close, deployment paths and locks, process guards, clone write isolation and disk allocation, interrupted selection recovery, and a real SPT update/rollback. WSL tests here cover native Linux files and windows; they do not prove that WSL can safely control a running Windows installation through an arbitrary host-drive mount.

### Phase-end decisions

1. Select the next application route: Go/Gio for the lower measured native UI build cost, or Rust/GPUI to retain the existing core and its test suite.
2. Identify the Windows version and the filesystem holding the intended game base, especially NTFS versus ReFS.
3. Provide an Abrego route to a native Windows test host. The current Linux container has no usable Windows execution route.

### Review locations

- Coordinator review: `/home/bryan/dev/modkeeper/docs/2026-11-08-parallel-trial-review.md`.
- Accepted brief: `/home/bryan/dev/modkeeper/docs/2026-11-08-implementation-brief.md`.
- GPUI note: `/home/bryan/dev/modkeeper-gpui/docs/2026-11-08-gpui-trial.md`.
- Go note: `/home/bryan/dev/modkeeper-go/docs/2026-11-08-go-trial.md`.
- Managed note: `/home/bryan/dev/modkeeper-managed/docs/2026-11-08-managed-trial.md`.

Stable jj changes are `mrtwlyyl` for GPUI, `ywsvntul` for Go and `xxrynuyk` for managed storage. They share frozen base commit `97933a386580a5ec18509d5a08a1f42c5a0465e2`. The GPUI final commit is `447517f2f5f802c0233609a22687c74480ec929b`; managed storage is `4e18ad847b90c0a77c98746bc9f598ad442bae7b`. No trial was merged or pushed.
