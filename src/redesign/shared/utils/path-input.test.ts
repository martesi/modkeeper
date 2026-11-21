import { describe, expect, test } from 'bun:test'
import { parsePathInput } from './path-input'

describe('parsePathInput', () => {
  test('returns no paths for empty or whitespace-only input', () => {
    expect(parsePathInput('', 'archives')).toEqual({ values: [], rejected: [] })
    expect(parsePathInput(' \n , \t', 'archives')).toEqual({
      values: [],
      rejected: [],
    })
  })

  test('trims and splits comma-separated paths', () => {
    expect(parsePathInput(' /mods/a.zip, C:\\mods\\b.7z ', 'archives')).toEqual(
      {
        values: ['/mods/a.zip', 'C:\\mods\\b.7z'],
        rejected: [],
      },
    )
  })

  test('drops empty lines and de-duplicates paths', () => {
    expect(
      parsePathInput('/mods/a.zip\n\n/mods/a.zip\n /mods/b.zip', 'archives'),
    ).toEqual({ values: ['/mods/a.zip', '/mods/b.zip'], rejected: [] })
  })

  test('rejects unsupported extensions using the archive authority', () => {
    expect(parsePathInput('/mods/a.zip\n/mods/readme.txt', 'archives')).toEqual(
      {
        values: ['/mods/a.zip'],
        rejected: ['/mods/readme.txt'],
      },
    )
  })

  test('returns a trimmed single path', () => {
    expect(parsePathInput('  C:\\SPT\\  ', 'single')).toEqual({
      values: ['C:\\SPT\\'],
      rejected: [],
    })
  })
})
