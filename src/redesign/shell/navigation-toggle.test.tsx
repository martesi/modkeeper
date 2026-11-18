import { createStore } from 'jotai'
import type { Dispatch, SetStateAction } from 'react'
import { describe, expect, test } from 'bun:test'
import { NavigationToggle } from './navigation-toggle'
import {
  getEffectiveNavigationExpanded,
  navigationExpandedAtom,
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

    const narrowToggle = NavigationToggle({
      expanded: getEffectiveNavigationExpanded(
        store.get(navigationExpandedAtom),
        true,
      ),
      label: 'Expand navigation',
      narrow: true,
      setExpanded: setPreference,
    })

    expect(narrowToggle.props.disabled).toBe(true)
    expect(narrowToggle.props['aria-expanded']).toBe(false)
    const click = narrowToggle.props.onClick
    if (!click) throw new Error('Navigation toggle must have a click handler')
    Reflect.apply(click, undefined, [])

    expect(store.get(navigationExpandedAtom)).toBe(true)
    expect(preferenceWrites).toBe(0)

    const wideToggle = NavigationToggle({
      expanded: getEffectiveNavigationExpanded(
        store.get(navigationExpandedAtom),
        false,
      ),
      label: 'Collapse navigation',
      narrow: false,
      setExpanded: setPreference,
    })

    expect(wideToggle.props.disabled).toBe(false)
    expect(wideToggle.props['aria-expanded']).toBe(true)
  })
})
