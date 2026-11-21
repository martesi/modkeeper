import { Glob } from 'bun'
import { resolve } from 'node:path'
import { compareText, type Path } from './catalog'
import type { TestRef } from './model-types'

export async function verifyReferences(paths: readonly Path[], root: string) {
  const cache = new Map<string, Promise<string>>()
  const errors: string[] = []
  for (const path of paths) {
    if (path.smoke && path.status !== 'covered')
      errors.push(`${path.id}: smoke paths must be covered`)
    if (path.status === 'partial' && !path.note?.trim())
      errors.push(`${path.id}: partial path must have a non-empty note`)
    if (path.status !== 'uncovered' && !path.refs.length)
      errors.push(`${path.id}: ${path.status} path has no test references`)
    for (const ref of path.refs) {
      if (!(await referenceExists(ref, readSource)))
        errors.push(`${path.id}: missing ${formatRef(ref)}`)
    }
  }
  return errors

  function readSource(directoryOrFile: string, kind: TestRef['kind']) {
    const path = resolve(root, directoryOrFile)
    const key = `${kind}:${path}`
    const cached = cache.get(key)
    if (cached) return cached
    const contents = kind === 'go' ? readGoPackage(path) : readIfPresent(path)
    cache.set(key, contents)
    return contents
  }
}

export function formatRef(ref: TestRef) {
  return `${ref.kind === 'go' ? ref.package : ref.file} :: ${ref.name}`
}

export function commandsFor(paths: readonly Path[]) {
  const commands = new Map<
    string,
    { ref: TestRef; names: Set<string>; paths: Set<string> }
  >()
  for (const path of paths) {
    for (const ref of path.refs) {
      const key = `${ref.kind}:${ref.kind === 'go' ? ref.package : ref.file}`
      const group = commands.get(key) ?? {
        ref,
        names: new Set<string>(),
        paths: new Set<string>(),
      }
      group.names.add(ref.name)
      group.paths.add(path.id)
      commands.set(key, group)
    }
  }
  return [...commands.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([, group]) => ({
      command: commandFor(group.ref, [...group.names].sort(compareText)),
      paths: [...group.paths].sort(compareText),
    }))
}

async function readGoPackage(path: string) {
  const files = await Array.fromAsync(
    new Glob('*_test.go').scan({ cwd: path, absolute: true }),
  ).catch(() => [])
  return (await Promise.all(files.map(readIfPresent))).join('\n')
}

async function readIfPresent(path: string) {
  const file = Bun.file(path)
  return (await file.exists()) ? file.text() : ''
}

async function referenceExists(
  ref: TestRef,
  read: (path: string, kind: TestRef['kind']) => Promise<string>,
) {
  if (ref.kind === 'go') {
    const text = await read(ref.package, 'go')
    return new RegExp(`^func ${RegExp.escape(ref.name)}\\s*\\(`, 'm').test(text)
  }

  const text = await read(ref.file, ref.kind)
  if (ref.kind === 'native') {
    const assertions = text.match(/^\s*for link in ([\s\S]*?);\s*do\s*$/m)?.[1]
    return (
      assertions?.includes(`"${ref.name}"`) && text.includes('grep -Fq "$link"')
    )
  }

  // Accept literal test titles with standard quote styles and optional line breaks.
  // Anchoring at the test declaration rejects describes, fixture strings and line comments.
  const titles = text.matchAll(
    /^\s*test\s*\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`([^`$]*)`)\s*,/gm,
  )
  return [...titles].some(
    ([, single, double, template]) =>
      (single ?? double ?? template).replace(/\\(['"\\])/g, '$1') === ref.name,
  )
}

function commandFor(ref: TestRef, names: readonly string[]) {
  if (ref.kind === 'native' && ref.file === 'scripts/native-smoke.sh')
    return `nix develop .#e2e --command xvfb-run -a bash ${quote(ref.file)}`
  if (ref.kind === 'native')
    return `nix develop .#e2e --command bash ${quote(ref.file)}`
  if (ref.kind === 'go') {
    const pattern = `^(${names.map(escapeTestPattern).join('|')})$`
    return `nix develop -c go test ./${ref.package} -run ${quote(pattern)}`
  }
  // Playwright grep matches a title including the project/file prefix, not just
  // the test name. Anchor each name at the end and supply its exact spec file.
  const pattern = ` (${names.map(escapeTestPattern).join('|')})$`
  return `PLAYWRIGHT_CHROMIUM_EXECUTABLE="\${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}" bun run test:e2e ${quote(ref.file)} -g ${quote(pattern)}`
}

function escapeTestPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}
