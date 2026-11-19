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
if ! grep -E 'libwebkitgtk-6\.0\.so|libwebkit2gtk-4\.1\.so' /tmp/modkeeper-native-smoke-ldd.txt; then
  echo "native-smoke: expected WebKitGTK 6.0 or 4.1 linkage was not found" >&2
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

echo "native-smoke: launching $binary under Xvfb (45 second smoke deadline)"
set +e
MODKEEPER_NATIVE_SMOKE=1 timeout --signal=TERM 45s "$binary" 2>&1 | tee /tmp/modkeeper-native-smoke.log
status=${PIPESTATUS[0]}
set -e
if [[ "$status" -ne 0 ]]; then
  echo "native-smoke: app exited with status $status" >&2
  exit 1
fi
for link in "PASS settings JS→Go→JS value" "PASS frontend event listener ready" \
  "PASS Go emitted registered event" "PASS event payload observed by frontend and reported to Go"; do
  if ! grep -Fq "$link" /tmp/modkeeper-native-smoke.log; then
    echo "native-smoke: FAIL missing evidence: $link" >&2
    exit 1
  fi
done
echo "native-smoke: PASS all native links"
