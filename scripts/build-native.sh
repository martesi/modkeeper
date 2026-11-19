#!/bin/sh
# Build the native Wails app. The frontend must be built with WAILS_APP=true so
# the bundle selects the Wails bridge; `wails3 build` only compiles dist/.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

bun run build:wails

if command -v wails3 >/dev/null 2>&1; then
  exec wails3 build "$@"
fi

if command -v nix >/dev/null 2>&1; then
  exec nix develop -c wails3 build "$@"
fi

echo "build-native: wails3 not found; install it or run inside the dev shell" >&2
exit 127
