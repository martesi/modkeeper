/**
 * Test preload: replace the native Wails runtime with an inert stub.
 *
 * The suite drives the injected `__MK_WAILS_MOCK__` transport, never a real
 * webview. Bun 1.4.4's test runner intermittently fails to link the package's
 * named exports (`Export named 'Call' not found`) once the generated bindings
 * are loaded inside the full suite, although the installed file is the
 * published tarball and the same import resolves in isolation. Stubbing the
 * module here keeps the suite deterministic on every runner.
 *
 * Anything the bindings touch at module scope must resolve, so every export
 * answers with itself. Calls reach the stub only if a test asks for the native
 * path; those tests install the mock transport instead.
 */
import { mock } from 'bun:test'

const inert: unknown = new Proxy(function inertStub() {}, {
  get: () => inert,
  apply: () => inert,
  construct: () => inert,
})

const runtime: Record<string, unknown> = {
  Application: inert,
  Browser: inert,
  Call: inert,
  CancellablePromise: Promise,
  Clipboard: inert,
  Create: inert,
  Dialogs: inert,
  Events: {
    On: () => () => {},
    Off: () => {},
    Emit: () => {},
    Once: () => () => {},
  },
  Flags: inert,
  Screens: inert,
  System: inert,
  IOS: inert,
  Android: inert,
  Updater: inert,
  Window: inert,
  WML: inert,
  Stream: inert,
  JSONStream: inert,
  WailsSocket: inert,
  setTransport: () => {},
  getTransport: () => undefined,
  objectNames: () => [],
  clientId: '',
}

mock.module('@wailsio/runtime', () => runtime)
