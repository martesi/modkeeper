#!/usr/bin/env python3
"""Verify the PE headers emitted by the Linux Windows cross-build."""

from __future__ import annotations

import struct
import sys
from pathlib import Path


MACHINES = {"amd64": (0x8664, "amd64"), "arm64": (0xAA64, "arm64")}


def u16(data: bytes, offset: int) -> int:
    return struct.unpack_from("<H", data, offset)[0]


def u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def verify(path: Path, expected_arch: str) -> None:
    expected_machine, machine_name = MACHINES[expected_arch]
    data = path.read_bytes()
    if data[:2] != b"MZ":
        raise SystemExit(f"{path}: missing DOS MZ signature")

    pe_offset = u32(data, 0x3C)
    if data[pe_offset : pe_offset + 4] != b"PE\0\0":
        raise SystemExit(f"{path}: missing PE signature")

    coff = pe_offset + 4
    machine = u16(data, coff)
    section_count = u16(data, coff + 2)
    optional_size = u16(data, coff + 16)
    optional = coff + 20
    magic = u16(data, optional)
    if magic != 0x20B:
        raise SystemExit(f"{path}: expected PE32+ optional header, got 0x{magic:04x}")

    subsystem = u16(data, optional + 68)
    if machine != expected_machine:
        raise SystemExit(
            f"{path}: expected {machine_name} machine 0x{expected_machine:04x}, got 0x{machine:04x}"
        )
    if subsystem != 2:
        raise SystemExit(f"{path}: expected Windows GUI subsystem 2, got {subsystem}")

    section_table = optional + optional_size
    sections = []
    for index in range(section_count):
        section = section_table + index * 40
        sections.append(data[section : section + 8].rstrip(b"\0").decode("ascii", "replace"))
    if ".rsrc" not in sections:
        raise SystemExit(f"{path}: missing .rsrc section; sections={sections}")

    print(
        f"OK {path}: machine={machine_name} subsystem={subsystem} "
        f"sections={','.join(sections)} size={path.stat().st_size} bytes"
    )


if len(sys.argv) != 3 or sys.argv[2] not in MACHINES:
    raise SystemExit(f"usage: {sys.argv[0]} PATH amd64|arm64")

verify(Path(sys.argv[1]), sys.argv[2])
