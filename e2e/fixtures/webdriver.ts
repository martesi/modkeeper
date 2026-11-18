/**
 * Minimal W3C WebDriver client for WebKitGTK's `WebKitWebDriver`.
 *
 * WebKitWebDriver can launch the Tauri app itself (`webkitgtk:browserOptions.binary`) as long as
 * the app enables WebKit automation (`TAURI_WEBVIEW_AUTOMATION=true`, wired by
 * tauri-runtime-wry). No tauri-driver, no npm dependencies.
 */

export type WdElement = Record<string, string>

export class WebDriverError extends Error {
  constructor(
    readonly command: string,
    readonly httpStatus: number,
    readonly wdError: string,
    readonly wdMessage: string,
    readonly wdStacktrace?: string,
  ) {
    super(`${command} failed (HTTP ${httpStatus}, ${wdError}): ${wdMessage}`)
    this.name = 'WebDriverError'
  }
}

export type NewSessionResult = {
  sessionId: string
  capabilities: Record<string, unknown>
}

export class WebDriverClient {
  private constructor(
    private readonly baseUrl: string,
    readonly sessionId: string,
    readonly capabilities: Record<string, unknown>,
  ) {}

  /** Starts a session, launching `binary` as the browser under test. */
  static async start(opts: {
    baseUrl: string
    binary: string
    /** Extra CLI args handed to the app (unused by Modkeeper). */
    args?: string[]
    timeoutMs?: number
  }): Promise<WebDriverClient> {
    const body = {
      capabilities: {
        alwaysMatch: {
          // wry reports its crate name as the automation application name, so the
          // driver sees browserName "wry" (verified: capabilities.browserVersion is the
          // wry version bundled in tauri-runtime-wry).
          browserName: 'wry',
          'webkitgtk:browserOptions': {
            binary: opts.binary,
            args: opts.args ?? [],
          },
        },
      },
    }
    const res = await fetchJson(
      `${opts.baseUrl}/session`,
      'POST',
      body,
      opts.timeoutMs ?? 90_000,
    )
    const envelope = res as {
      value?: { sessionId?: string; capabilities?: unknown }
      sessionId?: string
      capabilities?: unknown
    }
    const value = envelope.value ?? envelope
    const sessionId: string | undefined = value?.sessionId
    if (!sessionId) {
      throw new Error(
        `WebKitWebDriver did not return a sessionId: ${JSON.stringify(res).slice(0, 800)}`,
      )
    }
    return new WebDriverClient(
      opts.baseUrl,
      sessionId,
      (value.capabilities ?? {}) as Record<string, unknown>,
    )
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    const res = await fetchJson(
      `${this.baseUrl}/session/${this.sessionId}${path}`,
      method,
      body,
      timeoutMs,
    )
    // Plain commands answer `{ value: ... }`; errors are handled inside fetchJson and throw.
    return (res as { value?: unknown }).value
  }

  /** Executes synchronous JS in the app's webview and returns its value. */
  async execute<T = unknown>(script: string, args: unknown[] = []): Promise<T> {
    return (await this.request('POST', '/execute/sync', { script, args })) as T
  }

  async findElement(
    using: 'css selector' | 'xpath',
    value: string,
  ): Promise<WdElement> {
    return (await this.request('POST', '/element', {
      using,
      value,
    })) as WdElement
  }

  async findElements(
    using: 'css selector' | 'xpath',
    value: string,
  ): Promise<WdElement[]> {
    return (await this.request('POST', '/elements', {
      using,
      value,
    })) as WdElement[]
  }

  async click(element: WdElement): Promise<void> {
    await this.request('POST', `/element/${elementId(element)}/click`, {})
  }

  async getAttribute(element: WdElement, name: string): Promise<string | null> {
    return (await this.request(
      'GET',
      `/element/${elementId(element)}/attribute/${name}`,
    )) as string | null
  }

  /** Presses and releases a single W3C key (Unicode code point). */
  async pressKey(value: string): Promise<void> {
    await this.request('POST', '/actions', {
      actions: [
        {
          type: 'key',
          id: 'e2e-keyboard',
          actions: [
            { type: 'keyDown', value },
            { type: 'keyUp', value },
          ],
        },
      ],
    })
    await this.request('DELETE', '/actions').catch(() => undefined)
  }

  /** Full-page PNG screenshot encoded by the browser, as raw bytes. */
  async screenshot(): Promise<Uint8Array> {
    const b64 = (await this.request(
      'GET',
      '/screenshot',
      undefined,
      60_000,
    )) as string
    if (typeof b64 !== 'string' || b64.length === 0) {
      throw new Error('WebDriver screenshot returned no data')
    }
    return Uint8Array.from(Buffer.from(b64, 'base64'))
  }

  async quit(): Promise<void> {
    await this.request('DELETE', '', undefined, 15_000)
  }
}

function elementId(element: WdElement): string {
  const id =
    element['element-6066-11e4-a52e-4f735466cecf'] ??
    (element as Record<string, string>).ELEMENT
  if (!id)
    throw new Error(
      `Not a WebDriver element reference: ${JSON.stringify(element)}`,
    )
  return id
}

async function fetchJson(
  url: string,
  method: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers:
        body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (cause) {
    throw new Error(
      `WebDriver request ${method} ${url} failed: ${(cause as Error).message}`,
    )
  }

  const text = await res.text()
  let parsed: unknown
  if (text.length === 0) {
    parsed = {}
  } else {
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(
        `WebDriver ${method} ${url} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 400)}`,
      )
    }
  }

  if (!res.ok) {
    const err = ((parsed as { value?: unknown }).value ?? {}) as {
      error?: unknown
      message?: unknown
      stacktrace?: unknown
    }
    if (err !== null && typeof err === 'object' && err.error) {
      throw new WebDriverError(
        `${method} ${url}`,
        res.status,
        String(err.error),
        String(err.message ?? ''),
        err.stacktrace ? String(err.stacktrace) : undefined,
      )
    }
    throw new WebDriverError(
      `${method} ${url}`,
      res.status,
      'unknown',
      text.slice(0, 400),
    )
  }

  return parsed
}
