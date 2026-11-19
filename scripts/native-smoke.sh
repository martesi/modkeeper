#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

bun install
bun run build
nix develop -c wails3 build

binary=build/bin/modkeeper
if [[ ! -x "$binary" ]]; then
  echo "native-smoke: missing executable: $binary" >&2
  exit 1
fi

ldd "$binary" | tee /tmp/modkeeper-native-smoke-ldd.txt
if ! grep -E 'libwebkit2gtk-4\.1\.so|libwebkitgtk-4\.1\.so' /tmp/modkeeper-native-smoke-ldd.txt; then
  echo "native-smoke: expected WebKitGTK 4.1 linkage was not found" >&2
  exit 1
fi
if ! grep -E 'libsoup-3\.0\.so' /tmp/modkeeper-native-smoke-ldd.txt; then
  echo "native-smoke: expected libsoup3 linkage was not found" >&2
  exit 1
fi
if grep -E 'webkit2gtk-4\.0|webkitgtk-4\.0|libsoup-2\.4' /tmp/modkeeper-native-smoke-ldd.txt; then
  echo "native-smoke: legacy WebKitGTK 4.0/libsoup2 linkage found" >&2
  exit 1
fi

if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "native-smoke: xvfb-run is unavailable; cannot verify a native window" >&2
  exit 1
fi

echo "native-smoke: window/service/event checks are not implemented; refusing to report a pass" >&2
exit 1
