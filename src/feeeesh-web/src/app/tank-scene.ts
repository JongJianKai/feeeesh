import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FishDto } from './api.service';
import { glbUrlForSpecies } from './fish-models';

type FishNode = THREE.Object3D & {
  userData: { fishId: string; phase: number; speed: number; base: THREE.Vector3; care: string };
};

/** Inner glass volume — camera stays inside this AABB. */
const TANK = {
  minX: -2.35,
  maxX: 2.35,
  minY: -1.25,
  maxY: 1.25,
  minZ: -1.0,
  maxZ: 1.0
};

const MOVE_SPEED = 2.4;
const glbCache = new Map<string, THREE.Object3D>();
const gltfLoader = new GLTFLoader();

function loadGlb(url: string): Promise<THREE.Object3D> {
  const hit = glbCache.get(url);
  if (hit) return Promise.resolve(hit.clone(true));
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      url,
      (gltf) => {
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
    new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.55 })
  );
  const accent = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.35, 0.3),
    new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.55 })
  );
  accent.position.x = 0.4;
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.4, 0.08),
    new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.55 })
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
  private velocity = new THREE.Vector3();
  private hintEl?: HTMLDivElement;
  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    // prevent page scroll while flying
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft', 'ControlRight'].includes(e.code)) {
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

    this.camera = new THREE.PerspectiveCamera(65, w / h, 0.05, 100);
    this.camera.position.set(0, 0.15, 0.85);

    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.scene.add(this.controls.object);

    this.renderer.domElement.addEventListener('click', this.requestLock);
    this.controls.addEventListener('lock', this.onLock);
    this.controls.addEventListener('unlock', this.onUnlock);

    this.scene.fog = new THREE.FogExp2(0x0b3d4a, 0.06);
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
    el.textContent = 'Click tank to look · WASD move · Space up · Ctrl down · Esc unlock';
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
    // outer water box (visual shell)
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 3.0, 2.4),
      new THREE.MeshStandardMaterial({
        color: 0x1a6b8a,
        transparent: true,
        opacity: 0.12,
        roughness: 0.35,
        metalness: 0.05,
        side: THREE.BackSide
      })
    );
    this.scene.add(water);

    // glass edges
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(5.25, 3.05, 2.45)),
      new THREE.LineBasicMaterial({ color: 0xcfe9f5 })
    );
    this.scene.add(edges);

    // sand floor
    const sand = new THREE.Mesh(
      new THREE.BoxGeometry(5.0, 0.18, 2.2),
      new THREE.MeshStandardMaterial({ color: 0xcbb896, roughness: 1 })
    );
    sand.position.y = -1.4;
    this.scene.add(sand);

    // pixel backdrop plane behind glass
    const bgTex = new THREE.TextureLoader().load('/assets/feeeesh-lobby-bg-pixel.jpg');
    bgTex.colorSpace = THREE.SRGBColorSpace;
    bgTex.magFilter = THREE.NearestFilter;
    bgTex.minFilter = THREE.NearestFilter;
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 8),
      new THREE.MeshBasicMaterial({ map: bgTex, depthWrite: false })
    );
    backdrop.position.set(0, 0.2, -3.2);
    this.scene.add(backdrop);

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b7c85, roughness: 0.9 });
    const rock = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), rockMat);
    rock.position.set(-1.6, -1.05, -0.3);
    this.scene.add(rock);

    const plant = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 1.1, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x3aa76d })
    );
    plant.position.set(1.7, -0.8, 0.2);
    this.scene.add(plant);

    const coral = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.55, 0.35),
      new THREE.MeshStandardMaterial({ color: 0xff7a59, roughness: 0.7 })
    );
    coral.position.set(0.9, -1.05, -0.5);
    this.scene.add(coral);

    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0x88aacc, 0.65));

    this.fill = new THREE.PointLight(0x7fd3ff, 0.55, 12);
    this.fill.position.set(0, 1.2, 1.5);
    this.scene.add(this.fill);

    const bubMat = new THREE.MeshBasicMaterial({ color: 0xd8f4ff, transparent: true, opacity: 0.55 });
    for (let i = 0; i < 22; i++) {
      const s = 0.035 + Math.random() * 0.055;
      const b = new THREE.Mesh(new THREE.SphereGeometry(s, 6, 6), bubMat);
      b.position.set((Math.random() - 0.5) * 4.2, -1.2 + Math.random() * 2.4, (Math.random() - 0.5) * 1.6);
      b.userData = { speed: 0.15 + Math.random() * 0.25, phase: Math.random() * Math.PI * 2 };
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

        const scale = 0.42 * f.size * (f.care === 'Down' ? 0.85 : 1);
        root.scale.setScalar(scale);
        root.position.set(f.posX, f.care === 'Down' ? -1.15 : f.posY, f.posZ);

        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.material) {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) {
              if ('opacity' in mat) {
                (mat as THREE.MeshStandardMaterial).transparent = f.care !== 'Healthy';
                (mat as THREE.MeshStandardMaterial).opacity =
                  f.care === 'Healthy' ? 1 : f.care === 'NeedsCare' ? 0.82 : 0.55;
              }
            }
          }
        });

        (root as FishNode).userData = {
          fishId: f.id,
          phase: Math.random() * Math.PI * 2,
          speed: 0.35 + Math.random() * 0.5,
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
    const vertical = Number(this.keys.has('Space')) - Number(this.keys.has('ControlLeft') || this.keys.has('ControlRight'));

    // damp
    this.velocity.multiplyScalar(Math.pow(0.001, dt));

    if (this.controls.isLocked || forward || strafe || vertical) {
      const speed = MOVE_SPEED * dt;
      if (forward !== 0) this.controls.moveForward(forward * speed);
      if (strafe !== 0) this.controls.moveRight(strafe * speed);
      if (vertical !== 0) this.camera.position.y += vertical * speed;
    }

    this.clampCamera();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    if (this.fill) this.fill.intensity = 0.45 + Math.sin(t * 1.4) * 0.12;

    this.updateMovement(dt);

    for (const child of this.bubbleGroup.children) {
      const b = child as THREE.Mesh;
      const { speed, phase } = b.userData as { speed: number; phase: number };
      b.position.y += speed * dt;
      b.position.x += Math.sin(t * 0.8 + phase) * 0.002;
      if (b.position.y > 1.4) b.position.y = -1.35;
    }

    for (const child of this.fishGroup.children) {
      const node = child as FishNode;
      if (node.userData.care === 'Down') continue;
      const { phase, speed, base } = node.userData;
      const amp = node.userData.care === 'NeedsCare' ? 0.18 : 0.35;
      node.position.x = base.x + Math.sin(t * speed + phase) * amp;
      node.position.y = base.y + Math.sin(t * speed * 1.3 + phase) * 0.12;
      node.position.z = base.z + Math.cos(t * speed * 0.7 + phase) * 0.08;
      // yaw toward swim direction
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
