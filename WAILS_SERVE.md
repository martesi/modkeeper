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
their existing paths. The browser readiness check does not validate native IPC.
Use the native smoke command below to test Go service calls and events.

## Native build and linkage check

Run the native build and linkage check with:

```sh
scripts/native-smoke.sh
```

The script installs frontend dependencies, builds `dist/`, builds the Wails
application, and checks its dynamic dependencies for WebKitGTK 6.0 or 4.1 and
libsoup3. It fails if it finds the legacy WebKitGTK 4.0 or libsoup2 dependencies.
The default Nix dev shell includes `xvfb-run`; run the script inside Xvfb with:

```sh
nix develop -c xvfb-run -a scripts/native-smoke.sh
```

With `MODKEEPER_NATIVE_SMOKE=1`, the app binds a smoke-only service and opens the
frontend smoke module. The module calls the generated `GetSettings()` binding and
checks the defaults (`system`, `default`, `en-US`, `true`) before reporting the
returned value to Go. It then subscribes with `@wailsio/runtime` `Events.On`.
Go uses Wails v3.1.0 `WebviewWindow.ExecJS` to set a window marker and
`WebviewWindow.EmitEvent` to send the registered event. The frontend event
listener checks the marker, records the payload, and reports both to Go. Go
checks the exact payload and marker. Each step has a bounded deadline. The
script passes only when process startup, the settings round trip, and event
delivery all pass.
