import { compareText, type buildCatalog, type Path } from './catalog'
import { formatRef } from './test-refs'

export const matrixStart = '<!-- TEST-PATHS:START -->'
export const matrixEnd = '<!-- TEST-PATHS:END -->'

type StatKey = Exclude<
  keyof ReturnType<typeof buildCatalog>['stats'][number],
  'area'
>

export function renderMatrix({
  paths,
  stats,
}: ReturnType<typeof buildCatalog>) {
  const total = (key: StatKey) =>
    stats.reduce((sum, area) => sum + area[key], 0)
  const gaps = paths
    .filter(
      (path) => path.status === 'uncovered' && path.priority !== undefined,
    )
    .sort(
      (a, b) =>
        (a.priority ?? 0) - (b.priority ?? 0) || compareText(a.id, b.id),
    )
  const lines = [
    '## Coverage summary',
    '',
    '| Area | Paths | Covered | Partial | Uncovered | Modeled / feasible pairs | Asserted pairs | Excluded pairs |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...stats.map((area) => statRow(area.area, (key) => area[key])),
    statRow('**Total**', total),
    '',
    '## Highest-risk uncovered paths',
    '',
    ...gaps.map((path, index) => `${index + 1}. \`${path.id}\` — ${path.note}`),
    '',
    '## Path matrix',
    '',
    '★ marks the smoke spine. † requires a Windows host.',
  ]

  for (const area of stats) {
    lines.push(
      '',
      `### ${area.area}`,
      '',
      '| Path ID | Tier | Status | Expected outcome | Evidence or gap |',
      '| --- | --- | --- | --- | --- |',
      ...paths.filter((path) => path.area === area.area).map(pathRow),
    )
  }
  return lines.join('\n')
}

export function replaceMatrix(document: string, matrix: string) {
  const start = document.indexOf(matrixStart)
  const end = document.indexOf(matrixEnd)
  if (start === -1 || end < start) return undefined
  return `${document.slice(0, start)}${matrixStart}\n\n${matrix}\n\n${document.slice(end)}`
}

export function pathText(path: Path) {
  const flags = [
    path.smoke && 'smoke',
    path.requiresWindowsHost && 'requires-windows-host',
  ]
    .filter(Boolean)
    .join(', ')
  const label = `${path.id} [${path.tier}, ${path.status}${flags ? `, ${flags}` : ''}]`
  const detail = `  Given: ${path.precondition} Do: ${path.action}. Expect: ${path.outcome}.`
  const refs = path.refs.map((ref) => `  Test: ${formatRef(ref)}`)
  return [
    label,
    detail,
    ...refs,
    ...(path.note ? [`  Note: ${path.note}`] : []),
  ].join('\n')
}

function statRow(name: string, count: (key: StatKey) => number) {
  return `| ${name} | ${count('paths')} | ${count('covered')} | ${count('partial')} | ${count('uncovered')} | ${count('modeledPairs')} / ${count('feasiblePairs')} | ${count('assertedPairs')} | ${count('excludedPairs')} |`
}

function pathRow(path: Path) {
  const refs = path.refs.map((ref) => `\`${formatRef(ref)}\``)
  const evidence = [...refs, ...(path.note ? [path.note] : [])].join('<br>')
  const tier = `${path.tier}${path.requiresWindowsHost ? ' †' : ''}`
  return `| \`${path.id}\`${path.smoke ? ' ★' : ''} | ${tier} | ${path.status} | ${path.outcome} | ${evidence || '—'} |`
}
