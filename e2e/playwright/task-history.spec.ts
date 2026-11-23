import { expect, test, type Page } from '@playwright/test'
import { bootEmptyLibraryMockApp } from './boot'

test('task history is visible in light and dark themes', async ({ page }) => {
  await bootEmptyLibraryMockApp(page)
  await emitCompletedEvent(page, 'download-event', 'forge_install')
  await emitCompletedEvent(page, 'sync-event', 'sync')
  await emitCompletedEvent(page, 'upload-event', 'install')
  await page.getByRole('button', { name: 'Tasks' }).click()
  await page.getByRole('button', { name: 'Dismiss task result' }).click()

  const panel = page.getByRole('region', { name: 'Recent task history' })
  await expect(panel).toBeVisible()
  await expect(panel.locator('li')).toHaveCount(3)
  await expect(panel).toContainText('Download')
  await expect(panel).toContainText('Sync')
  await expect(panel).toContainText('Upload')
  await expect(panel).toContainText('Fixture Library')
  await expect(panel).toContainText('Completed')

  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.classList.toggle('dark', value === 'dark')
    }, theme)
    await page.screenshot({
      path: test.info().outputPath(`task-list-${theme}.png`),
      fullPage: true,
    })
  }
})

async function emitCompletedEvent(
  page: Page,
  taskId: string,
  operation: 'forge_install' | 'sync' | 'install',
) {
  await page.evaluate(
    async ({ taskId, operation }) => {
      type TestWindow = Window & {
        __MK_TASK_PROGRESS_E2E__?: {
          registerTask: (taskId: string, libraryId: string) => Promise<void>
          emit: (event: {
            taskId: string
            libraryId: string
            operation: 'forge_install' | 'sync' | 'install'
            sequence: number
            kind: 'progress'
            stage: 'task_started'
            percent: number
            log: null
          }) => Promise<void>
        }
        __MK_WAILS_MOCK__?: {
          commands?: Record<string, (...args: unknown[]) => unknown>
          events?: {
            emit?: (name: string, ...args: unknown[]) => void
          }
        }
      }
      const target = window as TestWindow
      const progress = target.__MK_TASK_PROGRESS_E2E__
      const mock = target.__MK_WAILS_MOCK__
      const workspaceCommand = mock?.commands?.getLibraryWorkspace
      const emitWorkspaceEvent = mock?.events?.emit
      if (!progress || !workspaceCommand || !emitWorkspaceEvent)
        throw new Error('E2E task event fixture is unavailable')

      const libraryId = 'fixture-library'
      await progress.registerTask(taskId, libraryId)
      await progress.emit({
        taskId,
        libraryId,
        operation,
        sequence: 0,
        kind: 'progress',
        stage: 'task_started',
        percent: 0,
        log: null,
      })
      const type =
        operation === 'sync' ? 'sync_completed' : 'mod_install_completed'
      emitWorkspaceEvent('workspace-event', {
        type,
        taskId,
        libraryId,
        failures: [],
        workspace: workspaceCommand(),
      })
    },
    { taskId, operation },
  )
}
