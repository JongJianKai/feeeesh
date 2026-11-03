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
 * Soft swim bounds — large open arena, not a glass aquarium.
 * Soft edges fade into bright water fog instead of walls.
 */
const TANK = {
  minX: -18,
  maxX: 18,
  minY: -4.2,
  maxY: 5.5,
  minZ: -16,
  maxZ: 14
};

const MOVE_SPEED = 5.4;
const FISH_SCALE = 0.48;
const WATER = 0x5ec8e8;
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
    new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45, flatShading: true })
  );
  const accent = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.35, 0.3),
    new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.45, flatShading: true })
  );
  accent.position.x = 0.4;
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.4, 0.08),
    new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.45, flatShading: true })
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
  grd.addColorStop(0, 'rgba(255,255,255,0.98)');
  grd.addColorStop(0.35, 'rgba(220,248,255,0.65)');
  grd.addColorStop(0.75, 'rgba(170,230,250,0.2)');
  grd.addColorStop(1, 'rgba(170,230,250,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(32, 32, 28, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.85)';
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
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 12 + Math.random() * 48;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.7)');
    grd.addColorStop(0.45, 'rgba(200,245,255,0.35)');
    grd.addColorStop(1, 'rgba(180,240,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // Soft intersecting ribbons
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 18; i++) {
    const y0 = Math.random() * 512;
    g.strokeStyle = `rgba(210,245,255,${0.08 + Math.random() * 0.12})`;
    g.lineWidth = 6 + Math.random() * 14;
    g.beginPath();
    g.moveTo(0, y0);
    for (let x = 0; x <= 512; x += 64) {
      g.quadraticCurveTo(x + 32, y0 + Math.sin(x * 0.02 + i) * 40, x + 64, y0 + Math.sin((x + 64) * 0.02 + i) * 28);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3.4, 3.0);
  return tex;
}

/** Soft distant haze dome — open world, no glass edges. */
function makeHorizonTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#c8f2ff');
  grd.addColorStop(0.35, '#7ed4f0');
  grd.addColorStop(0.7, '#3fb0d4');
  grd.addColorStop(1, '#1f88ae');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function makeMoteTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 14);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.4, 'rgba(255,240,180,0.55)');
  grd.addColorStop(1, 'rgba(255,240,180,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(16, 16, 14, 0, Math.PI * 2);
  g.fill();
  return new THREE.CanvasTexture(c);
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
  private moteGroup = new THREE.Group();
  private godRayGroup = new THREE.Group();
  private raf = 0;
  private disposed = false;
  private clock = new THREE.Clock();
  private fill?: THREE.PointLight;
  private sun?: THREE.DirectionalLight;
  private caustic?: THREE.Mesh;
  private caustic2?: THREE.Mesh;
  private causticTex?: THREE.CanvasTexture;
  private keys = new Set<string>();
  private hintEl?: HTMLDivElement;
  private bubbleTex = makeBubbleTexture();
  private moteTex = makeMoteTexture();
  private horizonTex = makeHorizonTexture();
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
    this.renderer.setClearColor(WATER, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.42;
    host.appendChild(this.renderer.domElement);
    host.style.position = host.style.position || 'relative';

    this.camera = new THREE.PerspectiveCamera(74, w / h, 0.08, 260);
    // Start elevated, looking out across open reef — no near walls in frame
    this.camera.position.set(-1.2, 1.6, 9.5);
    this.camera.lookAt(2.5, -1.2, -6);

    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.scene.add(this.controls.object);

    this.renderer.domElement.addEventListener('click', this.requestLock);
    this.controls.addEventListener('lock', this.onLock);
    this.controls.addEventListener('unlock', this.onUnlock);

    this.scene.fog = new THREE.FogExp2(WATER, 0.0095);
    this.scene.background = new THREE.Color(WATER);
    this.buildArena();
    this.scene.add(this.decorGroup);
    this.scene.add(this.fishGroup);
    this.scene.add(this.bubbleGroup);
    this.scene.add(this.sparkGroup);
    this.scene.add(this.moteGroup);
    this.scene.add(this.godRayGroup);
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
    el.textContent = 'Click to look · WASD swim (look up/down to rise/dive) · Esc unlock';
    Object.assign(el.style, {
      position: 'absolute',
      left: '50%',
      bottom: '5.75rem',
      transform: 'translateX(-50%)',
      zIndex: '3',
      padding: '0.5rem 1rem',
      borderRadius: '999px',
      background: 'rgba(8, 40, 52, 0.55)',
      border: '1px solid rgba(244, 251, 255, 0.22)',
      color: 'rgba(244, 251, 255, 0.92)',
      font: '700 0.8rem/1.2 Fredoka, Nunito, system-ui, sans-serif',
      pointerEvents: 'none',
      transition: 'opacity 0.25s ease',
      whiteSpace: 'nowrap',
      maxWidth: '92vw',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      letterSpacing: '0.01em',
      boxShadow: '2px 2px 0 rgba(10, 31, 40, 0.4)'
    } as CSSStyleDeclaration);
    this.host.appendChild(el);
    this.hintEl = el;
  }

  private addVoxelPlant(x: number, z: number, h: number, hue: number) {
    const stem = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, h, 0.12),
      new THREE.MeshStandardMaterial({
        color: hue,
        flatShading: true,
        roughness: 0.55,
        emissive: new THREE.Color(hue).multiplyScalar(0.15),
        emissiveIntensity: 0.35
      })
    );
    stem.position.set(x, -4.55 + h / 2, z);
    this.decorGroup.add(stem);
    for (let i = 0; i < 4; i++) {
      const leaf = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.12, 0.07),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(hue).offsetHSL(0, 0.05, 0.1 + i * 0.04),
          flatShading: true,
          roughness: 0.5,
          emissive: new THREE.Color(hue).multiplyScalar(0.1),
          emissiveIntensity: 0.25
        })
      );
      leaf.position.set(x + (i % 2 ? 0.14 : -0.14), -4.55 + h * (0.28 + i * 0.18), z);
      leaf.rotation.z = (i % 2 ? 1 : -1) * (0.35 + i * 0.1);
      this.decorGroup.add(leaf);
    }
  }

  private addCoralCluster(x: number, z: number, baseColor: number, scale = 1) {
    const mats = [
      new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.5,
        flatShading: true,
        emissive: baseColor,
        emissiveIntensity: 0.22
      }),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(baseColor).offsetHSL(0.02, 0.05, 0.14),
        roughness: 0.5,
        flatShading: true,
        emissive: new THREE.Color(baseColor).offsetHSL(0.02, 0, 0.1),
        emissiveIntensity: 0.12
      })
    ];
    const sizes: Array<[number, number, number, number, number, number]> = [
      [0, 0.42, 0, 0.42, 0.84, 0.42],
      [0.26, 0.62, 0.06, 0.2, 0.62, 0.2],
      [-0.24, 0.55, -0.1, 0.18, 0.55, 0.18],
      [0.1, 0.82, -0.14, 0.16, 0.4, 0.16],
      [0.05, 0.28, 0.22, 0.22, 0.35, 0.22]
    ];
    for (let i = 0; i < sizes.length; i++) {
      const [ox, oy, oz, sx, sy, sz] = sizes[i];
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx * scale, sy * scale, sz * scale), mats[i % mats.length]);
      m.position.set(x + ox * scale, -4.55 + oy * scale, z + oz * scale);
      this.decorGroup.add(m);
    }
  }

  private addRock(x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material) {
    const rock = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    rock.position.set(x, y, z);
    rock.rotation.y = (x * 0.3 + z * 0.17) % Math.PI;
    this.decorGroup.add(rock);
  }

  private buildArena() {
    // Distant horizon dome — open world fade, never a glass box
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(110, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.58),
      new THREE.MeshBasicMaterial({
        map: this.horizonTex,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false
      })
    );
    sky.position.y = -12;
    this.scene.add(sky);

    // Rolling sand bed — large open floor (warm, not chalk white)
    const sandMat = new THREE.MeshStandardMaterial({
      color: 0xc9a86e,
      roughness: 0.92,
      flatShading: true,
      emissive: new THREE.Color(0x8a6a3a),
      emissiveIntensity: 0.12
    });
    const sand = new THREE.Mesh(new THREE.BoxGeometry(56, 0.4, 48), sandMat);
    sand.position.set(0, -4.75, -2);
    this.scene.add(sand);

    // Soft seabed mounds — low profile so they read as terrain, not walls
    const duneMat = new THREE.MeshStandardMaterial({
      color: 0xb8955c,
      roughness: 0.95,
      flatShading: true,
      emissive: new THREE.Color(0x6e5228),
      emissiveIntensity: 0.06
    });
    const dunes: Array<[number, number, number, number, number, number]> = [
      [-12, -4.55, -7, 10, 0.28, 7],
      [14, -4.58, -9, 11, 0.24, 8],
      [-7, -4.6, 5, 7, 0.2, 6],
      [9, -4.58, 6, 8, 0.22, 6.5],
      [1, -4.62, -14, 16, 0.18, 6],
      [-16, -4.56, 3, 6, 0.26, 5],
      [16, -4.57, 4, 6, 0.24, 5]
    ];
    for (const [x, y, z, sx, sy, sz] of dunes) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), duneMat);
      d.position.set(x, y, z);
      this.scene.add(d);
    }

    // Bright caustics across the open bed
    this.causticTex = makeCausticTexture();
    this.caustic = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 38),
      new THREE.MeshBasicMaterial({
        map: this.causticTex,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    this.caustic.rotation.x = -Math.PI / 2;
    this.caustic.position.set(0, -4.4, -1);
    this.scene.add(this.caustic);

    // Second drifting caustic layer
    const caustic2 = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 34),
      new THREE.MeshBasicMaterial({
        map: this.causticTex,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    caustic2.rotation.x = -Math.PI / 2;
    caustic2.rotation.z = 0.4;
    caustic2.position.set(2, -4.35, 1);
    this.scene.add(caustic2);
    this.caustic2 = caustic2;

    // Soft god rays — angled, distant, never read as tank walls
    const rayMat = new THREE.MeshBasicMaterial({
      color: 0xf2fcff,
      transparent: true,
      opacity: 0.055,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    for (let i = 0; i < 7; i++) {
      const w = 2.2 + (i % 3) * 0.7;
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(w, 18), rayMat.clone());
      ray.position.set(-16 + i * 5.2, 2.4, -8 + (i % 3) * 2.5);
      ray.rotation.z = -0.18 + i * 0.035;
      ray.rotation.y = 0.35 + i * 0.04;
      ray.userData['phase'] = i * 0.85;
      this.godRayGroup.add(ray);
    }

    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x7a8e98,
      roughness: 0.85,
      flatShading: true,
      emissive: 0x2a3a44,
      emissiveIntensity: 0.15
    });
    const rockMat2 = new THREE.MeshStandardMaterial({
      color: 0x627480,
      roughness: 0.88,
      flatShading: true
    });
    const rocks: Array<[number, number, number, number, number, number, THREE.Material]> = [
      [-8.5, -3.9, -4, 2.4, 1.4, 1.8, rockMat],
      [-6.2, -4.1, -2.2, 1.4, 0.9, 1.2, rockMat2],
      [9.5, -3.85, -5.5, 2.2, 1.5, 1.6, rockMat],
      [7.2, -4.05, -3, 1.2, 0.85, 1.1, rockMat2],
      [1.5, -4.15, -9, 1.8, 0.7, 1.4, rockMat],
      [-12, -3.95, 1, 1.6, 1.2, 1.3, rockMat2],
      [13, -4.0, 2, 1.5, 1.1, 1.2, rockMat],
      [-3, -4.2, 6, 1.3, 0.65, 1.1, rockMat2],
      [4.5, -4.15, 7.5, 1.1, 0.7, 0.95, rockMat],
      [-15, -4.0, -6, 1.8, 1.0, 1.4, rockMat],
      [0.5, -4.25, -1.5, 0.9, 0.45, 0.7, rockMat2]
    ];
    for (const [x, y, z, sx, sy, sz, mat] of rocks) {
      this.addRock(x, y, z, sx, sy, sz, mat);
    }

    // Reef belts — spread wide for open-arena silhouette
    const plantSpots: Array<[number, number, number, number]> = [
      [10.5, -3.2, 2.2, 0x3ecf8e],
      [11.2, -4.5, 1.7, 0x2faf6a],
      [9.8, -2.8, 1.9, 0x48d898],
      [-10.8, -2.5, 2.3, 0x3ecf8e],
      [-11.5, -4.0, 1.85, 0x2faf6a],
      [-9.5, 3.2, 1.6, 0x48d898],
      [3.5, -8, 1.4, 0x3ecf8e],
      [-4.2, -7.5, 1.55, 0x2faf6a],
      [6.5, 5.5, 1.35, 0x48d898],
      [-6.8, 6.2, 1.45, 0x3ecf8e],
      [14, 0.5, 1.9, 0x2faf6a],
      [-14.5, -1, 2.0, 0x48d898],
      [1.2, 8.5, 1.25, 0x3ecf8e],
      [-2.5, -10, 1.5, 0x2faf6a],
      [8, -9, 1.7, 0x48d898]
    ];
    for (const [x, z, h, hue] of plantSpots) {
      this.addVoxelPlant(x, z, h, hue);
    }

    const corals: Array<[number, number, number, number?]> = [
      [5.5, -5.5, 0xff7a59, 1.15],
      [6.8, -4.2, 0xff9a6b, 0.9],
      [-5.8, -5.2, 0xff8a70, 1.1],
      [-7.2, -3.8, 0xff6b4a, 0.85],
      [2.2, 4.5, 0xffb08a, 1],
      [-2.8, 5.2, 0xff7a59, 0.95],
      [11, 3, 0xff9a6b, 1.05],
      [-11.5, 4, 0xff8a70, 1.1],
      [0.5, -11, 0xff6b4a, 1.2],
      [8.5, 7, 0xffb08a, 0.8],
      [-8, -8.5, 0xff7a59, 0.9],
      [14.5, -3, 0xff9a6b, 1]
    ];
    for (const [x, z, color, scale] of corals) {
      this.addCoralCluster(x, z, color, scale ?? 1);
    }

    // Bright open-water lighting
    this.sun = new THREE.DirectionalLight(0xfff8ee, 2.05);
    this.sun.position.set(8, 22, 12);
    this.scene.add(this.sun);

    this.scene.add(new THREE.AmbientLight(0xb8e4f5, 1.05));
    this.scene.add(new THREE.HemisphereLight(0xd8f6ff, 0x3a8aaa, 0.85));

    this.fill = new THREE.PointLight(0x9ee8ff, 1.65, 55);
    this.fill.position.set(0, 3.5, 4);
    this.scene.add(this.fill);

    const top = new THREE.PointLight(0xf2fbff, 1.25, 48);
    top.position.set(0, 6.5, -2);
    this.scene.add(top);

    const rim = new THREE.DirectionalLight(0xa8e8ff, 1.05);
    rim.position.set(-12, 6, -8);
    this.scene.add(rim);

    const warm = new THREE.PointLight(0xffc49a, 0.7, 28);
    warm.position.set(6, -2, 2);
    this.scene.add(warm);

    const warm2 = new THREE.PointLight(0xffd0a8, 0.45, 24);
    warm2.position.set(-7, -2.5, -3);
    this.scene.add(warm2);

    // Bubbles across the larger volume
    const bubMat = new THREE.SpriteMaterial({
      map: this.bubbleTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.9
    });
    for (let i = 0; i < 110; i++) {
      const b = new THREE.Sprite(bubMat.clone());
      const s = 0.07 + Math.random() * 0.18;
      b.scale.set(s, s, 1);
      b.position.set(
        (Math.random() - 0.5) * 36,
        -4.2 + Math.random() * 9,
        (Math.random() - 0.5) * 30
      );
      b.userData = {
        speed: 0.28 + Math.random() * 0.55,
        phase: Math.random() * Math.PI * 2,
        wobble: 0.4 + Math.random() * 1.1
      };
      this.bubbleGroup.add(b);
    }

    // Floating light motes (PokéBonk-style sparkle life)
    const moteMat = new THREE.SpriteMaterial({
      map: this.moteTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.75
    });
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Sprite(moteMat.clone());
      const s = 0.08 + Math.random() * 0.16;
      m.scale.set(s, s, 1);
      m.position.set(
        (Math.random() - 0.5) * 32,
        -3 + Math.random() * 7,
        (Math.random() - 0.5) * 26
      );
      m.userData = {
        phase: Math.random() * Math.PI * 2,
        speed: 0.15 + Math.random() * 0.35,
        amp: 0.25 + Math.random() * 0.55
      };
      this.moteGroup.add(m);
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
    const count = r.includes('legend') ? 26 : r.includes('rare') ? 16 : 10;
    const mat = new THREE.SpriteMaterial({
      map: this.bubbleTex,
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(mat.clone());
      const size = 0.1 + Math.random() * 0.14;
      s.scale.set(size, size, 1);
      s.position.copy(at);
      s.userData = {
        vx: (Math.random() - 0.5) * 1.8,
        vy: 0.5 + Math.random() * 1.4,
        vz: (Math.random() - 0.5) * 1.8,
        life: 0.9 + Math.random() * 0.55
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
      inTank.map(async (f, idx) => {
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
              mat.emissive = mat.color.clone().multiplyScalar(0.18);
              mat.emissiveIntensity = 0.65;
              mat.roughness = 0.42;
              mat.metalness = 0.06;
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

        // Spread fish across the larger arena (API pos is still ~[-1,1])
        const ring = (idx % 5) * 1.1;
        const px = f.posX * 5.5 + Math.sin(idx * 1.7) * ring;
        const py = f.care === 'Down' ? -4.1 : f.posY * 2.2 + 0.15;
        const pz = f.posZ * 4.5 - 1.5 + Math.cos(idx * 1.3) * ring;
        root.position.set(
          THREE.MathUtils.clamp(px, TANK.minX + 1, TANK.maxX - 1),
          THREE.MathUtils.clamp(py, TANK.minY + 0.4, TANK.maxY - 0.6),
          THREE.MathUtils.clamp(pz, TANK.minZ + 1, TANK.maxZ - 1)
        );

        (root as FishNode).userData = {
          fishId: f.id,
          phase: Math.random() * Math.PI * 2,
          speed: 0.28 + Math.random() * 0.42,
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
    if (this.fill) this.fill.intensity = 1.45 + Math.sin(t * 1.2) * 0.28;
    if (this.sun) this.sun.intensity = 1.95 + Math.sin(t * 0.35) * 0.12;

    if (this.caustic && this.causticTex) {
      this.causticTex.offset.x = Math.sin(t * 0.15) * 0.1;
      this.causticTex.offset.y = t * 0.045;
      (this.caustic.material as THREE.MeshBasicMaterial).opacity = 0.34 + Math.sin(t * 0.85) * 0.1;
    }
    if (this.caustic2 && this.causticTex) {
      const mat = this.caustic2.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.16 + Math.sin(t * 0.7 + 1.2) * 0.06;
      this.caustic2.rotation.z = 0.4 + Math.sin(t * 0.08) * 0.05;
    }

    for (const ray of this.godRayGroup.children) {
      const m = ray as THREE.Mesh;
      const mat = m.material as THREE.MeshBasicMaterial;
      const phase = (m.userData['phase'] as number) ?? 0;
      mat.opacity = 0.045 + Math.sin(t * 0.6 + phase) * 0.028;
    }

    this.updateMovement(dt);

    for (const child of this.bubbleGroup.children) {
      const b = child as THREE.Sprite;
      const { speed, phase, wobble } = b.userData as { speed: number; phase: number; wobble: number };
      b.position.y += speed * dt;
      b.position.x += Math.sin(t * wobble + phase) * 0.006;
      if (b.position.y > 5.8) b.position.y = -4.2;
    }

    for (const child of this.moteGroup.children) {
      const m = child as THREE.Sprite;
      const { phase, speed, amp } = m.userData as { phase: number; speed: number; amp: number };
      m.position.y += Math.sin(t * speed + phase) * 0.004;
      m.position.x += Math.cos(t * speed * 0.7 + phase) * 0.003 * amp;
      const mat = m.material as THREE.SpriteMaterial;
      mat.opacity = 0.45 + Math.sin(t * 2 + phase) * 0.3;
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
      const amp = node.userData.care === 'NeedsCare' ? 0.45 : 0.95;
      node.position.x = base.x + Math.sin(t * speed + phase) * amp;
      node.position.y = base.y + Math.sin(t * speed * 1.25 + phase) * 0.32;
      node.position.z = base.z + Math.cos(t * speed * 0.65 + phase) * 0.55;
      const dx = Math.cos(t * speed + phase);
      node.rotation.y = dx > 0 ? 0 : Math.PI;
      node.rotation.z = Math.sin(t * speed * 2 + phase) * 0.1;

      if (flashUntil > t) {
        const pulse = 0.55 + Math.sin(t * 14) * 0.45;
        node.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const raw of mats) {
            const mat = raw as THREE.MeshStandardMaterial;
            if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 0.65 + pulse * 1.5;
          }
        });
      }
    }

    // Gentle idle sway of taller plants
    for (const child of this.decorGroup.children) {
      if ((child as THREE.Mesh).geometry instanceof THREE.BoxGeometry) {
        const g = (child as THREE.Mesh).geometry as THREE.BoxGeometry;
        const p = g.parameters;
        if (p.height > 1.0 && p.width < 0.25) {
          child.rotation.z = Math.sin(t * 0.85 + child.position.x) * 0.08;
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
    this.moteTex.dispose();
    this.horizonTex.dispose();
    this.causticTex?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
