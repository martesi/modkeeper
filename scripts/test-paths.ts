import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { buildCatalog, compareText, selectPaths } from '../e2e/paths/catalog'
import { model, modelExport } from '../e2e/paths/model'
import {
  pathText,
  renderMatrix,
  replaceMatrix,
} from '../e2e/paths/presentation'
import { commandsFor, verifyReferences } from '../e2e/paths/test-refs'

const repoRoot = resolve(import.meta.dir, '..')
if (import.meta.main)
  process.exitCode = await main(process.argv.slice(2)).catch(
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      return 1
    },
  )

async function main(argv: string[]) {
  const { values: flags, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      area: { type: 'string' },
      tier: { type: 'string' },
      status: { type: 'string' },
      changed: { type: 'boolean' },
      write: { type: 'boolean' },
      check: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  })
  const [command = flags.check ? 'check' : 'list', ref = 'HEAD', ...extra] =
    positionals
  if (flags.help) {
    console.log(`Usage: bun scripts/test-paths.ts <command> [--json]
  list [--area NAME] [--tier T1|T2|T3|T4] [--status covered|partial|uncovered]
  select --changed [git-ref] | select --area NAME
  matrix [--write]
  model
  --check`)
    return 0
  }
  if (!['list', 'select', 'matrix', 'model', 'check'].includes(command))
    throw new Error(`Unknown command: ${command}`)
  validateOptions()
  if (command === 'model') return printJson(modelExport)

  const catalog = buildCatalog()
  if (catalog.errors.length && command !== 'check')
    return printErrors(catalog.errors)
  if (command === 'check') {
    const errors = [
      ...catalog.errors,
      ...(await verifyReferences(catalog.paths, repoRoot)),
    ]
    const doc = await Bun.file(resolve(repoRoot, 'E2E_PATHS.md')).text()
    if (replaceMatrix(doc, renderMatrix(catalog)) !== doc)
      errors.push(
        'E2E_PATHS.md is out of date; run bun scripts/test-paths.ts matrix --write',
      )
    if (flags.json)
      printJson({ ok: !errors.length, errors, stats: catalog.stats })
    if (errors.length) return flags.json ? 1 : printErrors(errors)
    if (!flags.json)
      console.log(`Checked ${catalog.paths.length} paths and their references.`)
    return 0
  }
  if (command === 'matrix') {
    if (flags.json)
      return printJson({ paths: catalog.paths, stats: catalog.stats })
    const matrix = renderMatrix(catalog)
    if (!flags.write) {
      console.log(matrix)
      return 0
    }
    const file = Bun.file(resolve(repoRoot, 'E2E_PATHS.md'))
    const updated = replaceMatrix(await file.text(), matrix)
    if (updated === undefined)
      throw new Error('Could not find the matrix markers in E2E_PATHS.md')
    await Bun.write(file, updated)
    return 0
  }
  if (command === 'select') {
    const changed = flags.changed ? changedFiles(ref) : undefined
    const paths = selectPaths(catalog.paths, { area: flags.area, changed })
    const commands = commandsFor(paths)
    if (flags.json)
      return printJson({ changed, paths, commands, stats: catalog.stats })
    console.log(
      [
        `${paths.length} selected paths (includes smoke)`,
        ...paths.map(pathText),
        '',
        'Commands (partial checks do not close their gaps):',
        ...commands.map(({ command }) => `  ${command}`),
      ].join('\n'),
    )
    return 0
  }

  const paths = catalog.paths.filter(
    (path) =>
      (!flags.area || path.area === flags.area) &&
      (!flags.tier || path.tier === flags.tier) &&
      (!flags.status || path.status === flags.status),
  )
  const stats = catalog.stats.filter(
    (area) => !flags.area || area.area === flags.area,
  )
  if (flags.json) return printJson({ paths, stats })
  console.log(
    [
      `${paths.length} matching paths`,
      ...stats.map(
        (area) =>
          `${area.area}: ${area.modeledPairs}/${area.feasiblePairs} feasible pairs modeled (${area.assertedPairs} asserted; ${area.excludedPairs} excluded)`,
      ),
      ...paths.map(pathText),
    ].join('\n'),
  )
  return 0

  function validateOptions() {
    if (extra.length || (positionals.length > 1 && !flags.changed))
      throw new Error('Only select --changed accepts a git ref')
    if (flags.check && command !== 'check')
      throw new Error('Use --check on its own')
    if (flags.changed && command !== 'select')
      throw new Error('Use --changed with select')
    if (command === 'select' && !!flags.area === !!flags.changed)
      throw new Error(
        'Use select with either --changed [git ref] or --area NAME',
      )
    if (
      flags.area !== undefined &&
      (!Object.hasOwn(model.areas, flags.area) ||
        !['select', 'list'].includes(command))
    )
      throw new Error(`Invalid area for ${command}: ${flags.area}`)
    if (
      flags.tier &&
      (command !== 'list' || !['T1', 'T2', 'T3', 'T4'].includes(flags.tier))
    )
      throw new Error(`Invalid tier for ${command}: ${flags.tier}`)
    if (
      flags.status &&
      (command !== 'list' ||
        !['covered', 'partial', 'uncovered'].includes(flags.status))
    )
      throw new Error(`Invalid status for ${command}: ${flags.status}`)
    if (flags.write && (command !== 'matrix' || flags.json))
      throw new Error('Use --write with matrix, without --json')
  }
}

function changedFiles(ref: string) {
  const base = git([
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${ref}^{commit}`,
  ]).trim()
  const tracked = git([
    'diff',
    '--no-ext-diff',
    '--name-only',
    '--no-renames',
    '-z',
    base,
    '--',
  ])
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
  return [
    ...new Set(`${tracked}${untracked}`.split('\0').filter(Boolean)),
  ].sort(compareText)
}

function git(args: string[]) {
  const { exitCode, stderr, stdout } = Bun.spawnSync(['git', ...args], {
    cwd: repoRoot,
  })
  if (exitCode !== 0)
    throw new Error(`git ${args[0]}: ${stderr.toString().trim()}`)
  return stdout.toString()
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2))
  return 0
}

function printErrors(errors: string[]) {
  for (const error of errors) console.error(error)
  return 1
}
