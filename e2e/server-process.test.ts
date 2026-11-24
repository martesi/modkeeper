import { expect, test } from 'bun:test'
import { type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { observeClose, stopServer } from './server/server-process'

test('does not treat kill errors as process termination', async () => {
  const child = new EventEmitter() as ChildProcess
  const signals: (NodeJS.Signals | number | undefined)[] = []
  child.kill = (signal) => {
    signals.push(signal)
    child.emit('error', new Error('kill EPERM'))
    return false
  }
  const closed = observeClose(child)
  await expect(stopServer(child, closed, 1)).rejects.toThrow(
    'Server did not stop; preserving its state directory',
  )
  expect(signals).toEqual([undefined, 'SIGKILL'])
})
