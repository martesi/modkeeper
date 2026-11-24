import { afterEach, expect, test } from 'vitest'
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const fixtures: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true })
})

function runScript(script: string, failGeneration = false) {
  const fixture = mkdtempSync(join(tmpdir(), 'modkeeper-startup-'))
  fixtures.push(fixture)
  const bin = join(fixture, 'node_modules', '.bin')
  const log = join(fixture, 'calls')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(fixture, 'package.json'), readFileSync('package.json'))
  for (const name of ['wails3', 'vite', 'tsc']) {
    const executable = join(bin, name)
    writeFileSync(
      executable,
      `#!/bin/sh\nprintf '%s\\n' '${name} '"$*" >> "$TEST_LOG"\n${name === 'wails3' ? 'exit "${GENERATOR_EXIT:-0}"' : ''}\n`,
    )
    chmodSync(executable, 0o755)
  }
  const result = spawnSync('bun', ['run', script, '--', '--example-flag'], {
    cwd: fixture,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TEST_LOG: log,
      GENERATOR_EXIT: failGeneration ? '42' : '0',
    },
  })
  return {
    exitCode: result.status,
    calls: readFileSync(log, 'utf8').trim().split('\n'),
  }
}

for (const script of ['dev', 'dev:wails', 'build', 'build:wails']) {
  test(`${script} generates bindings before frontend commands and forwards arguments`, () => {
    const result = runScript(script)
    expect(result.exitCode).toBe(0)
    expect(result.calls[0]).toMatch(/^wails3 generate bindings /)
    expect(
      result.calls.filter((call) => call.startsWith('wails3 ')),
    ).toHaveLength(1)
    if (script.startsWith('build')) expect(result.calls[1]).toMatch(/^tsc /)
    expect(result.calls.at(-1)).toContain('vite ')
    expect(result.calls.at(-1)).toContain('--example-flag')
  })

  test(`${script} stops when binding generation fails`, () => {
    const result = runScript(script, true)
    expect(result.exitCode).not.toBe(0)
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0]).toMatch(/^wails3 generate bindings /)
  })
}

test('desktop development builds before starting the frontend without regenerating', () => {
  const config = readFileSync('build/config.yml', 'utf8')
  const taskfile = readFileSync('Taskfile.yml', 'utf8')
  expect(config).toMatch(
    /- cmd: wails3 build DEV=true\s+type: blocking[\s\S]*?- cmd: bun run dev:wails:frontend/,
  )
  expect(taskfile).toMatch(/^ {2}build:\s+cmds:\s+- bun run build:wails/m)
})
