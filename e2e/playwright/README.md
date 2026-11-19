# Web E2E

Install dependencies with `bun install`, then install the Playwright Chromium
browser with `bunx playwright install chromium`. Run `bun run test:e2e`.
The suite starts Vite with the task fixture enabled, or reuses a server already
on port 1420. The mock backend is enabled by `VITE_E2E_MOCK=1`; task progress
is enabled by `VITE_E2E_TASK_PROGRESS=1`. Either enables the task event mock
bus. A reused server must set the relevant variable before it starts.

For Wails v3 native development, run `nix develop -c wails3 dev
-config ./build/config.yml`. The app uses Wails v3.1.0 services and
`@wailsio/runtime` events. Generate Go service bindings with:

```sh
nix develop -c wails3 generate bindings -ts -i -dir . -d frontend/bindings ./...
bun scripts/prune-wails-bindings.ts
```

The Playwright suite runs against the frontend and uses the in-memory Wails
mock; it does not exercise native IPC or native window behavior.

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
sync, native window behavior, or persisted settings. Retain native smoke tests
for those paths.
