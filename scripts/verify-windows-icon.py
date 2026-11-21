#!/usr/bin/env python3
"""Verify that the Windows ICO contains all Wails-generated sizes."""

from __future__ import annotations

import struct
import sys
from pathlib import Path


def verify(path: Path) -> None:
    data = path.read_bytes()
    if len(data) < 6:
        raise SystemExit(f"{path}: truncated ICO header")
    reserved, image_type, count = struct.unpack_from("<HHH", data, 0)
    if (reserved, image_type) != (0, 1):
        raise SystemExit(f"{path}: not an icon directory")

    sizes = set()
    for index in range(count):
        offset = 6 + index * 16
        if offset + 16 > len(data):
            raise SystemExit(f"{path}: truncated directory entry {index}")
        width, height = data[offset], data[offset + 1]
        if width != height:
            raise SystemExit(f"{path}: entry {index} is not square")
        sizes.add(width or 256)

    expected = {16, 32, 48, 64, 128, 256}
    if sizes != expected:
        raise SystemExit(f"{path}: expected icon sizes {sorted(expected)}, got {sorted(sizes)}")
    print(f"OK {path}: {count} entries, sizes={','.join(map(str, sorted(sizes)))}")


if len(sys.argv) != 2:
    raise SystemExit(f"usage: {sys.argv[0]} ICON.ico")

verify(Path(sys.argv[1]))
