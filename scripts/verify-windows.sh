#!/bin/sh
# Rebuild the Windows release artifacts and verify their PE/NSIS contracts.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

if [ "${MODKEEPER_WINDOWS_SHELL:-0}" != 1 ] && command -v nix >/dev/null 2>&1; then
  exec nix develop .#windows -c env MODKEEPER_WINDOWS_SHELL=1 sh scripts/verify-windows.sh "$@"
fi

sh scripts/build-windows.sh "$@"
python3 scripts/verify-windows-icon.py build/windows/icon.ico
python3 scripts/verify-windows-pe.py build/bin/modkeeper-amd64.exe amd64
python3 scripts/verify-windows-pe.py build/bin/modkeeper-arm64.exe arm64
sh scripts/verify-windows-installers.sh
