import * as THREE from 'three';
import type { FishDto } from './api.service';

type FishMesh = THREE.Mesh & { userData: { fishId: string; phase: number; speed: number; base: THREE.Vector3 } };

/** Procedural pixel-ish billboard fish (greybox until human pixel art). */
function makeFishTexture(colorHex: string, accentHex: string, care: string): THREE.CanvasTexture {
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
  // chunky pixel body
  ctx.fillRect(10, 10, 36, 12);
  ctx.fillRect(8, 12, 4, 8);
  ctx.fillRect(44, 8, 8, 6);
  ctx.fillRect(44, 18, 8, 6);
  ctx.fillStyle = fill(accentHex);
  ctx.fillRect(14, 12, 8, 8);
  ctx.fillRect(28, 14, 10, 4);
  ctx.fillStyle = care === 'Down' ? '#555' : '#111';
  ctx.fillRect(12, 14, 3, 3);

  if (care === 'NeedsCare' || care === 'Down') {
    ctx.fillStyle = '#e8f4ff';
    ctx.fillRect(30, 2, 4, 4);
  }

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
  private raf = 0;
  private disposed = false;
  private clock = new THREE.Clock();

  constructor(private host: HTMLElement) {
    const w = host.clientWidth || 960;
    const h = host.clientHeight || 540;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x0b2a3a, 1);
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    this.camera.position.set(0, 0.35, 5.2);
    this.camera.lookAt(0, 0, 0);

    this.scene.fog = new THREE.FogExp2(0x0b2a3a, 0.045);
    this.buildTank();
    this.scene.add(this.fishGroup);
    this.loop();
    window.addEventListener('resize', this.onResize);
  }

  private buildTank() {
    // water volume
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 3.0, 2.4),
      new THREE.MeshStandardMaterial({
        color: 0x1a6b8a,
        transparent: true,
        opacity: 0.22,
        roughness: 0.35,
        metalness: 0.05
      })
    );
    this.scene.add(water);

    // glass frame (edges)
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(5.25, 3.05, 2.45)),
      new THREE.LineBasicMaterial({ color: 0xcfe9f5 })
    );
    this.scene.add(edges);

    // sand
    const sand = new THREE.Mesh(
      new THREE.BoxGeometry(5.0, 0.18, 2.2),
      new THREE.MeshStandardMaterial({ color: 0xcbb896, roughness: 1 })
    );
    sand.position.y = -1.4;
    this.scene.add(sand);

    // simple decor blocks
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

    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0x88aacc, 0.55));

    // soft caustic-ish plane flicker via second light
    const fill = new THREE.PointLight(0x7fd3ff, 0.55, 12);
    fill.position.set(0, 1.2, 1.5);
    this.scene.add(fill);
  }

  setFish(fish: FishDto[]) {
    while (this.fishGroup.children.length) {
      const child = this.fishGroup.children.pop()!;
      const mesh = child as THREE.Mesh;
      (mesh.material as THREE.Material).dispose();
      (mesh.geometry as THREE.BufferGeometry).dispose();
    }

    for (const f of fish.filter((x) => x.inTank)) {
      const tex = makeFishTexture(f.colorHex, f.accentHex, f.care);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const size = 0.55 * f.size * (f.care === 'Down' ? 0.9 : 1);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size * 2, size), mat) as unknown as FishMesh;
      mesh.position.set(f.posX, f.care === 'Down' ? -1.15 : f.posY, f.posZ);
      mesh.userData = {
        fishId: f.id,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.55,
        base: mesh.position.clone()
      };
      if (f.care === 'Down') mesh.rotation.z = -0.4;
      this.fishGroup.add(mesh);
    }
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = this.clock.getElapsedTime();
    for (const child of this.fishGroup.children) {
      const mesh = child as FishMesh;
      if (mesh.rotation.z < -0.2) continue; // down fish rest
      const { phase, speed, base } = mesh.userData;
      mesh.position.x = base.x + Math.sin(t * speed + phase) * 0.35;
      mesh.position.y = base.y + Math.sin(t * speed * 1.3 + phase) * 0.12;
      mesh.position.z = base.z + Math.cos(t * speed * 0.7 + phase) * 0.08;
      mesh.rotation.y = Math.sin(t * speed + phase) > 0 ? 0 : Math.PI;
      // billboard-ish toward camera on XZ
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

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
