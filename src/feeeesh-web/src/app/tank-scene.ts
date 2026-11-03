import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FishDto } from './api.service';
import { glbUrlForSpecies } from './fish-models';

type FishNode = THREE.Object3D & {
  userData: {
    fishId: string;
    phase: number;
    speed: number;
    base: THREE.Vector3;
    care: string;
    rarity: string;
    flashUntil: number;
  };
};

/**
 * Inner glass volume — camera stays inside this AABB.
 * v5: same large swim space as v4, richer lighting / particles / decor.
 */
const TANK = {
  minX: -4.4,
  maxX: 4.4,
  minY: -2.35,
  maxY: 2.35,
  minZ: -1.9,
  maxZ: 1.9
};

const MOVE_SPEED = 3.2;
const FISH_SCALE = 0.52;
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

function makeBubbleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(28, 26, 4, 32, 32, 28);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.35, 'rgba(200,240,255,0.55)');
  grd.addColorStop(0.75, 'rgba(140,210,235,0.18)');
  grd.addColorStop(1, 'rgba(140,210,235,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(32, 32, 28, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.beginPath();
  g.ellipse(22, 20, 8, 5, -0.5, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function makeCausticTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 48; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 8 + Math.random() * 28;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(180,240,255,0.55)');
    grd.addColorStop(1, 'rgba(180,240,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.2, 1.4);
  return tex;
}

export class TankScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: PointerLockControls;
  private fishGroup = new THREE.Group();
  private bubbleGroup = new THREE.Group();
  private sparkGroup = new THREE.Group();
  private decorGroup = new THREE.Group();
  private raf = 0;
  private disposed = false;
  private clock = new THREE.Clock();
  private fill?: THREE.PointLight;
  private caustic?: THREE.Mesh;
  private causticTex?: THREE.CanvasTexture;
  private keys = new Set<string>();
  private hintEl?: HTMLDivElement;
  private bubbleTex = makeBubbleTexture();
  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
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
    this.renderer.setClearColor(0x0a3d4e, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    host.appendChild(this.renderer.domElement);
    host.style.position = host.style.position || 'relative';

    this.camera = new THREE.PerspectiveCamera(68, w / h, 0.05, 120);
    // Frame mid-tank: fish + decor + bubbles visible without pointer-lock first.
    this.camera.position.set(0, -0.35, 1.35);
    this.camera.lookAt(0, -0.55, -0.6);

    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.scene.add(this.controls.object);

    this.renderer.domElement.addEventListener('click', this.requestLock);
    this.controls.addEventListener('lock', this.onLock);
    this.controls.addEventListener('unlock', this.onUnlock);

    this.scene.fog = new THREE.FogExp2(0x0a3d4e, 0.022);
    this.scene.background = new THREE.Color(0x0a3d4e);
    this.buildTank();
    this.scene.add(this.decorGroup);
    this.scene.add(this.fishGroup);
    this.scene.add(this.bubbleGroup);
    this.scene.add(this.sparkGroup);
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
      padding: '0.5rem 1rem',
      borderRadius: '999px',
      background: 'rgba(8, 32, 40, 0.68)',
      border: '1px solid rgba(244, 251, 255, 0.2)',
      color: 'rgba(244, 251, 255, 0.9)',
      font: '700 0.8rem/1.2 Fredoka, Nunito, system-ui, sans-serif',
      pointerEvents: 'none',
      transition: 'opacity 0.25s ease',
      whiteSpace: 'nowrap',
      maxWidth: '92vw',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      letterSpacing: '0.01em',
      boxShadow: '2px 2px 0 rgba(10, 31, 40, 0.45)'
    } as CSSStyleDeclaration);
    this.host.appendChild(el);
    this.hintEl = el;
  }

  private addVoxelPlant(x: number, z: number, h: number, hue: number) {
    const stem = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, h, 0.1),
      new THREE.MeshStandardMaterial({ color: hue, flatShading: true, roughness: 0.7 })
    );
    stem.position.set(x, -2.55 + h / 2, z);
    this.decorGroup.add(stem);
    for (let i = 0; i < 3; i++) {
      const leaf = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.1, 0.06),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(hue).offsetHSL(0, 0, 0.08 + i * 0.04),
          flatShading: true,
          roughness: 0.65
        })
      );
      leaf.position.set(x + (i % 2 ? 0.12 : -0.12), -2.55 + h * (0.35 + i * 0.2), z);
      leaf.rotation.z = (i % 2 ? 1 : -1) * (0.35 + i * 0.1);
      this.decorGroup.add(leaf);
    }
  }

  private addCoralCluster(x: number, z: number, baseColor: number) {
    const mats = [
      new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.65, flatShading: true, emissive: baseColor, emissiveIntensity: 0.08 }),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(baseColor).offsetHSL(0.02, 0, 0.12),
        roughness: 0.65,
        flatShading: true
      })
    ];
    const sizes: Array<[number, number, number, number, number, number]> = [
      [0, 0.35, 0, 0.38, 0.7, 0.38],
      [0.22, 0.55, 0.05, 0.18, 0.55, 0.18],
      [-0.2, 0.48, -0.08, 0.16, 0.48, 0.16],
      [0.08, 0.72, -0.12, 0.14, 0.35, 0.14]
    ];
    for (let i = 0; i < sizes.length; i++) {
      const [ox, oy, oz, sx, sy, sz] = sizes[i];
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mats[i % mats.length]);
      m.position.set(x + ox, -2.55 + oy, z + oz);
      this.decorGroup.add(m);
    }
  }

  private buildTank() {
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(9.6, 5.4, 4.4),
      new THREE.MeshStandardMaterial({
        color: 0x1a6b8a,
        transparent: true,
        opacity: 0.08,
        roughness: 0.25,
        metalness: 0.08,
        side: THREE.BackSide
      })
    );
    this.scene.add(water);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(9.7, 5.5, 4.5)),
      new THREE.LineBasicMaterial({ color: 0xd8f4ff, transparent: true, opacity: 0.65 })
    );
    this.scene.add(edges);

    // Solid aqua back wall — never the lobby photo.
    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(9.4, 5.2),
      new THREE.MeshStandardMaterial({
        color: 0x156a82,
        roughness: 0.92,
        metalness: 0.02,
        emissive: new THREE.Color(0x0c4558),
        emissiveIntensity: 0.55
      })
    );
    backWall.position.set(0, 0, -2.15);
    this.scene.add(backWall);

    // Soft god-ray wash
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xb8ecff,
      transparent: true,
      opacity: 0.055,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    for (let i = 0; i < 5; i++) {
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(1.35 + (i % 2) * 0.4, 5.0), glowMat);
      ray.position.set(-3.2 + i * 1.55, 0.45, -2.08);
      ray.rotation.z = -0.08 + i * 0.035;
      this.scene.add(ray);
    }

    // Sand with subtle banding
    const sand = new THREE.Mesh(
      new THREE.BoxGeometry(9.2, 0.22, 4.0),
      new THREE.MeshStandardMaterial({ color: 0xd2be96, roughness: 1, flatShading: true })
    );
    sand.position.y = -2.55;
    this.scene.add(sand);

    const sandRipple = new THREE.Mesh(
      new THREE.BoxGeometry(8.6, 0.04, 3.4),
      new THREE.MeshStandardMaterial({ color: 0xc0aa7e, roughness: 1, flatShading: true })
    );
    sandRipple.position.set(0, -2.42, 0.15);
    this.scene.add(sandRipple);

    // Caustic light plane on the sand
    this.causticTex = makeCausticTexture();
    this.caustic = new THREE.Mesh(
      new THREE.PlaneGeometry(8.8, 3.6),
      new THREE.MeshBasicMaterial({
        map: this.causticTex,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    this.caustic.rotation.x = -Math.PI / 2;
    this.caustic.position.set(0, -2.38, 0);
    this.scene.add(this.caustic);

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b7c85, roughness: 0.9, flatShading: true });
    const rockMat2 = new THREE.MeshStandardMaterial({ color: 0x556670, roughness: 0.92, flatShading: true });
    const rocks: Array<[number, number, number, number, number, number, THREE.Material]> = [
      [-3.2, -2.15, -0.6, 1.1, 0.7, 0.8, rockMat],
      [-2.4, -2.25, 0.4, 0.7, 0.45, 0.55, rockMat2],
      [3.0, -2.1, -0.8, 1.0, 0.75, 0.7, rockMat],
      [2.2, -2.2, 0.55, 0.55, 0.4, 0.5, rockMat2],
      [0.2, -2.3, -1.2, 0.8, 0.35, 0.6, rockMat],
      [-0.8, -2.28, 0.9, 0.5, 0.32, 0.42, rockMat2],
      [1.4, -2.32, 1.0, 0.45, 0.28, 0.38, rockMat]
    ];
    for (const [x, y, z, sx, sy, sz, mat] of rocks) {
      const rock = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      rock.position.set(x, y, z);
      this.decorGroup.add(rock);
    }

    this.addVoxelPlant(3.4, 0.3, 1.7, 0x3aa76d);
    this.addVoxelPlant(3.65, -0.35, 1.35, 0x2f8f5c);
    this.addVoxelPlant(-3.5, 0.45, 1.8, 0x48b87a);
    this.addVoxelPlant(-3.75, -0.25, 1.4, 0x2f8f5c);
    this.addVoxelPlant(1.15, -1.05, 1.15, 0x3aa76d);
    this.addVoxelPlant(-1.35, -1.15, 1.25, 0x2f9a68);
    this.addVoxelPlant(0.4, 1.15, 0.95, 0x48b87a);

    this.addCoralCluster(1.85, -0.85, 0xff7a59);
    this.addCoralCluster(2.25, -0.55, 0xff9a6b);
    this.addCoralCluster(-1.95, -0.8, 0xff8a70);
    this.addCoralCluster(-0.55, -1.25, 0xff6b4a);
    this.addCoralCluster(0.9, 0.75, 0xffb08a);

    const key = new THREE.DirectionalLight(0xfff6e8, 1.35);
    key.position.set(3.5, 6.5, 4.5);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0x9ec4dd, 0.78));

    this.fill = new THREE.PointLight(0x7fd3ff, 1.2, 36);
    this.fill.position.set(0, 1.9, 2.0);
    this.scene.add(this.fill);

    const top = new THREE.PointLight(0xe8f8ff, 0.85, 30);
    top.position.set(0, 2.5, 0.2);
    this.scene.add(top);

    const rim = new THREE.DirectionalLight(0xa8e4ff, 0.7);
    rim.position.set(-4.5, 2.2, -2.5);
    this.scene.add(rim);

    const warm = new THREE.PointLight(0xffb08a, 0.35, 18);
    warm.position.set(2.5, -1.2, 0.5);
    this.scene.add(warm);

    const bubMat = new THREE.SpriteMaterial({
      map: this.bubbleTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.85
    });
    for (let i = 0; i < 56; i++) {
      const b = new THREE.Sprite(bubMat.clone());
      const s = 0.06 + Math.random() * 0.14;
      b.scale.set(s, s, 1);
      b.position.set((Math.random() - 0.5) * 8.2, -2.2 + Math.random() * 4.4, (Math.random() - 0.5) * 3.4);
      b.userData = {
        speed: 0.2 + Math.random() * 0.38,
        phase: Math.random() * Math.PI * 2,
        wobble: 0.35 + Math.random() * 0.8
      };
      this.bubbleGroup.add(b);
    }
  }

  /** Brief rarity flash on a newly summoned fish id (if present). */
  flashFish(fishId: string, rarity: string) {
    const node = this.fishGroup.children.find((c) => (c as FishNode).userData.fishId === fishId) as FishNode | undefined;
    if (!node) return;
    node.userData.flashUntil = this.clock.elapsedTime + 1.8;
    node.userData.rarity = rarity;
    this.burstSparks(node.position.clone(), rarity);
  }

  private burstSparks(at: THREE.Vector3, rarity: string) {
    const r = rarity.toLowerCase();
    const color =
      r.includes('legend') ? 0xffd166 : r.includes('rare') ? 0x7fd3ff : r.includes('uncommon') ? 0x3ecf8e : 0xf4fbff;
    const count = r.includes('legend') ? 22 : r.includes('rare') ? 14 : 8;
    const mat = new THREE.SpriteMaterial({
      map: this.bubbleTex,
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(mat.clone());
      const size = 0.08 + Math.random() * 0.12;
      s.scale.set(size, size, 1);
      s.position.copy(at);
      s.userData = {
        vx: (Math.random() - 0.5) * 1.4,
        vy: 0.4 + Math.random() * 1.2,
        vz: (Math.random() - 0.5) * 1.4,
        life: 0.9 + Math.random() * 0.5
      };
      this.sparkGroup.add(s);
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
              mat.emissive = mat.color.clone().multiplyScalar(0.12);
              mat.emissiveIntensity = 0.5;
              mat.roughness = 0.5;
              mat.metalness = 0.05;
              mat.flatShading = true;
            }
            if ('opacity' in mat) {
              mat.transparent = f.care !== 'Healthy';
              mat.opacity = f.care === 'Healthy' ? 1 : f.care === 'NeedsCare' ? 0.82 : 0.55;
              mat.needsUpdate = true;
            }
          }
        });

        const rarityBoost = /legend/i.test(f.rarity) ? 1.12 : /rare/i.test(f.rarity) ? 1.06 : 1;
        const scale = FISH_SCALE * f.size * rarityBoost * (f.care === 'Down' ? 0.85 : 1);
        root.scale.setScalar(scale);
        const px = f.posX * 1.35;
        const py = f.care === 'Down' ? -2.15 : f.posY * 0.85 - 0.15;
        const pz = Math.min(-0.15, Math.max(-1.35, f.posZ * 0.75 - 0.2));
        root.position.set(px, py, pz);

        (root as FishNode).userData = {
          fishId: f.id,
          phase: Math.random() * Math.PI * 2,
          speed: 0.32 + Math.random() * 0.45,
          base: root.position.clone(),
          care: f.care,
          rarity: f.rarity,
          flashUntil: 0
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

    if (forward !== 0) {
      this.camera.getWorldDirection(_fwd);
      this.camera.position.addScaledVector(_fwd, forward * speed);
    }

    if (strafe !== 0) {
      this.camera.getWorldDirection(_fwd);
      _right.crossVectors(_fwd, _up).normalize();
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
    if (this.fill) this.fill.intensity = 1.05 + Math.sin(t * 1.35) * 0.18;

    if (this.caustic && this.causticTex) {
      this.causticTex.offset.x = Math.sin(t * 0.12) * 0.08;
      this.causticTex.offset.y = t * 0.035;
      (this.caustic.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(t * 0.9) * 0.06;
    }

    this.updateMovement(dt);

    for (const child of this.bubbleGroup.children) {
      const b = child as THREE.Sprite;
      const { speed, phase, wobble } = b.userData as { speed: number; phase: number; wobble: number };
      b.position.y += speed * dt;
      b.position.x += Math.sin(t * wobble + phase) * 0.004;
      if (b.position.y > 2.45) b.position.y = -2.4;
    }

    for (let i = this.sparkGroup.children.length - 1; i >= 0; i--) {
      const s = this.sparkGroup.children[i] as THREE.Sprite;
      const u = s.userData as { vx: number; vy: number; vz: number; life: number };
      u.life -= dt;
      if (u.life <= 0) {
        this.sparkGroup.remove(s);
        (s.material as THREE.SpriteMaterial).dispose();
        continue;
      }
      s.position.x += u.vx * dt;
      s.position.y += u.vy * dt;
      s.position.z += u.vz * dt;
      u.vy -= 0.35 * dt;
      const mat = s.material as THREE.SpriteMaterial;
      mat.opacity = Math.max(0, u.life);
    }

    for (const child of this.fishGroup.children) {
      const node = child as FishNode;
      if (node.userData.care === 'Down') continue;
      const { phase, speed, base, flashUntil } = node.userData;
      const amp = node.userData.care === 'NeedsCare' ? 0.28 : 0.55;
      node.position.x = base.x + Math.sin(t * speed + phase) * amp;
      node.position.y = base.y + Math.sin(t * speed * 1.3 + phase) * 0.18;
      node.position.z = base.z + Math.cos(t * speed * 0.7 + phase) * 0.14;
      const dx = Math.cos(t * speed + phase);
      node.rotation.y = dx > 0 ? 0 : Math.PI;
      node.rotation.z = Math.sin(t * speed * 2 + phase) * 0.08;

      if (flashUntil > t) {
        const pulse = 0.55 + Math.sin(t * 14) * 0.45;
        node.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const raw of mats) {
            const mat = raw as THREE.MeshStandardMaterial;
            if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 0.5 + pulse * 1.4;
          }
        });
      }
    }

    // Gentle idle sway of taller plants
    for (const child of this.decorGroup.children) {
      if ((child as THREE.Mesh).geometry instanceof THREE.BoxGeometry) {
        const g = (child as THREE.Mesh).geometry as THREE.BoxGeometry;
        const p = g.parameters;
        if (p.height > 1.0 && p.width < 0.2) {
          child.rotation.z = Math.sin(t * 0.9 + child.position.x) * 0.06;
        }
      }
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
    this.bubbleTex.dispose();
    this.causticTex?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
