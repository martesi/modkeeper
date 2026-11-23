# Wails v3 development, bindings, and native build

The application uses Wails v3. Run commands from the repository root. Run `bun install` before frontend commands.

## Development

Run `bun run dev:wails` to start Vite with the Wails development flags. Run `nix develop -c wails3 dev -config ./build/config.yml -port 34115` to start the native Wails development app (the `-port` must match Vite's Wails port in `vite.config.ts`). Browser mode is useful for UI work, but it does not test native IPC.

To run the headless Wails server backend with Vite HMR, run `nix develop .#default -c task dev:server`. The Go backend listens on `127.0.0.1:8080`; Vite is served at `http://127.0.0.1:34116/`. Set `MODKEEPER_SERVER_PORT` or `WAILS_VITE_PORT` to override those ports. The bind configuration lives in Go (`serverOptions` in `main_server.go`); `MODKEEPER_SERVER_HOST` and `MODKEEPER_SERVER_PORT` override it for ad-hoc runs. The task builds the Wails frontend first so the embedded asset server can answer its root readiness check. It then builds the Go app with the `server` build tag and starts Vite with `/wails` HTTP and WebSocket traffic proxied to the backend. `WAILS_APP=true` makes the frontend take the Wails code path; the `@wailsio/runtime` package then loads `/wails/custom.js` through the proxy for the event WebSocket. This path uses the real Go-backed Wails IPC over WebSocket; it is not an in-memory frontend mock. Stop the task with Ctrl-C to stop both processes.

`task build:server` builds the frontend and a server-tagged executable at `build/bin/modkeeper-server`. `task run:server` builds and runs that executable. Run these tasks inside the Nix development shell.

## Server mode

The server build serves the same frontend bundle as the desktop app, but a browser page has no native Wails environment: `window._wails.environment` exists only in the desktop webview. The frontend therefore treats server and plain-browser pages as path-entry surfaces. The frontend subscribes to `wails:runtime-config-ready` and the window `load` event, so capability-dependent controls update after the native environment arrives instead of keeping a first-render value.

In server mode these work end to end:

- Create the first library by entering the game root path or browsing folders on the server host.
- Add mod archives by entering one archive path per line or separating paths with commas, or browse server-host folders and select archive files.
- Browse, search and install from the Forge registry.
- Enable, disable, delete, sync and rebuild the library cache.

These need the desktop app:

- Native file and folder pickers.
- OS drag and drop into the window.
- Opening a file or folder in the OS file manager.
- Window minimize, maximize and close controls.

Paths and folder listings come from the server host filesystem, not from the browser machine. A remote browser user must use paths exactly as the server host sees them. This branch supports path entry and server-host directory browsing, not file upload from the browser.

### Server trust boundary

Treat every server-mode client as trusted with the server process's filesystem permissions. The Wails RPC can list any absolute directory that the server process can read; other backend operations can also access paths using that process's permissions. Server mode does not provide user authentication or authorization. The default bind is loopback, but `MODKEEPER_SERVER_HOST` can expose it on another interface. If you bind beyond loopback, put the service behind an external access-control boundary and allow only trusted users. Origin checks are not authentication.

Assumption: the person who configures a library can name paths that exist on the server host.

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
