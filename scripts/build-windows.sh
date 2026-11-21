#!/bin/sh
# Build the Wails frontend, both Windows executables, and both NSIS scopes.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

if [ "${MODKEEPER_WINDOWS_SHELL:-0}" != 1 ] && command -v nix >/dev/null 2>&1; then
  exec nix develop .#windows -c env MODKEEPER_WINDOWS_SHELL=1 sh scripts/build-windows.sh "$@"
fi

bun run build:wails
wails3 task windows:package "$@"
