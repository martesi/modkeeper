import { createStore } from 'jotai'
import { act, type Dispatch, type SetStateAction } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, test } from 'vitest'
import { NavigationToggle } from './navigation-toggle'
import {
  getEffectiveNavigationExpanded,
  navigationExpandedAtom,
  toggleNavigationPreference,
} from './shell-state'

describe('navigation toggle at narrow widths', () => {
  test('stays disabled without writing the preference and expands again when wide', () => {
    const store = createStore()
    store.set(navigationExpandedAtom, true)
    let preferenceWrites = 0
    const setPreference: Dispatch<SetStateAction<boolean>> = (update) => {
      preferenceWrites += 1
      store.set(
        navigationExpandedAtom,
        typeof update === 'function'
          ? update(store.get(navigationExpandedAtom))
          : update,
      )
    }

    const container = document.createElement('div')
    const root = createRoot(container)
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      configurable: true,
      value: true,
    })
    act(() =>
      root.render(
        <NavigationToggle
          expanded={getEffectiveNavigationExpanded(
            store.get(navigationExpandedAtom),
            true,
          )}
          label="Expand navigation"
          narrow
          setExpanded={setPreference}
        />,
      ),
    )
    const narrowToggle = container.querySelector('button')!
    expect(narrowToggle.disabled).toBe(true)
    expect(narrowToggle.getAttribute('aria-expanded')).toBe('false')
    act(() => narrowToggle.click())
    toggleNavigationPreference(true, setPreference)

    expect(store.get(navigationExpandedAtom)).toBe(true)
    expect(preferenceWrites).toBe(0)

    act(() =>
      root.render(
        <NavigationToggle
          expanded={getEffectiveNavigationExpanded(
            store.get(navigationExpandedAtom),
            false,
          )}
          label="Collapse navigation"
          narrow={false}
          setExpanded={setPreference}
        />,
      ),
    )
    const wideToggle = container.querySelector('button')!
    expect(wideToggle.disabled).toBe(false)
    expect(wideToggle.getAttribute('aria-expanded')).toBe('true')
    act(() => root.unmount())
  })
})
