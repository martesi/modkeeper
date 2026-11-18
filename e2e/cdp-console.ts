/*
 * Agent-drivable console/screenshot capture over CDP (fix_plan_0.md §8).
 *
 * Usage:
 *   bun run dev:e2e            # launches the app with --remote-debugging-port=9222
 *   bun run e2e/cdp-console.ts # attaches, prints console+exceptions, saves .local/e2e/<run-timestamp>/cdp-console.png
 *
 * This is the validated flow that diagnosed the §0 boot crash: WebView2 honors
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, and http://127.0.0.1:9222/json exposes the page target.
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { e2eArtifactPath } from './fixtures/harness'

const base = process.env.CDP_URL ?? 'http://127.0.0.1:9222'

type Target = { type: string; title: string; webSocketDebuggerUrl: string }

const targets = (await (await fetch(`${base}/json`)).json()) as Target[]
const page = targets.find((t) => t.type === 'page')
if (!page) {
  console.error('no page target at', base, JSON.stringify(targets, null, 2))
  process.exit(1)
}
console.log('attached to:', page.title)

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (result: unknown) => void>()

function send(method: string, params: Record<string, unknown> = {}) {
  return new Promise<unknown>((resolve) => {
    const msgId = ++id
    pending.set(msgId, resolve)
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
}

ws.onmessage = (event) => {
  const msg = JSON.parse(String(event.data))
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)!(msg.result)
    pending.delete(msg.id)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args
      .map(
        (arg: { value?: unknown; description?: string }) =>
          arg.value ?? arg.description ?? '',
      )
      .join(' ')
    console.log(`[console.${msg.params.type}]`, text)
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    console.log(
      '[exception]',
      msg.params.exceptionDetails.text,
      msg.params.exceptionDetails.exception?.description ?? '',
    )
  }
}

await new Promise((resolve) => (ws.onopen = resolve))
await send('Runtime.enable')
await send('Page.enable')

// Collect console output for a few seconds, then screenshot and exit.
await new Promise((resolve) => setTimeout(resolve, 5000))

const shot = (await send('Page.captureScreenshot', { format: 'png' })) as
  { data?: string } | undefined
if (shot?.data) {
  const screenshotPath = e2eArtifactPath('cdp-console.png')
  mkdirSync(dirname(screenshotPath), { recursive: true })
  await Bun.write(screenshotPath, Buffer.from(shot.data, 'base64'))
  console.log('screenshot saved to', screenshotPath)
}
ws.close()
process.exit(0)
