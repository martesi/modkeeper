import { describe, expect, it } from 'bun:test'
import { resolveRegistryNoResults } from './registry-no-results'

describe('registry no-results compatibility copy', () => {
  it('keeps a missing SPT version explicitly unknown', () => {
    expect(resolveRegistryNoResults('Camo', null)).toEqual({
      kind: 'unknown-spt',
      query: 'Camo',
    })
  })

  it('uses the active SPT version when available', () => {
    expect(resolveRegistryNoResults('Camo', ' 4.0.11 ')).toEqual({
      kind: 'known-spt',
      query: 'Camo',
      sptVersion: '4.0.11',
    })
  })
})
