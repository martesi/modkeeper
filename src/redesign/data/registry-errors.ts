/** Extract Retry-After seconds from Forge error text. */
export function parseRetryAfterSeconds(message: string): number | null {
  const value = message.match(/retry[\s-]?after\s*[:=]?\s*(\d+)/i)?.[1]
  if (!value) return null
  const seconds = Number(value)
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null
}

export type RegistryRequestFailure = 'offline' | 'request'

/** Only Forge's explicit transport failure is presented as an offline state. */
export function classifyRegistryRequestFailure(
  error: unknown,
): RegistryRequestFailure {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return 'request'
  }
  const failure = error as { code?: unknown; data?: unknown }
  return failure.code === 'IOError' &&
    typeof failure.data === 'string' &&
    /^Forge request failed:/i.test(failure.data)
    ? 'offline'
    : 'request'
}
