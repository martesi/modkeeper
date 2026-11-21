#!/usr/bin/env bash
set -euo pipefail
set -m

cd "$(git rev-parse --show-toplevel)"

artifacts_root="${MODKEEPER_NATIVE_T3_ARTIFACTS:-/tmp/opencode}"
mkdir -p "$artifacts_root"
run_dir="$(mktemp -d "$artifacts_root/modkeeper-native-t3.XXXXXX")"
log="$run_dir/native-t3.log"
before="$run_dir/before.png"
after="$run_dir/after.png"
xvfb_pid=""
app_pid=""

cleanup() {
  local status=$?
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill -- "-$app_pid" 2>/dev/null || kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  if [[ -n "$xvfb_pid" ]] && kill -0 "$xvfb_pid" 2>/dev/null; then
    kill "$xvfb_pid" 2>/dev/null || true
    wait "$xvfb_pid" 2>/dev/null || true
  fi
  if [[ "$status" -eq 0 ]]; then
    rm -rf "$run_dir"
  else
    echo "native-t3: failure artifacts: $run_dir" >&2
    [[ -f "$log" ]] && tail -n 120 "$log" >&2
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

bun install
bun run build:wails
wails3 build
binary=build/bin/modkeeper
if [[ ! -x "$binary" ]]; then
  echo "native-t3: missing executable: $binary" >&2
  exit 1
fi

game="$run_dir/game"
library="$run_dir/library"
mkdir -p "$game/SPT/user/sptRegistry"
printf '{"SPT_Version":"4.2.1"}\n' >"$game/SPT/user/sptRegistry/registry.json"

archives=()
go build -o "$run_dir/native-archive-fixture" scripts/native-archive-fixture.go
make_archive() {
  local name="$1" content="$2"
  local archive="$run_dir/$name.zip"
  "$run_dir/native-archive-fixture" "$archive" "$name" "$content"
  archives+=("$archive")
}
make_archive "NativeOne" "one"
for i in $(seq -w 1 25); do make_archive "NativeBatch$i" "batch-$i"; done
for i in $(seq -w 1 25); do make_archive "NativeCancel$i" "cancel-$i"; done
"$run_dir/native-archive-fixture" "$run_dir/NativeBusy.zip" "NativeBusy" "busy"

urlencode() { bun -e 'console.log(encodeURIComponent(process.argv[1]))' "$1"; }
query="native-smoke=1&native-flow=1&game-root=$(urlencode "$game")&library-root=$(urlencode "$library")&archives-dir=$(urlencode "$run_dir")"
export MODKEEPER_NATIVE_SMOKE=1
export MODKEEPER_NATIVE_SMOKE_FLOW=1
export MODKEEPER_NATIVE_SMOKE_UI=1
export MODKEEPER_NATIVE_SMOKE_CONFIG="$run_dir/config.toml"
export MODKEEPER_NATIVE_SMOKE_URL="/?$query"
Xvfb -displayfd 3 -screen 0 1600x1000x24 -nolisten tcp -noreset 3>"$run_dir/display" >"$run_dir/xvfb.log" 2>&1 &
xvfb_pid=$!
for _ in $(seq 1 100); do
  [[ -s "$run_dir/display" ]] && break
  sleep 0.1
done
if [[ ! -s "$run_dir/display" ]]; then
  echo "native-t3: Xvfb did not allocate a display" >&2
  exit 1
fi
export DISPLAY=":$(cat "$run_dir/display")"
for _ in $(seq 1 100); do
  xdpyinfo >/dev/null 2>&1 && break
  sleep 0.1
done
xdpyinfo >/dev/null 2>&1 || { echo "native-t3: Xvfb did not become ready" >&2; exit 1; }

"$binary" >"$log" 2>&1 &
app_pid=$!
window=""
for _ in $(seq 1 300); do
  window="$(xdotool search --onlyvisible --name '^Modkeeper$' 2>/dev/null | head -n1 || true)"
  if [[ -n "$window" ]]; then
    import -window root "$before" 2>/dev/null || true
    if [[ "$(stat -c%s "$before" 2>/dev/null || echo 0)" -gt 10000 ]]; then break; fi
  fi
  sleep 0.2
done
if [[ -z "$window" ]] || [[ "$(stat -c%s "$before" 2>/dev/null || echo 0)" -le 10000 ]]; then
  echo "native-t3: native window did not paint" >&2
  exit 1
fi
eval "$(xdotool getwindowgeometry --shell "$window")"
status_x=$((X + 30))
status_y=$((Y + 80))

# Wait for the query-gated panel to paint before sending keyboard input.
for _ in $(seq 1 100); do
  import -window root "$before" 2>/dev/null || true
  panel_pixel="$(convert "$before" -format "%[pixel:p{$status_x,$status_y}]" info: 2>/dev/null || true)"
  [[ "$panel_pixel" == *"55,65,81"* ]] && break
  sleep 0.2
done
if [[ "$panel_pixel" != *"55,65,81"* ]]; then
  echo "native-t3: query-gated interaction panel did not paint (pixel=$panel_pixel)" >&2
  exit 1
fi
xdotool key Return
for _ in $(seq 1 100); do
  import -window root "$after" 2>/dev/null || true
  pixel="$(convert "$after" -format "%[pixel:p{$status_x,$status_y}]" info: 2>/dev/null || true)"
  if [[ "$pixel" == *"22,101,52"* ]]; then break; fi
  sleep 0.2
done
if [[ "$pixel" != *"22,101,52"* ]]; then
  echo "native-t3: screenshot did not show the post-interaction green status surface (pixel=$pixel)" >&2
  exit 1
fi

for _ in $(seq 1 100); do
  grep -Fq 'PASS xdotool-driven native UI interaction' "$log" && break
  sleep 0.2
done
for _ in $(seq 1 300); do
  if grep -Fq 'FAIL native backend archive journeys' "$log"; then
    echo "native-t3: frontend archive flow reported failure" >&2
    exit 1
  fi
  grep -Fq 'PASS native backend archive journeys' "$log" && break
  sleep 0.2
done
for link in "PASS settings JS→Go→JS value" "PASS frontend event listener ready" "PASS Go emitted registered event" "PASS event payload observed by frontend and reported to Go" "PASS native backend archive journeys" "PASS native LibraryBusy IPC error code" "PASS xdotool-driven native UI interaction"; do
  grep -Fq "$link" "$log" || { echo "native-t3: missing evidence: $link" >&2; exit 1; }
done
mod_dirs="$(find "$library/mods" -mindepth 1 -maxdepth 1 -type d | wc -l)"
installed_files="$(find "$library/mods" -type f -name '*.dll' | wc -l)"
cancelled_files="$(find "$library/mods" -type f -name 'NativeCancel*.dll' | wc -l)"
[[ "$mod_dirs" -gt 26 && "$mod_dirs" -lt 51 && "$installed_files" -gt 26 && "$installed_files" -lt 51 && "$cancelled_files" -gt 0 && "$cancelled_files" -lt 25 ]] || {
  echo "native-t3: filesystem assertion failed (mods=$mod_dirs files=$installed_files cancelled=$cancelled_files)" >&2
  exit 1
}
for name in NativeOne.dll NativeBatch01.dll NativeBatch25.dll; do
  find "$library/mods" -type f -name "$name" -print -quit | grep -q . || {
    echo "native-t3: expected installed archive file $name is absent" >&2
    exit 1
  }
done
find "$library/mods" -type f -name 'NativeCancel*.dll' -print -quit | grep -q . || {
  echo "native-t3: cancellation committed no completed archive" >&2
  exit 1
}

echo "native-t3: PASS real IPC archive flows, filesystem outcomes, painted window, keyboard interaction"
