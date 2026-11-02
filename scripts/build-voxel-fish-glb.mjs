/**
 * Builds 3 original voxel-style glTF fish (.glb) for Feeeesh View Tank.
 * Shapes inspired by AI concepts in media/fish-ai/ — no Pokémon IP.
 */
import * as THREE from '../src/feeeesh-web/node_modules/three/build/three.module.js';
import { GLTFExporter } from '../src/feeeesh-web/node_modules/three/examples/jsm/exporters/GLTFExporter.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '../src/feeeesh-web/public/assets/fish');
mkdirSync(outDir, { recursive: true });

function addBox(group, x, y, z, sx, sy, sz, color, opacity = 1) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.05,
      transparent: opacity < 1,
      opacity
    })
  );
  mesh.position.set(x, y, z);
  group.add(mesh);
}

function makeCoralBit() {
  const g = new THREE.Group();
  g.name = 'coral-bit';
  // body
  addBox(g, 0, 0, 0, 1.2, 0.7, 0.55, 0xff8a6b);
  addBox(g, 0.15, -0.05, 0, 0.9, 0.45, 0.42, 0xffd4c4);
  // head
  addBox(g, 0.65, 0.05, 0, 0.45, 0.5, 0.48, 0xff7a59);
  // eye
  addBox(g, 0.78, 0.12, 0.22, 0.12, 0.12, 0.08, 0x0a1f28);
  addBox(g, 0.8, 0.14, 0.26, 0.05, 0.05, 0.04, 0x7fd3ff);
  // fins
  addBox(g, -0.15, 0.45, 0, 0.35, 0.28, 0.08, 0xff9a6b);
  addBox(g, -0.1, -0.42, 0.18, 0.3, 0.12, 0.08, 0xffb08a);
  addBox(g, -0.1, -0.42, -0.18, 0.3, 0.12, 0.08, 0xffb08a);
  // tail
  addBox(g, -0.75, 0.05, 0, 0.28, 0.55, 0.1, 0xe85a3c);
  addBox(g, -0.95, 0.2, 0, 0.2, 0.28, 0.08, 0xff9a6b);
  addBox(g, -0.95, -0.15, 0, 0.2, 0.28, 0.08, 0xff9a6b);
  return g;
}

function makeAquaBlock() {
  const g = new THREE.Group();
  g.name = 'aqua-block';
  addBox(g, 0, 0, 0, 1.25, 0.65, 0.5, 0x2a9fb8);
  addBox(g, 0.05, 0.05, 0, 1.05, 0.35, 0.42, 0x57d0e8);
  addBox(g, -0.2, 0, 0, 0.25, 0.55, 0.52, 0x1f8fad);
  addBox(g, 0.25, 0, 0, 0.25, 0.55, 0.52, 0x1f8fad);
  addBox(g, 0.7, 0.02, 0, 0.4, 0.48, 0.45, 0x3ec7e0);
  addBox(g, 0.82, 0.1, 0.2, 0.11, 0.11, 0.07, 0x0a1f28);
  addBox(g, 0.84, 0.12, 0.24, 0.045, 0.045, 0.035, 0xf4fbff);
  addBox(g, -0.05, 0.42, 0, 0.4, 0.22, 0.08, 0x7fd3ff);
  addBox(g, -0.75, 0, 0, 0.3, 0.5, 0.1, 0x0b3d4a);
  addBox(g, -0.95, 0.18, 0, 0.22, 0.25, 0.08, 0x3ec7e0);
  addBox(g, -0.95, -0.18, 0, 0.22, 0.25, 0.08, 0x3ec7e0);
  return g;
}

function makePearlVoxel() {
  const g = new THREE.Group();
  g.name = 'pearl-voxel';
  addBox(g, 0, 0, 0, 1.15, 0.75, 0.6, 0xf4fbff);
  addBox(g, 0.1, -0.08, 0, 0.85, 0.4, 0.48, 0xe8f0f5);
  addBox(g, 0.55, 0.05, 0, 0.42, 0.52, 0.5, 0xffe8b0);
  addBox(g, 0.68, 0.12, 0.22, 0.12, 0.12, 0.08, 0x0a1f28);
  addBox(g, 0.7, 0.14, 0.26, 0.05, 0.05, 0.04, 0xffd166);
  addBox(g, -0.1, 0.48, 0, 0.35, 0.22, 0.08, 0xff7a59);
  addBox(g, -0.05, -0.45, 0.15, 0.28, 0.12, 0.08, 0xff9a6b);
  addBox(g, -0.05, -0.45, -0.15, 0.28, 0.12, 0.08, 0xff9a6b);
  addBox(g, -0.7, 0.05, 0, 0.28, 0.58, 0.1, 0xffd166);
  addBox(g, -0.9, 0.22, 0, 0.2, 0.28, 0.08, 0xff7a59);
  addBox(g, -0.9, -0.15, 0, 0.2, 0.28, 0.08, 0xff7a59);
  return g;
}

async function exportGlb(root, filename) {
  const scene = new THREE.Scene();
  scene.add(root);
  const exporter = new GLTFExporter();
  const ab = await exporter.parseAsync(scene, { binary: true });
  const out = join(outDir, filename);
  writeFileSync(out, Buffer.from(ab));
  console.log('wrote', out, Buffer.from(ab).length, 'bytes');
}

await exportGlb(makeCoralBit(), 'coral-bit.glb');
await exportGlb(makeAquaBlock(), 'aqua-block.glb');
await exportGlb(makePearlVoxel(), 'pearl-voxel.glb');
console.log('done');
