import { expect } from '@playwright/test'
import { test } from './fixture'
import { release } from 'node:os'
import path from 'node:path'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'

test('server starts without a mock', async ({ page, server }) => {
  const workspaceResponse = page.waitForResponse((response) => {
    const request = response.request()
    if (
      request.method() !== 'POST' ||
      new URL(response.url()).pathname !== '/wails/runtime'
    )
      return false
    const body = request.postDataJSON() as {
      object?: number
      method?: number
      args?: { methodID?: number }
    }
    return (
      body.object === 0 &&
      body.method === 0 &&
      body.args?.methodID === 188297059
    )
  })
  await page.goto(server.url)
  expect((await workspaceResponse).ok()).toBe(true)
  await expect(
    page.getByRole('navigation', { name: /primary navigation/i }),
  ).toBeVisible()
  await expect(
    page.getByText('Activate a library', { exact: true }),
  ).toBeVisible()
})

test('browses, creates and activates a library, then imports and syncs a local archive', async ({
  page,
  server,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'modkeeper.taskHistory.v1',
      JSON.stringify({
        version: 1,
        tasks: [
          {
            taskId: 'older-task-decoy',
            libraryId: 'older-library-decoy',
            timestamp: '2026-11-18T10:00:00.000Z',
            operation: 'sync',
            status: 'success',
            logTail: [],
          },
          {
            taskId: 'other-library-decoy',
            libraryId: 'other-library',
            timestamp: '2026-11-18T10:01:00.000Z',
            operation: 'sync',
            status: 'failure',
            logTail: [],
          },
        ],
      }),
    ),
  )
  await page.goto(server.url)
  await page.getByRole('button', { name: /manage libraries/i }).click()
  await page.getByRole('button', { name: /add library/i }).click()
  const picker = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Game root path') })
  await picker.getByLabel('Game root path').fill(server.game)
  await picker.getByRole('button', { name: 'Browse folders' }).click()
  await picker.getByRole('button', { name: 'game/', exact: true }).click()
  await picker.getByRole('button', { name: 'Select this folder' }).click()
  await expect(picker.getByLabel('Game root path')).toHaveValue(server.game)
  await picker.getByRole('button', { name: 'Use path' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('tab', { name: 'game' })).toBeVisible()
  await dialog.getByRole('button', { name: /add library/i }).click()
  const secondPicker = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Game root path') })
  await secondPicker
    .getByLabel('Game root path')
    .fill(path.join(server.root, 'second-game'))
  await secondPicker.getByRole('button', { name: 'Use path' }).click()
  await dialog.getByRole('tab', { name: 'game', exact: true }).click()
  await dialog.getByRole('button', { name: /^activate$/i }).click()
  await expect(
    dialog.getByRole('button', { name: /activated/i }),
  ).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Add mod', exact: true }).click()
  const archiveDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Archive paths') })
  await archiveDialog.getByLabel('Archive paths').fill(server.archive)
  await archiveDialog.getByRole('button', { name: 'Use path' }).click()
  await expect(
    page.getByText('fixture-mod', { exact: false }).first(),
  ).toBeVisible()
  const configPath = path.join(
    server.root,
    'config',
    'Modkeeper',
    'config.toml',
  )
  await expect
    .poll(() => readFile(configPath, 'utf8').catch(() => ''))
    .toContain('libraryRoot')
  const config = await readFile(configPath, 'utf8')
  const libraryRoot = [...config.matchAll(/libraryRoot\s*=\s*"([^"]+)"/g)]
    // TOML basic strings escape Windows path separators. Decode the captured
    // string before comparing it with the filesystem path supplied by Node.
    .map((match) => JSON.parse(`"${match[1]}"`) as string)
    .find((root): root is string => Boolean(root?.startsWith(server.game)))
  expect(libraryRoot).toBeDefined()
  if (!libraryRoot) throw new Error('Game library root was not persisted')
  await expect
    .poll(() =>
      readFile(path.join(libraryRoot, 'manifest.toml'), 'utf8').catch(() => ''),
    )
    .toContain('fixture-mod')
  const modsDir = path.join(libraryRoot, 'mods')
  const mods = await readdir(modsDir)
  expect(mods).toHaveLength(1)
  expect(
    await readFile(
      path.join(
        modsDir,
        mods[0],
        'BepInEx',
        'plugins',
        'FixtureMod',
        'fixture.dll',
      ),
    ),
  ).toEqual(Buffer.from('fixture payload'))

  await page.getByRole('button', { name: 'Add mod', exact: true }).click()
  const successArchiveDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Archive paths') })
  await successArchiveDialog
    .getByLabel('Archive paths')
    .fill(server.successArchive)
  await successArchiveDialog.getByRole('button', { name: 'Use path' }).click()
  await expect(
    page.getByText('fixture-success-mod', { exact: false }).first(),
  ).toBeVisible()

  const deployed = path.join(
    server.game,
    'BepInEx',
    'plugins',
    'FixtureMod',
    'fixture.dll',
  )
  await expect(readFile(deployed)).rejects.toMatchObject({ code: 'ENOENT' })
  await mkdir(path.dirname(deployed), { recursive: true })
  await writeFile(deployed, 'unmanaged user content')
  const successDeployed = path.join(
    server.game,
    'BepInEx',
    'plugins',
    'SuccessMod',
    'success.dll',
  )
  const sync = page.getByRole('button', { name: /^sync$/i })
  const partial = await runSync(page, sync)
  await page.getByRole('button', { name: /^tasks$/i }).click()
  const partialHistory = getSyncHistory(page, partial.taskId, partial.libraryId)
  await expect(partialHistory).toHaveCount(1)
  await expect(
    partialHistory.getByText('Completed with errors', { exact: true }),
  ).toBeVisible()
  await page.screenshot({
    path: path.resolve('test-results/sync-partial-result.png'),
    fullPage: false,
  })
  await expect(readFile(deployed, 'utf8')).resolves.toBe(
    'unmanaged user content',
  )
  await expect
    .poll(() => readFile(successDeployed, 'utf8'))
    .toBe('successful fixture payload')
  const partialManifest = await readFile(
    path.join(libraryRoot, 'manifest.toml'),
    'utf8',
  )
  expect(partialManifest).toContain('isDirty = true')
  expect(partialManifest).toContain('fixture-mod')
  expect(partialManifest).toContain('fixture-success-mod')
  const partialDeployment = await readFile(
    path.join(libraryRoot, 'deployment-v2.toml'),
    'utf8',
  )
  expect(partialDeployment).toContain('SuccessMod')
  expect(partialDeployment).not.toContain('FixtureMod')

  await rm(deployed)
  await rm(path.dirname(deployed), { recursive: true, force: true })
  await page
    .getByRole('dialog', { name: 'Tasks' })
    .getByRole('button', { name: 'Close' })
    .click()
  const success = await runSync(page, sync)
  await page.getByRole('button', { name: /^tasks$/i }).click()
  const successHistory = getSyncHistory(page, success.taskId, success.libraryId)
  await expect(successHistory).toHaveCount(1)
  await expect(
    successHistory.getByText('Completed', { exact: true }),
  ).toBeVisible()
  await expect.poll(() => readFile(deployed, 'utf8')).toBe('fixture payload')
  await expect
    .poll(() => readFile(successDeployed, 'utf8'))
    .toBe('successful fixture payload')
  const successManifest = await readFile(
    path.join(libraryRoot, 'manifest.toml'),
    'utf8',
  )
  expect(successManifest).toContain('isDirty = false')
  expect(successManifest).toContain('fixture-mod')
  expect(successManifest).toContain('fixture-success-mod')
  const successDeployment = await readFile(
    path.join(libraryRoot, 'deployment-v2.toml'),
    'utf8',
  )
  expect(successDeployment).toContain('SuccessMod')
  expect(successDeployment).toContain('FixtureMod')
})

async function runSync(
  page: import('@playwright/test').Page,
  sync: import('@playwright/test').Locator,
): Promise<{ taskId: string; libraryId: string }> {
  const accepted = page.waitForResponse((response) => {
    const request = response.request()
    if (
      request.method() !== 'POST' ||
      new URL(response.url()).pathname !== '/wails/runtime'
    )
      return false
    const body = request.postDataJSON() as {
      object?: number
      method?: number
      args?: { methodID?: number }
    }
    return (
      body.object === 0 &&
      body.method === 0 &&
      body.args?.methodID === 3644304143
    )
  })
  await sync.click()
  const response = await accepted
  expect(response.ok()).toBe(true)
  expect(await response.json()).toMatchObject({ accepted: true })
  const request = response.request().postDataJSON() as {
    args: { args: [{ taskId: string; libraryId: string }] }
  }
  const { taskId, libraryId } = request.args.args[0]
  expect(taskId).toEqual(expect.any(String))
  expect(libraryId).toEqual(expect.any(String))
  return { taskId, libraryId }
}

function getSyncHistory(
  page: import('@playwright/test').Page,
  taskId: string,
  libraryId: string,
) {
  return page
    .getByRole('region', { name: /recent task history/i })
    .locator(`li[data-task-id="${taskId}"][data-library-id="${libraryId}"]`)
    .filter({ hasText: 'Sync · Library: game' })
}

test('settings persist across a server restart and fresh browser context', async ({
  browser,
  page,
  server,
}) => {
  await page.goto(server.url)
  await page.getByRole('link', { name: /settings/i }).click()
  await page.getByRole('radio', { name: /dark/i }).click()
  await expect(page.getByRole('radio', { name: /dark/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect
    .poll(() =>
      readFile(
        path.join(server.root, 'config', 'Modkeeper', 'config.toml'),
        'utf8',
      ).catch(() => ''),
    )
    .toContain('theme = "dark"')
  await server.restart()
  const context = await browser.newContext()
  const fresh = await context.newPage()
  await fresh.goto(server.url)
  await fresh.getByRole('link', { name: /settings/i }).click()
  await expect(fresh.getByRole('radio', { name: /dark/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await context.close()
})

test('saves Copy and Link policy, switches libraries, reloads, and syncs', async ({
  page,
  server,
}) => {
  test.skip(
    process.platform !== 'linux' ||
      release().toLowerCase().includes('microsoft'),
    'Deployment policy controls are not verified on Windows or WSL hosts.',
  )

  await page.goto(server.url)
  await page.getByRole('button', { name: /manage libraries/i }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /add library/i }).click()
  let picker = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Game root path') })
  await picker.getByLabel('Game root path').fill(server.game)
  await picker.getByRole('button', { name: 'Use path' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'game', exact: true }).waitFor()
  await expect(dialog.getByRole('combobox').nth(0)).toBeEnabled()

  await chooseDeploymentPolicy(page, dialog, 'Copy')
  await dialog.getByRole('button', { name: /save deployment policy/i }).click()
  await expect
    .poll(() =>
      readFile(path.join(server.game, '.mod_keeper', 'manifest.toml'), 'utf8'),
    )
    .toContain('targetRuntime = "linux"')

  await dialog.getByRole('button', { name: /add library/i }).click()
  picker = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Game root path') })
  await picker
    .getByLabel('Game root path')
    .fill(path.join(server.root, 'second-game'))
  await picker.getByRole('button', { name: 'Use path' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'game', exact: true }).click()
  await expect(
    dialog.getByRole('button', { name: /^save deployment policy$/i }),
  ).toBeDisabled()
  await dialog.getByRole('button', { name: /^activate$/i }).click()
  await expect(
    dialog.getByRole('button', { name: /activated/i }),
  ).toBeDisabled()

  await page.keyboard.press('Escape')
  await page.goto(server.url)
  await page.getByRole('button', { name: /manage libraries/i }).click()
  dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('tab', { name: 'game', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Add mod', exact: true }).click()
  const archiveDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Archive paths') })
  await archiveDialog.getByLabel('Archive paths').fill(server.archive)
  await archiveDialog.getByRole('button', { name: 'Use path' }).click()
  await expect(
    page.getByText('fixture-mod', { exact: false }).first(),
  ).toBeVisible()

  const deployed = path.join(
    server.game,
    'BepInEx',
    'plugins',
    'FixtureMod',
    'fixture.dll',
  )
  const syncButton = page.getByRole('button', { name: /^sync$/i })
  await syncAndWait(syncButton)
  await expect.poll(() => readFile(deployed, 'utf8')).toBe('fixture payload')
  expect((await lstat(path.dirname(deployed))).isDirectory()).toBe(true)
  expect((await lstat(deployed)).isSymbolicLink()).toBe(false)

  await page.getByRole('button', { name: /manage libraries/i }).click()
  dialog = page.getByRole('dialog')
  await chooseDeploymentPolicy(page, dialog, 'Symbolic link')
  await dialog.getByRole('button', { name: /save deployment policy/i }).click()
  await expect
    .poll(() =>
      readFile(path.join(server.game, '.mod_keeper', 'manifest.toml'), 'utf8'),
    )
    .toContain('deploymentMethod = "link"')
  await page.keyboard.press('Escape')
  await syncAndWait(syncButton)
  await expect.poll(() => readFile(deployed, 'utf8')).toBe('fixture payload')
  await expect
    .poll(() =>
      lstat(path.dirname(deployed))
        .then((entry) => entry.isSymbolicLink())
        .catch(() => false),
    )
    .toBe(true)

  await syncAndWait(syncButton)
  await expect.poll(() => readFile(deployed, 'utf8')).toBe('fixture payload')
  expect((await lstat(path.dirname(deployed))).isSymbolicLink()).toBe(true)
})

async function syncAndWait(
  button: import('@playwright/test').Locator,
): Promise<void> {
  await button.click()
  await expect(button).toHaveAttribute('aria-busy', 'true')
  await expect(button).not.toHaveAttribute('aria-busy', 'true')
}

async function chooseDeploymentPolicy(
  page: import('@playwright/test').Page,
  dialog: import('@playwright/test').Locator,
  method: 'Copy' | 'Symbolic link',
): Promise<void> {
  const runtime = dialog.getByRole('combobox').nth(0)
  await runtime.click()
  await page.getByRole('option', { name: 'Linux' }).click()
  const deploymentMethod = dialog.getByRole('combobox').nth(1)
  await deploymentMethod.click()
  await page.getByRole('option', { name: method, exact: true }).click()
}

test('preserves staged bytes and reports blocked Sync after an interrupted server restart', async ({
  page,
  server,
}) => {
  await page.goto(server.url)
  await page.getByRole('button', { name: /manage libraries/i }).click()
  await page.getByRole('button', { name: /add library/i }).click()
  const picker = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Game root path') })
  await picker.getByRole('button', { name: 'Browse folders' }).click()
  await picker.getByRole('button', { name: 'game/', exact: true }).click()
  await picker.getByRole('button', { name: 'Select this folder' }).click()
  await expect(picker.getByLabel('Game root path')).toHaveValue(server.game)
  await picker.getByRole('button', { name: 'Use path' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Add mod', exact: true }).click()
  const archiveDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Archive paths') })
  await archiveDialog.getByLabel('Archive paths').fill(server.archive)
  await archiveDialog.getByRole('button', { name: 'Use path' }).click()
  await expect(
    page.getByText('fixture-mod', { exact: false }).first(),
  ).toBeVisible()
  await expect
    .poll(async () =>
      readFile(
        path.join(server.game, '.mod_keeper', 'manifest.toml'),
        'utf8',
      ).catch(() => ''),
    )
    .toContain('fixture-mod')
  const modsDir = path.join(server.game, '.mod_keeper', 'mods')
  const mods = await readdir(modsDir)
  expect(mods).toHaveLength(1)
  expect(
    await readFile(
      path.join(
        modsDir,
        mods[0],
        'BepInEx',
        'plugins',
        'FixtureMod',
        'fixture.dll',
      ),
    ),
  ).toEqual(Buffer.from('fixture payload'))

  const deploymentState = path.join(
    server.game,
    '.mod_keeper',
    'deployment-v2.toml',
  )
  const legacyState = 'artifacts = []\ncreated_dirs = []\n'
  const legacyPath = path.join(server.game, '.mod_keeper', 'deployment.toml')
  await writeFile(legacyPath, legacyState)
  const deployed = path.join(
    server.game,
    'BepInEx',
    'plugins',
    'FixtureMod',
    'fixture.dll',
  )
  await expect(readFile(deployed)).rejects.toMatchObject({ code: 'ENOENT' })
  const sync = page.getByRole('button', { name: /^sync$/i })
  const initial = await runSync(page, sync)
  await page.getByRole('button', { name: /^tasks$/i }).click()
  const syncHistory = getSyncHistory(page, initial.taskId, initial.libraryId)
  await expect(syncHistory).toHaveCount(1)
  await expect(
    syncHistory.getByText('Completed', { exact: true }),
  ).toBeVisible()
  await expect.poll(() => readFile(deployed, 'utf8')).toBe('fixture payload')
  await page
    .getByRole('dialog', { name: 'Tasks' })
    .getByRole('button', { name: 'Close' })
    .click()

  expect(await readFile(legacyPath, 'utf8')).toBe(legacyState)
  const syncIntent = path.join(server.game, '.mod_keeper', 'sync-intent.toml')
  const stateBeforeCrash = await readFile(deploymentState)
  await rm(deployed)
  await server.pauseAtSyncBoundary('during-staging')
  await runSync(page, sync)
  await server.waitForSyncBoundary('during-staging')
  await server.crash()

  const intentBeforeRecovery = await readFile(syncIntent)
  const stagePath = await findSyncStage(server.game)
  const stageBeforeRecovery = await readFile(stagePath)
  await server.restart()
  await page.goto(server.url)
  const retryTask = await runSync(
    page,
    page.getByRole('button', { name: /^sync$/i }),
  )
  await page.getByRole('button', { name: /^tasks$/i }).click()
  const retryHistory = page
    .getByRole('region', { name: /recent task history/i })
    .locator(
      `li[data-task-id="${retryTask.taskId}"][data-library-id="${retryTask.libraryId}"]`,
    )
  await expect(retryHistory).toBeVisible()
  await retryHistory.locator('summary').click()
  await expect(retryHistory).toContainText('Operation failed')
  expect(await readFile(deployed).catch(() => undefined)).toBeUndefined()
  expect(await readFile(stagePath)).toEqual(stageBeforeRecovery)
  expect(await readFile(syncIntent)).toEqual(intentBeforeRecovery)
  expect(await readFile(deploymentState)).toEqual(stateBeforeCrash)
})

async function findSyncStage(gameRoot: string): Promise<string> {
  const plugins = path.join(gameRoot, 'BepInEx', 'plugins')
  const stack = [plugins]
  while (stack.length > 0) {
    const directory = stack.pop()!
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      if (entry.name.startsWith('.modkeeper-stage-')) return candidate
      if (entry.isDirectory()) stack.push(candidate)
    }
  }
  throw new Error('Sync did not leave an observable staging object')
}
