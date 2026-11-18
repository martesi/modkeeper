#!/bin/sh
# Run a Rust command inside the project's development environment.
#
# Usage:
#   sh scripts/with-rust.sh <command> [args...]
#
# Examples:
#   sh scripts/with-rust.sh cargo test --manifest-path src-tauri/Cargo.toml
#   sh scripts/with-rust.sh cargo clippy --manifest-path src-tauri/Cargo.toml
#
# When `nix` is available, the command runs inside `nix develop` (the repo
# flake provides rustc/cargo, Tauri's system libraries, and the cached CARGO_HOME).
# Otherwise the command runs directly, using whatever `cargo` is on PATH.
#
# `nix-shell -p <pkg>` is NOT a supported fallback: this environment has no
# NIX_PATH/nixpkgs channel, so it fails to evaluate.

set -eu

if [ "$#" -eq 0 ]; then
  echo "with-rust: no command given" >&2
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH='' cd -- "$script_dir/.." && pwd)
cd "$repo_root"

if command -v nix >/dev/null 2>&1; then
  if [ ! -f "$repo_root/flake.nix" ]; then
    echo "with-rust: 'nix' is available but $repo_root/flake.nix is missing" >&2
    exit 1
  fi
  # exec preserves the child's exit status, stdout, and stderr. If `nix develop`
  # fails, its error is shown and its nonzero status is returned unchanged.
  exec nix develop "$repo_root" --command "$@"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "with-rust: neither 'nix' nor 'cargo' is available on PATH" >&2
  echo "with-rust: install Nix (flake.nix) or a Rust toolchain" >&2
  exit 127
fi

exec "$@"
