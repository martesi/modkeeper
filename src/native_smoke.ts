import { Call, Events } from '@wailsio/runtime'
import {
  CancelTask,
  CreateLibrary,
  GetLibraryWorkspace,
  GetSettings,
  InstallModArchives,
} from '../frontend/bindings/github.com/martes/modkeeper/backend/app'
import { commands } from './wails'
import { onFileDrop } from './platform'
import type { TaskProgressEvent } from '../frontend/bindings/github.com/martes/modkeeper/backend/models/models'

const smokeService = 'main.NativeSmokeService'
const initialSearch = window.location.search
const expectedSettings = {
  theme: 'system',
  accentColor: 'default',
  language: 'en-US',
  enableModsOnInstall: true,
  warnIncompatibleForgeInstall: true,
  forgeEndpoint: '',
}

export async function startNativeSmoke() {
  try {
    const settings = await GetSettings()
    if (
      !settings ||
      settings.theme !== expectedSettings.theme ||
      settings.accentColor !== expectedSettings.accentColor ||
      settings.language !== expectedSettings.language ||
      settings.enableModsOnInstall !== expectedSettings.enableModsOnInstall
    ) {
      throw new Error(`unexpected settings value: ${JSON.stringify(settings)}`)
    }
    await Call.ByName(
      `${smokeService}.ReportSettings`,
      JSON.stringify(settings),
    )

    Events.On('native-smoke-event', (event) => {
      const payload = String(event.data)
      ;(window as Window & { __nativeSmokeEvent?: string }).__nativeSmokeEvent =
        payload
      void Call.ByName(
        `${smokeService}.ReportEvent`,
        JSON.stringify({
          payload,
          execJSObserved:
            (window as Window & { __nativeSmokeGoExecJS?: boolean })
              .__nativeSmokeGoExecJS === true,
        }),
      )
    })
    await onFileDrop((paths) => {
      void Call.ByName(`${smokeService}.ReportDropFiles`, JSON.stringify(paths))
    })
    await Call.ByName(`${smokeService}.ListenerReady`)
    mountNativeUIAssertion()
    if (new URLSearchParams(initialSearch).has('native-flow')) {
      await runNativeArchiveFlow()
    }
  } catch (error) {
    console.error('native-smoke: frontend verification failed', error)
    if (new URLSearchParams(initialSearch).has('native-flow')) {
      void Call.ByName(
        `${smokeService}.ReportNativeFlow`,
        `FAIL native backend archive journeys: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

async function runNativeArchiveFlow() {
  const query = new URLSearchParams(initialSearch)
  const gameRoot = query.get('game-root')
  const libraryRoot = query.get('library-root')
  const archiveDir = query.get('archives-dir')
  if (!gameRoot || !libraryRoot || !archiveDir) {
    throw new Error('native flow fixture query is incomplete')
  }
  const archives = [
    `${archiveDir}/NativeOne.zip`,
    ...Array.from(
      { length: 25 },
      (_, i) =>
        `${archiveDir}/NativeBatch${String(i + 1).padStart(2, '0')}.zip`,
    ),
    ...Array.from(
      { length: 25 },
      (_, i) =>
        `${archiveDir}/NativeCancel${String(i + 1).padStart(2, '0')}.zip`,
    ),
  ]
  const workspace = await CreateLibrary({
    gameRoot,
    libraryRoot,
    name: 'Native T3 library',
  })
  const libraryId = workspace?.activeLibraryId
  if (!libraryId) throw new Error('CreateLibrary did not activate a library')

  await installAndWait('native-one', libraryId, archives.slice(0, 1))
  await installAndWait(
    'native-busy',
    libraryId,
    [`${archiveDir}/NativeBusy.zip`],
    async () => {
      const activation = await commands.activateLibrary({ libraryId })
      if (
        activation.status !== 'error' ||
        activation.error.code !== 'LibraryBusy'
      ) {
        throw new Error(
          `activation during install returned ${JSON.stringify(activation)}; expected LibraryBusy IPC error code`,
        )
      }
      await Call.ByName(`${smokeService}.ReleaseInstall`)
    },
  )
  await installAndWait('native-25', libraryId, archives.slice(1, 26))

  const cancelTask = 'native-cancel-25'
  const cancelled = new Promise<void>((resolve, reject) => {
    let cancelSent = false
    const off = Events.On('task_progress', (event) => {
      const progress = event.data as TaskProgressEvent
      if (progress.taskId !== cancelTask) return
      if (
        !cancelSent &&
        progress.stage === 'install_archives' &&
        progress.percent !== null &&
        progress.percent >= 8
      ) {
        cancelSent = true
        void CancelTask(cancelTask, libraryId).catch(reject)
      }
      if (
        progress.kind === 'completed' &&
        progress.stage === 'task_cancelled'
      ) {
        off()
        resolve()
      }
      if (
        progress.kind === 'completed' &&
        progress.stage !== 'task_cancelled'
      ) {
        off()
        reject(new Error(`cancel task ended at ${progress.stage}`))
      }
    })
  })
  await InstallModArchives({
    taskId: cancelTask,
    libraryId,
    archivePaths: archives.slice(26),
  })
  await cancelled

  const result = await GetLibraryWorkspace()
  const installed = result?.modsByLibraryId?.[libraryId] ?? []
  if (installed.length <= 27 || installed.length >= 51) {
    throw new Error(
      `native archive flow installed ${installed.length} mods; expected all 27 committed archives and fewer than 25 cancelled archives`,
    )
  }
  await Call.ByName(
    `${smokeService}.ReportNativeFlow`,
    `PASS native backend archive journeys (${installed.length} mods); PASS native LibraryBusy IPC error code`,
  )
}

async function installAndWait(
  taskId: string,
  libraryId: string,
  archivePaths: string[],
  onStarted?: () => Promise<void>,
) {
  let resolveWorkspace!: (value: unknown) => void
  const workspaceEvent = new Promise<unknown>((resolve) => {
    resolveWorkspace = resolve
  })
  const offWorkspace = Events.On('workspace-event', (event) => {
    const data = event.data as { taskId?: string }
    if (data.taskId === taskId) {
      offWorkspace()
      resolveWorkspace(data)
    }
  })
  const completed = new Promise<void>((resolve, reject) => {
    const off = Events.On('task_progress', (event) => {
      const progress = event.data as TaskProgressEvent
      if (progress.taskId !== taskId || progress.kind !== 'completed') return
      off()
      if (progress.stage === 'task_completed') resolve()
      else {
        void workspaceEvent.then((detail) =>
          reject(
            new Error(
              `install ${taskId} failed: ${JSON.stringify(progress)}; workspace=${JSON.stringify(detail)}`,
            ),
          ),
        )
      }
    })
  })
  await InstallModArchives({ taskId, libraryId, archivePaths })
  await onStarted?.()
  await completed
}

function mountNativeUIAssertion() {
  const panel = document.createElement('section')
  panel.style.cssText =
    'position:fixed;z-index:2147483647;top:12px;left:12px;padding:12px;background:#111827;color:white;font:16px sans-serif;border:2px solid #64748b'
  const button = document.createElement('button')
  button.textContent = 'Run native UI check'
  button.style.cssText = 'padding:10px;background:#fff;color:#111;font:inherit'
  const status = document.createElement('div')
  status.textContent = 'Waiting for keyboard input'
  status.style.cssText = 'margin-top:8px;padding:8px;background:#374151'
  button.addEventListener('click', () => {
    status.textContent = 'Native UI interaction passed'
    status.style.background = '#166534'
    void Call.ByName(
      `${smokeService}.ReportUIInteraction`,
      JSON.stringify({ status: status.textContent, search: location.search }),
    )
  })
  panel.append(button, status)
  document.body.append(panel)
  button.focus()
}

void startNativeSmoke()

declare global {
  interface Window {
    __MODKEEPER_NATIVE_SMOKE_START__?: () => Promise<void>
  }
}
