#!/usr/bin/env bun
/**
 * Frontend smoke check for the Wails Vite development server.
 *
 * This does not launch a native Wails window or test Wails runtime bindings.
 * Run `nix develop .#e2e -c wails3 dev -config ./build/config.yml` in one
 * terminal, then run `bun e2e/wails-smoke.ts` in another.
 */
const url = process.env.WAILS_DEV_SERVER_URL ?? 'http://127.0.0.1:34115/'

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  const html = await response.text()
  if (!response.ok || !html.includes('id="root"')) {
    throw new Error(`Unexpected response: HTTP ${response.status}`)
  }
  console.log(`Wails dev frontend is serving the app shell at ${url}`)
  console.log(
    'Manual native check still required: open the Wails window and exercise IPC/events. ' +
      'Tauri uses @tauri-apps/api/event. Wails v3 uses generated frontend/bindings ' +
      'services and @wailsio/runtime Events.On/Events.Emit.',
  )
} catch (error) {
  console.error(
    `Wails frontend smoke failed for ${url}: ${(error as Error).message}. ` +
      'Start `wails3 dev -config ./build/config.yml` first.',
  )
  process.exitCode = 1
}
