import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const temp = await mkdtemp(path.join(tmpdir(), 'modkeeper-fixture-test-'))
afterAll(() => rm(temp, { recursive: true, force: true }))

test('cleans its root when the server binary does not exist', async () => {
  const child = Bun.spawn(
    [
      'bun',
      'run',
      'test:e2e:server',
      'fixture-startup.spec.ts',
      '--workers=1',
      '--retries=0',
    ],
    {
      env: {
        ...process.env,
        TMPDIR: temp,
        MODKEEPER_E2E_BINARY: path.join(temp, 'missing-server'),
        MODKEEPER_E2E_STARTUP_PROBE: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(exitCode).not.toBe(0)
  expect(stdout + stderr).toContain('Server failed to start')
  expect(
    (await readdir(temp)).filter((name) => name.startsWith('modkeeper-e2e-')),
  ).toEqual([])
}, 30_000)
