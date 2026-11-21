import { Glob } from 'bun'
import { model } from './model'
import {
  surfaces,
  type Area,
  type Evidence,
  type Model,
  type Surface,
  type Values,
} from './model-types'
import { countPairs, pairwise } from './pairwise'

export interface Path extends Evidence {
  area: string
  values: Values
  tier: (typeof surfaces)[Surface]['tier']
  requiresWindowsHost: boolean
  precondition: string
  action: string
  outcome: string
}

export function buildCatalog(definition: Model = model) {
  const errors: string[] = []
  const uniqueEvidence = new Map<string, Evidence>()
  for (const record of definition.evidence) {
    if (uniqueEvidence.has(record.id))
      errors.push(`Duplicate path ID: ${record.id}`)
    uniqueEvidence.set(record.id, record)
  }

  const areas = Object.entries(definition.areas).map(([id, area]) =>
    buildArea(id, area, uniqueEvidence, errors),
  )
  const paths = areas.flatMap((area) => area.paths)
  const byId = new Map(paths.map((path) => [path.id, path]))
  for (const id of uniqueEvidence.keys()) {
    if (!byId.has(id))
      errors.push(`Evidence does not refer to a legal path: ${id}`)
  }
  for (const surface of Object.keys(surfaces)) {
    if (!paths.some((path) => path.values.surface === surface))
      errors.push(`Unused dimension value: surface=${surface}`)
  }
  if (!paths.some((path) => path.smoke)) errors.push('Smoke spine is empty')
  return { paths, stats: areas.map((area) => area.stats), errors }
}

export function selectPaths(
  paths: readonly Path[],
  filter: { area?: string; changed?: readonly string[] },
  definition: Model = model,
) {
  const changed = filter.changed ?? []
  const selectedAreas = filter.area
    ? new Set([filter.area])
    : areasForChanges(changed, definition)
  return paths.filter((path) => path.smoke || selectedAreas.has(path.area))
}

export function areasForChanges(
  changed: readonly string[],
  definition: Model = model,
) {
  if (matchesChanges(definition.sharedChangeGlobs, changed))
    return new Set(Object.keys(definition.areas))

  const allAreas = Object.entries(definition.areas)
  const selected = new Set<string>()
  for (const file of changed) {
    const matched = allAreas.filter(([, area]) =>
      matchesChanges(area.changeGlobs, [file]),
    )
    if (
      !matched.length &&
      matchesChanges(definition.fallbackChangeGlobs, [file])
    )
      return new Set(Object.keys(definition.areas))
    for (const [id] of matched) selected.add(id)
  }
  return selected
}

function buildArea(
  id: string,
  area: Area,
  evidence: ReadonlyMap<string, Evidence>,
  errors: string[],
) {
  const journeys = new Map(
    area.journeys.map((journey) => [journey[0], journey]),
  )
  if (journeys.size !== area.journeys.length)
    errors.push(`Duplicate path ID: ${id} has repeated scenario IDs`)
  const dimensions = {
    scenario: [...journeys.keys()],
    context: Object.keys(area.contexts),
    surface: [
      ...new Set([
        ...area.surfaces,
        ...area.journeys.flatMap((journey) => journey[4] ?? []),
      ]),
    ],
  }
  const seeds: Values[] = []
  for (const path of evidence.values()) {
    if (!path.id.startsWith(`${id}.`)) continue
    const [, scenario, context, surface, extra] = path.id.split('.')
    const row = { scenario, context, surface }
    if (
      extra !== undefined ||
      Object.entries(dimensions).some(
        ([axis, values]) =>
          !values.some((value) => value === row[axis as keyof typeof row]),
      )
    )
      continue
    if (canExtend(row)) seeds.push(row)
  }
  const result = pairwise(dimensions, canExtend, seeds)
  const paths = result.rows.map(asPath).sort((a, b) => compareText(a.id, b.id))
  for (const [axis, values] of Object.entries(dimensions)) {
    for (const value of values) {
      if (!paths.some((path) => path.values[axis] === value))
        errors.push(`Unused dimension value: ${id}.${axis}=${value}`)
    }
  }
  if (new Set(paths.map((path) => path.id)).size !== paths.length)
    errors.push(`Duplicate generated path ID in ${id}`)

  return {
    paths,
    stats: {
      area: id,
      paths: paths.length,
      covered: paths.filter((path) => path.status === 'covered').length,
      partial: paths.filter((path) => path.status === 'partial').length,
      uncovered: paths.filter((path) => path.status === 'uncovered').length,
      feasiblePairs: result.feasiblePairs,
      modeledPairs: result.modeledPairs,
      assertedPairs: countPairs(
        paths
          .filter((path) => path.status === 'covered')
          .map((path) => path.values),
        dimensions,
      ),
      excludedPairs: result.totalPairs - result.feasiblePairs,
    },
  }

  function canExtend(values: Values): boolean {
    if (
      area.exclusions?.some(({ when }) =>
        Object.entries(when).every(([axis, value]) => values[axis] === value),
      )
    )
      return false
    const { scenario, context, surface } = values
    if (!scenario) return true
    const journey = journeys.get(scenario)
    return (
      !!journey &&
      (!context || journey[3].includes(context)) &&
      (!surface ||
        (journey[4] ?? area.surfaces).some((allowed) => allowed === surface))
    )
  }

  function asPath(values: Values): Path {
    const { scenario, context } = values
    const surface = values.surface as Surface
    const pathId = `${id}.${scenario}.${context}.${surface}`
    const journey = journeys.get(scenario)
    if (!journey) throw new Error(`Unknown journey: ${pathId}`)
    const record = evidence.get(pathId)
    return {
      ...record,
      id: pathId,
      area: id,
      values,
      tier: surfaces[surface].tier,
      requiresWindowsHost: surface === 'native-windows',
      precondition: area.contexts[context],
      action: journey[1],
      outcome: journey[2],
      status: record?.status ?? 'uncovered',
      refs: record?.refs ?? [],
    }
  }
}

function matchesChanges(globs: readonly string[], changed: readonly string[]) {
  return globs.some((pattern) => {
    const glob = new Glob(pattern)
    return changed.some((file) => glob.match(file))
  })
}

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
