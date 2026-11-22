import { describe, expect, test } from 'bun:test'
import type { CSSProperties } from 'react'
import { titlebarDragStyle } from './titlebar-drag'

describe('titlebar drag marker', () => {
  test('uses the Wails CSS property only in the Wails shell', () => {
    expect(titlebarDragStyle('wails')).toEqual({
      '--wails-draggable': 'drag',
    } as CSSProperties)
    expect(titlebarDragStyle('tauri')).toBeUndefined()
    expect(titlebarDragStyle('browser')).toBeUndefined()
  })
})
