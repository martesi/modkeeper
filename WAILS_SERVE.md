# Wails serve mode

The installed CLI is Wails **v2.16.0** (`nix develop -c wails version`).
Its help lists `dev` and does not list a `serve` command. The supported browser
launch is `wails dev -browser` (`nix develop -c wails dev --help`).

`wails dev -browser` starts the configured Vite server and opens it in a browser.
For E2E, use `http://127.0.0.1:34115/`; `GET /` is the readiness check. Vite
uses port 34115 when `WAILS_DEV=true` (`vite.config.ts`). This is the frontend
development server, not the Wails native window's webview.

Run it from the repository root with:

```sh
nix develop .#e2e -c wails dev -browser
```

The Go application binds `backend.App`. Backend methods are still stubs and
browser mode does not turn the native Wails IPC bridge into a browser IPC
transport. Use it to drive frontend routing and rendering; it does not validate
native IPC.
