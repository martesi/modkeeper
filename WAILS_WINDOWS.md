# Wails Windows builds

Modkeeper's Wails v3 Windows release is cross-compiled from Linux. The backend
is pure Go, so the build uses `GOOS=windows`, `CGO_ENABLED=0`, and does not
need a Windows Go toolchain or a MinGW linker. The frontend is a static Vite
bundle, and Wails embeds the generated Windows resource object into the Go
executable.

## Build and package

From the repository root, the reproducible release command is:

```sh
./scripts/build-windows.sh
```

The script enters `nix develop .#windows` when Nix is available. That shell
contains Go, Bun, Wails v3, NSIS, and Python for the header checks. It runs the
Wails frontend build, then creates:

- `build/bin/modkeeper-amd64.exe`
- `build/bin/modkeeper-arm64.exe`
- `build/bin/modkeeper-amd64-machine-installer.exe`
- `build/bin/modkeeper-amd64-user-installer.exe`
- `build/bin/modkeeper-arm64-machine-installer.exe`
- `build/bin/modkeeper-arm64-user-installer.exe`

To run the tasks directly inside the shell:

```sh
nix develop .#windows -c wails3 task build:windows
nix develop .#windows -c wails3 task package:windows
```

The first task builds the frontend and both executables. The second task also
generates the WebView2 online bootstrapper and builds machine- and user-scope
NSIS installers for each architecture. An internet connection is required the
first time the bootstrapper is generated.

The complete Linux verification command rebuilds everything and checks the PE
headers, GUI subsystem, `.rsrc` resource section, NSIS output, WebView2
reference, and expanded installer/uninstaller executable paths:

```sh
./scripts/verify-windows.sh
```

The Windows icon is generated from the 256px Tauri source when the tracked
asset needs to be refreshed:

```sh
nix develop .#windows -c wails3 generate icons \
  -input src-tauri/icons/128x128@2x.png \
  -macfilename /tmp/modkeeper-wails-icon.icns \
  -windowsfilename build/windows/icon.ico
```

`build/windows/info.json` and `build/windows/nsis/version.nsh` are generated
at build time by `scripts/generate-windows-info.ts` from the read-only
`package.json` version. They are ignored by Git. The tracked Windows manifest
contains the matching assembly version and the generator fails if it drifts.
The WebView2 bootstrapper and architecture-specific `.syso` files are also
ignored and are never release source files.

## Verification boundary

Verified on this Linux host:

- both PE architectures, Windows GUI subsystem, and Wails `.rsrc` resources;
- NSIS machine/user installers for amd64 and arm64;
- WebView2 bootstrapper inclusion in the expanded NSIS script;
- installer file payload and uninstall registry paths targeting
  `modkeeper.exe`;
- Linux Go compilation with `nix develop -c go build ./...`.

Still requiring a real Windows host (ideally one x64 and one ARM64 test
machine or a supported ARM64 VM):

- launching the executables and exercising the native Wails window, WebView2,
  IPC, file links, and SPT process checks;
- confirming the WebView2 runtime is detected, downloaded, and installed by
  each installer when absent, including offline/error behavior;
- validating UAC, per-user versus machine registry entries, shortcuts,
  install/upgrade/uninstall cleanup, and Windows long-path behavior;
- Authenticode signing, timestamping, SmartScreen reputation, and release
  signing policy;
- ARM64 hardware behavior and installer architecture selection.

This cross-build does not replace the existing Tauri workflow; it gives the
Wails port a releasable Windows artifact path from Linux. See the root
`Taskfile.yml` and the included `build/windows/Taskfile.yml` for the upstream
Wails resource/NSIS structure.
