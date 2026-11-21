import { expect, test } from '@playwright/test'

test('task center opens and displays progress and its log', async ({
  page,
}) => {
  // Serve-mode browser run: the app auto-installs the in-memory Wails mock
  // (VITE_E2E_TASK_PROGRESS=1), so register/emit travel the mock bus.
  await page.goto('/')
  await expect(page.getByRole('button', { name: /^Tasks/ })).toBeVisible()
  await page.evaluate(async () => {
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

test('running install task exposes a cancel action', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await window.__MK_TASK_PROGRESS_E2E__?.registerTask(
      'install-task',
      'mock-library',
    )
    await window.__MK_TASK_PROGRESS_E2E__?.emit({
      taskId: 'install-task',
      libraryId: 'mock-library',
      operation: 'install',
      sequence: 0,
      kind: 'progress',
      stage: 'install_archives',
      percent: 0,
      log: null,
    })
    window.__MK_WAILS_MOCK__!.commands!.cancelTask = (taskId, libraryId) => {
      const target = window as Window & { __MK_CANCELLED_TASK__?: unknown[] }
      target.__MK_CANCELLED_TASK__ = [taskId, libraryId]
    }
  })
  await page.getByRole('button', { name: /^Tasks/ }).click()
  const active = page.getByLabel('Active tasks')
  await active.getByRole('button', { name: 'Cancel import' }).click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __MK_CANCELLED_TASK__?: unknown[] })
            .__MK_CANCELLED_TASK__,
      ),
    )
    .toEqual(['install-task', 'mock-library'])
})
