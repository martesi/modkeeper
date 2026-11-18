/*
 * Accent-foreground derivation (fix_plan_0.md §4): a filled control's text color is derived from
 * the accent's relative luminance, so light accents (green, orange) get dark text instead of the
 * hardcoded white that made them unreadable. No dependency — WCAG 2.x math only.
 */

const LIGHT_FOREGROUND = '#ffffff'
// The Fidelity dark ink, not pure black, so derived dark text matches the rest of the UI.
const DARK_FOREGROUND = '#1b1c22'
const BLACK_FOREGROUND = '#000000'

function channelToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : value
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  )
}

export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA)
  const lb = relativeLuminance(hexB)
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la]
  return (lighter + 0.05) / (darker + 0.05)
}

/** A high-contrast foreground for a filled control, including a black fallback for vivid pinks. */
export function contrastOn(hex: string): string {
  const foreground =
    contrastRatio(hex, LIGHT_FOREGROUND) >= contrastRatio(hex, DARK_FOREGROUND)
      ? LIGHT_FOREGROUND
      : DARK_FOREGROUND
  return contrastRatio(hex, foreground) >= 4.5 ? foreground : BLACK_FOREGROUND
}

function hexChannels(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((channel) => channel + channel)
          .join('')
      : value
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

function mixHex(hex: string, target: string, amount: number): string {
  const source = hexChannels(hex)
  const destination = hexChannels(target)
  const channels = source.map((channel, index) =>
    Math.round(channel + (destination[index]! - channel) * amount)
      .toString(16)
      .padStart(2, '0'),
  )
  return `#${channels.join('')}`
}

/**
 * A hue-preserving accent shade that stays readable as text/focus against the theme surface.
 * Saved swatches keep their stored hex; this only adjusts the rendered fill when a custom color
 * would be too low-contrast on the current light/dark canvas.
 */
export function accentForBackground(
  hex: string,
  background: string,
  target = 4.5,
): string {
  if (contrastRatio(hex, background) >= target) return hex
  const targetColor =
    relativeLuminance(background) > 0.5 ? '#000000' : '#ffffff'
  for (let step = 1; step <= 20; step += 1) {
    const mixed = mixHex(hex, targetColor, step / 20)
    if (contrastRatio(mixed, background) >= target) return mixed
  }
  return targetColor
}
