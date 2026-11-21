export type Tier = 'T1' | 'T2' | 'T3' | 'T4'
export type Status = 'covered' | 'partial' | 'uncovered'

export const surfaces = {
  'backend-api': { tier: 'T1' },
  'backend-filesystem': { tier: 'T2' },
  'linux-process': { tier: 'T2' },
  'wails-dev': { tier: 'T3' },
  'native-linux': { tier: 'T3' },
  'native-windows': { tier: 'T3', requiresWindowsHost: true },
  'browser-mock': { tier: 'T4' },
} as const

export type Surface = keyof typeof surfaces
export type Values = Readonly<Record<string, string>>

export interface Exclusion {
  when: Values
  reason: string
}

export type Journey = [
  scenario: string,
  action: string,
  outcome: string,
  contexts: readonly string[],
  surfaces?: readonly Surface[],
]

export interface Area {
  surfaces: readonly Surface[]
  contexts: Readonly<Record<string, string>>
  journeys: readonly Journey[]
  exclusions?: readonly Exclusion[]
  changeGlobs: readonly string[]
}

export type TestRef =
  | { kind: 'go'; package: string; name: string }
  | { kind: 'playwright' | 'native'; file: string; name: string }

export interface Evidence {
  id: string
  status: Status
  refs: readonly TestRef[]
  note?: string
  priority?: number
  smoke?: true
}

export interface Model {
  areas: Readonly<Record<string, Area>>
  evidence: readonly Evidence[]
  sharedChangeGlobs: readonly string[]
  fallbackChangeGlobs: readonly string[]
}
