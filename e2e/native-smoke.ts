#!/usr/bin/env bun
/**
 * Native end-to-end smoke test for the Modkeeper Tauri app on Linux.
 *
 * What it does, in order:
 *   1. builds a simulated SPT game root under /tmp/opencode/e2e
 *   2. creates a real library through `Library::create` (temporary cargo example, always removed)
 *   3. seeds the debug App Config next to that library
 *   4. builds the React UI and serves it on http://localhost:1420 (debug builds load that URL)
 *   5. lets WebKitWebDriver launch the real Tauri binary (TAURI_WEBVIEW_AUTOMATION=true)
 *   6. asserts the React UI booted, the library renders, the theme toggles through real IPC
 *      (persisted config_debug.toml) and captures three screenshots
 *
 * Reproduce from the repo root:
 *   nix develop .#e2e -c bun e2e/native-smoke.ts
 *
 * Optional: --screenshots <dir> (defaults to docs/argus-benchmark/screenshots)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  assertPng,
  assertSeedHelperRemoved,
  createLibrary,
  E2eError,
  ensureAppBinary,
  injectBootErrorTrap,
  findFreeDisplay,
  findFreePort,
  isPortOpen,
  parseAppConfig,
  prepareScratchTree,
  readIfExists,
  readPrimaryTokens,
  repoRoot,
  runOnce,
  seedGameRoot,
  sleep,
  spawnLogged,
  stopProcess,
  tail,
  waitFor,
  writeAppConfig,
  type ManagedProcess,
  type SeedPaths,
} from './fixtures/harness'
import { WebDriverClient } from './fixtures/webdriver'

// next-themes renders an inline <script> via React; React 19 dev builds log this exact warning.
// It is a dev-only, upstream warning (the app works), so the boot scan reports it as allowlisted
// instead of hiding it or failing the run.
const ALLOWED_CONSOLE_ERRORS = [
  /Encountered a script tag while rendering React component/,
]

type Options = { screenshotsDir: string }

type JsIssue = {
  kind: 'uncaught-error' | 'unhandled-rejection' | 'console.error'
  text: string
}

type State = {
  paths: SeedPaths
  env: Record<string, string>
  binary: string
  library: { id: string; name: string }
  tokens: { light: string; dark: string }
  display: number
  wdPort: number
  client: WebDriverClient | null
  appPid: number | null
  logs: {
    preview: string
    webdriver: string
    build: string
    frontendBuild: string
  }
  screenshots: Record<'libraryLight' | 'libraryDark' | 'settingsDark', string>
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function parseOptions(argv: string[]): Options {
  let screenshotsDir = join(repoRoot, 'docs', 'argus-benchmark', 'screenshots')
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: bun e2e/native-smoke.ts [--screenshots <dir>]',
          '',
          'Runs the native (Xvfb + WebKitWebDriver) smoke test against a simulated SPT root.',
          'Must be invoked inside `nix develop .#e2e` so cargo, WebKitWebDriver, Xvfb and the',
          'GTK/WebKit runtime are on PATH.',
        ].join('\n'),
      )
      process.exit(0)
    }
    if (arg === '--screenshots') {
      const value = argv[++i]
      if (!value)
        throw new E2eError('--screenshots requires a directory argument')
      screenshotsDir = resolve(value)
      continue
    }
    if (arg.startsWith('--screenshots=')) {
      screenshotsDir = resolve(arg.slice('--screenshots='.length))
      continue
    }
    throw new E2eError(`Unknown argument: ${arg}`)
  }
  return { screenshotsDir }
}

// ---------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------

const TOTAL_STEPS = 14
let stepIndex = 0

async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  stepIndex++
  const started = performance.now()
  console.log(`\n[${stepIndex}/${TOTAL_STEPS}] ${label}`)
  try {
    const value = await fn()
    console.log(`      PASS (${Math.round(performance.now() - started)} ms)`)
    return value
  } catch (error) {
    console.log(`      FAIL (${Math.round(performance.now() - started)} ms)`)
    throw error
  }
}

function info(message: string): void {
  console.log(`      · ${message}`)
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2))
  const startedAt = Date.now()
  const state = {} as State

  const processes: ManagedProcess[] = []

  try {
    // ---------------------------------------------------------------------------------------
    await step('preflight: required tools and repo layout', async () => {
      const missing = [
        'Xvfb',
        'WebKitWebDriver',
        'cargo',
        'bun',
        'xdpyinfo',
      ].filter((tool) => !Bun.which(tool))
      if (missing.length > 0) {
        throw new E2eError(
          `Missing required tools: ${missing.join(', ')}. ` +
            'Run this script inside `nix develop .#e2e`.',
        )
      }
      info(`repo: ${repoRoot}`)
      info(
        `tools: ${['Xvfb', 'WebKitWebDriver', 'cargo', 'bun']
          .map((tool) => `${tool}=${Bun.which(tool)}`)
          .join(' ')}`,
      )
    })

    // ---------------------------------------------------------------------------------------
    await step(
      'environment: simulated SPT game root, seeded library, App Config',
      async () => {
        state.paths = prepareScratchTree()
        state.display = findFreeDisplay()
        state.wdPort = await findFreePort()

        if (await isPortOpen('127.0.0.1', 1420)) {
          throw new E2eError(
            'Port 1420 is already in use. Stop the other Vite dev server before running the ' +
              'native smoke test (the debug binary loads http://localhost:1420).',
          )
        }

        state.env = Object.fromEntries(
          Object.entries(process.env).filter(
            ([, value]) => value !== undefined,
          ),
        ) as Record<string, string>
        Object.assign(state.env, {
          XDG_CONFIG_HOME: state.paths.xdg.config,
          XDG_CACHE_HOME: state.paths.xdg.cache,
          XDG_DATA_HOME: state.paths.xdg.data,
          XDG_RUNTIME_DIR: state.paths.xdg.runtime,
          HOME: state.paths.xdg.home,
          DISPLAY: `:${state.display}`,
          TAURI_WEBVIEW_AUTOMATION: 'true',
          NO_COLOR: '1',
          CARGO_TERM_COLOR: 'never',
        })

        seedGameRoot(state.paths.gameRoot)
        info(`game root: ${state.paths.gameRoot}`)

        state.logs = {
          preview: join(state.paths.xdg.home, 'logs', 'preview.log'),
          webdriver: join(state.paths.xdg.home, 'logs', 'webdriver.log'),
          build: join(state.paths.xdg.home, 'logs', 'cargo-build.log'),
          frontendBuild: join(
            state.paths.xdg.home,
            'logs',
            'frontend-build.log',
          ),
        }

        const binary = await ensureAppBinary({
          env: state.env,
          logFile: state.logs.build,
          report: info,
        })
        state.binary = binary.path

        state.library = await createLibrary({
          env: state.env,
          gameRoot: state.paths.gameRoot,
          libraryRoot: state.paths.libraryRoot,
          name: 'Argus Native E2E Library',
        })
        info(
          `Library::create → id=${state.library.id} name="${state.library.name}"`,
        )
        info(`library root: ${state.paths.libraryRoot}`)

        writeAppConfig({
          configFile: state.paths.configFile,
          libraryId: state.library.id,
          libraryRoot: state.paths.libraryRoot,
          theme: 'light',
        })
        info(`app config: ${state.paths.configFile} (theme=light)`)

        state.tokens = readPrimaryTokens(
          join(repoRoot, 'src', 'assets', 'style.css'),
        )
        info(
          `theme tokens: light --primary=${state.tokens.light} dark --primary=${state.tokens.dark}`,
        )
      },
    )

    // ---------------------------------------------------------------------------------------
    await step(
      'display: start Xvfb and wait for it to accept clients',
      async () => {
        const log = join(state.paths.xdg.home, 'logs', 'xvfb.log')
        const managed = spawnLogged({
          name: 'Xvfb',
          cmd: [
            'Xvfb',
            `:${state.display}`,
            '-screen',
            '0',
            '1400x900x24',
            '-nolisten',
            'tcp',
          ],
          cwd: repoRoot,
          env: state.env,
          logFile: log,
        })
        processes.push(managed)
        await waitFor(
          `Xvfb :${state.display}`,
          async () => {
            const result = await runOnce({
              cmd: ['xdpyinfo', '-display', `:${state.display}`],
              cwd: repoRoot,
              env: state.env,
              allowFailure: true,
              timeoutMs: 5_000,
            })
            return result.code === 0
          },
          { timeoutMs: 15_000, intervalMs: 200 },
        )
        info(`display :${state.display} ready (log: ${log})`)
        return managed
      },
    )

    // ---------------------------------------------------------------------------------------
    await step(
      'frontend: build the UI and serve it on :1420 (vite preview)',
      async () => {
        const build = await runOnce({
          cmd: ['bun', 'run', 'build'],
          cwd: repoRoot,
          env: state.env,
          timeoutMs: 5 * 60_000,
          allowFailure: true,
        })
        writeFileSync(state.logs.frontendBuild, build.output)
        if (build.code !== 0) {
          throw new E2eError(
            `frontend build failed (bun run build, log: ${state.logs.frontendBuild})`,
            tail(build.output, 6_000),
          )
        }
        info('bun run build OK (tsc typecheck + vite production build)')

        // The debug binary loads http://localhost:1420; serving the production bundle there makes
        // boot fast and deterministic (no HMR churn from concurrent edits, no dependency-optimize
        // stall that trips the backend's 10s startup watchdog).
        injectBootErrorTrap(join(repoRoot, 'dist', 'index.html'))
        info(
          'boot error trap injected into dist/index.html (gitignored build output)',
        )

        const managed = spawnLogged({
          name: 'vite preview',
          cmd: ['bun', 'run', 'preview', '--port', '1420', '--strictPort'],
          cwd: repoRoot,
          env: state.env,
          logFile: state.logs.preview,
        })
        processes.push(managed)

        await waitFor(
          'vite preview on :1420',
          () => isPortOpen('127.0.0.1', 1420),
          {
            timeoutMs: 60_000,
            intervalMs: 200,
          },
        )
        const res = await fetch('http://127.0.0.1:1420/', {
          signal: AbortSignal.timeout(15_000),
        })
        const html = await res.text()
        if (
          res.status !== 200 ||
          !html.includes('id="root"') ||
          !html.includes('__e2eSmoke')
        ) {
          throw new E2eError(
            `vite preview is not serving the patched app shell (HTTP ${res.status}, ${html.length} bytes)`,
          )
        }
        info('preview serves the app shell with the boot error trap')
      },
    )

    // ---------------------------------------------------------------------------------------
    await step(
      'driver: start WebKitWebDriver and launch the app under automation',
      async () => {
        const managed = spawnLogged({
          name: 'WebKitWebDriver',
          cmd: [
            'WebKitWebDriver',
            '--host=127.0.0.1',
            `--port=${state.wdPort}`,
          ],
          cwd: repoRoot,
          env: state.env,
          logFile: state.logs.webdriver,
        })
        processes.push(managed)

        await waitFor(
          'WebKitWebDriver /status',
          async () => {
            try {
              const res = await fetch(
                `http://127.0.0.1:${state.wdPort}/status`,
                {
                  signal: AbortSignal.timeout(1_000),
                },
              )
              const body = (await res.json()) as { value?: { ready?: boolean } }
              return body.value?.ready === true
            } catch {
              return false
            }
          },
          { timeoutMs: 20_000, intervalMs: 200 },
        )

        // WebKitWebDriver inherits this env and hands it to the launched app; the app's own
        // stdout/stderr are inherited too, so all Rust logs land in the WebDriver log file.
        state.client = await WebDriverClient.start({
          baseUrl: `http://127.0.0.1:${state.wdPort}`,
          binary: state.binary,
        })
        const capabilities = state.client.capabilities
        const pid = capabilities['webkit:processID']
        state.appPid = typeof pid === 'number' ? pid : null
        info(
          `session ${state.client.sessionId} launched ${state.binary} ` +
            `(pid ${state.appPid ?? 'unknown'}, browser ${capabilities.browserName} ${capabilities.browserVersion})`,
        )

        // Install the JS error trap before the SPA finishes booting. Vite's client additionally
        // forwards uncaught errors/rejections to the dev-server log, which covers boot-time throws
        // that happen before this trap exists.
        const readyState = await state.client.execute<string>(
          `return (() => {
          const state = window.__e2eSmoke || (window.__e2eSmoke = { installed: false, errors: [] });
          if (!state.installed) {
            state.installed = true;
            window.addEventListener('error', (event) => {
              state.errors.push({ kind: 'uncaught-error', text: String(event.message || (event.error && event.error.stack) || event.error) });
            });
            window.addEventListener('unhandledrejection', (event) => {
              const reason = event.reason;
              state.errors.push({ kind: 'unhandled-rejection', text: String((reason && reason.stack) || reason) });
            });
            const original = console.error;
            console.error = function (...args) {
              state.errors.push({ kind: 'console.error', text: args.map((arg) => (arg && arg.stack) ? String(arg.stack) : String(arg)).join(' ') });
              return original.apply(console, args);
            };
          }
          return document.readyState;
        })()`,
        )
        info(`JS error trap installed at document.readyState=${readyState}`)
      },
    )

    // ---------------------------------------------------------------------------------------
    await step(
      'assertion 1: window opens and the React UI renders (#root has children)',
      async () => {
        const client = requireClient(state)
        const snapshot = await waitFor(
          '#root to render children',
          async () => {
            const result = await client.execute<{
              ready: string
              children: number
              path: string
            }>(`return {
            ready: document.readyState,
            children: (document.getElementById('root')?.childElementCount) || 0,
            path: location.pathname,
          }`)
            return result.children > 0 && result.ready === 'complete'
              ? result
              : null
          },
          { timeoutMs: 45_000, intervalMs: 250 },
        )
        info(
          `document.readyState=${snapshot.ready}, #root children=${snapshot.children}, path=${snapshot.path}`,
        )
        if (!snapshot.path.startsWith('/library')) {
          throw new E2eError(
            `Expected the app to land on /library, got ${snapshot.path}`,
          )
        }
        // The DOM can render inside an unmapped WebKit view, so confirm the native window really
        // opened on the X display and has the configured 1100x780 size.
        const windowId = await waitFor(
          'native window titled "Modkeeper"',
          async () => {
            const result = await runOnce({
              cmd: ['xdotool', 'search', '--name', '^Modkeeper$'],
              cwd: repoRoot,
              env: state.env,
              allowFailure: true,
              timeoutMs: 5_000,
            })
            return result.code === 0
              ? result.output.trim().split('\n')[0]
              : null
          },
          { timeoutMs: 10_000, intervalMs: 200 },
        )
        const geometryResult = await runOnce({
          cmd: ['xdotool', 'getwindowgeometry', '--shell', windowId],
          cwd: repoRoot,
          env: state.env,
          timeoutMs: 5_000,
        })
        const width = Number(
          /^WIDTH=(\d+)$/m.exec(geometryResult.output)?.[1] ?? 0,
        )
        const height = Number(
          /^HEIGHT=(\d+)$/m.exec(geometryResult.output)?.[1] ?? 0,
        )
        if (width < 1000 || height < 700) {
          throw new E2eError(
            `Native window geometry looks wrong: ${width}x${height} (window id ${windowId})`,
          )
        }
        info(
          `native window ${windowId}: ${width}x${height} (title "Modkeeper")`,
        )

        const watchdogErrors = appErrorLines(state).filter((line) =>
          line.includes('get_library_workspace was not called'),
        )
        if (watchdogErrors.length > 0) {
          throw new E2eError(
            'The backend boot watchdog fired: the frontend did not call get_library_workspace ' +
              'within 10s. The UI may have loaded after a crash.',
            watchdogErrors.join('\n'),
          )
        }
      },
    )

    // ---------------------------------------------------------------------------------------
    await step('screenshot: library screen in light theme', async () => {
      const client = requireClient(state)
      const tokens = await readThemeState(client)
      assertLight(tokens, state)
      await sleep(350) // let theme transitions settle after the computed value is confirmed
      state.screenshots = {
        ...state.screenshots,
        libraryLight: await saveScreenshot(
          client,
          options.screenshotsDir,
          'library-light',
        ),
      }
      info(`saved ${state.screenshots.libraryLight}`)
    })

    // ---------------------------------------------------------------------------------------
    await step(
      'assertion 2: the seeded library renders in the Manage libraries dialog',
      async () => {
        const client = requireClient(state)
        const manageButtons = await client.findElements(
          'xpath',
          "//button[normalize-space(.)='Manage libraries']",
        )
        if (manageButtons.length === 0) {
          throw new E2eError(
            'No "Manage libraries" button found on the library screen',
          )
        }
        await activateElement(client, manageButtons[0])
        await waitFor(
          'Manage libraries dialog',
          async () =>
            (await client.execute<boolean>(
              `return !!document.querySelector('[role="dialog"]')`,
            ))
              ? true
              : null,
          { timeoutMs: 10_000 },
        )

        await waitFor(
          'Manage libraries dialog to finish opening',
          async () =>
            (await client.execute<boolean>(
              `const dialog = document.querySelector('[role="dialog"]');
             if (!dialog || dialog.getAttribute('data-state') !== 'open') return false;
             const style = getComputedStyle(dialog);
             return Number(style.opacity) > 0.99 && style.visibility !== 'hidden';`,
            ))
              ? true
              : null,
          { timeoutMs: 5_000, intervalMs: 100 },
        )

        const tabXpath = `//*[@role='tab' and normalize-space(.)=${xpathLiteral(state.library.name)}]`
        const tab = await waitFor(
          `library tab "${state.library.name}"`,
          async () => {
            try {
              return await client.findElement('xpath', tabXpath)
            } catch {
              return null
            }
          },
          { timeoutMs: 5_000, intervalMs: 100 },
        )
        const tabText = await client.execute<string>(
          `return Array.from(document.querySelectorAll('[role="tab"]')).map((el) => el.textContent.trim()).join(' | ')`,
        )
        if (!tabText.includes(state.library.name)) {
          throw new E2eError(
            `Seeded library "${state.library.name}" is not rendered as a library tab`,
            `tabs present: ${tabText}`,
          )
        }
        const selected = await client.getAttribute(tab, 'aria-selected')
        if (selected !== 'true') {
          throw new E2eError(
            `Library tab "${state.library.name}" exists but is not the active/selected library ` +
              `(aria-selected=${selected})`,
          )
        }
        info(
          `rendered library tab: "${state.library.name}" (aria-selected=true)`,
        )

        await client.pressKey('\uE00C')
        await waitFor(
          'Manage libraries dialog to close',
          async () =>
            (await client.execute<boolean>(
              `return !!document.querySelector('[role="dialog"]')`,
            ))
              ? null
              : true,
          { timeoutMs: 10_000 },
        )
      },
    )

    // ---------------------------------------------------------------------------------------
    await step(
      'assertion 3: clean boot (no uncaught JS errors, no Rust ERROR logs)',
      async () => {
        const client = requireClient(state)
        const issues = await collectJsIssues(client)
        const rustErrors = appErrorLines(state)
        const { allowed, fatal } = classifyConsoleIssues(issues)
        for (const issue of allowed)
          info(`allowlisted upstream dev warning: ${issue.text}`)
        if (fatal.length > 0) {
          throw new E2eError(
            'Uncaught JavaScript error(s) during boot',
            fatal.map((issue) => `[${issue.kind}] ${issue.text}`).join('\n'),
          )
        }
        if (rustErrors.length > 0) {
          throw new E2eError(
            'Rust logged error-level lines during boot',
            rustErrors.join('\n'),
          )
        }
        info(
          'no uncaught JS errors, no unhandled rejections, no Rust ERROR lines',
        )
      },
    )

    // ---------------------------------------------------------------------------------------
    await step(
      'assertion 4: Settings nav → dark theme applies and persists via IPC',
      async () => {
        const client = requireClient(state)
        const before = await readThemeState(client)
        assertLight(before, state)

        const settingsLink = await client.findElement(
          'css selector',
          'nav a[href="/settings"]',
        )
        await activateElement(client, settingsLink)
        await waitFor(
          'navigation to /settings',
          async () => {
            const path = await client.execute<string>(
              'return location.pathname',
            )
            return path === '/settings' ? path : null
          },
          { timeoutMs: 10_000 },
        )
        const heading = await waitFor(
          'Settings heading',
          async () => {
            const text = await client.execute<string>(
              `return document.querySelector('main h1')?.textContent?.trim() || ''`,
            )
            return text.length > 0 ? text : null
          },
          { timeoutMs: 10_000 },
        )
        if (heading !== 'Settings') {
          throw new E2eError(`Expected Settings heading, got "${heading}"`)
        }
        info(
          `navigated via real nav link to ${await client.execute<string>('return location.pathname')}`,
        )

        await clickByRoleText(client, 'radio', 'Dark')
        await sleep(250)
        info(
          `theme control after click: ${await describeThemeControls(client)}`,
        )

        const dark = await waitFor(
          'dark theme to apply (class + --primary token)',
          async () => {
            const theme = await readThemeState(client)
            return theme.dark && theme.primary === state.tokens.dark
              ? theme
              : null
          },
          { timeoutMs: 10_000 },
        ).catch(async (error) => {
          throw new E2eError(
            (error as Error).message,
            `theme controls: ${await describeThemeControls(client)}\n` +
              `js issues: ${JSON.stringify(await collectJsIssues(client))}`,
          )
        })
        if (dark.primary !== state.tokens.dark) {
          throw new E2eError(
            `--primary did not switch to the dark token: ${dark.primary} !== ${state.tokens.dark}`,
          )
        }
        if (before.primary === dark.primary) {
          throw new E2eError(
            '--primary did not change between light and dark themes',
          )
        }
        info(
          `documentElement class="${dark.className}" ` +
            `--primary ${before.primary} → ${dark.primary} (expected ${state.tokens.dark})`,
        )

        const persisted = await waitForPersistedTheme(state, 'dark')
        assertConfigIdentity(persisted, state)
        info(`config_debug.toml on disk now has theme="${persisted.theme}"`)

        await sleep(350)
        state.screenshots = {
          ...state.screenshots,
          settingsDark: await saveScreenshot(
            client,
            options.screenshotsDir,
            'settings-dark',
          ),
        }
        info(`saved ${state.screenshots.settingsDark}`)
      },
    )

    // ---------------------------------------------------------------------------------------
    await step('screenshot: library screen in dark theme', async () => {
      const client = requireClient(state)
      const libraryLink = await client.findElement(
        'css selector',
        'nav a[href="/library"]',
      )
      await activateElement(client, libraryLink)
      await waitFor(
        'navigation back to /library',
        async () => {
          const path = await client.execute<string>('return location.pathname')
          return path === '/library' ? path : null
        },
        { timeoutMs: 10_000 },
      )
      const theme = await waitFor(
        'dark theme still applied on the library screen',
        async () => {
          const value = await readThemeState(client)
          return value.dark ? value : null
        },
        { timeoutMs: 5_000 },
      )
      if (theme.primary !== state.tokens.dark) {
        throw new E2eError(
          `--primary drifted on the library screen: ${theme.primary} !== ${state.tokens.dark}`,
        )
      }
      await waitFor(
        'library screen content after navigation',
        async () =>
          (await client.execute<boolean>(
            `return !!document.querySelector('main h1') && document.querySelectorAll('[role="dialog"]').length === 0`,
          ))
            ? true
            : null,
        { timeoutMs: 10_000 },
      )
      await sleep(350)
      state.screenshots = {
        ...state.screenshots,
        libraryDark: await saveScreenshot(
          client,
          options.screenshotsDir,
          'library-dark',
        ),
      }
      info(`saved ${state.screenshots.libraryDark}`)
    })

    // ---------------------------------------------------------------------------------------
    await step(
      'assertion 5: toggle back to light and confirm persistence again',
      async () => {
        const client = requireClient(state)
        const settingsLink = await client.findElement(
          'css selector',
          'nav a[href="/settings"]',
        )
        await activateElement(client, settingsLink)
        await waitFor(
          'navigation back to /settings',
          async () => {
            const path = await client.execute<string>(
              'return location.pathname',
            )
            return path === '/settings' ? path : null
          },
          { timeoutMs: 10_000 },
        )

        await clickByRoleText(client, 'radio', 'Light')
        await sleep(250)
        info(
          `theme control after click: ${await describeThemeControls(client)}`,
        )
        const light = await waitFor(
          'light theme to apply (class + --primary token)',
          async () => {
            const theme = await readThemeState(client)
            return !theme.dark && theme.primary === state.tokens.light
              ? theme
              : null
          },
          { timeoutMs: 10_000 },
        )
        info(
          `documentElement class="${light.className}" --primary=${light.primary}`,
        )

        const persisted = await waitForPersistedTheme(state, 'light')
        assertConfigIdentity(persisted, state)
        info(`config_debug.toml on disk now has theme="${persisted.theme}"`)
      },
    )

    // ---------------------------------------------------------------------------------------
    await step(
      'assertion 6: all three screenshots exist and are valid PNGs',
      async () => {
        for (const [key, path] of Object.entries(state.screenshots)) {
          const bytes = new Uint8Array(readFileSync(path))
          const { width, height } = assertPng(bytes, key)
          info(
            `${path} (${width}x${height}, ${(bytes.byteLength / 1024).toFixed(1)} KiB)`,
          )
        }
      },
    )

    // ---------------------------------------------------------------------------------------
    await step(
      'final scan: no JS or Rust errors after the full interaction sequence',
      async () => {
        const client = requireClient(state)
        const issues = await collectJsIssues(client)
        const { allowed, fatal } = classifyConsoleIssues(issues)
        for (const issue of allowed)
          info(`allowlisted upstream dev warning: ${issue.text}`)
        if (fatal.length > 0) {
          throw new E2eError(
            'Uncaught JavaScript error(s) during the interaction sequence',
            fatal.map((issue) => `[${issue.kind}] ${issue.text}`).join('\n'),
          )
        }
        const rustErrors = appErrorLines(state)
        if (rustErrors.length > 0) {
          throw new E2eError(
            'Rust logged error-level lines during the run',
            rustErrors.join('\n'),
          )
        }
        info('no JS errors, no Rust ERROR lines')
      },
    )

    console.log(
      `\n✅ native smoke test passed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    )
    return 0
  } catch (error) {
    await printFailureDiagnostics(state, error)
    return 1
  } finally {
    await cleanup(state, processes)
    console.log(
      `\nTotal elapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    )
  }
}

// ---------------------------------------------------------------------------------------------
// Interaction helpers
// ---------------------------------------------------------------------------------------------

function requireClient(state: State): WebDriverClient {
  if (!state.client) throw new E2eError('WebDriver session is not available')
  return state.client
}

type ThemeState = {
  dark: boolean
  className: string
  primary: string
  background: string
}

async function readThemeState(client: WebDriverClient): Promise<ThemeState> {
  return client.execute<ThemeState>(
    `const style = getComputedStyle(document.documentElement);
     return {
       dark: document.documentElement.classList.contains('dark'),
       className: document.documentElement.className,
       primary: style.getPropertyValue('--primary').trim(),
       background: style.getPropertyValue('--background').trim(),
     }`,
  )
}

function assertLight(theme: ThemeState, state: State): void {
  if (theme.dark)
    throw new E2eError(
      `Expected the light theme at boot, class="${theme.className}"`,
    )
  if (theme.primary !== state.tokens.light) {
    throw new E2eError(
      `Light --primary mismatch: computed ${theme.primary}, style.css token ${state.tokens.light}`,
    )
  }
}

/** XPath 1.0 has no escape syntax; build a literal that works for both quote characters. */
function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`
  if (!value.includes('"')) return `"${value}"`
  return `concat(${value
    .split("'")
    .map((part) => `'${part}'`)
    .join(', "\'", ')})`
}

async function activateElement(
  client: WebDriverClient,
  element: Record<string, string>,
): Promise<void> {
  await client.execute('arguments[0].click()', [element])
}

async function clickByRoleText(
  client: WebDriverClient,
  role: string,
  text: string,
): Promise<void> {
  const element = await waitFor(
    `${role} "${text}"`,
    async () => {
      try {
        return await client.findElement(
          'xpath',
          `//*[@role=${xpathLiteral(role)} and normalize-space(.)=${xpathLiteral(text)}]`,
        )
      } catch {
        return null
      }
    },
    { timeoutMs: 10_000, intervalMs: 150 },
  )
  await activateElement(client, element)
}

/** Compact diagnostic of the theme control + any visible toast after a click. */
async function describeThemeControls(client: WebDriverClient): Promise<string> {
  return client.execute<string>(
    `const radios = Array.from(document.querySelectorAll('[role="radio"]')).map((el) => el.textContent.trim() + '=' + el.getAttribute('aria-checked'));
     const toasts = Array.from(document.querySelectorAll('[data-sonner-toast]')).map((el) => el.textContent.trim());
     return JSON.stringify({ radios, toasts, className: document.documentElement.className });`,
  )
}

async function saveScreenshot(
  client: WebDriverClient,
  dir: string,
  name: string,
): Promise<string> {
  mkdirSync(dir, { recursive: true })
  const bytes = await client.screenshot()
  const path = join(dir, `native-${name}.png`)
  writeFileSync(path, bytes)
  return path
}

async function waitForPersistedTheme(
  state: State,
  theme: 'light' | 'dark',
): Promise<ReturnType<typeof parseAppConfig>> {
  return waitFor(
    `config_debug.toml to persist theme="${theme}"`,
    () => {
      const text = readIfExists(state.paths.configFile)
      if (!text) return null
      const config = parseAppConfig(text)
      return config.theme === theme ? config : null
    },
    { timeoutMs: 15_000, intervalMs: 100 },
  )
}

function assertConfigIdentity(
  config: ReturnType<typeof parseAppConfig>,
  state: State,
): void {
  if (config.activeLibraryId !== state.library.id) {
    throw new E2eError(
      `activeLibraryId changed after saving settings: ${config.activeLibraryId} !== ${state.library.id}`,
    )
  }
  if (config.knownLibraries.length !== 1) {
    throw new E2eError(
      `Expected exactly one known library after saving settings, got ${config.knownLibraries.length}`,
    )
  }
  const known = config.knownLibraries[0]
  if (known.libraryRoot !== state.paths.libraryRoot) {
    throw new E2eError(
      `libraryRoot changed after saving settings: ${known.libraryRoot} !== ${state.paths.libraryRoot}`,
    )
  }
}

// ---------------------------------------------------------------------------------------------
// Log scanning
// ---------------------------------------------------------------------------------------------

async function collectJsIssues(client: WebDriverClient): Promise<JsIssue[]> {
  const issues = await client.execute<JsIssue[]>(
    `return (window.__e2eSmoke && window.__e2eSmoke.errors) || []`,
  )
  return Array.isArray(issues) ? issues : []
}

function classifyConsoleIssues(issues: JsIssue[]): {
  allowed: JsIssue[]
  fatal: JsIssue[]
} {
  const allowed: JsIssue[] = []
  const fatal: JsIssue[] = []
  for (const issue of issues) {
    if (
      issue.kind === 'console.error' &&
      ALLOWED_CONSOLE_ERRORS.some((pattern) => pattern.test(issue.text))
    ) {
      allowed.push(issue)
    } else {
      fatal.push(issue)
    }
  }
  return { allowed, fatal }
}

function appErrorLines(state: State): string[] {
  const text = readIfExists(state.logs.webdriver)
  return text
    .split('\n')
    .filter((line) => /\[ERROR\]/.test(line) || /panicked at/.test(line))
    .map((line) => line.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------------------------
// Failure diagnostics + cleanup
// ---------------------------------------------------------------------------------------------

async function printFailureDiagnostics(
  state: State,
  error: unknown,
): Promise<void> {
  console.error(
    '\n──────────────────────────────── FAILURE ────────────────────────────────',
  )
  if (error instanceof E2eError) {
    console.error(`✗ ${error.message}`)
    if (error.detail) console.error(error.detail)
  } else {
    console.error(`✗ ${(error as Error)?.stack ?? String(error)}`)
  }

  if (state.client) {
    try {
      const snapshot = await state.client.execute<Record<string, unknown>>(
        `return {
           url: location.href,
           ready: document.readyState,
           rootChildren: (document.getElementById('root')?.childElementCount) || 0,
           text: document.body.innerText.slice(0, 800),
         }`,
      )
      console.error(`\napp snapshot: ${JSON.stringify(snapshot, null, 2)}`)
    } catch (snapshotError) {
      console.error(
        `\napp snapshot unavailable: ${(snapshotError as Error).message}`,
      )
    }
  }

  const logFile = (key: keyof State['logs'] | undefined): string =>
    key && state.logs?.[key] ? readIfExists(state.logs[key]) : ''
  const appLog = logFile('webdriver')
  if (appLog)
    console.error(`\n--- app/WebDriver log (tail) ---\n${tail(appLog, 8_000)}`)
  const previewLog = logFile('preview')
  if (previewLog)
    console.error(
      `\n--- vite preview log (tail) ---\n${tail(previewLog, 4_000)}`,
    )
  const frontendBuildLog = logFile('frontendBuild')
  if (frontendBuildLog) {
    console.error(
      `\n--- frontend build log (tail) ---\n${tail(frontendBuildLog, 4_000)}`,
    )
  }
  console.error(
    '──────────────────────────────────────────────────────────────────────────',
  )
}

async function cleanup(
  state: State,
  processes: ManagedProcess[],
): Promise<void> {
  console.log('\n[cleanup] stopping app, WebDriver, Vite and Xvfb')
  let cleanupFailed = false

  if (state.client) {
    try {
      await state.client.quit()
    } catch (error) {
      console.warn(
        `[cleanup] WebDriver session delete failed: ${(error as Error).message}`,
      )
    }
    state.client = null
  }

  if (state.appPid) {
    await sleep(250)
    let alive = true
    try {
      process.kill(state.appPid, 0)
    } catch {
      alive = false
    }
    if (alive) {
      try {
        process.kill(state.appPid, 'SIGKILL')
        console.warn(`[cleanup] killed leftover app process ${state.appPid}`)
      } catch (error) {
        console.warn(
          `[cleanup] could not kill app pid ${state.appPid}: ${(error as Error).message}`,
        )
      }
    }
  }

  for (const managed of [...processes].reverse()) {
    try {
      await stopProcess(managed)
    } catch (error) {
      cleanupFailed = true
      console.error(
        `[cleanup] failed to stop ${managed.name}: ${(error as Error).message}`,
      )
    }
  }

  try {
    assertSeedHelperRemoved(
      state.env ?? (process.env as Record<string, string>),
    )
  } catch (error) {
    cleanupFailed = true
    console.error(`[cleanup] ${(error as Error).message}`)
  }

  if (state.paths?.xdg.home) {
    const leftover = [
      'preview.log',
      'webdriver.log',
      'cargo-build.log',
      'frontend-build.log',
    ]
      .map((file) => join(state.paths.xdg.home, 'logs', file))
      .filter((file) => existsSync(file))
    if (leftover.length > 0) {
      console.log(
        `[cleanup] logs kept at ${state.paths.xdg.home}/logs (${leftover.length} files)`,
      )
    }
  }

  if (cleanupFailed) process.exitCode = 1
}

// ---------------------------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------------------------

const exitCode = await main()
if (exitCode !== 0) process.exit(exitCode)
