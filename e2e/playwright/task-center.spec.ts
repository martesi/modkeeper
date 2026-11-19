import { expect, test } from '@playwright/test'

test('task center opens and displays progress and its log', async ({
  page,
}) => {
  // The integration base still uses Tauri events. Replace this temporary seam
  // with G2's Wails mock once the repository uses the Wails event bridge.
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: unknown) => void>()
    const listeners = new Map<string, number[]>()
    let nextId = 0
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        transformCallback: (callback: (event: unknown) => void) => {
          const id = ++nextId
          callbacks.set(id, callback)
          return id
        },
        invoke: async (
          command: string,
          args: { event: string; handler: number; payload: unknown },
        ) => {
          if (command === 'plugin:event|listen') {
            listeners.set(args.event, [
              ...(listeners.get(args.event) ?? []),
              args.handler,
            ])
            return args.handler
          }
          if (command === 'plugin:event|emit') {
            for (const id of listeners.get(args.event) ?? []) {
              callbacks.get(id)?.({
                event: args.event,
                id,
                payload: args.payload,
              })
            }
            return null
          }
          throw new Error(`Unexpected IPC command: ${command}`)
        },
      },
    })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: /^Tasks/ })).toBeVisible()
  await page.evaluate(async () => {
    Object.assign(window, { isTauri: true })
    await window.__MK_TASK_PROGRESS_E2E__?.registerTask(
      'web-task',
      'web-library',
    )
  })
  await page.getByRole('button', { name: /^Tasks/ }).click()
  await expect(
    page.locator('[aria-labelledby="task-center-title"]'),
  ).toBeVisible()
  await page.evaluate(async () => {
    await window.__MK_TASK_PROGRESS_E2E__?.emit({
      taskId: 'web-task',
      libraryId: 'web-library',
      operation: 'sync',
      sequence: 0,
      kind: 'progress',
      stage: 'sync_deploy',
      percent: 42,
      log: {
        level: 'info',
        code: 'web-fixture',
        message: 'Synthetic progress fixture log entry',
      },
    })
  })
  const active = page.getByLabel('Active tasks')
  const bar = active.getByRole('progressbar')
  await expect(bar).toHaveAttribute('aria-valuenow', '42')
  await expect(bar).toHaveAttribute(
    'aria-valuetext',
    'Deploying files: 42% of this stage',
  )
  await expect(bar).toHaveAttribute('aria-live', 'off')
  await active.locator('details > summary').click()
  await expect(active.locator('details')).toHaveAttribute('open', '')
  await expect(active).toContainText('Synthetic progress fixture log entry')
})
