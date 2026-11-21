import { evidence } from './evidence'
import { crosscuttingJourneys } from './journeys-crosscutting'
import { libraryJourneys } from './journeys-library'
import { surfaces, type Model } from './model-types'

export const model = {
  areas: { ...libraryJourneys, ...crosscuttingJourneys },
  evidence,
  sharedChangeGlobs: [
    'src/redesign/app/**',
    'src/redesign/shared/hooks/**',
    'src/redesign/shared/components/**',
    'src/redesign/shell/**',
    'src/redesign/data/runtime-boundary*',
    'src/wails/**',
    'src/platform*',
    'frontend/bindings/**',
    'e2e/playwright/boot.ts',
    'playwright.config.ts',
    'e2e/bindings.test.ts',
    'main.go',
    'go.mod',
    'go.sum',
  ],
  fallbackChangeGlobs: [
    'backend/**',
    'src/redesign/**',
    'src/routes/**',
    'e2e/playwright/**',
  ],
} satisfies Model

// A serializable authored model; `test-paths.ts model --json` exports it.
export const modelExport = { dimensions: { surface: surfaces }, ...model }
