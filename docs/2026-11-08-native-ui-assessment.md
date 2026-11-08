# Modkeeper native UI and Go assessment

Date: 8 November 2026, Asia/Shanghai.

Update: the user's accepted requirements are in [the implementation brief](2026-11-08-implementation-brief.md). Full game copies are disallowed. The CLI must run without WebView setup. Go is being tested for build-storage cost. Windows and WSL execution are required.
Repository: /home/bryan/dev/modkeeper on Abrego.
Source baseline: a00e179029019d2d7888db87549ec79032432759.
Status: phase 1 assessment. No application code or installed game was changed.

## Recommendation

Keep the Rust domain code. Implement managed generations behind a UI-independent interface. Use the present UI for that work. Then test GPUI if removing the web frontend remains a priority.

GPUI can retire the current JavaScript frontend and its build tools. It does not produce a smaller Rust dependency graph in the measured configuration. The published GPUI 0.2.2 trial graph increases production and build dependencies from 373 to 577 on Linux, and from 293 to 501 on Windows.

Go has useful maintenance and build options, especially Gio on Windows. However, a native Go application requires both a backend port and a UI port. There is no measured memory, speed, or release-size benefit for Modkeeper yet. Wails retains the web frontend and WebView runtime.

The managed-generation design is in [the companion plan](2026-11-08-managed-generations.md). It preserves the previous game, SPT, mods, manager state, and saved data. Rollback deliberately restores the old data.

## Baseline and scope

The local branch is two commits ahead of origin/main at 561e070acc0eb69efe886a64350dcc748e1a9825. The source checkout was clean before this assessment. The measurements use the local revision, including its dependency and file-operation fixes.

The development shell provided Rust/Cargo 1.99.1 and Bun 1.4.2. package.json requests Bun 1.4.4. No package update was made.

Separate these quantities:

- A direct declaration is a dependency named by the application.
- A package identity is one resolved package name and version. Different versions count separately.
- A production graph includes ordinary and build dependencies for one target. It excludes development-only edges.
- Installed development files, native system libraries, release files, and process memory are different measurements.

The package counts below are inventory measurements. They do not measure code quality, vulnerability count, executable size, startup time, or memory use.

## What a full native UI can remove

### Frontend

| Item | Measured count |
| --- | ---: |
| Direct production declarations in package.json | 23 |
| Direct development declarations | 32 |
| Total direct declarations | 55 |
| Unique package identities in bun.lock | 994 |
| Package keys or placements in bun.lock | 1,299 |

A full native UI can retire the current React, TypeScript, Vite, Tailwind, Storybook, and related frontend dependency graph. The 55 declarations and 994 identities are gross removal figures. They assume that no JavaScript tooling or embedded web content remains. Independent tools, such as the Git-hook runner, can be retained if useful.

The 1,299 lock entries are not 1,299 different package versions. Some identities appear at more than one package location.

Evidence: package.json and bun.lock at the source baseline.

### Rust before adding a replacement UI

The current manifest has 27 ordinary dependency declarations, one Windows-only declaration, two build declarations, and two development declarations. Some names appear in more than one section.

Eight ordinary declarations belong to the UI or IPC layer:

- tauri
- tauri-plugin-opener
- tauri-plugin-dialog
- tauri-plugin-log
- specta
- specta-typescript
- tauri-specta
- window-vibrancy

A native Rust port can also remove the tauri-build build dependency and the current build-time tempfile declaration. Test-time tempfile can remain. This leaves 19 ordinary core declarations and the Windows-only sysinfo declaration before a replacement UI is added.

The complete Cargo.lock has 520 entries, including the application. It covers more than one platform and includes development dependencies. It is not the count of packages compiled into a release.

The following graph cut removes the top-level UI, IPC, and Tauri build roots from the existing production graph. It keeps the existing resolved features. It is an upper estimate of gross removal, not a complete native application.

| Target | Current external packages | Core after root cut | Removed before adding a UI |
| --- | ---: | ---: | ---: |
| Linux x86_64 | 373 | 121 | 252, or 67.6% |
| Windows x86_64 MSVC | 293 | 136 | 157, or 53.6% |

Evidence: src-tauri/Cargo.toml, src-tauri/Cargo.lock, and target-specific cargo tree output.

## GPUI: measured replacement graph

The temporary comparison kept the core dependencies, removed the UI/IPC roots and Tauri build dependencies, and added exactly gpui = "=0.2.2". It used the published crates.io release with its default features: font-kit, Wayland, X11, and windows-manifest.

The original lockfile seeded the comparison. All retained direct core dependencies resolved to the same versions as the baseline. The temporary crate contained no Modkeeper UI implementation.

| Target | Tauri baseline | Core plus GPUI | Packages removed | Packages added | Net change |
| --- | ---: | ---: | ---: | ---: | ---: |
| Linux x86_64 | 373 | 577 | 135 | 339 | +204, or +54.7% |
| Windows x86_64 MSVC | 293 | 501 | 92 | 300 | +208, or +71.0% |

The common package counts are 238 on Linux and 201 on Windows. Packages shared by the core and UI remain only once per name and version. GPUI also brings back some packages removed by the simple root cut. Thus, the gross root-cut totals cannot be subtracted from the final application unchanged.

This result supports a precise conclusion: GPUI removes one complete web development stack, while this GPUI configuration adds Rust packages. Do not add the npm and Cargo percentages together. The ecosystems have different package boundaries and the Bun lock covers a broader platform set.

The graph resolved successfully. No GPUI application was compiled or launched. Counts may change when features are reduced, platform code changes, or feature-parity libraries are added.

Published GPUI 0.2.2 includes its platform backends. Current Zed source has a separate gpui_platform crate. Do not combine this older release's counts with claims about current-main features. Pin one revision for the implementation trial.

Sources: [GPUI](https://gpui.rs/), [0.2.2 features](https://docs.rs/crate/gpui/0.2.2/features), [0.2.2 platform source](https://docs.rs/crate/gpui/0.2.2/source/src/platform.rs), [current platform manifest](https://github.com/zed-industries/zed/blob/main/crates/gpui_platform/Cargo.toml).

### What still needs work

GPUI draws its interface through a GPU renderer. It does not give every control the operating system's stock widget implementation. Its project describes the API as pre-1.0 and subject to change.

The port must cover the mod list, forms, dialogs, file drag and drop, background-task progress, cancellation, keyboard focus, Chinese input, scaling, themes, translations, and application packaging. Tauri plugins and generated TypeScript bindings do not transfer directly.

Current-main accessibility work does not prove accessibility for the measured release or for Modkeeper's controls. Test the chosen revision with keyboard navigation and the target screen reader.

Source: [GPUI README](https://github.com/zed-industries/zed/blob/main/crates/gpui/README.md). The feature checklist comes from the local application and the proposed generation workflow.

## Development disk use

| Measured item | Size | Meaning |
| --- | ---: | --- |
| node_modules, allocated bytes | 703.49 MiB | Current local development directory |
| node_modules, apparent bytes | 563.12 MiB | Sum of logical file sizes |
| Existing dist, apparent bytes | 0.87 MiB | Existing generated frontend files; not rebuilt for this comparison |
| Bun component, Nix NAR size | 75.89 MiB | One tool component |
| WebKitGTK runtime component, Nix NAR size | 175.59 MiB | One native runtime component |
| WebKitGTK runtime closure, Nix NAR size | 837.22 MiB | Component plus its referenced store paths |
| WebKitGTK development closure, Nix NAR size | 959.22 MiB | Development component plus referenced store paths |

NAR sizes describe Nix's uncompressed archive representation. They are not installed file sizes or guaranteed space recovery. The closures overlap. They must not be added together. Other applications can retain the same store paths.

A GPUI port can remove Modkeeper's need for Bun and WebKitGTK. It still needs native graphics, windowing, font, and platform libraries. The exact net development-environment saving needs a complete replacement shell.

Tauri uses the platform WebView: WebView2 on Windows and WebKitGTK on Linux. Removing that dependency does not mean that a Windows machine will remove its shared WebView2 installation.

Source: [Tauri WebView versions](https://v2.tauri.app/reference/webview-versions/). Disk values were measured on Abrego with du and nix path-info.

The existing Rust target directory contains old build outputs and caches. It is not a release-size measure. An existing Windows executable also lacks a verified build revision. Neither is used to claim migration savings.

## Go options and benefits

| Choice | Web frontend | Rust backend reuse | Main benefit | Main cost |
| --- | --- | --- | --- | --- |
| Keep Tauri and Rust | Retained | Direct | Smallest path to managed SPT versions | Two language/tooling stacks and a WebView |
| Rust and GPUI | Removed | Most domain code | One application language; no WebView | New UI and platform integration |
| Go and Gio | Removed | Port required | Simple Windows GUI build prerequisites | Backend port and more custom UI work |
| Go and Fyne | Removed | Port required | Built-in widgets, dialogs, and packaging tools | Backend/UI port; C and graphics build dependencies |
| Go and Wails v3 | Retained | Port required | Go backend with substantial React reuse | Keeps web tooling and WebView requirements |

### Where Go helps

Go's standard library covers JSON, ordinary files and paths, regular expressions, Base64, synchronization, ZIP, and TAR. These facilities can reduce third-party declarations for a new backend. One language can also remove the Rust-to-TypeScript IPC type generation when the UI is native Go.

Gio's official Windows setup requires no extra dependencies beyond its normal Go setup. That is a useful build benefit. A complete Modkeeper build would avoid a C compiler only if its selected archive and OS integration libraries also allow it. Gio on Linux still requires window-system and graphics development packages.

Fyne supplies a larger ready-made widget set. Its desktop build requires a C compiler and graphics support. This is a developer requirement; Windows end users do not need to install a compiler.

Sources: [Go standard library](https://pkg.go.dev/std), [Gio Windows](https://gioui.org/doc/install/windows), [Gio Linux](https://gioui.org/doc/install/linux), [Fyne quick start](https://docs.fyne.io/started/quick/), [Fyne widgets and tools](https://docs.fyne.io/started/).

### What Go does not remove

Go does not provide the present ZIP/7z behavior as a complete standard-library replacement. Its ZIP reader supports the standard built-in compression methods and permits additional decoders. A Modkeeper port still needs a 7z implementation and a decision on all currently accepted codecs and encrypted-archive error behavior.

TOML, semantic-version constraints, BLAKE3, Windows junctions, copy-on-write cloning, and reliable process-path inspection still require libraries or platform code. Preserve current path validation, duplicate-entry checks, collision rules, link handling, cleanup on failure, and serialization formats.

Sources: [Go ZIP](https://pkg.go.dev/archive/zip), local src-tauri/Cargo.toml, src-tauri/src/utils/archive.rs, and the archive/security tests.

Go's runtime includes garbage collection. Its memory and CPU tradeoff depends on allocations and workload. A language change alone does not establish lower memory use or faster imports.

Source: [Go garbage collector guide](https://go.dev/doc/gc-guide).

Wails v3 changes the backend language while retaining a WebView. Its current installation guide requires WebView2 on Windows, and GTK4 with WebKitGTK 6.0 on Linux. Therefore it does not meet a goal of removing the web UI runtime.

Source: [Wails v3 installation](https://v3.wails.io/getting-started/installation/), checked 8 November 2026.

No native Go application or dependency graph was implemented in this phase. A numerical Go package, memory, speed, or binary-size saving would be speculation.

## Port scope in the current code

| Inventory | Files | Physical lines |
| --- | ---: | ---: |
| Rust application source | 37 | 4,498 |
| Rust integration tests | 10 | 2,618 |
| Frontend TS, TSX, and CSS | 138 | 10,062 |
| Active redesign directory, a subset | 62 | 4,555 |

These are source inventories, not effort estimates. The frontend total includes generated and older code. The redesign uses shared files outside that directory. Language-independent fixture data can remain useful in a Go port; Rust test code must be ported where relevant.

The domain services are largely separate from Tauri. Direct coupling is concentrated in application startup, commands, state injection, task dispatch, and events. Specta derives and generated TypeScript bindings provide the current IPC contract.

A GPUI trial can call a Rust domain service directly. A Go port must recreate filesystem, archive, process, deployment, persistence, and recovery behavior. A Rust/Go bridge would retain both toolchains and add an interface, so it is not the preferred first step.

Evidence: src-tauri/src/lib.rs, commands/global.rs, commands/library.rs, core/library_service.rs, core/global_service.rs, models/workspace.rs, src/gen/bindings.ts, and src/redesign/data/library-repository.ts.

## SPT 5.0 work is independent of UI choice

Current Modkeeper accepts the version range ^4. Its existing test confirms rejection of 5.0.0. It can recognize SPT and SPT_Runtime layouts, but that does not establish full 5.0 support.

The current library model binds one game root to one SPT version. Deployment mutates that tree in place. Manifest, cache, and deployment records are written separately. Transient mod snapshots do not preserve a complete installation.

The first implementation should therefore add generation identity, validated base import, isolated staging, complete-state ownership, writer checks, selection recovery, and rollback. Keep these operations below the UI adapter.

The official SPT 5.0 guide remains a Bleeding Edge guide. The archive's exact EFT target, build identity, and hash matter. SPT's .NET 10 requirements remain regardless of Modkeeper's language.

Source: [official SPT 5.0 guide](https://github.com/SP-Tushonka/wiki/blob/main/SPT_50/bleeding-edge-install-instructions.md). See the companion plan for pinned launcher and server source evidence.

## Next phase and its completion test

Recommended next phase: implement the smallest managed-generation engine in Rust. Use full copies when a tested clone operation is unavailable, if that disk cost is accepted. Keep old versions until explicitly deleted. Add no automatic data merge during rollback.

After that, a GPUI trial should implement one complete user path: select a managed installation, import a representative mod archive, show progress and errors, activate the result, and select a previous generation. A shell that only opens a window is not enough to decide a migration.

Compare equivalent release builds on the same machine and data:

| Measure | Required comparison |
| --- | --- |
| Cold launch | Time until the same mod list is usable |
| Idle memory | Whole application process tree, including WebView child processes |
| Import | Elapsed time, peak memory, cancellation, and failure cleanup for the same archives |
| Installation | Application files plus separately stated shared prerequisites |
| Build | Clean and incremental builds, with cache state recorded |
| UI behavior | Keyboard, Chinese input, screen reader, scaling, file drop, and long-task response |

Do not set a memory-saving percentage before this test.

## Verification and reproduction

The existing SPT fixture passed: 4 passed, 0 failed, 1 ignored. The ignored test requires an actual game installation.

A separate synthetic filesystem check passed copy isolation and old-data rollback. Hardlink and directory-symlink writes changed their source. The repository mount did not support cp --reflink=always. No actual SPT 5.0 game, launcher, or server was run.

Count production dependencies with:

```sh
nix develop .#default --command cargo tree --locked \
  --manifest-path src-tauri/Cargo.toml \
  --target x86_64-unknown-linux-gnu \
  --edges normal,build --prefix none --no-dedupe --format '{p}'
```

Count each distinct package name/version once, excluding the application. Repeat with x86_64-pc-windows-msvc. For the GPUI scenario, use a temporary manifest that removes the listed UI/build roots and adds gpui = "=0.2.2". Seed it with the original Cargo.lock and verify that retained direct dependencies keep their baseline versions. Resolve once, keep its lockfile, and repeat the same tree command.

Do not substitute all Cargo.lock entries or a naive cargo metadata traversal for this count. Those include a different platform, feature, or development scope.

The source Cargo.lock SHA-256 is c63f0467ea0986af03d51101125c6c05e83a4fd70d8f15ff38ce71ae59b0bdad. The GPUI scenario lock SHA-256 is affb19cd5cdf730376be209d5dd1588dd6d21e519694be3b1953ec71d13ce1d5.

Temporary measurement records are under /tmp/modkeeper-phase1-root and /tmp/modkeeper-deps-assessment-a00e1790 on Abrego. The final GPUI counts are in gpui-counterfactual/tree-report.json. Earlier metadata reports have a different scope and are not the figures used here.

## Decisions at this phase end

1. Next work: managed-generation engine in Rust, GPUI trial, or Go trial. Recommendation: generation engine.
2. Storage: allow full-copy fallback, or require verified shared immutable assets in the first release. Recommendation: allow full copy with a free-space check.
3. Platform: native Windows only, or Windows plus Linux/Proton. Recommendation: native Windows first. Add WSL control only if it is a required user path.

The choice to roll back saved data with the old generation is already recorded.
