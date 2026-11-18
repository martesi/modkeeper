import type { KeyboardEvent } from 'react'

/** Activate a result only when its own row/card receives Enter or Space. */
export function handleRegistryItemKeyDown(
  event: KeyboardEvent<HTMLElement>,
  onActivate: () => void,
) {
  if (event.target !== event.currentTarget) return
  if (event.key !== 'Enter' && event.key !== ' ') return

  event.preventDefault()
  onActivate()
}
