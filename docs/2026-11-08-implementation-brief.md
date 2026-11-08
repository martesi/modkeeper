# Parallel implementation phase: accepted requirements

Date: 8 November 2026.
This brief supersedes the phase-1 recommendations where they differ.

## User decisions

- Start all three tracks in separate worktrees, in parallel.
- Use Abrego ACP with GPT-5.6 Luna and max reasoning effort for each track.
- The GPUI reason is a real command-line application that runs without a WebView environment. A hidden GUI or a GUI startup path that still loads WebView libraries is insufficient.
- The Go reason is build-storage cost. The current Rust build tree is about 28.2 GB allocated, including about 24.6 GB in debug. Counts of dependency names do not answer this concern.
- Full copies of EFT game assets are not allowed. Use a verified copy-on-write operation or a working dummy/overlay game directory with isolated writes. Unsupported filesystems must not silently fall back to full game copies.
- Copying small mutable SPT, configuration, mod, and save state is allowed where needed. Rollback deliberately restores the old data.
- Windows is first. Development is under WSL. The app must have runnable and testable paths in native Windows and WSL/Linux.
- Ask questions only at the end of a work phase. Proceed with authorized reversible work.

## Scope of this phase

Each track must produce an implemented, runnable path and focused verification. Do not stop at a design document. Do not merge competing migrations or push them. Keep the source baseline and existing game data intact.

Keep the implementation small. Reuse the domain logic and fixtures. No new general workflow framework, database, or service layer without a concrete requirement.

### GPUI and CLI track

Reproduce the current --help/headless behavior safely before editing. Separate CLI and GUI initialization and linking. A default CLI build must not require Tauri, WebKitGTK, WebView2, a display server, or GPUI graphics libraries. A separate or feature-gated GPUI frontend is acceptable. Implement useful library/mod operations in the CLI, not only --help. Preserve structured errors and nonzero exit status. Keep terminal output on Windows; do not apply the GUI subsystem attribute to the CLI executable.

Build and run the headless path with display variables unset and inspect dynamic dependencies. Build a real GPUI path and test an actual user flow where access permits. Record any platform-specific or toolkit blocker. Use a pinned GPUI revision and do not mix release/main APIs.

### Go track

Port the small application's real domain and CLI path, with a minimal native UI entry if practical in this phase. Prefer the Go standard library and a minimal maintained archive library where necessary. Preserve file formats and archive/path/ownership safety. Keep GUI dependencies out of the CLI build. Do not use Wails as a substitute for removing WebView dependencies.

Measure cold build cache, module cache, outputs, incremental rebuild growth, and Windows cross-build output separately. Compare measured workload and cache scope. Do not claim a reduction by comparing one Go binary with the entire historical Rust target directory. Preserve ZIP/7z coverage or list exact missing parity; do not silently remove formats.

### Managed generation track

Implement filesystem capability detection and a real generation create/update/select/rollback path. Prefer native cloning when supported. On Linux use a real reflink operation; on Windows use the correct supported block-clone API with volume and range checks. Verify independent writes and deletes. Return an actionable error when cloning is unsupported.

Investigate a dummy/overlay tree for NTFS and other non-cloning volumes. Shared hardlinks or broad writable directory links do not isolate writes. A dummy directory must keep launcher cleanup, game patching, mods, profiles, and manager metadata private. Do not label it safe based only on a synthetic test. Prototype the smallest viable approach and state exact requirements when a driver or filesystem feature is needed.

No full-game copy fallback, including base import. Work only with synthetic fixtures or explicitly supplied real game paths. Do not change real installations. Keep old generations and their data. Include obsolete-package file handling, link rebasing, stopped-writer checks, and recovery of an interrupted selection at the scope implemented.

## Build and test discipline

- Use the existing Nix pin. Do not update unrelated dependencies.
- Do not duplicate node_modules or the existing target tree in the new worktrees.
- Share the downloaded Rust registry cache. Use a separate target directory per track.
- For new measured Rust builds use debug info disabled and incremental compilation disabled, unless the test explicitly measures another profile. Limit parallel jobs to avoid three simultaneous unbounded builds.
- Do not delete existing caches or user data. Record measured bytes and commands.
- Test actual CLI commands against temporary fixtures. Do not treat cross-compilation as native Windows execution.
- The Abrego connector is inside a Linux environment on a WSL2 kernel. Initial inspection found no Windows interop command, /mnt/c, or WSLInterop entry. Keep Windows runtime testing pending until an actual route is found; do not substitute Wine and call it native Windows.

## Delivery

Leave each worktree with a clear jj description, source changes, a short validation note, exact commands, and measured storage. Report completed behavior, remaining parity, and platform evidence. The coordinator will review the diffs and ask phase-end questions.
