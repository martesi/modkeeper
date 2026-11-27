import { test as base } from '@playwright/test'
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { startServer, stopServer } from './server-process'

interface ServerFixture {
  server: {
    url: string
    root: string
    game: string
    archive: string
    successArchive: string
    syncHookDir: string
    pauseAtSyncBoundary: (boundary: string) => Promise<void>
    waitForSyncBoundary: (boundary: string) => Promise<void>
    releaseSyncBoundary: () => Promise<void>
    crash: () => Promise<void>
    restart: () => Promise<void>
  }
}

export const test = base.extend<ServerFixture>({
  server: async ({ browserName }, run) => {
    if (browserName !== 'chromium') throw new Error('Expected Chromium')
    const root = await mkdtemp(path.join(tmpdir(), 'modkeeper-e2e-'))
    let serverProcess: ReturnType<typeof startServer> | undefined
    await (async () => {
      if (process.env.MODKEEPER_E2E_ROOT_MARKER)
        await writeFile(process.env.MODKEEPER_E2E_ROOT_MARKER, root)
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
      const successArchive = path.resolve('e2e/server/fixture-success-mod.zip')
      const syncHookDir = path.join(root, 'sync-hook')
      await mkdir(syncHookDir)
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
        MODKEEPER_E2E_SYNC_HOOK_DIR: syncHookDir,
      }
      delete env.VITE_E2E_MOCK
      delete env.VITE_E2E_TASK_PROGRESS
      const executable =
        process.env.MODKEEPER_E2E_BINARY ??
        path.resolve(
          'build/ci',
          process.platform === 'win32'
            ? 'modkeeper-server-e2e.exe'
            : 'modkeeper-server-e2e',
        )
      serverProcess = startServer(executable, env, url)
      await serverProcess.ready
      await run({
        url,
        root,
        game,
        archive,
        successArchive,
        syncHookDir,
        pauseAtSyncBoundary: async (boundary) => {
          await rm(path.join(syncHookDir, 'release'), { force: true })
          await rm(path.join(syncHookDir, 'reached'), { force: true })
          await writeFile(path.join(syncHookDir, 'pause-at'), boundary)
        },
        waitForSyncBoundary: async (boundary) =>
          waitForFileContent(path.join(syncHookDir, 'reached'), boundary),
        releaseSyncBoundary: async () =>
          writeFile(path.join(syncHookDir, 'release'), 'continue'),
        crash: async () => {
          if (!serverProcess) throw new Error('Server has not started')
          const crashed = serverProcess
          if (!crashed.child.kill('SIGKILL'))
            throw new Error('Could not interrupt the real server process')
          await crashed.closed
          serverProcess = undefined
        },
        restart: async () => {
          if (serverProcess)
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

async function waitForFileContent(
  pathname: string,
  expected: string,
): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const content = await readFile(pathname, 'utf8').catch(() => '')
    if (content.trim() === expected) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Server did not reach Sync boundary ${expected}`)
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
