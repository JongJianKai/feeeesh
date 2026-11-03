import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FishDto } from './api.service';
import { glbUrlForSpecies } from './fish-models';

type FishNode = THREE.Object3D & {
  userData: { fishId: string; phase: number; speed: number; base: THREE.Vector3; care: string };
};

/**
 * Inner glass volume — camera stays inside this AABB.
 * v4: much larger swim space (~1.9× prior).
 */
const TANK = {
  minX: -4.4,
  maxX: 4.4,
  minY: -2.35,
  maxY: 2.35,
  minZ: -1.9,
  maxZ: 1.9
};

const MOVE_SPEED = 3.1;
const FISH_SCALE = 0.52; // slightly smaller than v3 (0.72)
const glbCache = new Map<string, THREE.Object3D>();
const gltfLoader = new GLTFLoader();

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function loadGlb(url: string): Promise<THREE.Object3D> {
  const hit = glbCache.get(url);
  if (hit) return Promise.resolve(hit.clone(true));
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      url,
      (gltf) => {
        // Nearest-neighbor on any textures so voxel faces stay crisp.
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const raw of mats) {
            const mat = raw as THREE.MeshStandardMaterial;
            for (const map of [mat.map, mat.emissiveMap, mat.normalMap, mat.roughnessMap].filter(Boolean)) {
              const tex = map as THREE.Texture;
              tex.magFilter = THREE.NearestFilter;
              tex.minFilter = THREE.NearestFilter;
              tex.generateMipmaps = false;
              tex.needsUpdate = true;
            }
            mat.flatShading = true;
            mat.needsUpdate = true;
          }
        });
        glbCache.set(url, gltf.scene);
        resolve(gltf.scene.clone(true));
      },
      undefined,
      reject
    );
  });
}

/** Chunked procedural fish if a glTF fails. */
function makeFallbackFish(colorHex: string, accentHex: string): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.45, 0.35),
    new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.55, flatShading: true })
  );
  const accent = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.35, 0.3),
    new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.55, flatShading: true })
  );
  accent.position.x = 0.4;
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.4, 0.08),
    new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.55, flatShading: true })
  );
  tail.position.x = -0.55;
  g.add(body, accent, tail);
  return g;
}

export class TankScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: PointerLockControls;
  private fishGroup = new THREE.Group();
  private bubbleGroup = new THREE.Group();
  private raf = 0;
  private disposed = false;
  private clock = new THREE.Clock();
  private fill?: THREE.PointLight;
  private keys = new Set<string>();
  private hintEl?: HTMLDivElement;
  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    // WASD only — vertical comes from look pitch + W/S (no Space/Ctrl).
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
      e.preventDefault();
    }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  constructor(private host: HTMLElement) {
    const w = host.clientWidth || 960;
    const h = host.clientHeight || 540;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x0a3a4a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    host.style.position = host.style.position || 'relative';

    this.camera = new THREE.PerspectiveCamera(72, w / h, 0.05, 120);
    // Start near the front glass looking into the tank (fish swim ahead).
    this.camera.position.set(0, 0.15, 1.55);

    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.scene.add(this.controls.object);

    this.renderer.domElement.addEventListener('click', this.requestLock);
    this.controls.addEventListener('lock', this.onLock);
    this.controls.addEventListener('unlock', this.onUnlock);

    // Soft underwater haze only — no lobby photo behind the glass.
    this.scene.fog = new THREE.FogExp2(0x0b3d4a, 0.028);
    this.scene.background = new THREE.Color(0x0a3a4a);
    this.buildTank();
    this.scene.add(this.fishGroup);
    this.scene.add(this.bubbleGroup);
    this.mountHint();
    this.loop();

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private requestLock = () => {
    if (!this.controls.isLocked) this.controls.lock();
  };

  private onLock = () => {
    if (this.hintEl) this.hintEl.style.opacity = '0';
  };

  private onUnlock = () => {
    if (this.hintEl) this.hintEl.style.opacity = '1';
  };

  private mountHint() {
    const el = document.createElement('div');
    el.className = 'fe-tank-hint';
    el.textContent = 'Click tank to look · WASD swim (look up/down to rise/dive) · Esc unlock';
    Object.assign(el.style, {
      position: 'absolute',
      left: '50%',
      bottom: '5.5rem',
      transform: 'translateX(-50%)',
      zIndex: '3',
      padding: '0.45rem 0.9rem',
      borderRadius: '999px',
      background: 'rgba(8, 32, 40, 0.62)',
      border: '1px solid rgba(244, 251, 255, 0.18)',
      color: 'rgba(244, 251, 255, 0.85)',
      font: '600 0.78rem/1.2 Nunito, system-ui, sans-serif',
      pointerEvents: 'none',
      transition: 'opacity 0.25s ease',
      whiteSpace: 'nowrap',
      maxWidth: '92vw',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    } as CSSStyleDeclaration);
    this.host.appendChild(el);
    this.hintEl = el;
  }

  private buildTank() {
    // Clear water shell — solid tank scene only (no lobby BG plane).
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(9.6, 5.4, 4.4),
      new THREE.MeshStandardMaterial({
        color: 0x1a6b8a,
        transparent: true,
        opacity: 0.1,
        roughness: 0.35,
        metalness: 0.05,
        side: THREE.BackSide
      })
    );
    this.scene.add(water);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(9.7, 5.5, 4.5)),
      new THREE.LineBasicMaterial({ color: 0xcfe9f5 })
    );
    this.scene.add(edges);

    // Soft interior back wall (solid aqua — not a photo)
    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(9.4, 5.2),
      new THREE.MeshStandardMaterial({
        color: 0x145a72,
        roughness: 0.85,
        metalness: 0.02,
        emissive: new THREE.Color(0x0a3040),
        emissiveIntensity: 0.35
      })
    );
    backWall.position.set(0, 0, -2.15);
    this.scene.add(backWall);

    // Subtle caustic-like light panels on the back (procedural blocks, not an image)
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x7fd3ff,
      transparent: true,
      opacity: 0.08
    });
    for (let i = 0; i < 5; i++) {
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(0.55 + Math.random() * 0.4, 4.6), glowMat);
      ray.position.set(-3.2 + i * 1.6, 0.2, -2.12);
      ray.rotation.z = (Math.random() - 0.5) * 0.08;
      this.scene.add(ray);
    }

    const sand = new THREE.Mesh(
      new THREE.BoxGeometry(9.2, 0.22, 4.0),
      new THREE.MeshStandardMaterial({ color: 0xcbb896, roughness: 1, flatShading: true })
    );
    sand.position.y = -2.55;
    this.scene.add(sand);

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b7c85, roughness: 0.9, flatShading: true });
    const rocks: Array<[number, number, number, number, number, number]> = [
      [-3.2, -2.15, -0.6, 1.1, 0.7, 0.8],
      [-2.4, -2.25, 0.4, 0.7, 0.45, 0.55],
      [3.0, -2.1, -0.8, 1.0, 0.75, 0.7],
      [2.2, -2.2, 0.55, 0.55, 0.4, 0.5],
      [0.2, -2.3, -1.2, 0.8, 0.35, 0.6]
    ];
    for (const [x, y, z, sx, sy, sz] of rocks) {
      const rock = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), rockMat);
      rock.position.set(x, y, z);
      this.scene.add(rock);
    }

    const plantMat = new THREE.MeshStandardMaterial({ color: 0x3aa76d, flatShading: true });
    const plantSpots = [
      [3.4, -1.4, 0.3],
      [3.6, -1.55, -0.4],
      [-3.5, -1.35, 0.5],
      [-3.7, -1.5, -0.2],
      [1.2, -1.6, -1.0],
      [-1.4, -1.55, -1.1]
    ];
    for (const [x, y, z] of plantSpots) {
      const h = 1.4 + Math.random() * 0.8;
      const plant = new THREE.Mesh(new THREE.BoxGeometry(0.14, h, 0.14), plantMat);
      plant.position.set(x, y, z);
      this.scene.add(plant);
    }

    const coralMat = new THREE.MeshStandardMaterial({ color: 0xff7a59, roughness: 0.7, flatShading: true });
    const coralMat2 = new THREE.MeshStandardMaterial({ color: 0xff9a6b, roughness: 0.7, flatShading: true });
    const corals: Array<[number, number, number, THREE.Material]> = [
      [1.8, -2.05, -0.9, coralMat],
      [2.1, -1.95, -0.7, coralMat2],
      [-1.9, -2.05, -0.85, coralMat2],
      [-0.6, -2.1, -1.3, coralMat]
    ];
    for (const [x, y, z, mat] of corals) {
      const coral = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.4), mat);
      coral.position.set(x, y, z);
      this.scene.add(coral);
    }

    const key = new THREE.DirectionalLight(0xffffff, 1.25);
    key.position.set(3, 6, 4);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0x88aacc, 0.7));

    this.fill = new THREE.PointLight(0x7fd3ff, 0.65, 22);
    this.fill.position.set(0, 1.8, 2.2);
    this.scene.add(this.fill);

    const top = new THREE.PointLight(0xd8f4ff, 0.35, 18);
    top.position.set(0, 2.4, 0);
    this.scene.add(top);

    const bubMat = new THREE.MeshBasicMaterial({ color: 0xd8f4ff, transparent: true, opacity: 0.55 });
    for (let i = 0; i < 40; i++) {
      const s = 0.035 + Math.random() * 0.055;
      const b = new THREE.Mesh(new THREE.SphereGeometry(s, 6, 6), bubMat);
      b.position.set((Math.random() - 0.5) * 8.0, -2.2 + Math.random() * 4.2, (Math.random() - 0.5) * 3.2);
      b.userData = { speed: 0.18 + Math.random() * 0.3, phase: Math.random() * Math.PI * 2 };
      this.bubbleGroup.add(b);
    }
  }

  async setFish(fish: FishDto[]) {
    while (this.fishGroup.children.length) {
      const child = this.fishGroup.children.pop()!;
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          const mat = m.material;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat?.dispose();
        }
      });
    }

    const inTank = fish.filter((x) => x.inTank);
    await Promise.all(
      inTank.map(async (f) => {
        let root: THREE.Object3D;
        try {
          root = await loadGlb(glbUrlForSpecies(f.speciesId));
        } catch {
          root = makeFallbackFish(f.colorHex, f.accentHex);
        }

        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const mats = (Array.isArray(m.material) ? m.material : [m.material]).filter(Boolean);
          for (const raw of mats) {
            const mat = raw as THREE.MeshStandardMaterial;
            if ('color' in mat && mat.color) {
              mat.emissive = mat.color.clone().multiplyScalar(0.1);
              mat.emissiveIntensity = 0.45;
              mat.roughness = 0.55;
              mat.metalness = 0.04;
              mat.flatShading = true;
            }
            if ('opacity' in mat) {
              mat.transparent = f.care !== 'Healthy';
              mat.opacity = f.care === 'Healthy' ? 1 : f.care === 'NeedsCare' ? 0.82 : 0.55;
              mat.needsUpdate = true;
            }
          }
        });

        const scale = FISH_SCALE * f.size * (f.care === 'Down' ? 0.85 : 1);
        root.scale.setScalar(scale);
        // Spread across the larger tank volume
        const px = f.posX * 1.55;
        const py = f.care === 'Down' ? -2.15 : f.posY * 1.15 + 0.05;
        const pz = Math.max(-1.5, f.posZ * 0.95);
        root.position.set(px, py, pz);

        (root as FishNode).userData = {
          fishId: f.id,
          phase: Math.random() * Math.PI * 2,
          speed: 0.32 + Math.random() * 0.45,
          base: root.position.clone(),
          care: f.care
        };
        if (f.care === 'Down') root.rotation.z = -0.35;
        this.fishGroup.add(root);
      })
    );
  }

  private clampCamera() {
    const p = this.camera.position;
    p.x = Math.min(TANK.maxX, Math.max(TANK.minX, p.x));
    p.y = Math.min(TANK.maxY, Math.max(TANK.minY, p.y));
    p.z = Math.min(TANK.maxZ, Math.max(TANK.minZ, p.z));
  }

  private updateMovement(dt: number) {
    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const strafe = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));

    if (!this.controls.isLocked && !forward && !strafe) {
      this.clampCamera();
      return;
    }

    const speed = MOVE_SPEED * dt;

    // W/S move along camera look direction (pitch included → look up + W = swim up).
    if (forward !== 0) {
      this.camera.getWorldDirection(_fwd);
      this.camera.position.addScaledVector(_fwd, forward * speed);
    }

    // A/D strafe on the horizontal plane only.
    if (strafe !== 0) {
      this.camera.getWorldDirection(_fwd);
      _right.crossVectors(_fwd, _up).normalize();
      // Prefer PointerLockControls' right axis when available for consistency.
      if (_right.lengthSq() < 1e-6) {
        _right.setFromMatrixColumn(this.camera.matrix, 0);
      }
      this.camera.position.addScaledVector(_right, strafe * speed);
    }

    this.clampCamera();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    if (this.fill) this.fill.intensity = 0.55 + Math.sin(t * 1.4) * 0.12;

    this.updateMovement(dt);

    for (const child of this.bubbleGroup.children) {
      const b = child as THREE.Mesh;
      const { speed, phase } = b.userData as { speed: number; phase: number };
      b.position.y += speed * dt;
      b.position.x += Math.sin(t * 0.8 + phase) * 0.002;
      if (b.position.y > 2.4) b.position.y = -2.35;
    }

    for (const child of this.fishGroup.children) {
      const node = child as FishNode;
      if (node.userData.care === 'Down') continue;
      const { phase, speed, base } = node.userData;
      const amp = node.userData.care === 'NeedsCare' ? 0.28 : 0.55;
      node.position.x = base.x + Math.sin(t * speed + phase) * amp;
      node.position.y = base.y + Math.sin(t * speed * 1.3 + phase) * 0.18;
      node.position.z = base.z + Math.cos(t * speed * 0.7 + phase) * 0.14;
      const dx = Math.cos(t * speed + phase);
      node.rotation.y = dx > 0 ? 0 : Math.PI;
      node.rotation.z = Math.sin(t * speed * 2 + phase) * 0.08;
    }

    this.renderer.render(this.scene, this.camera);
  };

  private onResize = () => {
    const w = this.host.clientWidth || 960;
    const h = this.host.clientHeight || 540;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  resize() {
    this.onResize();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.removeEventListener('click', this.requestLock);
    this.controls.removeEventListener('lock', this.onLock);
    this.controls.removeEventListener('unlock', this.onUnlock);
    if (this.controls.isLocked) this.controls.unlock();
    this.controls.dispose();
    this.hintEl?.remove();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
