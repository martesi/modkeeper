import { test as base } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { cp, copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

interface ServerFixture {
  server: {
    url: string
    root: string
    game: string
    archive: string
    restart: () => Promise<void>
  }
}

export const test = base.extend<ServerFixture>({
  server: async ({ browserName }, run) => {
    if (browserName !== 'chromium') throw new Error('Expected Chromium')
    const root = await mkdtemp(path.join(tmpdir(), 'modkeeper-e2e-'))
    let serverProcess: ReturnType<typeof startServer> | undefined
    await (async () => {
      const game = path.join(root, 'game')
      await mkdir(path.join(game, 'SPT', 'user', 'sptRegistry'), {
        recursive: true,
      })
      await writeFile(path.join(game, 'SPT', 'SPT.Server.exe'), 'fixture')
      await writeFile(path.join(game, 'EscapeFromTarkov.exe'), 'fixture')
      await writeFile(
        path.join(game, 'SPT', 'user', 'sptRegistry', 'registry.json'),
        '{"SPT_Version":"SPT 4.0.11 - 278e72"}',
      )
      await cp(game, path.join(root, 'second-game'), { recursive: true })
      const archive = path.join(root, 'fixture-mod.zip')
      await copyFile(path.resolve('e2e/server/fixture-mod.zip'), archive)
      const port = await freePort()
      const url = `http://127.0.0.1:${port}`
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: root,
        USERPROFILE: root,
        APPDATA: path.join(root, 'config'),
        LOCALAPPDATA: path.join(root, 'local'),
        XDG_CONFIG_HOME: path.join(root, 'config'),
        XDG_DATA_HOME: path.join(root, 'data'),
        XDG_CACHE_HOME: path.join(root, 'cache'),
        MODKEEPER_SERVER_PORT: String(port),
        MODKEEPER_SERVER_HOST: '127.0.0.1',
      }
      delete env.VITE_E2E_MOCK
      delete env.VITE_E2E_TASK_PROGRESS
      const executable =
        process.env.MODKEEPER_E2E_BINARY ??
        path.resolve(
          'build/ci',
          process.platform === 'win32'
            ? 'modkeeper-server.exe'
            : 'modkeeper-server',
        )
      serverProcess = startServer(executable, env, url)
      await serverProcess.ready
      await run({
        url,
        root,
        game,
        archive,
        restart: async () => {
          if (!serverProcess) throw new Error('Server has not started')
          await stopServer(serverProcess.child, serverProcess.closed)
          serverProcess = startServer(executable, env, url)
          await serverProcess.ready
        },
      })
    })().finally(async () => {
      if (serverProcess)
        await stopServer(serverProcess.child, serverProcess.closed)
      await rm(root, { recursive: true, force: true })
    })
  },
})

function startServer(executable: string, env: NodeJS.ProcessEnv, url: string) {
  const child = spawn(executable, [], { env, stdio: 'inherit' })
  const closed = new Promise<void>((resolve) => {
    child.once('error', (error) => {
      console.error(`Could not start server: ${error.message}`)
      resolve()
    })
    child.once('close', () => resolve())
  })
  const ready = waitForServer(url, closed).then((isReady) => {
    if (!isReady) throw new Error(`Server failed to start at ${url}`)
  })
  return { child, closed, ready }
}

async function stopServer(child: ChildProcess, closed: Promise<void>) {
  child.kill()
  if (await closesWithin(closed)) return
  child.kill('SIGKILL')
  if (!(await closesWithin(closed)))
    throw new Error('Server did not stop; preserving its state directory')
}

async function closesWithin(closed: Promise<void>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    closed.then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), 3000)
    }),
  ])
  clearTimeout(timer)
  return result
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('No available port')
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return address.port
}

async function waitForServer(
  url: string,
  closed: Promise<void>,
): Promise<boolean> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const result = await Promise.race([
      fetch(url, { signal: AbortSignal.timeout(1000) }).then(
        (response) => response.ok,
        () => false,
      ),
      closed.then(() => 'closed' as const),
    ])
    if (result === 'closed') return false
    if (result) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}
