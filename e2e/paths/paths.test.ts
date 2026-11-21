import { describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { areasForChanges, buildCatalog, selectPaths } from './catalog'
import { model } from './model'
import { pairwise } from './pairwise'
import { commandsFor, verifyReferences } from './test-refs'

describe('path generation', () => {
  test('packs a two-value three-axis model into four deterministic rows', () => {
    const dimensions = {
      scenario: ['import', 'sync'],
      context: ['fresh', 'existing'],
      surface: ['backend', 'native'],
    }
    const result = pairwise(dimensions, () => true)
    expect(result.rows).toEqual([
      { scenario: 'import', context: 'fresh', surface: 'backend' },
      { scenario: 'import', context: 'existing', surface: 'native' },
      { scenario: 'sync', context: 'fresh', surface: 'native' },
      { scenario: 'sync', context: 'existing', surface: 'backend' },
    ])
    expect(pairwise(dimensions, () => true)).toEqual(result)
    expect(result.modeledPairs).toBe(12)
  })

  test('excludes pairs with no legal completion and preserves feasible pairs', () => {
    const result = pairwise(
      {
        scenario: ['launch', 'guard'],
        surface: ['mock', 'native'],
        context: ['stopped', 'running'],
      },
      ({ scenario, surface, context }) =>
        !(
          (scenario === 'guard' && surface === 'mock') ||
          (scenario === 'guard' && context === 'stopped') ||
          (surface === 'mock' && context === 'running')
        ),
    )
    expect(result.totalPairs).toBe(12)
    expect(result.feasiblePairs).toBe(9)
    expect(result.modeledPairs).toBe(9)
    expect(result.rows).not.toContainEqual({
      scenario: 'guard',
      surface: 'mock',
      context: 'running',
    })
  })

  test('rejects stale model IDs and impossible dimension values', () => {
    const changed = {
      ...model,
      evidence: [
        ...model.evidence,
        model.evidence[0],
        {
          ...model.evidence[0],
          id: 'library.create-default-root.existing-root.browser-mock',
        },
      ],
      areas: {
        ...model.areas,
        import: {
          ...model.areas.import,
          contexts: {
            ...model.areas.import.contexts,
            unused: 'No journey uses this',
          },
        },
      },
    }
    const { errors } = buildCatalog(changed)
    expect(errors).toContain(`Duplicate path ID: ${model.evidence[0].id}`)
    expect(errors).toContain('Unused dimension value: import.context=unused')
    expect(errors).toContain(
      'Evidence does not refer to a legal path: library.create-default-root.existing-root.browser-mock',
    )
  })
})

describe('risk-based selection', () => {
  const catalog = buildCatalog()
  const smoke = catalog.paths.filter((path) => path.smoke)

  test('always selects smoke, including for a docs-only change', () => {
    expect(smoke.length).toBeGreaterThan(0)
    expect(selectPaths(catalog.paths, { changed: ['README.md'] })).toEqual(
      smoke,
    )
    const scoped = selectPaths(catalog.paths, { area: 'import' })
    expect(scoped.filter((path) => path.area !== 'import')).toEqual(smoke)
    expect(
      scoped.some(
        (path) => path.area === 'import' && path.status === 'uncovered',
      ),
    ).toBe(true)
  })

  test('a backend archive diff selects only import plus smoke and pins the test commands', () => {
    const changed = ['backend/archive/archive.go']
    expect([...areasForChanges(changed)]).toEqual(['import'])
    expect([...areasForChanges(['backend/deployment/plan.go'])]).toEqual([
      'deploy',
      'recovery',
    ])
    expect([
      ...areasForChanges(['src/redesign/data/registry-repository.ts']),
    ]).toEqual(['forge'])
    expect([
      ...areasForChanges(['src/redesign/shared/utils/path-input.ts']),
    ]).toEqual(['library', 'import'])
    const paths = selectPaths(catalog.paths, { changed })
    expect(paths).toEqual(selectPaths(catalog.paths, { area: 'import' }))
    expect(commandsFor(paths).map(({ command }) => command)).toContain(
      "nix develop -c go test ./backend -run '^(TestAppSurfaceEndToEnd|TestCancelInstallBatchCommitsCompletedArchives|TestInstallManyArchives|TestInstallProcessT2Journey|TestInstallUpgradeLeavesNoSnapshot)$'",
    )
  })

  test('an unmatched backend change selects every area conservatively', () => {
    expect([...areasForChanges(['backend/models/error.go'])]).toEqual(
      Object.keys(model.areas),
    )
  })
})

test('partial evidence requires a non-empty note', async () => {
  const partial = buildCatalog().paths.find((path) => path.status === 'partial')
  expect(partial).toBeDefined()
  const errors = await verifyReferences(
    [{ ...partial!, note: '   ' }],
    resolve(import.meta.dir, '../..'),
  )
  expect(errors).toContain(
    `${partial!.id}: partial path must have a non-empty note`,
  )
})

test('selected native smoke command owns a headless X display', () => {
  const platformPaths = buildCatalog().paths.filter(
    (path) =>
      path.area === 'platform' &&
      path.refs.some(
        (ref) =>
          ref.kind === 'native' && ref.file === 'scripts/native-smoke.sh',
      ),
  )
  expect(commandsFor(platformPaths).map(({ command }) => command)).toContain(
    "nix develop .#e2e --command xvfb-run -a bash 'scripts/native-smoke.sh'",
  )
})

test('--check fails when a covered Go test declaration disappears', async () => {
  const repo = resolve(import.meta.dir, '../..')
  const fixture = await mkdtemp(join(tmpdir(), 'modkeeper-paths-'))
  await Promise.resolve()
    .then(async () => {
      await mkdir(join(fixture, 'scripts'))
      await Promise.all([
        cp(join(repo, 'e2e'), join(fixture, 'e2e'), { recursive: true }),
        cp(join(repo, 'backend'), join(fixture, 'backend'), {
          recursive: true,
        }),
        cp(
          join(repo, 'scripts/test-paths.ts'),
          join(fixture, 'scripts/test-paths.ts'),
        ),
        cp(
          join(repo, 'scripts/native-smoke.sh'),
          join(fixture, 'scripts/native-smoke.sh'),
        ),
        cp(
          join(repo, 'scripts/native-t3.sh'),
          join(fixture, 'scripts/native-t3.sh'),
        ),
        cp(join(repo, 'E2E_PATHS.md'), join(fixture, 'E2E_PATHS.md')),
      ])
      const file = Bun.file(join(fixture, 'backend/app_integration_test.go'))
      const original = await file.text()
      const args = [
        process.execPath,
        'scripts/test-paths.ts',
        '--check',
        '--json',
      ]
      expect(Bun.spawnSync(args, { cwd: fixture }).exitCode).toBe(0)
      await Bun.write(
        file,
        original.replace(
          'func TestInstallProcessT2Journey(',
          'func TestInstallProcessT2JourneyRenamed(',
        ),
      )
      const result = Bun.spawnSync(args, { cwd: fixture })
      expect(result.exitCode).toBe(1)
      const { ok, errors } = JSON.parse(result.stdout.toString())
      expect(ok).toBe(false)
      expect(errors).toContain(
        'recovery.crash-import-fresh.fresh-temp.linux-process: missing backend :: TestInstallProcessT2Journey',
      )
    })
    .finally(() => rm(fixture, { recursive: true, force: true }))
})
