#!/usr/bin/env sh
set -eu

if command -v nix >/dev/null 2>&1; then
  exec nix develop .#default -c "$@"
fi

exec "$@"
