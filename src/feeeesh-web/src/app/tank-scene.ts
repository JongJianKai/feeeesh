import * as THREE from 'three';
import type { FishDto } from './api.service';
import { spriteUrlForSpecies } from './fish-sprites';

type FishMesh = THREE.Mesh & {
  userData: { fishId: string; phase: number; speed: number; base: THREE.Vector3; care: string };
};

const textureCache = new Map<string, THREE.Texture>();
const loader = new THREE.TextureLoader();

function loadSprite(url: string): Promise<THREE.Texture> {
  const hit = textureCache.get(url);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        textureCache.set(url, tex);
        resolve(tex);
      },
      undefined,
      reject
    );
  });
}

/** Procedural fallback if a sprite fails to load (still pixel-ish). */
function makeFallbackTexture(colorHex: string, accentHex: string, care: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 64, 32);
  const dim = care === 'Healthy' ? 1 : care === 'NeedsCare' ? 0.72 : 0.45;
  const fill = (hex: string) => {
    const c = new THREE.Color(hex);
    c.multiplyScalar(dim);
    return `#${c.getHexString()}`;
  };
  ctx.fillStyle = fill(colorHex);
  ctx.fillRect(10, 10, 36, 12);
  ctx.fillRect(8, 12, 4, 8);
  ctx.fillRect(44, 8, 8, 6);
  ctx.fillRect(44, 18, 8, 6);
  ctx.fillStyle = fill(accentHex);
  ctx.fillRect(14, 12, 8, 8);
  ctx.fillStyle = care === 'Down' ? '#555' : '#111';
  ctx.fillRect(12, 14, 3, 3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class TankScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private fishGroup = new THREE.Group();
  private bubbleGroup = new THREE.Group();
  private raf = 0;
  private disposed = false;
  private clock = new THREE.Clock();
  private fill?: THREE.PointLight;

  constructor(private host: HTMLElement) {
    const w = host.clientWidth || 960;
    const h = host.clientHeight || 540;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x0a3a4a, 1);
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    this.camera.position.set(0, 0.35, 5.2);
    this.camera.lookAt(0, 0, 0);

    this.scene.fog = new THREE.FogExp2(0x0b3d4a, 0.038);
    this.buildTank();
    this.scene.add(this.fishGroup);
    this.scene.add(this.bubbleGroup);
    this.loop();
    window.addEventListener('resize', this.onResize);
  }

  private buildTank() {
    // Pixel aquarium backdrop (AI placeholder) for digital-world depth.
    void loadSprite('/assets/feeeesh-lobby-bg-pixel.jpg').then((tex) => {
      if (this.disposed) return;
      const backdrop = new THREE.Mesh(
        new THREE.PlaneGeometry(14, 8),
        new THREE.MeshBasicMaterial({ map: tex, depthWrite: false })
      );
      backdrop.position.set(0, 0.2, -3.2);
      this.scene.add(backdrop);
      this.renderer.setClearColor(0x0a2f3a, 1);
    });

    const water = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 3.0, 2.4),
      new THREE.MeshStandardMaterial({
        color: 0x1a6b8a,
        transparent: true,
        opacity: 0.14,
        roughness: 0.35,
        metalness: 0.05
      })
    );
    this.scene.add(water);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(5.25, 3.05, 2.45)),
      new THREE.LineBasicMaterial({ color: 0xcfe9f5 })
    );
    this.scene.add(edges);

    const sand = new THREE.Mesh(
      new THREE.BoxGeometry(5.0, 0.18, 2.2),
      new THREE.MeshStandardMaterial({ color: 0xcbb896, roughness: 1 })
    );
    sand.position.y = -1.4;
    this.scene.add(sand);

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

    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0x88aacc, 0.55));

    this.fill = new THREE.PointLight(0x7fd3ff, 0.55, 12);
    this.fill.position.set(0, 1.2, 1.5);
    this.scene.add(this.fill);

    // soft pixel bubbles
    const bubMat = new THREE.MeshBasicMaterial({ color: 0xd8f4ff, transparent: true, opacity: 0.55 });
    for (let i = 0; i < 18; i++) {
      const s = 0.04 + Math.random() * 0.06;
      const b = new THREE.Mesh(new THREE.SphereGeometry(s, 6, 6), bubMat);
      b.position.set((Math.random() - 0.5) * 4.2, -1.2 + Math.random() * 2.4, (Math.random() - 0.5) * 1.6);
      b.userData = { speed: 0.15 + Math.random() * 0.25, phase: Math.random() * Math.PI * 2 };
      this.bubbleGroup.add(b);
    }
  }

  async setFish(fish: FishDto[]) {
    while (this.fishGroup.children.length) {
      const child = this.fishGroup.children.pop()!;
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (mat.map && !textureCache.has((mat.map as any).source?.data?.src)) {
        // keep cached sprites; dispose only ephemeral canvas maps
        if ((mat.map as THREE.CanvasTexture).image instanceof HTMLCanvasElement) {
          mat.map.dispose();
        }
      }
      mat.dispose();
      mesh.geometry.dispose();
    }

    const inTank = fish.filter((x) => x.inTank);
    await Promise.all(
      inTank.map(async (f) => {
        let map: THREE.Texture;
        try {
          map = await loadSprite(spriteUrlForSpecies(f.speciesId));
        } catch {
          map = makeFallbackTexture(f.colorHex, f.accentHex, f.care);
        }

        const mat = new THREE.MeshBasicMaterial({
          map,
          transparent: true,
          alphaTest: 0.15,
          side: THREE.DoubleSide,
          depthWrite: false,
          opacity: f.care === 'Healthy' ? 1 : f.care === 'NeedsCare' ? 0.82 : 0.55
        });

        const img = map.image as { width?: number; height?: number } | undefined;
        const aspect = (img?.width || 64) / (img?.height || 32);
        const h = 0.72 * f.size * (f.care === 'Down' ? 0.9 : 1);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h), mat) as unknown as FishMesh;
        mesh.position.set(f.posX, f.care === 'Down' ? -1.15 : f.posY, f.posZ);
        mesh.userData = {
          fishId: f.id,
          phase: Math.random() * Math.PI * 2,
          speed: 0.35 + Math.random() * 0.5,
          base: mesh.position.clone(),
          care: f.care
        };
        if (f.care === 'Down') mesh.rotation.z = -0.4;
        this.fishGroup.add(mesh);
      })
    );
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = this.clock.getElapsedTime();
    if (this.fill) this.fill.intensity = 0.45 + Math.sin(t * 1.4) * 0.12;

    for (const child of this.bubbleGroup.children) {
      const b = child as THREE.Mesh;
      const { speed, phase } = b.userData as { speed: number; phase: number };
      b.position.y += speed * 0.016;
      b.position.x += Math.sin(t * 0.8 + phase) * 0.002;
      if (b.position.y > 1.4) b.position.y = -1.35;
    }

    for (const child of this.fishGroup.children) {
      const mesh = child as FishMesh;
      if (mesh.userData.care === 'Down') continue;
      const { phase, speed, base } = mesh.userData;
      const amp = mesh.userData.care === 'NeedsCare' ? 0.18 : 0.35;
      mesh.position.x = base.x + Math.sin(t * speed + phase) * amp;
      mesh.position.y = base.y + Math.sin(t * speed * 1.3 + phase) * 0.12;
      mesh.position.z = base.z + Math.cos(t * speed * 0.7 + phase) * 0.08;
      const facing = Math.sin(t * speed + phase) > 0 ? 1 : -1;
      mesh.scale.x = Math.abs(mesh.scale.x) * facing;
      mesh.lookAt(this.camera.position.x, mesh.position.y, this.camera.position.z);
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
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
