# Dependency update and security review — 2026-11-02

The dependency refresh covers the Bun and Cargo manifests and lockfiles, Nix
inputs, and GitHub Actions. This is a targeted review of archive import,
deletion, deployment metadata, Markdown rendering, and Tauri configuration.

## Dependency findings

Audits use Bun 1.4.4 against the npm advisory service and cargo-audit 0.22.2
against the current RustSec database. Counts describe the locked graphs and
the databases consulted during this review.

| Check                                                    | Before                                                        | After                                           |
| -------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| npm advisory records, including development dependencies | 153 records / 137 distinct advisories across 35 package names | 3 advisories across 3 development-only packages |
| npm production dependencies                              | Vulnerable packages were present                              | 0 findings across 244 checked packages          |
| Rust vulnerability findings                              | 12                                                            | 0                                               |
| Rust informational warnings                              | 27                                                            | 6                                               |

The Rust updates include Tauri 2.12.5, ZIP 9.2.1, sevenz-rust2 0.24.2,
Zstandard 0.14.3, zstd-safe 8.2.0, TOML 1.1, and sysinfo 0.40.1.
Frontend updates include Vite 8, Lingui 6, Storybook 10, Jotai 3, Babel 8,
React 19.3, and the current Tauri JS packages. Generated bindings use the
updated exporter; the frontend adapter selects serialized output types.

Compatibility exceptions are deliberate:

- TypeScript 6.0.3: typescript-eslint 8.72.1 rejects TypeScript 7 at startup.
  Bun ambient types are now explicitly enabled for TypeScript 6.
- ESLint and @eslint/js 9.39.5: eslint-plugin-react 7.37.5 does not declare
  support for ESLint 10. Both remain on the latest supported major.
- Specta rc.26 and specta-typescript 0.0.13: the newest tauri-specta rc.26
  requires this exact pair. Specta rc.27 and exporter 0.0.14 cannot resolve
  with it.

The unused SWC Vite plugin and its explicit postinstall trust were removed.
Lingui uses its native macro transform before the Babel React Compiler pass.
CI uses Bun 1.4.4, locked Cargo resolution, immutable action revisions, and
installation with lifecycle scripts disabled. Checkout credentials are not
persisted. The Tauri action was migrated to v1's `releaseAssetNamePattern` input.

The sysinfo upgrade also makes process-inspection initialization fallible.
The Windows guard now propagates a logged structured error and blocks the
operation when inspection is unavailable. A Windows-specific regression
checks that this failure is not interpreted as permission to deploy.

## Application issues fixed

- **Deletion path traversal:** `remove_mod` previously joined an unchecked IPC
  mod ID to both the backup and mod directories, even if that mod was absent
  from the library. Absolute paths or traversal strings could therefore reach
  recursive deletion outside the library. It now rejects unknown IDs and
  unsafe path components before any cleanup. The regression test also checks
  forged matching manifest entries and preservation of external fixture files.
- **ZIP special permissions:** the custom extraction code preserved the full
  archive-provided Unix mode, independently of the ZIP crate's safe extraction
  helper. It now strips SUID, SGID, and sticky bits while retaining ordinary
  executable permissions, and propagates permission-setting errors. A crafted
  central-directory regression verifies the extracted mode is 0755, not 06755.
  Privilege impact depends on the account running extraction and execution.
- **Archive path aliases:** ZIP and 7z preflight now reject alternate stream
  names, trailing-dot/space aliases, control characters, and ASCII case-folded
  duplicate/file-parent collisions. Validation happens before entries are
  written. These checks are enforced on Linux as well as Windows.

The archive checks do not constitute a complete model of every filesystem's
Unicode case folding or Windows reserved-device naming behavior.

## Remaining dependency findings

All three npm findings are outside the production dependency graph:

| Package          | Introduced by                                            | Advisory and disposition                                                                                                                                                    |
| ---------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deepmerge 4.3.1  | shadcn / @shadcn/registry                                | [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), low: prototype poisoning; no published patch listed. Avoid untrusted component registries.        |
| glob 13.0.6      | Storybook's React docgen plugin                          | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), moderate: traversal can continue after cancellation; fixed in 14.0.2, outside the parent's range. |
| minimatch 3/9/10 | ESLint, TypeScript ESLint, shadcn, and Storybook tooling | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate: pattern amplification; fixed in 11.0.1, outside parent ranges.                          |

No cross-major overrides or advisory suppressions were added. In particular,
eslint-plugin-react calls minimatch's old callable export; forcing minimatch
11 globally would break that consumer. Updating the owning tools is preferred.

Rust warnings remain visible:

- [glib / RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html):
  unsound VariantStrIter implementations in glib 0.18.5, reached through the
  Linux GTK/WebKit dependency stack. The fix requires glib >=0.20, incompatible
  with the stack's current bindings. Application source does not directly use
  VariantStrIter; that does not prove absence of transitive reachability.
- [paste / RUSTSEC-2024-0436](https://rustsec.org/advisories/RUSTSEC-2024-0436.html)
  and [proc-macro-error / RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html):
  unmaintained compile-time dependencies through Specta/Tauri and GTK macros.
- zvariant, zvariant_derive, and zbus_names:
  [RUSTSEC-2026-0370](https://rustsec.org/advisories/RUSTSEC-2026-0370.html),
  [RUSTSEC-2026-0372](https://rustsec.org/advisories/RUSTSEC-2026-0372.html), and
  [RUSTSEC-2026-0371](https://rustsec.org/advisories/RUSTSEC-2026-0371.html).
  These unmaintained dependencies enter through tauri-plugin-opener's zbus
  integration. Their current compatible versions remain selected upstream.

## Application follow-up findings

1. **Persisted metadata containment — priority follow-up.** Library loading
   trusts cached file paths and recorded deployment targets/directories from
   TOML. Deployment and cleanup subsequently join them to roots without a
   universal containment check. Forged local library metadata could influence
   writes or cleanup outside the game directory. The deletion-ID guard above
   does not fix this separate path. Validate all stored relative paths and
   their resolved ancestors before sync or cleanup. This was identified from
   source inspection; an end-to-end exploit of forged deployment metadata was
   not exercised. Ordinary archive import does not supply these TOML records.
2. **Archive resource limits.** Extraction lacks entry-count, decompressed-byte,
   and time limits. A malicious ZIP/7z can consume disk/CPU, and the current
   collision scan has quadratic worst-case cost. Add streaming byte budgets
   and bounded preflight with transactional staging cleanup.
3. **CSP disabled.** `src-tauri/tauri.conf.json` sets `csp: null`. This removes
   defense against a future frontend injection issue; no executable Markdown
   injection was demonstrated. React Markdown currently has no raw-HTML plugin.
   Add a tested policy compatible with IPC, local assets, dynamic styles, and
   next-themes' inline bootstrap. See [Tauri CSP guidance](https://v2.tauri.app/security/csp/).

These follow-ups are not resolved by a clean package vulnerability count.

## Validation

- Frozen Bun 1.4.4 installation with scripts disabled passed.
- Bun tests: 8 passed, including generated command/error/event contract tests.
- Rust tests: 76 passed; one real-installation inspection test remains ignored
  because it requires an explicit SPT installation path.
- Rust formatting and Clippy for all targets/features passed on Linux.
- Both GitHub Actions workflows passed local actionlint validation.
- Frontend production build and Storybook production build passed.
- Changed TypeScript source and Vite configuration pass ESLint; Vite config and
  the binding contract tests pass dedicated TypeScript checks.
- Native Linux/WebKitGTK startup and Settings navigation rendered on an
  isolated X11 display with isolated application data. Screenshots were
  inspected. Browser fixture checks passed for search, dark theme, and settings
  retention during navigation. Browser fixture data is intentionally in memory;
  these checks do not establish persistence across application restarts.
- The full `tsc -b` check still fails on existing legacy UI references to
  removed commands/types. An untouched HEAD checkout reported 45 diagnostics;
  the refreshed code reports 44 after resolving ambient Bun types and the old
  generated unused import. Changed frontend source has no new type errors.
- Full frontend lint reports seven issues in unchanged source. Four were
  present with the original dependencies; three are newly enforced
  `react-hooks/set-state-in-effect` diagnostics on existing legacy components.
  These were not suppressed.
- Development rendering logs a React warning about next-themes' inline script.
  Theme switching was verified despite that diagnostic.

Windows GUI runtime, Windows ARM64, and gameplay were not exercised. The
Windows x64 GNU cross-check passed for all targets and features, including
the updated process guard and its Windows-specific tests. This checks
compilation; those Windows tests were not executed on Linux.

Recheck advisories with `bun audit --json`, `bun audit --prod`, and
`cargo audit --file src-tauri/Cargo.lock`. Use `nix develop` for Cargo commands.
