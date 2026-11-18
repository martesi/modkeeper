export type CommandResult<T, E> =
  { status: 'ok'; data: T } | { status: 'error'; error: E }

export type TrackedCommandResponse = { accepted: boolean }

export async function runPlainCommand<T, E>(input: {
  isTauri: boolean
  invoke: () => Promise<CommandResult<T, E>>
  mock: () => T | Promise<T>
  apply: (data: T) => void
  onDomainError: (error: E) => void
  onTransportError: (error: unknown) => void
  current: () => T
}): Promise<T> {
  if (!input.isTauri) return input.mock()

  let result: CommandResult<T, E>
  try {
    // Tauri IPC wraps domain errors in Result but rejects on transport failure.
    result = await input.invoke()
  } catch (error) {
    input.onTransportError(error)
    return input.current()
  }

  if (result.status === 'error') {
    input.onDomainError(result.error)
    return input.current()
  }

  input.apply(result.data)
  return result.data
}

export async function runTrackedCommand<E>(input: {
  isTauri: boolean
  ensureReady?: () => Promise<boolean>
  onNotReady?: () => void
  canStart?: () => boolean
  onBusy?: () => void
  invoke: (taskId: string) => Promise<CommandResult<TrackedCommandResponse, E>>
  registerPending: () => string
  clearPending: (taskId: string) => void
  mockComplete: (taskId: string) => void
  schedule: (callback: () => void) => void
  onDomainError: (error: E) => void
  onTransportError: (error: unknown) => void
}): Promise<TrackedCommandResponse> {
  if (input.isTauri && input.ensureReady && !(await input.ensureReady())) {
    input.onNotReady?.()
    return { accepted: false }
  }

  // Check-and-register runs in one synchronous step after every await, so two starts in the same
  // tick cannot both claim the library.
  if (input.canStart && !input.canStart()) {
    input.onBusy?.()
    return { accepted: false }
  }

  const taskId = input.registerPending()

  if (!input.isTauri) {
    input.schedule(() => input.mockComplete(taskId))
    return { accepted: true }
  }

  let result: CommandResult<TrackedCommandResponse, E>
  try {
    // The pending task is registered before IPC because a completion event can arrive immediately.
    result = await input.invoke(taskId)
  } catch (error) {
    input.clearPending(taskId)
    input.onTransportError(error)
    return { accepted: false }
  }

  if (result.status === 'error') {
    input.clearPending(taskId)
    input.onDomainError(result.error)
    return { accepted: false }
  }

  if (!result.data.accepted) input.clearPending(taskId)
  return result.data
}

export function createRetryableConnection(
  onError: (error: unknown) => void,
): (connect: () => Promise<unknown>) => Promise<boolean> {
  let connected = false
  let connection: Promise<boolean> | undefined

  return (connect) => {
    if (connected) return Promise.resolve(true)
    if (connection) return connection

    // Convert sync throws and rejected listener registration into a retryable false result.
    const attempt = Promise.resolve()
      .then(connect)
      .then(
        () => {
          connected = true
          return true
        },
        (error: unknown) => {
          onError(error)
          return false
        },
      )
    connection = attempt
    void attempt.then(
      (ready) => {
        if (!ready && connection === attempt) connection = undefined
      },
      () => {
        if (connection === attempt) connection = undefined
      },
    )
    return attempt
  }
}
