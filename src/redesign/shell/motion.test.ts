import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const sharedStyles = readFileSync(
  new URL('../../assets/style.css', import.meta.url),
  'utf8',
)
const motionStyles = readFileSync(
  new URL('./desktop-shell.css', import.meta.url),
  'utf8',
)
const navigationSource = readFileSync(
  new URL('./left-navigation.tsx', import.meta.url),
  'utf8',
)
const inspectorSource = readFileSync(
  new URL('../registry/registry-detail-inspector.tsx', import.meta.url),
  'utf8',
)
const libraryEmptyCardSource = readFileSync(
  new URL('../library/library-empty-card.tsx', import.meta.url),
  'utf8',
)
const registryNoLibraryEmptySource = readFileSync(
  new URL('../registry/registry-no-library-empty-state.tsx', import.meta.url),
  'utf8',
)

function cssBlockContent(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker)
  if (markerIndex < 0) return ''
  const openingBrace = source.indexOf('{', markerIndex)
  if (openingBrace < 0) return ''

  let depth = 0
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openingBrace + 1, index)
    }
  }
  return ''
}

describe('shell and registry motion', () => {
  it('uses shared Argus timings and easing for transform and color motion', () => {
    expect(sharedStyles).toContain('--t-fast: 83ms')
    expect(sharedStyles).toContain('--t-med: 167ms')
    expect(sharedStyles).toContain('--t-slow: 250ms')
    expect(sharedStyles).toContain('--ease-move: cubic-bezier(0.33, 0, 0.1, 1)')
    expect(motionStyles).toContain(
      'transition: transform var(--t-med) var(--ease-move)',
    )
    expect(motionStyles).toContain('transition-duration: var(--t-fast)')
    expect(motionStyles).toContain(
      'animation: mk-registry-inspector-enter var(--t-slow) var(--ease-move) both',
    )
  })

  it('removes motion under reduced motion without hiding focus or changing layout', () => {
    const reducedMotionStyles = cssBlockContent(
      motionStyles,
      '@media (prefers-reduced-motion: reduce)',
    )
    expect(reducedMotionStyles).not.toBe('')
    expect(reducedMotionStyles).toMatch(
      /\.mk-navigation-item,\s*\.mk-navigation-indicator\s*\{\s*transition:\s*none;\s*\}/,
    )
    expect(reducedMotionStyles).toMatch(
      /\.mk-registry-inspector-enter\s*\{\s*animation:\s*none;\s*\}/,
    )
    expect(sharedStyles).toContain('animation-duration: 0.01ms !important')
    expect(sharedStyles).toContain('transition-duration: 0.01ms !important')
    expect(motionStyles).toContain('transform: translateX(4px)')
    expect(motionStyles).not.toContain('transition: width')
    expect(navigationSource).not.toContain('transition-[width]')
    expect(inspectorSource).not.toContain('transition-[width]')
    expect(navigationSource).toContain('focus-visible:ring-[3px]')
    expect(navigationSource).toContain('aria-label={label()}')
    expect(inspectorSource).toContain(
      'aria-label={detail?.name ?? registryText.title()}',
    )
    expect(inspectorSource).toContain('aria-label={registryText.closeDetail()}')
  })

  it('renders rail nav items without category headers and flat empty states without card backgrounds', () => {
    expect(navigationSource).not.toContain('commonText.workspace')
    expect(navigationSource).not.toContain('commonText.preferences')
    expect(navigationSource).not.toContain('<h2')
    expect(navigationSource).toContain('className="flex-1"')
    expect(navigationSource).toContain('mk-navigation-indicator')

    expect(libraryEmptyCardSource).not.toContain('bg-card')
    expect(libraryEmptyCardSource).not.toContain('border-dashed')
    expect(registryNoLibraryEmptySource).not.toContain('bg-muted')
    expect(registryNoLibraryEmptySource).not.toContain('bg-card')
    expect(registryNoLibraryEmptySource).not.toContain('border')
  })
})
