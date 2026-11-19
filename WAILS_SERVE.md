# Wails v3 development, bindings, and native build

The application uses Wails v3. Run commands from the repository root. Run `bun install` before frontend commands.

## Development

Run `bun run dev:wails` to start Vite with the Wails development flags. Run `nix develop -c wails3 dev -config ./build/config.yml` to start the native Wails development app. Browser mode is useful for UI work, but it does not test native IPC.

## Native build

Build the native frontend and app inside the Nix development environment with:

```sh
nix develop -c bun run build:native
```

This script runs `bun run build:wails` and then `wails3 build`. The Wails CLI builds the existing `dist/` directory; it does not build the frontend first. `bun run build` is not the native build path: it embeds `WAILS=false` and uses the Tauri fallback. Native frontend bundles must be built with `WAILS_APP=true` (`build:wails` sets it). Runtime detection also accepts `window._wails.environment`, which Wails injects in the native webview. That runtime marker is a safety net, not the primary build switch.

The native smoke builds the frontend with `bun run build:wails`, then builds and launches the native app. Run it under Xvfb with:

```sh
nix develop -c xvfb-run -a scripts/native-smoke.sh
```

The smoke checks native service binding and event delivery. It also checks that the binary links WebKitGTK 6.0 or 4.1 and libsoup3, not WebKitGTK 4.0 or libsoup2.

## E2E

Run `PLAYWRIGHT_CHROMIUM_EXECUTABLE=<chromium-executable> bun run test:e2e`. Playwright starts Vite and tests the frontend. The task-center test uses the Wails in-memory mock. It does not test native IPC, backend synchronization, native window behavior, or persisted settings.

## What works end to end

The Go `TestAppSurfaceEndToEnd` test (`backend/app_integration_test.go`) exercises library
creation, settings persistence, ZIP installation without changing the source archive, bulk
enable/disable, sync into the game tree with a `sync_completed` event, and cache rebuild.
The native smoke separately proves settings IPC round-trip and event delivery through the
native Wails runtime.

## Wails bindings

Wails service bindings live under `frontend/bindings`. Regenerate them after Go service changes:

```sh
nix develop -c wails3 generate bindings -ts -i -dir . -d frontend/bindings ./...
bun scripts/prune-wails-bindings.ts
```

The prune script removes generated files that are not part of the supported frontend binding surface. This keeps generated output deterministic and avoids unrelated generated API leaking into the frontend. Check the pruned output with `bun scripts/prune-wails-bindings.ts --check`.
