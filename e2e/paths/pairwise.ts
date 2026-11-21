import type { Values } from './model-types'

type Axis = [name: string, values: readonly string[]]
type Pair = [key: string, first: Values]

// A pair is feasible when it can be completed to a legal path. Extend one
// pair at a time instead of building a cross product of full journeys.
export function pairwise(
  dimensions: Readonly<Record<string, readonly string[]>>,
  canExtend: (values: Values) => boolean,
  seeds: readonly Values[] = [],
) {
  const axes = Object.entries(dimensions)
  const pairs = enumeratePairs(axes)
  const feasible = pairs.filter(([, pair]) =>
    completeRow(axes, canExtend, pair, new Set()),
  )
  const remaining = new Set(feasible.map(([key]) => key))
  const rows = [...seeds]

  for (const row of seeds) {
    for (const key of pairsIn(row, axes)) remaining.delete(key)
  }
  for (const [key, pair] of feasible) {
    if (!remaining.has(key)) continue
    const row = completeRow(axes, canExtend, pair, remaining)
    if (!row) throw new Error(`Feasible pair no longer has a witness: ${key}`)
    rows.push(row)
    for (const matched of pairsIn(row, axes)) remaining.delete(matched)
  }

  return {
    rows,
    totalPairs: pairs.length,
    feasiblePairs: feasible.length,
    modeledPairs: feasible.length - remaining.size,
  }
}

export function countPairs(
  rows: readonly Values[],
  dimensions: Readonly<Record<string, readonly string[]>>,
) {
  const axes = Object.entries(dimensions)
  return new Set(rows.flatMap((row) => pairsIn(row, axes))).size
}

function enumeratePairs(axes: readonly Axis[]): Pair[] {
  return axes.flatMap(([left, leftValues], index) =>
    axes
      .slice(index + 1)
      .flatMap(([right, rightValues]) =>
        leftValues.flatMap((a) =>
          rightValues.map((b): Pair => [
            pairKey(left, right, a, b),
            { [left]: a, [right]: b },
          ]),
        ),
      ),
  )
}

function pairsIn(values: Values, axes: readonly Axis[]) {
  return axes.flatMap(([left], index) =>
    left in values
      ? axes
          .slice(index + 1)
          .filter(([right]) => right in values)
          .map(([right]) => pairKey(left, right, values[left], values[right]))
      : [],
  )
}

function pairKey(left: string, right: string, a: string, b: string) {
  return JSON.stringify([left, right, a, b])
}

function completeRow(
  axes: readonly Axis[],
  canExtend: (values: Values) => boolean,
  assigned: Values,
  uncovered: ReadonlySet<string>,
): Values | undefined {
  if (!canExtend(assigned)) return undefined
  const next = axes.find(([axis]) => !(axis in assigned))
  if (!next) return assigned
  const [axis, values] = next
  const candidates = values
    .map((value) => ({ ...assigned, [axis]: value }))
    .map((row) => ({
      row,
      score: pairsIn(row, axes).filter((key) => uncovered.has(key)).length,
    }))
    .sort((a, b) => b.score - a.score)

  for (const { row } of candidates) {
    const witness = completeRow(axes, canExtend, row, uncovered)
    if (witness) return witness
  }
  return undefined
}
