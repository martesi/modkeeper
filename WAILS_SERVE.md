# Wails v3 development and build

This app uses Wails **v3.1.0**. The v3 CLI reads `build/config.yml`; it does not
use the v2 `wails.json` file. Run commands from the repository root:

```sh
nix develop .#e2e -c wails3 dev -config ./build/config.yml
nix develop -c wails3 build
```

The dev config runs the Vite server on `http://127.0.0.1:34115/`. `GET /` is
the frontend readiness check. The web page is served by Vite, not by the native
window, and browser mode does not validate native IPC.

Go services are generated under `frontend/bindings/github.com/martes/modkeeper/backend`.
The frontend calls `App.<Method>(...)` from those generated Wails bindings. V3
events use `@wailsio/runtime` (`Events.On`, `Events.Once`, `Events.Emit`) and
the custom event names registered in `main.go`. Regenerate bindings after Go
service or event changes:

```sh
nix develop -c wails3 generate bindings -ts -i -dir . -d frontend/bindings ./...
```

The frontend adapter keeps the Tauri transport and in-memory browser mock for
their existing paths. This smoke mode checks the page shell only. Use a native
Wails window to test Go service calls and events.

## Native build and linkage check

Run the native build and linkage check with:

```sh
scripts/native-smoke.sh
```

The script installs frontend dependencies, builds `dist/`, builds the Wails
application, and checks its dynamic dependencies for WebKitGTK 4.1 and libsoup3.
It fails if it finds the legacy WebKitGTK 4.0 or libsoup2 dependencies. It also
requires `xvfb-run`. A successful build and linkage check do not prove native
window startup, service binding, or event delivery; this repository does not yet
provide those observations. The script exits unsuccessfully rather than report
an unverified native smoke as passing.
