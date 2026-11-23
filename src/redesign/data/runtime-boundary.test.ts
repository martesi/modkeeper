import { describe, expect, test } from 'bun:test'
import {
  createRetryableConnection,
  runPlainCommand,
  runTrackedCommand,
} from './runtime-boundary'

describe('runPlainCommand', () => {
  test('uses the browser mock without invoking Wails', async () => {
    let value = 0
    let invoked = false
    const result = await runPlainCommand({
      isNative: false,
      invoke: async () => {
        invoked = true
        return { status: 'ok' as const, data: 3 }
      },
      mock: () => {
        value += 1
        return value
      },
      apply: () => {
        throw new Error('browser mock must not use the Wails apply path')
      },
      onDomainError: () => {},
      onTransportError: () => {},
      current: () => -1,
    })

    expect(result).toBe(1)
    expect(value).toBe(1)
    expect(invoked).toBe(false)
  })

  test('applies Wails success data', async () => {
    const applied: number[] = []
    const result = await runPlainCommand({
      isNative: true,
      invoke: async () => ({ status: 'ok', data: 7 }),
      mock: () => -1,
      apply: (data) => applied.push(data),
      onDomainError: () => {},
      onTransportError: () => {},
      current: () => 4,
    })

    expect(result).toBe(7)
    expect(applied).toEqual([7])
  })

  test('returns current state on a Wails domain error', async () => {
    const errors: string[] = []
    let mockCalls = 0
    const result = await runPlainCommand({
      isNative: true,
      invoke: async () => ({ status: 'error', error: 'domain' }),
      mock: () => {
        mockCalls += 1
        return -1
      },
      apply: () => {},
      onDomainError: (error) => errors.push(error),
      onTransportError: () => {},
      current: () => 4,
    })

    expect(result).toBe(4)
    expect(errors).toEqual(['domain'])
    expect(mockCalls).toBe(0)
  })

  test('returns current state on a Wails transport throw', async () => {
    const errors: unknown[] = []
    let mockCalls = 0
    const result = await runPlainCommand({
      isNative: true,
      invoke: async () => {
        throw new Error('IPC disconnected')
      },
      mock: () => {
        mockCalls += 1
        return -1
      },
      apply: () => {},
      onDomainError: () => {},
      onTransportError: (error) => errors.push(error),
      current: () => 4,
    })

    expect(result).toBe(4)
    expect(errors).toHaveLength(1)
    expect(mockCalls).toBe(0)
  })
})

describe('runTrackedCommand', () => {
  test('registers pending before invoke and returns Wails data', async () => {
    const order: string[] = []
    const result = await runTrackedCommand({
      isNative: true,
      registerPending: () => {
        order.push('register')
        return 'task-1'
      },
      invoke: async (taskId) => {
        order.push(`invoke:${taskId}`)
        return { status: 'ok', data: { accepted: true } }
      },
      clearPending: () => order.push('clear'),
      mockComplete: () => order.push('mockComplete'),
      schedule: () => order.push('schedule'),
      onDomainError: () => order.push('domainError'),
      onTransportError: () => order.push('transportError'),
    })

    expect(result).toEqual({ accepted: true })
    expect(order).toEqual(['register', 'invoke:task-1'])
  })

  test('clears pending once on a Wails domain error without mock completion', async () => {
    const order: string[] = []
    const result = await runTrackedCommand({
      isNative: true,
      registerPending: () => 'task-2',
      invoke: async () => ({ status: 'error', error: 'domain' }),
      clearPending: (taskId) => order.push(`clear:${taskId}`),
      mockComplete: () => order.push('mockComplete'),
      schedule: () => order.push('schedule'),
      onDomainError: (error) => order.push(`domain:${error}`),
      onTransportError: () => order.push('transportError'),
    })

    expect(result).toEqual({ accepted: false })
    expect(order).toEqual(['clear:task-2', 'domain:domain'])
  })

  test('clears pending once on a Wails throw without mock completion', async () => {
    const order: string[] = []
    const result = await runTrackedCommand({
      isNative: true,
      registerPending: () => 'task-3',
      invoke: async () => {
        throw new Error('IPC disconnected')
      },
      clearPending: (taskId) => order.push(`clear:${taskId}`),
      mockComplete: () => order.push('mockComplete'),
      schedule: () => order.push('schedule'),
      onDomainError: () => order.push('domainError'),
      onTransportError: () => order.push('transportError'),
    })

    expect(result).toEqual({ accepted: false })
    expect(order).toEqual(['clear:task-3', 'transportError'])
  })

  test('schedules the browser mock completion and returns accepted', async () => {
    const order: string[] = []
    let scheduled: (() => void) | undefined
    const result = await runTrackedCommand({
      isNative: false,
      registerPending: () => {
        order.push('register')
        return 'task-browser'
      },
      invoke: async () => {
        order.push('invoke')
        return { status: 'ok', data: { accepted: true } }
      },
      clearPending: () => order.push('clear'),
      mockComplete: (taskId) => order.push(`mockComplete:${taskId}`),
      schedule: (callback) => {
        order.push('schedule')
        scheduled = callback
      },
      onDomainError: () => {},
      onTransportError: () => {},
    })

    expect(result).toEqual({ accepted: true })
    expect(order).toEqual(['register', 'schedule'])
    scheduled?.()
    expect(order).toEqual(['register', 'schedule', 'mockComplete:task-browser'])
  })
})

describe('createRetryableConnection', () => {
  test('retries listener registration after failure and stays connected on success', async () => {
    const errors: unknown[] = []
    let attempts = 0
    const ensure = createRetryableConnection((error) => errors.push(error))

    const first = await ensure(async () => {
      attempts += 1
      throw new Error('listener unavailable')
    })
    const second = await ensure(async () => {
      attempts += 1
    })
    const third = await ensure(async () => {
      attempts += 1
    })

    expect(first).toBe(false)
    expect(second).toBe(true)
    expect(third).toBe(true)
    expect(attempts).toBe(2)
    expect(errors).toHaveLength(1)
  })
})

describe('runTrackedCommand admission', () => {
  test('blocks tracked invoke until listener registration can be retried', async () => {
    let attempts = 0
    let invocations = 0
    let registrations = 0
    let unavailable = 0
    const ensure = createRetryableConnection(() => {})
    const run = () =>
      runTrackedCommand({
        isNative: true,
        ensureReady: () =>
          ensure(async () => {
            attempts += 1
            if (attempts === 1) throw new Error('listener unavailable')
          }),
        onNotReady: () => {
          unavailable += 1
        },
        registerPending: () => {
          registrations += 1
          return `task-${registrations}`
        },
        invoke: async () => {
          invocations += 1
          return { status: 'ok', data: { accepted: true } }
        },
        clearPending: () => {},
        mockComplete: () => {},
        schedule: () => {},
        onDomainError: () => {},
        onTransportError: () => {},
      })

    expect(await run()).toEqual({ accepted: false })
    expect(invocations).toBe(0)
    expect(registrations).toBe(0)
    expect(unavailable).toBe(1)

    expect(await run()).toEqual({ accepted: true })
    expect(invocations).toBe(1)
    expect(registrations).toBe(1)
    expect(unavailable).toBe(1)
  })

  test('blocks a second start when the library is already busy', async () => {
    let registered = 0
    let invoked = 0
    let busy = 0
    const run = () =>
      runTrackedCommand({
        isNative: true,
        canStart: () => registered === 0,
        onBusy: () => {
          busy += 1
        },
        registerPending: () => {
          registered += 1
          return 'task-busy'
        },
        invoke: async () => {
          invoked += 1
          return { status: 'ok', data: { accepted: true } }
        },
        clearPending: () => {},
        mockComplete: () => {},
        schedule: () => {},
        onDomainError: () => {},
        onTransportError: () => {},
      })

    expect(await run()).toEqual({ accepted: true })
    expect(await run()).toEqual({ accepted: false })
    expect(registered).toBe(1)
    expect(invoked).toBe(1)
    expect(busy).toBe(1)
  })

  test('clears pending when the backend explicitly rejects an ok response', async () => {
    const cleared: string[] = []
    const result = await runTrackedCommand({
      isNative: true,
      registerPending: () => 'task-rejected',
      invoke: async () => ({ status: 'ok', data: { accepted: false } }),
      clearPending: (taskId) => cleared.push(taskId),
      mockComplete: () => {},
      schedule: () => {},
      onDomainError: () => {},
      onTransportError: () => {},
    })

    expect(result).toEqual({ accepted: false })
    expect(cleared).toEqual(['task-rejected'])
  })
})
