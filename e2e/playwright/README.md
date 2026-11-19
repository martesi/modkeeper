# Web E2E

Install dependencies with `bun install`, then install the Playwright Firefox
browser with `bunx playwright install firefox`. Run `bun run test:e2e`.
The suite starts Vite with the task fixture enabled, or reuses a server already
on port 1420. A reused server must also set `VITE_E2E_TASK_PROGRESS=1`.

For agent exploration, set `ARCA_E2E_HARNESS` to the bundled E2E skill's
`scripts/harness.ts` path. Then run:

```sh
bun "$ARCA_E2E_HARNESS" start --config .config/arca.toml --session review
bun run test:agent snapshot
bun "$ARCA_E2E_HARNESS" playwright --config .config/arca.toml --session regression -- test
bun "$ARCA_E2E_HARNESS" stop --config .config/arca.toml
```

The current integration base still imports the Tauri event API directly.
The spec injects a temporary Tauri event shim before page load, boots with the
browser workspace, and enables the native event listener before registering its
synthetic task. Replace that shim with G2's `window.go` and runtime mock after
the task repository uses the Wails bridge. This test does not cover real IPC,
backend sync, native window behavior, or persisted settings; retain the native
smoke tests for those paths.
