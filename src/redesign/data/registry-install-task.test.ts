import { describe, expect, it } from 'vitest'
import { runRegistryInstallTask } from './registry-install-task'

function createTaskInput(
  overrides: Partial<Parameters<typeof runRegistryInstallTask>[0]> = {},
) {
  const events: string[] = []
  const pending = new Set<string>()
  let timeoutCallback: (() => void) | null = null
  let canceledTimeouts = 0

  const input = {
    isNative: true,
    ensureReady: async () => {
      events.push('listener-ready')
      return true
    },
    onNotReady: () => {},
    canStart: () => true,
    onBusy: () => {},
    createTaskId: () => 'forge-task-1',
    registerPending: (taskId: string) => {
      events.push('registered')
      pending.add(taskId)
    },
    clearPending: (taskId: string) => {
      events.push('cleared')
      pending.delete(taskId)
    },
    invoke: async () => {
      events.push('invoke')
      return { status: 'ok' as const, data: { accepted: true } }
    },
    mockComplete: () => {},
    schedule: () => {},
    onDomainError: () => events.push('domain-error'),
    onTransportError: () => events.push('transport-error'),
    onTimeout: () => events.push('timeout'),
    timeoutMs: 10,
    scheduleTimeout: (callback: () => void) => {
      timeoutCallback = callback
      return 1 as unknown as ReturnType<typeof setTimeout>
    },
    cancelTimeout: () => {
      canceledTimeouts += 1
    },
    ...overrides,
  }

  return {
    input,
    events,
    pending,
    fireTimeout: () => timeoutCallback?.(),
    canceledTimeouts: () => canceledTimeouts,
  }
}

describe('Registry install task lifecycle', () => {
  it('waits for the event bus and registers the task before invoking Forge', async () => {
    const task = createTaskInput()

    const result = await runRegistryInstallTask(task.input)

    expect(result).toEqual({ accepted: true })
    expect(task.events.slice(0, 3)).toEqual([
      'listener-ready',
      'registered',
      'invoke',
    ])
    expect(task.pending.has('forge-task-1')).toBe(true)
  })

  it('clears task state and its timeout when IPC rejects', async () => {
    const task = createTaskInput({
      invoke: async () => {
        throw new Error('IPC unavailable')
      },
    })

    const result = await runRegistryInstallTask(task.input)

    expect(result).toEqual({ accepted: false })
    expect(task.pending.size).toBe(0)
    expect(task.events).toContain('transport-error')
    expect(task.canceledTimeouts()).toBe(1)
  })

  it('clears task state and its timeout when Forge rejects the request', async () => {
    const task = createTaskInput({
      invoke: async () => ({
        status: 'error' as const,
        error: 'HTTP 404: version missing' as never,
      }),
    })

    const result = await runRegistryInstallTask(task.input)

    expect(result).toEqual({ accepted: false })
    expect(task.pending.size).toBe(0)
    expect(task.events).toContain('domain-error')
    expect(task.canceledTimeouts()).toBe(1)
  })

  it('clears task state when the backend refuses to accept the install', async () => {
    const task = createTaskInput({
      invoke: async () => ({
        status: 'ok' as const,
        data: { accepted: false },
      }),
    })

    const result = await runRegistryInstallTask(task.input)

    expect(result).toEqual({ accepted: false })
    expect(task.pending.size).toBe(0)
    expect(task.canceledTimeouts()).toBe(1)
  })

  it('clears task state when an accepted install has no completion event', async () => {
    const task = createTaskInput()
    const result = await runRegistryInstallTask(task.input)
    expect(result).toEqual({ accepted: true })

    task.fireTimeout()

    expect(task.pending.size).toBe(0)
    expect(task.events).toContain('timeout')
    expect(task.canceledTimeouts()).toBe(1)
  })
})
