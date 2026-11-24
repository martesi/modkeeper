import { describe, expect, it, vi } from 'vitest'
import type { KeyboardEvent } from 'react'
import { handleRegistryItemKeyDown } from './registry-item-keyboard'

function keyboardEvent({
  key,
  target,
  currentTarget,
}: {
  key: string
  target: EventTarget
  currentTarget: EventTarget
}) {
  const preventDefault = vi.fn()
  const event = {
    key,
    target,
    currentTarget,
    preventDefault,
  } as unknown as KeyboardEvent<HTMLElement>

  return { event, preventDefault }
}

describe('registry result keyboard activation', () => {
  it('leaves Enter and Space on nested parent and action buttons to those buttons', () => {
    for (const key of ['Enter', ' ']) {
      for (const nestedControl of ['parent link', 'action button']) {
        const row = { role: 'row' } as unknown as EventTarget
        const button = { label: nestedControl } as unknown as EventTarget
        const activateRow = vi.fn()
        const { event, preventDefault } = keyboardEvent({
          key,
          target: button,
          currentTarget: row,
        })

        handleRegistryItemKeyDown(event, activateRow)

        expect(activateRow).not.toHaveBeenCalled()
        expect(preventDefault).not.toHaveBeenCalled()
      }
    }
  })

  it('activates the focused result itself with Enter and Space', () => {
    for (const key of ['Enter', ' ']) {
      const row = { role: 'row' } as unknown as EventTarget
      const activateRow = vi.fn()
      const { event, preventDefault } = keyboardEvent({
        key,
        target: row,
        currentTarget: row,
      })

      handleRegistryItemKeyDown(event, activateRow)

      expect(activateRow).toHaveBeenCalledTimes(1)
      expect(preventDefault).toHaveBeenCalledTimes(1)
    }
  })
})
