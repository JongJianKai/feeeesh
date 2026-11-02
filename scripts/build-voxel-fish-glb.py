#!/usr/bin/env python3
"""Build 3 original voxel fish .glb files with per-box PBR materials."""

from __future__ import annotations

import json
import struct
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "src/feeeesh-web/public/assets/fish"
OUT.mkdir(parents=True, exist_ok=True)


def hex_rgb(hex_color: str):
    h = hex_color.lstrip("#")
    return [int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255]


def box_geometry(cx, cy, cz, sx, sy, sz):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    faces = [
        ((-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz), (0, 0, 1)),
        ((hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz), (0, 0, -1)),
        ((hx, -hy, hz), (hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz), (1, 0, 0)),
        ((-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz), (-1, 0, 0)),
        ((-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz), (-hx, hy, -hz), (0, 1, 0)),
        ((-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz), (0, -1, 0)),
    ]
    positions, normals, indices = [], [], []
    for a, b, c, d, n in faces:
        base = len(positions) // 3
        for p in (a, b, c, d):
            positions.extend([p[0] + cx, p[1] + cy, p[2] + cz])
            normals.extend(n)
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    return positions, normals, indices


def pack_f32(vals):
    return struct.pack("<" + "f" * len(vals), *vals)


def pack_u16(vals):
    return struct.pack("<" + "H" * len(vals), *vals)


def write_glb(path: Path, name: str, boxes):
    """Each box → its own mesh primitive + PBR material (baseColorFactor)."""
    blobs = []
    cursor = 0

    def place(blob: bytes) -> int:
        nonlocal cursor
        pad = (4 - (cursor % 4)) % 4
        if pad:
            blobs.append(b"\x00" * pad)
            cursor += pad
        off = cursor
        blobs.append(blob)
        cursor += len(blob)
        return off

    buffer_views = []
    accessors = []
    materials = []
    primitives = []
    nodes = []
    meshes = []

    # Root node with children
    child_indices = []

    for i, (cx, cy, cz, sx, sy, sz, color) in enumerate(boxes):
        positions, normals, indices = box_geometry(cx, cy, cz, sx, sy, sz)
        pos_b = pack_f32(positions)
        nor_b = pack_f32(normals)
        idx_b = pack_u16(indices)

        pos_off = place(pos_b)
        nor_off = place(nor_b)
        idx_off = place(idx_b)

        bv_pos = len(buffer_views)
        buffer_views.append({"buffer": 0, "byteOffset": pos_off, "byteLength": len(pos_b), "target": 34962})
        bv_nor = len(buffer_views)
        buffer_views.append({"buffer": 0, "byteOffset": nor_off, "byteLength": len(nor_b), "target": 34962})
        bv_idx = len(buffer_views)
        buffer_views.append({"buffer": 0, "byteOffset": idx_off, "byteLength": len(idx_b), "target": 34963})

        xs, ys, zs = positions[0::3], positions[1::3], positions[2::3]
        acc_pos = len(accessors)
        accessors.append(
            {
                "bufferView": bv_pos,
                "componentType": 5126,
                "count": len(positions) // 3,
                "type": "VEC3",
                "max": [max(xs), max(ys), max(zs)],
                "min": [min(xs), min(ys), min(zs)],
            }
        )
        acc_nor = len(accessors)
        accessors.append(
            {"bufferView": bv_nor, "componentType": 5126, "count": len(normals) // 3, "type": "VEC3"}
        )
        acc_idx = len(accessors)
        accessors.append(
            {"bufferView": bv_idx, "componentType": 5123, "count": len(indices), "type": "SCALAR"}
        )

        mat_i = len(materials)
        rgb = hex_rgb(color)
        materials.append(
            {
                "name": f"{name}-part-{i}",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [rgb[0], rgb[1], rgb[2], 1.0],
                    "metallicFactor": 0.05,
                    "roughnessFactor": 0.55,
                },
            }
        )

        mesh_i = len(meshes)
        meshes.append(
            {
                "name": f"{name}-{i}",
                "primitives": [
                    {
                        "attributes": {"POSITION": acc_pos, "NORMAL": acc_nor},
                        "indices": acc_idx,
                        "material": mat_i,
                        "mode": 4,
                    }
                ],
            }
        )
        node_i = len(nodes)
        nodes.append({"mesh": mesh_i, "name": f"{name}-box-{i}"})
        child_indices.append(node_i)

    # final bin pad
    pad = (4 - (cursor % 4)) % 4
    if pad:
        blobs.append(b"\x00" * pad)
        cursor += pad
    bin_chunk = b"".join(blobs)

    root_node = len(nodes)
    nodes.append({"name": name, "children": child_indices})

    gltf = {
        "asset": {"version": "2.0", "generator": "feeeesh-voxel-fish"},
        "scene": 0,
        "scenes": [{"nodes": [root_node]}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": cursor}],
    }

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((4 - (len(json_bytes) % 4)) % 4)

    total = 12 + 8 + len(json_bytes) + 8 + len(bin_chunk)
    header = struct.pack("<4sII", b"glTF", 2, total)
    path.write_bytes(
        header
        + struct.pack("<I4s", len(json_bytes), b"JSON")
        + json_bytes
        + struct.pack("<I4s", len(bin_chunk), b"BIN\x00")
        + bin_chunk
    )
    print(f"wrote {path} ({path.stat().st_size} bytes, {len(boxes)} boxes)")


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
