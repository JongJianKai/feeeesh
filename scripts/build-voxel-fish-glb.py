#!/usr/bin/env python3
"""Build 3 original voxel fish .glb files (no external deps beyond stdlib)."""

from __future__ import annotations

import json
import struct
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "src/feeeesh-web/public/assets/fish"
OUT.mkdir(parents=True, exist_ok=True)


def box_mesh(cx, cy, cz, sx, sy, sz, rgba):
    """Unit box centered at origin, then scaled/translated. Returns positions, normals, indices, color."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    # 24 verts (unique normals per face)
    faces = [
        # +Z
        ((-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz), (0, 0, 1)),
        # -Z
        ((hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz), (0, 0, -1)),
        # +X
        ((hx, -hy, hz), (hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz), (1, 0, 0)),
        # -X
        ((-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz), (-1, 0, 0)),
        # +Y
        ((-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz), (-hx, hy, -hz), (0, 1, 0)),
        # -Y
        ((-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz), (0, -1, 0)),
    ]
    positions = []
    normals = []
    colors = []
    indices = []
    for a, b, c, d, n in faces:
        base = len(positions) // 3
        for p in (a, b, c, d):
            positions.extend([p[0] + cx, p[1] + cy, p[2] + cz])
            normals.extend(n)
            colors.extend(rgba)
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    return positions, normals, colors, indices


def hex_rgba(hex_color: str, a=1.0):
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255
    return [r, g, b, a]


def merge_boxes(boxes):
    positions, normals, colors, indices = [], [], [], []
    for cx, cy, cz, sx, sy, sz, color in boxes:
        p, n, c, i = box_mesh(cx, cy, cz, sx, sy, sz, hex_rgba(color))
        base = len(positions) // 3
        positions.extend(p)
        normals.extend(n)
        colors.extend(c)
        indices.extend([x + base for x in i])
    return positions, normals, colors, indices


def pack_f32(vals):
    return struct.pack("<" + "f" * len(vals), *vals)


def pack_u16(vals):
    return struct.pack("<" + "H" * len(vals), *vals)


def align4(n):
    return (n + 3) & ~3


def write_glb(path: Path, name: str, boxes):
    positions, normals, colors, indices = merge_boxes(boxes)
    pos_b = pack_f32(positions)
    nor_b = pack_f32(normals)
    col_b = pack_f32(colors)
    idx_b = pack_u16(indices)
    if len(indices) % 2 == 1:
        idx_b += b"\x00\x00"  # pad odd count for align; actual count tracked separately

    # Build tightly packed buffer with 4-byte alignment between views
    blobs = []
    offsets = []

    def add(blob, align_even=False):
        pad = (4 - (len(b"".join(blobs)) % 4)) % 4
        if pad:
            blobs.append(b"\x00" * pad)
        offsets.append(len(b"".join(blobs)))
        blobs.append(blob)
        if align_even and (len(blob) % 4):
            blobs.append(b"\x00" * (4 - len(blob) % 4))

    # Recreate with running offset
    blobs = []
    cursor = 0

    def place(blob):
        nonlocal cursor
        pad = (4 - (cursor % 4)) % 4
        if pad:
            blobs.append(b"\x00" * pad)
            cursor += pad
        off = cursor
        blobs.append(blob)
        cursor += len(blob)
        return off

    pos_off = place(pos_b)
    nor_off = place(nor_b)
    col_off = place(col_b)
    idx_raw = pack_u16(indices)
    idx_off = place(idx_raw)
    # final pad
    pad = (4 - (cursor % 4)) % 4
    if pad:
        blobs.append(b"\x00" * pad)
        cursor += pad
    bin_chunk = b"".join(blobs)
    byte_len = cursor

    # accessors min/max for positions
    xs = positions[0::3]
    ys = positions[1::3]
    zs = positions[2::3]
    pos_min = [min(xs), min(ys), min(zs)]
    pos_max = [max(xs), max(ys), max(zs)]
    vert_count = len(positions) // 3
    idx_count = len(indices)

    gltf = {
        "asset": {"version": "2.0", "generator": "feeeesh-voxel-fish"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [
            {
                "name": name,
                "primitives": [
                    {
                        "attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2},
                        "indices": 3,
                        "mode": 4,
                    }
                ],
            }
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": vert_count,
                "type": "VEC3",
                "max": pos_max,
                "min": pos_min,
            },
            {
                "bufferView": 1,
                "componentType": 5126,
                "count": vert_count,
                "type": "VEC3",
            },
            {
                "bufferView": 2,
                "componentType": 5126,
                "count": vert_count,
                "type": "VEC4",
            },
            {
                "bufferView": 3,
                "componentType": 5123,
                "count": idx_count,
                "type": "SCALAR",
            },
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": pos_off, "byteLength": len(pos_b), "target": 34962},
            {"buffer": 0, "byteOffset": nor_off, "byteLength": len(nor_b), "target": 34962},
            {"buffer": 0, "byteOffset": col_off, "byteLength": len(col_b), "target": 34962},
            {"buffer": 0, "byteOffset": idx_off, "byteLength": len(idx_raw), "target": 34963},
        ],
        "buffers": [{"byteLength": byte_len}],
    }

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_pad = (4 - (len(json_bytes) % 4)) % 4
    json_bytes += b" " * json_pad

    # GLB: 12-byte header + JSON chunk + BIN chunk
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_chunk)
    header = struct.pack("<4sII", b"glTF", 2, total)
    json_chunk = struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes
    bin_chunk_full = struct.pack("<I4s", len(bin_chunk), b"BIN\x00") + bin_chunk
    path.write_bytes(header + json_chunk + bin_chunk_full)
    print(f"wrote {path} ({path.stat().st_size} bytes, {vert_count} verts)")


CORAL_BIT = [
    (0, 0, 0, 1.2, 0.7, 0.55, "ff8a6b"),
    (0.15, -0.05, 0, 0.9, 0.45, 0.42, "ffd4c4"),
    (0.65, 0.05, 0, 0.45, 0.5, 0.48, "ff7a59"),
    (0.78, 0.12, 0.22, 0.12, 0.12, 0.08, "0a1f28"),
    (0.8, 0.14, 0.26, 0.05, 0.05, 0.04, "7fd3ff"),
    (-0.15, 0.45, 0, 0.35, 0.28, 0.08, "ff9a6b"),
    (-0.1, -0.42, 0.18, 0.3, 0.12, 0.08, "ffb08a"),
    (-0.1, -0.42, -0.18, 0.3, 0.12, 0.08, "ffb08a"),
    (-0.75, 0.05, 0, 0.28, 0.55, 0.1, "e85a3c"),
    (-0.95, 0.2, 0, 0.2, 0.28, 0.08, "ff9a6b"),
    (-0.95, -0.15, 0, 0.2, 0.28, 0.08, "ff9a6b"),
]

AQUA_BLOCK = [
    (0, 0, 0, 1.25, 0.65, 0.5, "2a9fb8"),
    (0.05, 0.05, 0, 1.05, 0.35, 0.42, "57d0e8"),
    (-0.2, 0, 0, 0.25, 0.55, 0.52, "1f8fad"),
    (0.25, 0, 0, 0.25, 0.55, 0.52, "1f8fad"),
    (0.7, 0.02, 0, 0.4, 0.48, 0.45, "3ec7e0"),
    (0.82, 0.1, 0.2, 0.11, 0.11, 0.07, "0a1f28"),
    (0.84, 0.12, 0.24, 0.045, 0.045, 0.035, "f4fbff"),
    (-0.05, 0.42, 0, 0.4, 0.22, 0.08, "7fd3ff"),
    (-0.75, 0, 0, 0.3, 0.5, 0.1, "0b3d4a"),
    (-0.95, 0.18, 0, 0.22, 0.25, 0.08, "3ec7e0"),
    (-0.95, -0.18, 0, 0.22, 0.25, 0.08, "3ec7e0"),
]

PEARL_VOXEL = [
    (0, 0, 0, 1.15, 0.75, 0.6, "f4fbff"),
    (0.1, -0.08, 0, 0.85, 0.4, 0.48, "e8f0f5"),
    (0.55, 0.05, 0, 0.42, 0.52, 0.5, "ffe8b0"),
    (0.68, 0.12, 0.22, 0.12, 0.12, 0.08, "0a1f28"),
    (0.7, 0.14, 0.26, 0.05, 0.05, 0.04, "ffd166"),
    (-0.1, 0.48, 0, 0.35, 0.22, 0.08, "ff7a59"),
    (-0.05, -0.45, 0.15, 0.28, 0.12, 0.08, "ff9a6b"),
    (-0.05, -0.45, -0.15, 0.28, 0.12, 0.08, "ff9a6b"),
    (-0.7, 0.05, 0, 0.28, 0.58, 0.1, "ffd166"),
    (-0.9, 0.22, 0, 0.2, 0.28, 0.08, "ff7a59"),
    (-0.9, -0.15, 0, 0.2, 0.28, 0.08, "ff7a59"),
]


if __name__ == "__main__":
    write_glb(OUT / "coral-bit.glb", "coral-bit", CORAL_BIT)
    write_glb(OUT / "aqua-block.glb", "aqua-block", AQUA_BLOCK)
    write_glb(OUT / "pearl-voxel.glb", "pearl-voxel", PEARL_VOXEL)
