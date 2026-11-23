import { expect, test } from '@playwright/test'
import { bootMockApp } from './boot'

async function openLibrary(page: import('@playwright/test').Page) {
  await bootMockApp(page)
  await page.getByRole('link', { name: /library/i }).click()
}

test('mouse palette autocomplete, close tooltip and matched icons', async ({
  page,
}) => {
  await openLibrary(page)
  await page
    .getByRole('button', { name: /search mods/i })
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  const input = dialog.locator('[data-command-palette-search]')
  await expect(dialog).toBeVisible()
  const hint = dialog.getByText('Esc', { exact: true })
  await expect(hint).toBeVisible()
  await expect(dialog.getByRole('listbox')).toBeVisible()
  const listbox = dialog.getByRole('listbox')
  const combo = dialog.locator('[data-command-palette-search]')
  await expect(combo).toHaveAttribute('aria-expanded', 'true')
  await expect(combo).toHaveAttribute(
    'aria-controls',
    (await listbox.getAttribute('id')) ?? '',
  )
  await expect(combo).toHaveAttribute(
    'aria-activedescendant',
    (await dialog.getByRole('option').first().getAttribute('id')) ?? '',
  )
  const searchIcon = dialog.locator('svg').first()
  await dialog.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    )
  })
  const closeButton = dialog.getByRole('button', { name: 'Close' })
  const closeIcon = closeButton.locator('svg')
  const [searchBox, closeBox] = await Promise.all([
    searchIcon.boundingBox(),
    closeIcon.boundingBox(),
  ])
  expect(searchBox).not.toBeNull()
  expect(closeBox).not.toBeNull()
  if (!searchBox || !closeBox) throw new Error('Palette icons have no bounds')
  const hintBox = await hint.boundingBox()
  const inputBox = await input.boundingBox()
  if (!hintBox || !inputBox) throw new Error('Palette controls have no bounds')
  expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(hintBox.x)
  expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(closeBox.x)
  expect(searchBox.width).toBeCloseTo(closeBox.width, 3)
  expect(searchBox.height).toBeCloseTo(closeBox.height, 3)
  expect(searchBox.y + searchBox.height / 2).toBeCloseTo(
    closeBox.y + closeBox.height / 2,
    0,
  )

  await closeButton.hover()
  await expect(page.getByRole('tooltip')).toHaveText('Close (Esc)')
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await expect(closeButton).toBeVisible()
  await expect(page.getByRole('tooltip')).toBeVisible()

  await input.fill('missing-titlebar-result')
  await expect(input).toHaveAttribute('aria-expanded', 'false')
  await expect(input).not.toHaveAttribute('aria-controls')
  await expect(input).not.toHaveAttribute('aria-activedescendant')
  await expect(dialog.getByRole('listbox')).toHaveCount(0)
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await expect(dialog.getByRole('status')).toHaveText('No matching mods')
  await input.press('ArrowDown')
  await input.fill('')
  await expect(input).toHaveAttribute(
    'aria-activedescendant',
    (await dialog.getByRole('option').first().getAttribute('id')) ?? '',
  )

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(
    page.getByRole('button', { name: /search mods/i }).first(),
  ).toBeFocused()
})

test('composition keys do not navigate or activate results', async ({
  page,
}) => {
  await openLibrary(page)
  await page
    .getByRole('button', { name: /search mods/i })
    .first()
    .click()
  const input = page.getByRole('combobox')
  const selected = await input.getAttribute('aria-activedescendant')
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter']) {
    const prevented = await input.evaluate((element, key) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        isComposing: true,
      })
      element.dispatchEvent(event)
      return event.defaultPrevented
    }, key)
    expect(prevented).toBe(false)
  }
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(input).toHaveAttribute('aria-activedescendant', selected ?? '')
})

for (const change of ['target', 'library', 'screen'] as const) {
  test(`reveal is cancelled when ${change} changes during close`, async ({
    page,
  }) => {
    await openLibrary(page)
    const trigger = page.getByRole('button', { name: /search mods/i }).first()
    await trigger.click()
    const input = page.getByRole('combobox')
    await input.evaluate(async (element, change) => {
      const statePath = '/src/redesign/state/library-state.ts'
      const jotaiPath = '/node_modules/.vite/deps/jotai.js'
      const state = await import(statePath)
      const { getDefaultStore } = await import(jotaiPath)
      const store = getDefaultStore()
      const workspace = store.get(state.libraryWorkspaceAtom)
      if (!workspace?.activeLibraryId) throw new Error('No active library')
      const libraryId = workspace.activeLibraryId
      const screen = store.get(state.libraryScreenInstanceAtom)
      element.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      )
      if (change === 'screen') {
        store.set(state.libraryScreenInstanceAtom, null)
        store.set(state.libraryScreenInstanceAtom, screen)
      } else {
        const changed =
          change === 'library'
            ? { ...workspace, activeLibraryId: 'other-library' }
            : {
                ...workspace,
                modsByLibraryId: {
                  ...workspace.modsByLibraryId,
                  [libraryId]: [],
                },
              }
        store.set(state.libraryWorkspaceAtom, changed)
        store.set(state.libraryWorkspaceAtom, workspace)
      }
    }, change)
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.waitForTimeout(300)
    await expect(page.locator('[data-mod-id]:focus')).toHaveCount(0)
    // A cancelled reveal restores focus to the palette trigger.
    await expect(trigger).toBeFocused()
  })
}

test('leaving and returning to the library during close does not steal focus', async ({
  page,
}) => {
  await openLibrary(page)
  await page
    .getByRole('button', { name: /search mods/i })
    .first()
    .click()
  await page.getByRole('combobox').evaluate((input) => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    )
    const link = document.querySelector<HTMLAnchorElement>(
      'a[href="/registry"]',
    )
    if (!link) throw new Error('Registry link not found')
    link.click()
  })
  await expect(page).toHaveURL(/\/registry/)
  await page.getByRole('link', { name: /library/i }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.waitForTimeout(300)
  await expect(page.locator('[data-mod-id]:focus')).toHaveCount(0)
})

test('shortcut palette filters the current list and Ctrl+F selects its query', async ({
  page,
}) => {
  await openLibrary(page)
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog')
  const paletteInput = dialog.locator('[data-command-palette-search]')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('listbox')).toBeVisible()
  await expect(paletteInput).toHaveAttribute('aria-expanded', 'true')
  await paletteInput.fill('query-from-shortcut')
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await expect(
    page.getByText('No mods match your search or filters.'),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    page.getByText('No mods match your search or filters.'),
  ).toBeVisible()
  await page.keyboard.press('Control+f')
  await expect(paletteInput).toBeFocused()
  await expect(paletteInput).toHaveValue('query-from-shortcut')
  await expect(paletteInput).toHaveJSProperty('selectionStart', 0)
  await expect(paletteInput).toHaveJSProperty(
    'selectionEnd',
    'query-from-shortcut'.length,
  )
})

test('keyboard activation of the trigger filters the library', async ({
  page,
}) => {
  await openLibrary(page)
  const trigger = page.getByRole('button', { name: /search mods/i }).first()
  await trigger.focus()
  await page.keyboard.press('Enter')
  const input = page.getByRole('combobox')
  await input.fill('missing-keyboard-result')
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(
    page.getByText('No mods match your search or filters.'),
  ).toBeVisible()
})

test('interaction during dialog close cancels pending reveal focus', async ({
  page,
}) => {
  await openLibrary(page)
  const trigger = page.getByRole('button', { name: /search mods/i }).first()
  await trigger.click()
  const input = page.getByRole('combobox')
  await input.press('Enter')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.waitForTimeout(300)
  // The Tab interaction cancels the reveal, so close restores trigger focus.
  await expect(trigger).toBeFocused()
  await expect(page.locator('[data-mod-id]:focus')).toHaveCount(0)
})

test('shrinking results keeps keyboard activation on a valid option', async ({
  page,
}) => {
  await openLibrary(page)
  await page
    .getByRole('button', { name: /search mods/i })
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  const input = page.getByRole('combobox')
  const options = dialog.getByRole('option')
  const count = await options.count()
  if (count < 10) test.skip(true, 'Mock library needs at least ten mods')
  for (let index = 0; index < 9; index += 1) {
    await input.press('ArrowDown')
  }
  await input.evaluate(async () => {
    const statePath = '/src/redesign/state/library-state.ts'
    const jotaiPath = '/node_modules/.vite/deps/jotai.js'
    const state = await import(statePath)
    const { getDefaultStore } = await import(jotaiPath)
    const store = getDefaultStore()
    const workspace = store.get(state.libraryWorkspaceAtom)
    const libraryId = workspace?.activeLibraryId
    if (!libraryId) throw new Error('No active library')
    const mods = workspace.modsByLibraryId[libraryId] ?? []
    store.set(state.libraryWorkspaceAtom, {
      ...workspace,
      modsByLibraryId: {
        ...workspace.modsByLibraryId,
        [libraryId]: mods.slice(0, 3),
      },
    })
  })
  const thirdId = await options.nth(2).getAttribute('id')
  const secondId = await options.nth(1).getAttribute('id')
  if (!thirdId || !secondId) throw new Error('Result has no accessible id')
  // The stale active index is clamped to the third visible result.
  await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true')
  await expect(input).toHaveAttribute('aria-activedescendant', thirdId)
  await input.press('ArrowUp')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(input).toHaveAttribute('aria-activedescendant', secondId)
  await input.press('Enter')
  await expect(dialog).toBeHidden()
  const onlyModId = secondId.replace('palette-result-', '')
  await expect(
    page.locator(`[data-mod-id="${onlyModId}"]:not([role="option"])`),
  ).toBeFocused()
})

test('autocomplete arrow keys and Enter locate a mod', async ({ page }) => {
  await openLibrary(page)
  await page
    .getByRole('button', { name: /search mods/i })
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('listbox')).toBeVisible()
  const options = dialog.getByRole('option')
  if ((await options.count()) === 0) test.skip(true, 'Mock library has no mods')
  const optionId = await options.nth(1).getAttribute('id')
  if (!optionId) throw new Error('Result has no accessible id')
  const modId = optionId.replace('palette-result-', '')
  const paletteInput = dialog.locator('[data-command-palette-search]')
  await dialog.getByRole('listbox').evaluate((list) => {
    list.style.maxHeight = '45px'
  })
  await paletteInput.press('ArrowDown')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  const selectedColor = await options
    .nth(1)
    .evaluate((option) => getComputedStyle(option).backgroundColor)
  const unselectedColor = await options
    .first()
    .evaluate((option) => getComputedStyle(option).backgroundColor)
  expect(selectedColor).not.toBe(unselectedColor)
  await expect(options.locator('button, a, input, [tabindex]')).toHaveCount(0)
  expect(
    await dialog.getByRole('listbox').evaluate((list) => list.scrollTop),
  ).toBeGreaterThan(0)
  await expect(paletteInput).toBeFocused()
  await expect(paletteInput).toHaveAttribute(
    'aria-activedescendant',
    (await options.nth(1).getAttribute('id')) ?? '',
  )
  await paletteInput.press('Enter')
  await expect(dialog).toBeHidden()
  const locatedMod = page.locator(`[data-mod-id="${modId}"]`)
  await expect(locatedMod).toBeVisible()
  await expect(locatedMod).toBeFocused()
  await page.getByRole('button', { name: 'Grid view' }).click()
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(locatedMod).not.toBeFocused()
})

test('outside click closes the palette and restores focus to its trigger', async ({
  page,
}) => {
  await openLibrary(page)
  const trigger = page.getByRole('button', { name: /search mods/i }).first()
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.mouse.click(10, 400)
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

for (const view of ['Grid view', 'Icon view']) {
  test(`Locate reveals and focuses a mod in ${view}`, async ({ page }) => {
    await openLibrary(page)
    await page.getByRole('button', { name: view }).click()
    await page
      .getByRole('button', { name: /search mods/i })
      .first()
      .click()

    const dialog = page.getByRole('dialog')
    const option = dialog.getByRole('option').first()
    const modId = await option.getAttribute('data-mod-id')
    if (!modId) throw new Error('Autocomplete result has no mod id')
    await option.click()

    const locatedMod = page.locator(
      `[data-mod-id="${modId}"]:not([role="option"])`,
    )
    await expect(dialog).toBeHidden()
    await expect(locatedMod).toBeVisible()
    await expect(locatedMod).toBeFocused()
  })
}
