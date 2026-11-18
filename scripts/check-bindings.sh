#!/bin/sh
# Fail if src/gen/bindings.ts does not match what the Rust command/event declarations produce.
#
# The export helper writes to "../src/gen/bindings.ts" relative to the process CWD, so this
# always runs from src-tauri. The working tree is restored either way: a drift check must not
# leave the generated file half-updated behind a failing exit.
#
# Usage:
#   sh scripts/check-bindings.sh            # verify
#   sh scripts/check-bindings.sh --write    # regenerate in place (same as the documented command)

set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH='' cd -- "$script_dir/.." && pwd)
target="$repo_root/src/gen/bindings.ts"
write_mode=0

if [ "${1:-}" = "--write" ]; then
  write_mode=1
elif [ "$#" -gt 0 ]; then
  echo "check-bindings: unknown argument '$1'" >&2
  echo "usage: $0 [--write]" >&2
  exit 2
fi

if [ ! -f "$target" ]; then
  echo "check-bindings: $target is missing" >&2
  exit 1
fi

# The binary is a Tauri bin target, so it needs the flake's system libraries as well as rustc.
run_export() {
  if command -v nix >/dev/null 2>&1; then
    nix develop "$repo_root" --command cargo run --quiet --bin export_types --features export-types
  elif command -v cargo >/dev/null 2>&1; then
    cargo run --quiet --bin export_types --features export-types
  else
    echo "check-bindings: neither 'nix' nor 'cargo' is available on PATH" >&2
    exit 127
  fi
}

backup=$(mktemp "${TMPDIR:-/tmp}/bindings.XXXXXX")
cp "$target" "$backup"
restore() {
  cp "$backup" "$target"
  rm -f "$backup"
}
trap restore EXIT

cd "$repo_root/src-tauri"
run_export >/dev/null

if cmp -s "$target" "$backup"; then
  echo "bindings: OK ($target matches the Rust declarations)"
  if [ "$write_mode" -eq 1 ]; then
    echo "bindings: nothing to write"
  fi
  exit 0
fi

if [ "$write_mode" -eq 1 ]; then
  # Keep the regenerated file: the caller asked for it.
  cp "$target" "$backup" 2>/dev/null || true
  trap - EXIT
  rm -f "$backup"
  echo "bindings: wrote $target"
  exit 0
fi

echo "bindings: DRIFT — $target does not match the Rust declarations." >&2
echo "Run 'sh scripts/check-bindings.sh --write' to regenerate it." >&2
echo "" >&2
diff -u "$backup" "$target" | sed -n '1,120p' >&2 || true
exit 1
