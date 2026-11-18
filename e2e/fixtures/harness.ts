/**
 * Process, fixture, and filesystem helpers for the native smoke test.
 *
 * Everything lives under /tmp/opencode/e2e so the real user config never changes. Each run
 * wipes its scratch tree, making the harness idempotent.
 */
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { spawn, type Subprocess } from 'bun'

export const repoRoot = resolve(import.meta.dir, '..', '..')
export const scratchRoot = '/tmp/opencode/e2e/modkeeper-native-smoke'

/** Run-scoped folder for local artifacts. Never writes into tracked paths. */
export const runStamp = new Date().toISOString().replace(/[:.]/g, '-')

export function e2eArtifactPath(...parts: string[]): string {
  return join(repoRoot, '.local', 'e2e', runStamp, ...parts)
}

export class E2eError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'E2eError'
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Polls `fn` until it returns a truthy value or the timeout elapses. */
export async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null | undefined> | T | null | undefined,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const intervalMs = opts.intervalMs ?? 100
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  let lastValue: unknown
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      lastValue = value
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await sleep(intervalMs)
  }
  const details = [
    `waited ${timeoutMs}ms for ${label}`,
    lastError
      ? `last error: ${(lastError as Error).message ?? String(lastError)}`
      : '',
    lastValue !== undefined ? `last value: ${JSON.stringify(lastValue)}` : '',
  ]
    .filter(Boolean)
    .join('; ')
  throw new E2eError(`Timed out: ${details}`)
}

// ---------------------------------------------------------------------------------------------
// Ports and display
// ---------------------------------------------------------------------------------------------

export async function isPortOpen(
  host: string,
  port: number,
  timeoutMs = 500,
): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}:${port}/`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    await res.arrayBuffer().catch(() => undefined)
    return true
  } catch {
    return false
  }
}

export async function findFreePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new E2eError('Could not determine a free TCP port')
  }
  const port = address.port
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  return port
}

/** Finds an unused X display number by checking the socket and lock files Xvfb writes. */
export function findFreeDisplay(): number {
  for (let n = 90; n < 160; n++) {
    if (!existsSync(`/tmp/.X11-unix/X${n}`) && !existsSync(`/tmp/.X${n}-lock`))
      return n
  }
  throw new E2eError('No free X display found in :90-:159')
}

// ---------------------------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------------------------

export type ManagedProcess = {
  name: string
  proc: Subprocess
  logFile: string
  pid: number
}

/** Spawns a long-lived process whose stdout+stderr go to `logFile`. */
export function spawnLogged(opts: {
  name: string
  cmd: string[]
  cwd: string
  env: Record<string, string | undefined>
  logFile: string
  detached?: boolean
}): ManagedProcess {
  mkdirSync(dirname(opts.logFile), { recursive: true })
  const fd = openSync(opts.logFile, 'a')
  let proc: Subprocess
  try {
    proc = spawn(opts.cmd, {
      cwd: opts.cwd,
      env: opts.env,
      stdin: 'ignore',
      stdout: fd,
      stderr: fd,
      detached: opts.detached ?? true,
    })
  } finally {
    closeSync(fd)
  }
  if (!proc.pid) {
    throw new E2eError(
      `Failed to spawn ${opts.name}: no pid (command: ${opts.cmd.join(' ')})`,
    )
  }
  return { name: opts.name, proc, logFile: opts.logFile, pid: proc.pid }
}

/** Terminates a process group, falling back to the direct child. */
export async function stopProcess(
  managed: ManagedProcess | undefined,
  signal: NodeJS.Signals = 'SIGTERM',
  graceMs = 5_000,
): Promise<void> {
  if (!managed) return
  const { proc, pid, name } = managed
  if (proc.exitCode !== null) return
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      proc.kill(signal)
    } catch {
      // already gone
    }
  }
  const exited = await Promise.race([
    proc.exited.then(() => true),
    sleep(graceMs).then(() => false),
  ])
  if (!exited) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        proc.kill('SIGKILL')
      } catch {
        // already gone
      }
    }
    await Promise.race([proc.exited, sleep(2_000)])
  }
  if (proc.exitCode === null) {
    let alive = true
    try {
      process.kill(pid, 0)
    } catch {
      alive = false
    }
    if (alive)
      console.warn(
        `[cleanup] ${name} (pid ${pid}) is still alive after SIGKILL`,
      )
  }
}

/** Runs a short command and returns its captured output; throws on a non-zero exit. */
export async function runOnce(opts: {
  cmd: string[]
  cwd: string
  env: Record<string, string | undefined>
  timeoutMs?: number
  allowFailure?: boolean
}): Promise<{ code: number; output: string }> {
  const proc = spawn(opts.cmd, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => {
    try {
      proc.kill('SIGKILL')
    } catch {
      // ignore
    }
  }, opts.timeoutMs ?? 60_000)
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
    proc.exited,
  ])
  clearTimeout(timer)
  const output = `${stdout}${stderr}`
  if (code !== 0 && !opts.allowFailure) {
    throw new E2eError(
      `Command failed (exit ${code}): ${opts.cmd.join(' ')}`,
      tail(output, 4_000),
    )
  }
  return { code, output }
}

export function tail(text: string, maxChars = 6_000): string {
  if (text.length <= maxChars) return text
  return `… (${text.length - maxChars} chars elided)\n${text.slice(-maxChars)}`
}

export function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

// ---------------------------------------------------------------------------------------------
// Cargo / app binary
// ---------------------------------------------------------------------------------------------

export function cargoTargetDir(
  env: Record<string, string | undefined>,
): string {
  return env.CARGO_TARGET_DIR?.trim() || join(repoRoot, 'src-tauri', 'target')
}

function newestMtime(paths: string[]): number {
  let newest = 0
  const stack = [...paths]
  while (stack.length > 0) {
    const path = stack.pop()!
    let info
    try {
      info = statSync(path)
    } catch {
      continue
    }
    if (info.isDirectory()) {
      for (const entry of readdirSync(path)) stack.push(join(path, entry))
    } else if (info.isFile()) {
      newest = Math.max(newest, info.mtimeMs)
    }
  }
  return newest
}

export type AppBinary = { path: string; built: boolean }

/**
 * Resolves the debug binary named by Cargo's `default-run`, rebuilding when any Rust source or
 * Tauri config is newer than the binary so the smoke test never exercises stale code.
 */
export async function ensureAppBinary(opts: {
  env: Record<string, string | undefined>
  logFile: string
  report: (message: string) => void
}): Promise<AppBinary> {
  const manifestPath = join(repoRoot, 'src-tauri', 'Cargo.toml')
  const manifest = readFileSync(manifestPath, 'utf8')
  const binName =
    /^default-run\s*=\s*"([^"]+)"/m.exec(manifest)?.[1] ??
    /^name\s*=\s*"([^"]+)"/m.exec(manifest)?.[1]
  if (!binName)
    throw new E2eError(`Could not read the binary name from ${manifestPath}`)

  const binaryPath = join(cargoTargetDir(opts.env), 'debug', binName)
  const watchList = [
    join(repoRoot, 'src-tauri', 'src'),
    join(repoRoot, 'src-tauri', 'Cargo.toml'),
    join(repoRoot, 'src-tauri', 'build.rs'),
    join(repoRoot, 'src-tauri', 'tauri.conf.json'),
    join(repoRoot, 'src-tauri', 'tauri.linux.conf.json'),
  ]
  const sourceMtime = newestMtime(watchList)
  const binaryMtime = existsSync(binaryPath) ? statSync(binaryPath).mtimeMs : 0

  if (binaryMtime >= sourceMtime) {
    opts.report(`reusing debug binary ${binaryPath}`)
    return { path: binaryPath, built: false }
  }

  opts.report(
    `debug binary is stale or missing; running cargo build (log: ${opts.logFile})`,
  )
  const proc = spawn(
    [
      'cargo',
      'build',
      '--manifest-path',
      join(repoRoot, 'src-tauri', 'Cargo.toml'),
    ],
    {
      cwd: repoRoot,
      env: {
        ...opts.env,
        CARGO_TERM_COLOR: 'never',
        CARGO_TARGET_DIR: cargoTargetDir(opts.env),
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const timer = setTimeout(() => {
    try {
      proc.kill('SIGKILL')
    } catch {
      // already gone
    }
  }, 20 * 60_000)
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
    proc.exited,
  ])
  clearTimeout(timer)
  mkdirSync(dirname(opts.logFile), { recursive: true })
  writeFileSync(opts.logFile, `${stdout}${stderr}`)
  if (code !== 0) {
    throw new E2eError(
      `cargo build failed with exit code ${code} (see ${opts.logFile})`,
      tail(`${stdout}${stderr}`, 6_000),
    )
  }
  if (!existsSync(binaryPath)) {
    throw new E2eError(`cargo build succeeded but ${binaryPath} is missing`)
  }
  return { path: binaryPath, built: true }
}

// ---------------------------------------------------------------------------------------------
// Simulated SPT game root + library + app config
// ---------------------------------------------------------------------------------------------

export type SeedPaths = {
  gameRoot: string
  libraryRoot: string
  configFile: string
  xdg: {
    config: string
    cache: string
    data: string
    home: string
    runtime: string
  }
}

export function prepareScratchTree(): SeedPaths {
  rmSync(scratchRoot, { recursive: true, force: true })
  const xdg = {
    config: join(scratchRoot, 'xdg', 'config'),
    cache: join(scratchRoot, 'xdg', 'cache'),
    data: join(scratchRoot, 'xdg', 'data'),
    home: join(scratchRoot, 'xdg', 'home'),
    runtime: join(scratchRoot, 'xdg', 'runtime'),
  }
  for (const dir of Object.values(xdg)) mkdirSync(dir, { recursive: true })
  // GLib refuses a runtime dir with loose permissions.
  chmodSync(xdg.runtime, 0o700)
  const gameRoot = join(scratchRoot, 'game')
  mkdirSync(gameRoot, { recursive: true })
  return {
    gameRoot,
    libraryRoot: join(gameRoot, '.mod_keeper'),
    configFile: join(xdg.config, 'modkeeper', 'config_debug.toml'),
    xdg,
  }
}

/** Mirrors src-tauri/tests/common/mod.rs::setup_test_env and SPTPathRules. */
export function seedGameRoot(gameRoot: string): void {
  const writeDummy = (relative: string) => {
    const path = join(gameRoot, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'dummy')
  }
  writeDummy('EscapeFromTarkov.exe')
  writeDummy('SPT/SPT.Server.exe')
  mkdirSync(join(gameRoot, 'SPT/user/mods'), { recursive: true })
  mkdirSync(join(gameRoot, 'BepInEx/plugins'), { recursive: true })
  const registry = join(gameRoot, 'SPT/user/sptRegistry/registry.json')
  mkdirSync(dirname(registry), { recursive: true })
  writeFileSync(registry, '{"SPT_Version": "SPT 4.0.11 - 278e72"}')
}

const seedExampleSource = `// TEMPORARY e2e seed helper — created and deleted by e2e/native-smoke.ts.
use camino::Utf8PathBuf;
use mod_keeper_lib::core::library::Library;
use mod_keeper_lib::models::library::LibraryCreationRequirement;

fn main() {
    let game_root = Utf8PathBuf::from(
        std::env::var("E2E_GAME_ROOT").expect("E2E_GAME_ROOT must be set"),
    );
    let library_root = Utf8PathBuf::from(
        std::env::var("E2E_LIBRARY_ROOT").expect("E2E_LIBRARY_ROOT must be set"),
    );
    let name = std::env::var("E2E_LIBRARY_NAME").unwrap_or_else(|_| "E2E Library".to_string());

    let library = Library::create(LibraryCreationRequirement {
        game_root,
        repo_root: Some(library_root),
        name,
    })
    .unwrap_or_else(|err| {
        eprintln!("E2E_SEED_FAILED: {err}");
        std::process::exit(1);
    });

    println!("E2E_LIBRARY_ID={}", library.id);
    println!("E2E_LIBRARY_NAME={}", library.name);
}
`

/**
 * Creates the library through the real `Library::create` code path, using a temporary cargo
 * example that is always removed again. Returns the created library id and name.
 */
export async function createLibrary(opts: {
  env: Record<string, string | undefined>
  gameRoot: string
  libraryRoot: string
  name: string
}): Promise<{ id: string; name: string }> {
  const exampleDir = join(repoRoot, 'src-tauri', 'examples')
  const exampleFile = join(exampleDir, 'e2e_seed_library.rs')
  const createdDir = !existsSync(exampleDir)
  mkdirSync(exampleDir, { recursive: true })
  writeFileSync(exampleFile, seedExampleSource)

  try {
    const { code, output } = await runOnce({
      cmd: [
        'cargo',
        'run',
        '--quiet',
        '--manifest-path',
        join(repoRoot, 'src-tauri', 'Cargo.toml'),
        '--example',
        'e2e_seed_library',
      ],
      cwd: repoRoot,
      env: {
        ...opts.env,
        CARGO_TERM_COLOR: 'never',
        E2E_GAME_ROOT: opts.gameRoot,
        E2E_LIBRARY_ROOT: opts.libraryRoot,
        E2E_LIBRARY_NAME: opts.name,
      },
      timeoutMs: 10 * 60_000,
    })
    if (code !== 0) {
      throw new E2eError(
        `Library::create helper exited with ${code}`,
        tail(output),
      )
    }
    const id = /^E2E_LIBRARY_ID=(.+)$/m.exec(output)?.[1]?.trim()
    const name = /^E2E_LIBRARY_NAME=(.+)$/m.exec(output)?.[1]?.trim()
    if (!id || !name) {
      throw new E2eError(
        'Library::create helper printed no library id/name',
        tail(output),
      )
    }
    if (!existsSync(join(opts.libraryRoot, 'manifest.toml'))) {
      throw new E2eError(
        `Library::create did not write ${join(opts.libraryRoot, 'manifest.toml')}`,
      )
    }
    return { id, name }
  } finally {
    rmSync(exampleFile, { force: true })
    if (
      createdDir &&
      existsSync(exampleDir) &&
      readdirSync(exampleDir).length === 0
    ) {
      rmSync(exampleDir, { recursive: true, force: true })
    }
  }
}

/** Must run after createLibrary; asserts the temporary helper left no repo footprint. */
export function assertSeedHelperRemoved(
  env: Record<string, string | undefined>,
): void {
  const examplesDir = join(repoRoot, 'src-tauri', 'examples')
  const status = spawnSyncText(
    ['git', 'status', '--porcelain', '--', 'src-tauri/examples'],
    env,
  )
  if (status.trim().length > 0) {
    throw new E2eError(`Temporary seed helper left repo changes:\n${status}`)
  }
  if (existsSync(examplesDir)) {
    const entries = readdirSync(examplesDir)
    if (entries.length > 0) {
      throw new E2eError(
        `Temporary examples directory is not empty: ${entries.join(', ')}`,
      )
    }
  }
}

function spawnSyncText(
  cmd: string[],
  env: Record<string, string | undefined>,
): string {
  const result = Bun.spawnSync({
    cmd,
    cwd: repoRoot,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return `${result.stdout.toString()}${result.stderr.toString()}`
}

/** Writes the debug App Config exactly where ProjectDirs::from("", "", "Modkeeper") looks. */
export function writeAppConfig(opts: {
  configFile: string
  libraryId: string
  libraryRoot: string
  theme: 'light' | 'dark' | 'system'
}): void {
  mkdirSync(dirname(opts.configFile), { recursive: true })
  writeFileSync(
    opts.configFile,
    [
      '[[knownLibraries]]',
      `id = "${opts.libraryId}"`,
      `libraryRoot = "${opts.libraryRoot}"`,
      '',
      '[appState]',
      `activeLibraryId = "${opts.libraryId}"`,
      '',
      '[settings]',
      `theme = "${opts.theme}"`,
      'accentColor = "default"',
      'language = "en-US"',
      'enableModsOnInstall = true',
      '',
    ].join('\n'),
  )
}

export type ConfigSnapshot = {
  theme?: string
  activeLibraryId?: string
  knownLibraries: { id?: string; libraryRoot?: string }[]
}

export function parseAppConfig(text: string): ConfigSnapshot {
  const settingsBlock = /\[settings\]([\s\S]*?)(?=\n\[|$)/.exec(text)?.[1] ?? ''
  const appStateBlock = /\[appState\]([\s\S]*?)(?=\n\[|$)/.exec(text)?.[1] ?? ''
  const knownLibraries: { id?: string; libraryRoot?: string }[] = []
  const tableBlocks =
    text.match(/\[\[knownLibraries\]\]([\s\S]*?)(?=\n\[|$)/g) ?? []
  for (const block of tableBlocks) {
    knownLibraries.push({
      id: /^\s*id\s*=\s*"([^"]*)"/m.exec(block)?.[1],
      libraryRoot: /^\s*libraryRoot\s*=\s*"([^"]*)"/m.exec(block)?.[1],
    })
  }
  if (knownLibraries.length === 0) {
    const inline = /knownLibraries\s*=\s*\[([\s\S]*?)\]/m.exec(text)?.[1]
    if (inline) {
      for (const entry of inline.match(/\{[^}]*\}/g) ?? []) {
        knownLibraries.push({
          id: /\bid\s*=\s*"([^"]*)"/.exec(entry)?.[1],
          libraryRoot: /\blibraryRoot\s*=\s*"([^"]*)"/.exec(entry)?.[1],
        })
      }
    }
  }
  return {
    theme: /^\s*theme\s*=\s*"([^"]*)"/m.exec(settingsBlock)?.[1],
    activeLibraryId:
      /^\s*activeLibraryId\s*=\s*(?:"([^"]*)"|'([^']*)')/m.exec(
        appStateBlock,
      )?.[1] ??
      /^\s*activeLibraryId\s*=\s*(?:"([^"]*)"|'([^']*)')/m.exec(
        appStateBlock,
      )?.[2],
    knownLibraries,
  }
}

// ---------------------------------------------------------------------------------------------
// Frontend build + boot error trap
// ---------------------------------------------------------------------------------------------

/**
 * Injects a passive error trap as the first script in the built `dist/index.html`.
 *
 * WebKitWebDriver has no `Page.addScriptToEvaluateOnNewDocument`, so this is the only way to
 * observe uncaught errors (and console.error) that happen while the app module evaluates. The
 * injected script only records; it changes nothing the UI renders. `dist/` is gitignored and
 * rebuilt on every run, so no repo file is qualified as modified.
 */
export function injectBootErrorTrap(indexHtmlPath: string): void {
  const html = readFileSync(indexHtmlPath, 'utf8')
  if (html.includes('__e2eSmoke')) {
    throw new E2eError(`${indexHtmlPath} already contains the e2e error trap`)
  }
  const trap = `<script>
window.__e2eSmoke = { installed: true, errors: [] };
addEventListener('error', function (event) {
  window.__e2eSmoke.errors.push({ kind: 'uncaught-error', text: String(event.message || (event.error && event.error.stack) || event.error) });
});
addEventListener('unhandledrejection', function (event) {
  var reason = event.reason;
  window.__e2eSmoke.errors.push({ kind: 'unhandled-rejection', text: String((reason && reason.stack) || reason) });
});
(function () {
  var original = console.error;
  console.error = function () {
    window.__e2eSmoke.errors.push({ kind: 'console.error', text: Array.prototype.map.call(arguments, function (arg) { return (arg && arg.stack) ? String(arg.stack) : String(arg); }).join(' ') });
    return original.apply(console, arguments);
  };
})();
</script>`
  const headIndex = html.indexOf('<head>')
  if (headIndex === -1)
    throw new E2eError(`${indexHtmlPath} has no <head> to inject into`)
  const patched = `${html.slice(0, headIndex + '<head>'.length)}${trap}${html.slice(headIndex + '<head>'.length)}`
  writeFileSync(indexHtmlPath, patched)
}

// ---------------------------------------------------------------------------------------------
// CSS theme tokens + PNG validation
// ---------------------------------------------------------------------------------------------

/** Reads the light/dark `--primary` values from style.css so assertions never hardcode hexes. */
export function readPrimaryTokens(styleCssPath: string): {
  light: string
  dark: string
} {
  const css = readFileSync(styleCssPath, 'utf8')
  const light = extractVar(css, /:root\s*\{([^}]*)\}/g, '--primary')
  const dark = extractVar(css, /\.dark\s*\{([^}]*)\}/g, '--primary')
  if (!light || !dark) {
    throw new E2eError(`Could not read --primary tokens from ${styleCssPath}`)
  }
  return { light, dark }
}

function extractVar(
  css: string,
  blockPattern: RegExp,
  variable: string,
): string | undefined {
  for (const block of css.matchAll(blockPattern)) {
    const match = new RegExp(`${variable}\\s*:\\s*([^;]+);`).exec(block[1])
    if (match) return match[1].trim()
  }
  return undefined
}

export function assertPng(
  bytes: Uint8Array,
  label: string,
): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24)
    throw new E2eError(`${label}: screenshot is only ${bytes.length} bytes`)
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i])
      throw new E2eError(`${label}: not a PNG (bad signature)`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width < 100 || height < 100) {
    throw new E2eError(`${label}: screenshot too small (${width}x${height})`)
  }
  return { width, height }
}
