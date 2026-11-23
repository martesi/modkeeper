import type { Result, SError } from '@/wails/contract'
import { translateError } from '../lib/error'

/**
 * FP-style Result unwrapper
 * @param resultPromise - Promise that resolves to a Result
 * @param handler - Optional function that receives (ok, err) and returns a value
 * @returns If handler provided, returns handler result. Otherwise returns ok value or throws translated error
 */
export async function ur<T, R = T>(
  resultPromise: Promise<Result<T, SError>> | Result<T, SError>,
  handler?: (ok?: T, err?: SError) => R,
): Promise<R> {
  const result = await resultPromise

  if (result.status === 'error') {
    if (handler) {
      return handler(void 0, result.error)
    }
    throw new Error(translateError(result.error))
  }

  if (handler) {
    return handler(result.data, void 0)
  }

  return result.data as unknown as R
}
