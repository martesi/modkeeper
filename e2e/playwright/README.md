# Web E2E

Install dependencies with `bun install`, then install the Playwright Chromium
browser with `bunx playwright install chromium`. Run `bun run test:e2e` in the
development shell, which provides the Wails bindings generator.
The suite starts Vite with the task fixture enabled, or reuses a server already
on port 1420. The mock backend is enabled by `VITE_E2E_MOCK=1`; task progress
is enabled by `VITE_E2E_TASK_PROGRESS=1`. Either enables the task event mock
bus. A reused server must set the relevant variable before it starts.

For Wails v3 native development, run `nix develop -c wails3 dev
-config ./build/config.yml`. The app uses Wails v3.1.0 services and
`@wailsio/runtime` events. The Go service bindings are generated, not
committed. Development and build commands generate them before starting the
frontend. To generate them separately, run:

```sh
nix develop -c bun run bindings:wails
```

`e2e/playwright/` uses the in-memory Wails mock; it does not exercise real IPC
or native window behavior. `e2e/server/` uses the real server binary and its
embedded Wails frontend. To build and run those journeys on Linux:

```sh
nix develop .#default -c bun run build:wails
nix develop .#default -c go build -tags server -o build/ci/modkeeper-server .
nix develop .#e2e -c bun run test:e2e:server
```

Build the frontend without `VITE_E2E_MOCK` and `VITE_E2E_TASK_PROGRESS` set.
Each test starts its own server on a loopback port and owns a temporary home,
configuration, game roots, and archive. The fixture removes that state after
the server exits. `MODKEEPER_E2E_BINARY` may point to a prebuilt server; the
default is `build/ci/modkeeper-server` (with `.exe` on Windows). The fixture
uses platform paths and sets both Windows and XDG configuration variables for
future Windows CI; Windows execution has not yet been verified. Tests do not
reuse a running server. Native window behavior is outside server-mode coverage.

For agent exploration, set `ARCA_E2E_HARNESS` to the bundled E2E skill's
`scripts/harness.ts` path. Then run:

```sh
bun "$ARCA_E2E_HARNESS" start --config .config/arca.toml --session review
bun run test:agent snapshot
bun "$ARCA_E2E_HARNESS" playwright --config .config/arca.toml --session regression -- test
bun "$ARCA_E2E_HARNESS" stop --config .config/arca.toml
```

The task-center spec installs a Wails in-memory event mock before app startup.
It exercises frontend routing and event delivery, but not real IPC, backend
sync, native window behavior, or persisted settings.
