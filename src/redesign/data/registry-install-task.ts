import type { OperationAccepted } from '@gen/bindings'
import { runTrackedCommand } from './runtime-boundary'
import type { CommandResult } from './runtime-boundary'

export const REGISTRY_INSTALL_TIMEOUT_MS = 10 * 60 * 1000

/*
 * Timer handles are normalized to the union of the DOM (`number`) and Bun/Node (`Timeout`)
 * representations so the fallback and injected schedulers share one opaque type.
 */
type TimerHandle = number | ReturnType<typeof setTimeout>

type TimeoutRecord = {
  handle: TimerHandle
  cancel: (handle: TimerHandle) => void
}

const installTimeouts = new Map<string, TimeoutRecord>()

export function clearRegistryInstallTimeout(taskId: string): void {
  const timeout = installTimeouts.get(taskId)
  if (!timeout) return
  timeout.cancel(timeout.handle)
  installTimeouts.delete(taskId)
}

export async function runRegistryInstallTask<E>(input: {
  isTauri: boolean
  ensureReady: () => Promise<boolean>
  onNotReady: () => void
  canStart: () => boolean
  onBusy: () => void
  createTaskId: () => string
  registerPending: (taskId: string) => void
  clearPending: (taskId: string) => void
  invoke: (taskId: string) => Promise<CommandResult<OperationAccepted, E>>
  mockComplete: (taskId: string) => void
  schedule: (callback: () => void) => void
  onDomainError: (error: E) => void
  onTransportError: (error: unknown) => void
  onTimeout: (taskId: string) => void
  timeoutMs?: number
  scheduleTimeout?: (callback: () => void, milliseconds: number) => TimerHandle
  cancelTimeout?: (handle: TimerHandle) => void
}): Promise<OperationAccepted> {
  let registeredTaskId: string | null = null
  const clearPending = (taskId: string) => {
    clearRegistryInstallTimeout(taskId)
    input.clearPending(taskId)
  }

  try {
    return await runTrackedCommand({
      isTauri: input.isTauri,
      ensureReady: input.ensureReady,
      onNotReady: input.onNotReady,
      canStart: input.canStart,
      onBusy: input.onBusy,
      invoke: input.invoke,
      registerPending: () => {
        const taskId = input.createTaskId()
        registeredTaskId = taskId
        input.registerPending(taskId)
        const scheduleTimeout = input.scheduleTimeout ?? setTimeout
        const handle = scheduleTimeout(() => {
          clearRegistryInstallTimeout(taskId)
          input.clearPending(taskId)
          input.onTimeout(taskId)
        }, input.timeoutMs ?? REGISTRY_INSTALL_TIMEOUT_MS)
        installTimeouts.set(taskId, {
          handle,
          cancel: input.cancelTimeout ?? clearTimeout,
        })
        return taskId
      },
      clearPending,
      mockComplete: input.mockComplete,
      schedule: input.schedule,
      onDomainError: input.onDomainError,
      onTransportError: input.onTransportError,
    })
  } catch (error) {
    if (registeredTaskId) clearPending(registeredTaskId)
    input.onTransportError(error)
    return { accepted: false }
  }
}
