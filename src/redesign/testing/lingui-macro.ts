import { mock } from 'bun:test'

let installed = false

function identity(value: unknown, ...values: unknown[]): string {
  if (Array.isArray(value)) {
    return value
      .map(
        (part, index) => `${part}${index < values.length ? values[index] : ''}`,
      )
      .join('')
  }
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'message' in value) {
    return String(value.message ?? '')
  }
  return ''
}

/**
 * Bun runs tests without the Vite Lingui transform, so the real macro package
 * throws at import time. Identity messages keep i18n modules importable. Every
 * export is present so a later test file never sees an incomplete module link.
 */
export function installLinguiMacroMock(): void {
  if (installed) return
  installed = true
  mock.module('@lingui/core/macro', () => ({
    t: identity,
    msg: identity,
    ph: identity,
    defineMessage: identity,
    plural: identity,
    select: identity,
    selectOrdinal: identity,
  }))
}
