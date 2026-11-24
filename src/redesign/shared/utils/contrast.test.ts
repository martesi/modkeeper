/*
 * Default accents meet normal-text contrast in both themes. Saved/custom swatches remain unchanged
 * and use the better of the two supported foregrounds.
 */
import { describe, expect, test } from 'vitest'
import { accentForBackground, contrastOn, contrastRatio } from './contrast'
import { ACCENT_SWATCHES } from '../../settings/accent-palette'

describe('contrastOn', () => {
  for (const swatch of ACCENT_SWATCHES.filter(
    (swatch) => swatch.value !== 'default',
  )) {
    test(`${swatch.name} (${swatch.value}) foreground is readable`, () => {
      const foreground = contrastOn(swatch.value)
      const ratio = contrastRatio(swatch.value, foreground)
      expect(ratio).toBeGreaterThanOrEqual(4.5)

      for (const candidate of ['#ffffff', '#1b1c22']) {
        expect(ratio).toBeGreaterThanOrEqual(
          contrastRatio(swatch.value, candidate),
        )
      }
    })
  }

  test('theme-aware default accents meet normal-text contrast', () => {
    expect(contrastRatio('#0067c0', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#4cc2ff', '#00213b')).toBeGreaterThanOrEqual(4.5)
  })

  test('light accents get dark text, dark accents get white text', () => {
    expect(contrastOn('#3ecf8e')).toBe('#1b1c22')
    expect(contrastOn('#f5a35c')).toBe('#1b1c22')
    expect(contrastOn('#e91e63')).toBe('#000000')
    expect(contrastOn('#00828d')).toBe('#ffffff')
  })

  test('custom accents are shade-adjusted for the active canvas', () => {
    for (const hex of ['#3ecf8e', '#f5a35c', '#e91e63']) {
      const light = accentForBackground(hex, '#f3f3f3')
      const dark = accentForBackground(hex, '#202020')
      expect(contrastRatio(light, '#f3f3f3')).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(dark, '#202020')).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(light, contrastOn(light))).toBeGreaterThanOrEqual(
        4.5,
      )
      expect(contrastRatio(dark, contrastOn(dark))).toBeGreaterThanOrEqual(4.5)
    }
    expect(accentForBackground('#0067c0', '#f3f3f3')).toBe('#0067c0')
  })

  test('destructive fills have readable text in both themes', () => {
    expect(contrastRatio('#c42b1c', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#ff6a5c', '#2a0400')).toBeGreaterThanOrEqual(4.5)
  })
})
