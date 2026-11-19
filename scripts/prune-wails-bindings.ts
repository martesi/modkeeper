#!/usr/bin/env bun
/**
 * Wails v3's TypeScript generator emits `Create` (and sometimes other runtime
 * helpers) unconditionally. Generated bindings are machine output, but they are
 * still type-checked by `tsc` because the app imports them, so an unused import
 * fails `noUnusedLocals`. This drops import specifiers that never appear outside
 * their import block. Run after `wails3 generate bindings`.
 *
 * Usage: bun scripts/prune-wails-bindings.ts [--check]
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = 'frontend/bindings'
const checkOnly = process.argv.includes('--check')

const files = await collect(root)
let changed = 0
const problems: string[] = []

for (const file of files) {
  const source = await readFile(file, 'utf8')
  const { text, removed } = prune(source)
  if (removed.length === 0) continue
  changed++
  if (checkOnly) {
    problems.push(`${file}: unused ${removed.join(', ')}`)
    continue
  }
  await writeFile(file, text)
}

if (checkOnly && problems.length > 0) {
  console.error('Generated Wails bindings contain unused imports:')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('Run: bun scripts/prune-wails-bindings.ts')
  process.exit(1)
}

console.log(
  changed === 0
    ? 'wails bindings: no unused imports'
    : `wails bindings: pruned ${changed} file(s)`,
)

async function collect(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await collect(path)))
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

function prune(source: string): { text: string; removed: string[] } {
  const lines = source.split('\n')
  const blocks: { start: number; end: number; names: string[] }[] = []

  for (let i = 0; i < lines.length; i++) {
    if (!/^import \{\s*$/.test(lines[i] ?? '')) continue
    let end = i + 1
    while (end < lines.length && !/^\} from /.test(lines[end] ?? '')) end++
    if (end >= lines.length) continue
    const names = lines
      .slice(i + 1, end)
      .map((line) => line.trim().replace(/,$/, ''))
      .filter((line) => line.length > 0)
      .map((spec) => spec.split(/\s+as\s+/).pop() ?? spec)
    blocks.push({ start: i, end, names })
    i = end
  }

  const outside = lines.map((line, index) =>
    blocks.some((block) => index > block.start && index < block.end)
      ? null
      : line,
  )

  const removed: string[] = []
  for (const block of blocks) {
    const kept: number[] = []
    for (let index = block.start + 1; index < block.end; index++) {
      const spec = (lines[index] ?? '').trim().replace(/,$/, '')
      if (!spec) continue
      const local = spec.split(/\s+as\s+/).pop() ?? spec
      const used = outside.some((line) => line !== null && line.includes(local))
      if (used) kept.push(index)
      else removed.push(local)
    }
    if (kept.length === 0) {
      lines[block.start] = '__DROP__'
      for (let index = block.start + 1; index <= block.end; index++) {
        lines[index] = '__DROP__'
      }
    } else if (kept.length < block.end - block.start - 1) {
      // Preserve trailing commas only on lines that remain in the block.
      const keptSet = new Set(kept)
      for (let index = block.start + 1; index < block.end; index++) {
        if (!keptSet.has(index)) lines[index] = '__DROP__'
      }
    }
  }

  const text = lines
    .filter((line) => line !== '__DROP__')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
  return { text, removed }
}
