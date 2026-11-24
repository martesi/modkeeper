import { afterAll, expect, test } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const temp = await mkdtemp(path.join(tmpdir(), 'modkeeper-fixture-test-'))
afterAll(() => rm(temp, { recursive: true, force: true }))

test('cleans its root when the server binary does not exist', async () => {
  const env = { ...process.env }
  delete env.JEST_WORKER_ID
  const { error, stdout, stderr } = await new Promise<{
    error: Error | null
    stdout: string
    stderr: string
  }>((resolve) => {
    execFile(
      'bun',
      [
        'run',
        'test:e2e:server',
        'fixture-startup.spec.ts',
        '--workers=1',
        '--retries=0',
      ],
      {
        env: {
          ...env,
          TMPDIR: temp,
          MODKEEPER_E2E_BINARY: path.join(temp, 'missing-server'),
          MODKEEPER_E2E_STARTUP_PROBE: '1',
        },
        timeout: 25_000,
      },
      (error, stdout, stderr) => resolve({ error, stdout, stderr }),
    )
  })
  expect(error).not.toBeNull()
  expect(stdout + stderr).toContain('Server failed to start')
  expect(
    (await readdir(temp)).filter((name) => name.startsWith('modkeeper-e2e-')),
  ).toEqual([])
}, 30_000)
