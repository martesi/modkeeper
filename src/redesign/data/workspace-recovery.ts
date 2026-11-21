import type { LibraryWorkspace } from './redesign-types'
import { getWorkspaceVersion } from '../state/library-state'

const recoveryRefreshDelays = [1000, 2000, 4000]
const pendingRecoveryWarning = 'Initial library recovery did not finish'

let activeGeneration = 0
let activeController: AbortController | undefined

export interface WorkspaceRecoverySequence {
  isCurrent: () => boolean
  run: (
    loadWorkspace: (
      guard: WorkspaceReadGuard,
    ) => Promise<LibraryWorkspace | null>,
    onComplete: (workspace: LibraryWorkspace | null) => void,
    wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>,
  ) => Promise<void>
  dispose: () => void
}

export interface WorkspaceReadGuard {
  isActive: () => boolean
  isCurrent: () => boolean
  onApplied: () => void
}

export function beginWorkspaceRecoverySequence(): WorkspaceRecoverySequence {
  activeController?.abort()
  const controller = new AbortController()
  const generation = ++activeGeneration
  let expectedWorkspaceVersion = getWorkspaceVersion()
  activeController = controller

  const isActive = () =>
    generation === activeGeneration && !controller.signal.aborted
  const isCurrent = () =>
    isActive() && expectedWorkspaceVersion === getWorkspaceVersion()
  const guard: WorkspaceReadGuard = {
    isActive,
    isCurrent,
    onApplied: () => {
      expectedWorkspaceVersion = getWorkspaceVersion()
    },
  }

  return {
    isCurrent,
    run: (loadWorkspace, onComplete, wait = delay) =>
      runSequence(loadWorkspace, onComplete, guard, controller.signal, wait),
    dispose: () => {
      controller.abort()
      if (activeController !== controller) return
      activeController = undefined
      activeGeneration++
    },
  }
}

async function runSequence(
  loadWorkspace: (
    guard: WorkspaceReadGuard,
  ) => Promise<LibraryWorkspace | null>,
  onComplete: (workspace: LibraryWorkspace | null) => void,
  guard: WorkspaceReadGuard,
  signal: AbortSignal,
  wait: (milliseconds: number, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const { isCurrent } = guard
  if (!isCurrent()) return
  const initialWorkspace = await loadWorkspace(guard)
  if (!isCurrent()) return

  const workspace = await refreshWorkspaceAfterPendingRecovery(
    initialWorkspace,
    () => loadWorkspace(guard),
    isCurrent,
    signal,
    wait,
  )
  if (isCurrent()) onComplete(workspace)
}

async function refreshWorkspaceAfterPendingRecovery(
  initialWorkspace: LibraryWorkspace | null,
  reload: () => Promise<LibraryWorkspace | null>,
  isCurrent: () => boolean,
  signal: AbortSignal,
  wait: (milliseconds: number, signal: AbortSignal) => Promise<void>,
): Promise<LibraryWorkspace | null> {
  let workspace = initialWorkspace
  if (!hasPendingRecoveryWarning(workspace)) return workspace

  for (const milliseconds of recoveryRefreshDelays) {
    if (!isCurrent()) return null
    await wait(milliseconds, signal)
    if (!isCurrent()) return null
    workspace = await reload()
    if (!isCurrent() || !hasPendingRecoveryWarning(workspace)) break
  }
  return workspace
}

function hasPendingRecoveryWarning(
  workspace: LibraryWorkspace | null,
): boolean {
  return workspace?.configWarning?.includes(pendingRecoveryWarning) ?? false
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      resolve()
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}
