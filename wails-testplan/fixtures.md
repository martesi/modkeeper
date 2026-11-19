# Portable parity fixture specifications

Keep tests self-contained. Create a fresh temporary root per test and remove it
with the test framework's cleanup hook. Use absolute canonical paths where path
comparison matters. Never use the developer's real game or config directories.

## Game and library fixture

```text
<tmp>/
  game/
    EscapeFromTarkov.exe                 # non-empty stub
    SPT/ or SPT_Runtime/
      SPT.Server.exe                     # non-empty stub
      SPT.Server.deps.json               # synthetic runtimeTarget/targets JSON
      user/mods/
    BepInEx/plugins/
  repo/
    manifest.toml
    mods/
    backups/
```

Allow choosing either SPT server root, version metadata, and whether each tree
exists. Keep version values such as `4.1.6`, `5.0.0`, unsupported `5.1.0`, and
malformed `{}` as table-driven inputs. Include both server and client executables
when testing normal library creation. Test ambiguous roots by creating both
`SPT/` and `SPT_Runtime/` with server executables. Store all fixture paths
inside the temporary root.

## Mod tree fixtures

- Server-only: `SPT/user/mods/<Name>/mod.dll`.
- Client-only: `BepInEx/plugins/<Name>/client.dll`.
- Combined: both server and client payloads in one package.
- Executables: root-level `.exe` plus a nested `.exe` under a mod's `tools/`.
- Invalid tree: unrelated `.dll` outside recognized mod roots.
- Add `.txt` beside recognized `.dll` files to verify ignored files do not
  alter generated IDs.
- Include nested files and an existing destination file for recursive overwrite
  checks.
- For security checks, create a sibling `outside/keep.txt` sentinel. Attempt
  unknown, empty, dot, traversal (`../` and `..\\`), absolute, and stream-like
  IDs. Assert the sentinel and outside tree remain unchanged.

## Archive samples

Build deterministic archives in memory or in the temp root. ZIP sample entries:

```text
SPT_Runtime/user/mods/Example/mod.dll
BepInEx/plugins/Example/client.dll
```

Write a known byte payload to each entry and assert exact deployed bytes.
Provide variants for SPT 4 and 5 layouts, a package containing both old
`SPT/` and new `SPT_Runtime/` roots (must reject), and an unprocessed directory
with conflicting paths (deployment collision must not replace existing data).
Do not depend on downloaded or real-world archives.

## Config, registry, and recovery

- Config: isolated `config.toml`; cases include absent, partial settings,
  valid saved config, malformed TOML, and a destination path that is a directory
  to force save failure. Assert malformed data remains byte-for-byte unchanged
  and atomic writes leave no temporary file.
- Migration: legacy config points to two temp library roots; one has a valid
  manifest with a stable ID, another has no readable manifest. Assert adoption
  versus fresh ID and active-library mapping.
- Registry: in-memory registry with temp config path, empty active library,
  independent in-flight task set, and controllable watch/channel equivalent.
  Avoid real process inspection except behind an OS-specific adapter.
- Recovery journal: synthetic journal in the temp config directory plus
  `original` and `quarantine` objects. Cover staged/committed phases, registered
  and unregistered library IDs, conflicting root ownership, missing config file,
  and absent config directory. On blocked recovery, assert journal and
  quarantine remain intact.

## Link and deployment cases

Use real temp files for symlink/hardlink semantics. Skip or adapt only when the
platform cannot create the relevant link type; keep collision and source
preservation assertions. For purge safety, create owned deployment records and
vary redirected directories, relative link targets, dangling external targets,
long link names, missing artifacts, and recovery manifests. Permission-based
tests must detect unsupported privilege environments and report an explicit
skip rather than weaken the assertion.

## Registry/network responses

No test should call a live SPT or Forge service. For Forge-facing tests, inject
a local fake HTTP server/transport with table-driven responses: valid metadata,
empty body, malformed JSON, non-success status, timeout, and version mismatch.
Assert response parsing and error classification, not the fake server's
implementation details.
