import { describe, expect, it } from 'vitest'
import { allPageItems, allPageNumber } from './registry-pagination'

describe('All items pagination', () => {
  it('clamps the shared cursor to the longest result set', () => {
    expect(allPageNumber(0, 2, 3)).toBe(1)
    expect(allPageNumber(9, 2, 3)).toBe(3)
    expect(allPageNumber(2, 0, 0)).toBe(1)
  })

  for (const [name, mods, addons] of [
    ['more mods', [['M1'], ['M2'], ['M3']], [['A1']]],
    ['more addons', [['M1']], [['A1'], ['A2'], ['A3']]],
    ['empty addons', [['M1'], ['M2'], ['M3']], []],
  ] as [string, string[][], string[][]][]) {
    it(name, () => {
      const pages = Array.from({ length: 3 }, (_, index) => {
        const page = allPageNumber(index + 1, mods.length, addons.length)
        return allPageItems(page, {
          mods: {
            items: mods[Math.min(page, mods.length) - 1] ?? [],
            lastPage: mods.length,
          },
          addons: {
            items: addons[Math.min(page, addons.length) - 1] ?? [],
            lastPage: addons.length,
          },
        })
      })
      expect(pages).toEqual(
        Array.from({ length: 3 }, (_, i) => [
          ...(mods[i] ?? []),
          ...(addons[i] ?? []),
        ]),
      )
      const all = pages.flat()
      expect(new Set(all).size).toBe(all.length)
      expect([...all].sort()).toEqual([...mods.flat(), ...addons.flat()].sort())
    })
  }
})
