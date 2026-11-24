import { spawn, type ChildProcess } from 'node:child_process'

export function startServer(
  executable: string,
  env: NodeJS.ProcessEnv,
  url: string,
) {
  const child = spawn(executable, [], { env, stdio: 'inherit' })
  const closed = observeClose(child)
  const ready = waitForServer(url, closed).then((isReady) => {
    if (!isReady) throw new Error(`Server failed to start at ${url}`)
  })
  return { child, closed, ready }
}

export function observeClose(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    child.on('error', (error) => {
      console.error(`Server process error: ${error.message}`)
    })
    child.once('close', () => resolve())
  })
}

export async function stopServer(
  child: ChildProcess,
  closed: Promise<void>,
  timeout = 3000,
) {
  child.kill()
  if (await closesWithin(closed, timeout)) return
  child.kill('SIGKILL')
  if (!(await closesWithin(closed, timeout)))
    throw new Error('Server did not stop; preserving its state directory')
}

async function closesWithin(
  closed: Promise<void>,
  timeout: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    closed.then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeout)
    }),
  ])
  clearTimeout(timer)
  return result
}

async function waitForServer(
  url: string,
  closed: Promise<void>,
): Promise<boolean> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const result = await Promise.race([
      fetch(url, { signal: AbortSignal.timeout(1000) }).then(
        (response) => response.ok,
        () => false,
      ),
      closed.then(() => 'closed' as const),
    ])
    if (result === 'closed') return false
    if (result) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}
