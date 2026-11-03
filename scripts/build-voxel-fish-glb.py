#!/usr/bin/env python3
"""Build denser PokéBonk-like voxel fish .glb files (original species only)."""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "src/feeeesh-web/public/assets/fish"
OUT.mkdir(parents=True, exist_ok=True)

# Unit voxel edge length — smaller = denser silhouette.
VOX = 0.08


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
    nodes = []
    meshes = []
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
                    "metallicFactor": 0.04,
                    "roughnessFactor": 0.62,
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

    pad = (4 - (cursor % 4)) % 4
    if pad:
        blobs.append(b"\x00" * pad)
        cursor += pad
    bin_chunk = b"".join(blobs)

    root_node = len(nodes)
    nodes.append({"name": name, "children": child_indices})

    gltf = {
        "asset": {"version": "2.0", "generator": "feeeesh-voxel-fish-v4"},
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
    path.write_bytes(
        struct.pack("<4sII", b"glTF", 2, total)
        + struct.pack("<I4s", len(json_bytes), b"JSON")
        + json_bytes
        + struct.pack("<I4s", len(bin_chunk), b"BIN\x00")
        + bin_chunk
    )
    print(f"wrote {path} ({path.stat().st_size} bytes, {len(boxes)} voxels)")


class VoxelFish:
    """Accumulate unit voxels; merge same-color runs into larger boxes when possible."""

    def __init__(self):
        self.cells: dict[tuple[int, int, int], str] = {}

    def set(self, ix: int, iy: int, iz: int, color: str):
        self.cells[(ix, iy, iz)] = color

    def fill_ellipsoid(
        self,
        cx: float,
        cy: float,
        cz: float,
        rx: float,
        ry: float,
        rz: float,
        color_fn,
    ):
        ix0 = math.floor((cx - rx) / VOX) - 1
        ix1 = math.ceil((cx + rx) / VOX) + 1
        iy0 = math.floor((cy - ry) / VOX) - 1
        iy1 = math.ceil((cy + ry) / VOX) + 1
        iz0 = math.floor((cz - rz) / VOX) - 1
        iz1 = math.ceil((cz + rz) / VOX) + 1
        for ix in range(ix0, ix1 + 1):
            for iy in range(iy0, iy1 + 1):
                for iz in range(iz0, iz1 + 1):
                    x, y, z = (ix + 0.5) * VOX, (iy + 0.5) * VOX, (iz + 0.5) * VOX
                    nx = (x - cx) / max(rx, 1e-6)
                    ny = (y - cy) / max(ry, 1e-6)
                    nz = (z - cz) / max(rz, 1e-6)
                    if nx * nx + ny * ny + nz * nz <= 1.0:
                        col = color_fn(x, y, z, nx, ny, nz)
                        if col:
                            self.set(ix, iy, iz, col)

    def fill_box(self, x0, y0, z0, x1, y1, z1, color):
        ix0 = math.floor(min(x0, x1) / VOX)
        ix1 = math.floor(max(x0, x1) / VOX)
        iy0 = math.floor(min(y0, y1) / VOX)
        iy1 = math.floor(max(y0, y1) / VOX)
        iz0 = math.floor(min(z0, z1) / VOX)
        iz1 = math.floor(max(z0, z1) / VOX)
        for ix in range(ix0, ix1 + 1):
            for iy in range(iy0, iy1 + 1):
                for iz in range(iz0, iz1 + 1):
                    self.set(ix, iy, iz, color)

    def to_boxes(self):
        """Greedy merge adjacent same-color cells along X then Y for fewer draw boxes."""
        remaining = dict(self.cells)
        boxes = []
        while remaining:
            (ix, iy, iz), color = next(iter(remaining.items()))
            # grow X
            x_end = ix
            while (x_end + 1, iy, iz) in remaining and remaining[(x_end + 1, iy, iz)] == color:
                x_end += 1
            # grow Y
            y_end = iy
            grow_y = True
            while grow_y:
                for x in range(ix, x_end + 1):
                    if (x, y_end + 1, iz) not in remaining or remaining[(x, y_end + 1, iz)] != color:
                        grow_y = False
                        break
                if grow_y:
                    y_end += 1
            # grow Z
            z_end = iz
            grow_z = True
            while grow_z:
                for x in range(ix, x_end + 1):
                    for y in range(iy, y_end + 1):
                        if (x, y, z_end + 1) not in remaining or remaining[(x, y, z_end + 1)] != color:
                            grow_z = False
                            break
                    if not grow_z:
                        break
                if grow_z:
                    z_end += 1

            for x in range(ix, x_end + 1):
                for y in range(iy, y_end + 1):
                    for z in range(iz, z_end + 1):
                        del remaining[(x, y, z)]

            sx = (x_end - ix + 1) * VOX
            sy = (y_end - iy + 1) * VOX
            sz = (z_end - iz + 1) * VOX
            cx = (ix + x_end + 1) * 0.5 * VOX
            cy = (iy + y_end + 1) * 0.5 * VOX
            cz = (iz + z_end + 1) * 0.5 * VOX
            boxes.append((cx, cy, cz, sx, sy, sz, color))
        return boxes


def make_coral_bit():
    f = VoxelFish()
    body = "ff8a6b"
    belly = "ffd4c4"
    dark = "e85a3c"
    fin = "ff9a6b"
    fin_soft = "ffb08a"
    eye = "0a1f28"
    shine = "7fd3ff"
    snout = "ff7a59"

    def body_color(x, y, z, nx, ny, nz):
        if y < -0.08:
            return belly
        if abs(z) > 0.22 and y > 0.05:
            return dark
        return body

    f.fill_ellipsoid(0.05, 0.0, 0.0, 0.55, 0.38, 0.34, body_color)
    f.fill_ellipsoid(0.48, 0.02, 0.0, 0.28, 0.30, 0.28, lambda *a: snout)
    # eyes (both sides)
    for side in (1, -1):
        f.fill_box(0.58, 0.08, 0.18 * side, 0.70, 0.20, 0.26 * side, eye)
        f.fill_box(0.62, 0.12, 0.22 * side, 0.68, 0.18, 0.28 * side, shine)
    # dorsal fin — notched silhouette
    for i, h in enumerate([0.18, 0.28, 0.34, 0.30, 0.22, 0.14]):
        x = -0.12 + i * VOX * 1.2
        f.fill_box(x, 0.32, -0.04, x + VOX * 1.1, 0.32 + h, 0.04, fin)
    # pectorals
    for side in (1, -1):
        f.fill_box(-0.05, -0.08, 0.28 * side, 0.22, 0.06, 0.40 * side, fin_soft)
        f.fill_box(0.02, -0.02, 0.36 * side, 0.18, 0.04, 0.46 * side, fin)
    # forked tail
    f.fill_box(-0.72, -0.06, -0.05, -0.52, 0.18, 0.05, dark)
    f.fill_box(-0.92, 0.08, -0.04, -0.70, 0.32, 0.04, fin)
    f.fill_box(-0.92, -0.20, -0.04, -0.70, 0.04, 0.04, fin)
    f.fill_box(-0.98, 0.18, -0.03, -0.88, 0.30, 0.03, fin_soft)
    f.fill_box(-0.98, -0.18, -0.03, -0.88, -0.06, 0.03, fin_soft)
    # cheek blush
    for side in (1, -1):
        f.fill_box(0.42, -0.06, 0.22 * side, 0.52, 0.02, 0.30 * side, "ffb0a0")
    return f.to_boxes()


def make_aqua_block():
    f = VoxelFish()
    deep = "1f8fad"
    mid = "2a9fb8"
    light = "57d0e8"
    bright = "3ec7e0"
    ink = "0b3d4a"
    eye = "0a1f28"
    shine = "f4fbff"
    fin = "7fd3ff"

    def body_color(x, y, z, nx, ny, nz):
        # vertical stripes along length
        stripe = int(math.floor((x + 0.7) / 0.18)) % 2
        if y < -0.1:
            return light
        return deep if stripe == 0 else mid

    f.fill_ellipsoid(0.0, 0.0, 0.0, 0.58, 0.34, 0.30, body_color)
    f.fill_ellipsoid(0.52, 0.02, 0.0, 0.26, 0.26, 0.25, lambda *a: bright)
    for side in (1, -1):
        f.fill_box(0.60, 0.06, 0.16 * side, 0.72, 0.18, 0.24 * side, eye)
        f.fill_box(0.64, 0.10, 0.20 * side, 0.70, 0.16, 0.26 * side, shine)
    # dorsal ridge
    for i in range(7):
        x = -0.28 + i * VOX * 1.15
        h = 0.10 + (0.08 if i % 2 == 0 else 0.02)
        f.fill_box(x, 0.28, -0.04, x + VOX, 0.28 + h, 0.04, fin)
    # side fins
    for side in (1, -1):
        f.fill_box(-0.08, -0.06, 0.26 * side, 0.20, 0.08, 0.40 * side, bright)
        f.fill_box(0.0, 0.0, 0.36 * side, 0.14, 0.06, 0.48 * side, fin)
    # blocky forked tail
    f.fill_box(-0.78, -0.10, -0.05, -0.55, 0.16, 0.05, ink)
    f.fill_box(-0.98, 0.06, -0.04, -0.74, 0.28, 0.04, bright)
    f.fill_box(-0.98, -0.22, -0.04, -0.74, 0.0, 0.04, bright)
    # belly stripe accents
    f.fill_box(-0.25, -0.22, -0.12, 0.35, -0.14, 0.12, light)
    return f.to_boxes()


def make_pearl_voxel():
    f = VoxelFish()
    pearl = "f4fbff"
    soft = "e8f0f5"
    gold = "ffd166"
    coral = "ff7a59"
    warm = "ffe8b0"
    eye = "0a1f28"
    shine = "ffd166"
    fin = "ff9a6b"

    def body_color(x, y, z, nx, ny, nz):
        if y < -0.06:
            return soft
        if abs(z) > 0.2 and y > 0.1:
            return warm
        return pearl

    f.fill_ellipsoid(0.0, 0.02, 0.0, 0.52, 0.40, 0.36, body_color)
    f.fill_ellipsoid(0.42, 0.04, 0.0, 0.28, 0.30, 0.28, lambda *a: warm)
    for side in (1, -1):
        f.fill_box(0.52, 0.10, 0.18 * side, 0.64, 0.22, 0.26 * side, eye)
        f.fill_box(0.56, 0.14, 0.22 * side, 0.62, 0.20, 0.28 * side, shine)
    # gold crown dorsal
    for i, h in enumerate([0.14, 0.22, 0.28, 0.24, 0.16]):
        x = -0.10 + i * VOX * 1.25
        f.fill_box(x, 0.36, -0.04, x + VOX * 1.1, 0.36 + h, 0.04, coral if i % 2 else gold)
    for side in (1, -1):
        f.fill_box(-0.02, -0.10, 0.30 * side, 0.22, 0.04, 0.44 * side, fin)
        f.fill_box(0.04, -0.04, 0.40 * side, 0.16, 0.02, 0.50 * side, gold)
    f.fill_box(-0.70, -0.08, -0.05, -0.48, 0.20, 0.05, gold)
    f.fill_box(-0.92, 0.10, -0.04, -0.66, 0.34, 0.04, coral)
    f.fill_box(-0.92, -0.22, -0.04, -0.66, 0.02, 0.04, coral)
    # pearl cheek dots
    for side in (1, -1):
        f.fill_box(0.28, -0.02, 0.26 * side, 0.36, 0.06, 0.34 * side, gold)
    return f.to_boxes()


if __name__ == "__main__":
    write_glb(OUT / "coral-bit.glb", "coral-bit", make_coral_bit())
    write_glb(OUT / "aqua-block.glb", "aqua-block", make_aqua_block())
    write_glb(OUT / "pearl-voxel.glb", "pearl-voxel", make_pearl_voxel())
