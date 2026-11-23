// 共享 3D 视图：OIT 渲染 + 相机 + 轨道控制 + 场景内容（管线/地层）管理

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OitView } from './oit';
import { store } from './store';
import { buildPipes, BuiltPipes } from './scene/pipes';
import { buildStrata, BuiltStrata } from './scene/strata';
import { PipeCategory } from './types';

export class View3D {
  readonly view: OitView;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly canvas: HTMLCanvasElement;
  pipes?: BuiltPipes;
  strata?: BuiltStrata;
  readonly extras = new THREE.Group(); // 页面自有内容（基坑、挖机、剖切线等）
  onFrame: ((dt: number) => void) | null = null;
  private raf = 0;
  private lastT = 0;
  private resizeObs: ResizeObserver;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.view = new OitView(canvas);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.scene.add(this.extras);

    const amb = new THREE.AmbientLight(0xffffff, 0.75);
    amb.layers.enableAll();
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(80, -60, 150);
    dir.layers.enableAll();
    this.scene.add(amb, dir);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.resetCamera();
    (window as unknown as { __view3d?: View3D }).__view3d = this; // 调试钩子
  }

  resetCamera(): void {
    const base = store.baseElev;
    this.camera.position.set(120, -160, 140 + base);
    this.controls.target.set(0, 0, base - 2);
    this.controls.update();
  }

  resize(): void {
    const el = this.canvas.parentElement;
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    if (w === 0 || h === 0) return;
    this.view.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** 从 store 重建管线与地层 */
  rebuildContent(): void {
    if (this.pipes) { this.scene.remove(this.pipes.group); }
    if (this.strata) { this.scene.remove(this.strata.group); }
    this.view.unregisterAll();
    this.pipes = undefined;
    this.strata = undefined;

    this.strata = buildStrata();
    this.scene.add(this.strata.group);
    for (const t of this.strata.transparents) this.view.registerTransparent(t.mesh, t.pair);

    if (store.entities.length > 0) {
      this.pipes = buildPipes(store.entities, store.pointMap, store.origin);
      this.scene.add(this.pipes.group);
      for (const t of this.pipes.transparents) this.view.registerTransparent(t.mesh, t.pair);
    }
  }

  setStrataAlpha(layerName: string, alpha: number): void {
    if (!this.strata) return;
    for (const t of this.strata.transparents) {
      if (t.layer === layerName) t.pair.accum.uniforms.uAlpha.value = alpha;
    }
  }

  setEnvelopesVisible(v: boolean): void {
    this.pipes?.group.traverse(o => {
      if (o.userData.kind === 'envelope') o.visible = v;
    });
  }

  setCategoryVisible(cat: PipeCategory, v: boolean): void {
    this.pipes?.group.traverse(o => {
      if ((o.userData.kind === 'pipe' || o.userData.kind === 'envelope') && o.userData.category === cat) {
        o.visible = v;
      }
    });
  }

  /** 地面（基准高程面）拾取 */
  pickGround(ndcX: number, ndcY: number): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -store.baseElev);
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, out) ? out : null;
  }

  start(): void {
    if (this.raf) return;
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (this.disposed) return;
      const dt = Math.min(0.1, (t - this.lastT) / 1000);
      this.lastT = t;
      this.controls.update();
      this.onFrame?.(dt);
      this.view.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.view.dispose();
  }
}
