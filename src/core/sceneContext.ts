// 三维场景单例: 渲染器 / 相机 / 轨道控制 / WBOIT / 对象组 / 文字标注 / 裁剪平面
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Wboit } from './wboit';
import { buildPipeline, type RuntimeSegment } from './pipelineBuilder';
import { buildTerrain, type Terrain } from './terrain';
import { capsuleGeometry, createEnvelopeMaterial, type EnvelopeMesh } from './envelope';
import { envelopeRadius } from '../domain/constants';
import type { ExcavationPlan, PipePoint, PipeSegment } from '../domain/types';
import { buildPit, type PitBuild, type WallLabel } from './pit';

const NO_CLIP: THREE.Plane[] = [];

export class SceneContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly wboit: Wboit;
  private host: HTMLElement;
  private raf = 0;
  private clock = new THREE.Clock();

  pipelineGroup: THREE.Group | null = null;
  private terrain: Terrain | null = null;
  private envelopeGroup = new THREE.Group();
  private markerGroup = new THREE.Group();
  private pitGroup: THREE.Group | null = null;
  private labelElements = new Map<string, HTMLDivElement>();
  private labelLayer: HTMLDivElement;
  private pitPlanes: THREE.Plane[] = [];

  runtime: RuntimeSegment[] = [];
  points: PipePoint[] = [];
  segments: PipeSegment[] = [];
  envelopes: EnvelopeMesh[] = [];
  wallLabels: WallLabel[] = [];
  showEnvelopes = true;

  // 每帧回调(挖机页面挂接实时距离计算)
  onFrame: ((dt: number) => void) | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.localClippingEnabled = true;
    this.renderer.autoClear = false;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, host.clientWidth / host.clientHeight, 0.1, 1000);
    this.camera.position.set(48, 38, 56);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 260;
    this.controls.target.set(0, -2, 0);

    this.wboit = new Wboit(this.renderer);
    this.wboit.setBackground(0x0e1420);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(40, 70, 30);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xb0c4de, 0.5);
    dir2.position.set(-50, 30, -40);
    this.scene.add(dir2);

    this.scene.add(this.envelopeGroup, this.markerGroup);

    // DOM 文字标注层(避免 Sprite 参与透明排序)
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'label-layer';
    host.appendChild(this.labelLayer);

    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.clock.getDelta();
    this.controls.update();
    if (this.onFrame) this.onFrame(dt);
    this.wboit.render(this.scene, this.camera);
    this.updateLabels();
  };

  private onResize = (): void => {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.wboit.setSize(this.renderer.domElement.width, this.renderer.domElement.height);
  };

  /** 载入(或重新载入)管线数据并重建场景 */
  loadPipeline(points: PipePoint[], segments: PipeSegment[]): void {
    this.clearPipeline();
    this.points = points;
    this.segments = segments;
    const built = buildPipeline(points, segments, (s) =>
      envelopeRadius(s.method, s.grade, s.inferred)
    );
    this.pipelineGroup = built.root;
    this.runtime = built.runtime;
    this.scene.add(built.root);
    this.rebuildEnvelopes();
    if (!this.terrain) {
      this.terrain = buildTerrain(this.wboit);
      this.scene.add(this.terrain.group);
    }
    this.applyPitClipping();
  }

  private rebuildEnvelopes(): void {
    this.envelopeGroup.clear();
    this.envelopes = [];
    for (const r of this.runtime) {
      const envR = r.envelopeRadius;
      const geo = capsuleGeometry(r.a, r.b, envR);
      const mat = createEnvelopeMaterial(this.wboit, this.utilityColor(r.utility), r.a, r.b, envR, r.seg.inferred ? 0.62 : 0.45);
      mat.clippingPlanes = this.pitPlanes.length ? this.pitPlanes : null;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.segmentId = r.seg.id;
      this.envelopeGroup.add(mesh);
      this.envelopes.push({ mesh, a: r.a, b: r.b, radius: envR, segmentId: r.seg.id });
    }
    this.envelopeGroup.visible = this.showEnvelopes;
  }

  private utilityColor(u: string): number {
    const map: Record<string, number> = {
      water: 0x1e88e5,
      drain: 0x6d4c41,
      gas: 0xfdd835,
      power: 0xe53935,
      comm: 0x7e57c2,
      heat: 0xfb8c00
    };
    return map[u] ?? 0xffffff;
  }

  setEnvelopeVisible(v: boolean): void {
    this.showEnvelopes = v;
    this.envelopeGroup.visible = v;
  }

  setRoadOpacity(v: number): void {
    this.terrain?.setRoadOpacity(v);
  }

  setStrataOpacity(v: number): void {
    this.terrain?.setStrataOpacity(v);
  }

  setTerrainVisible(v: boolean): void {
    if (this.terrain) this.terrain.group.visible = v;
  }

  /** 开挖方案: 重建坑体与裁剪平面 */
  setPit(plan: ExcavationPlan | null): void {
    if (this.pitGroup) {
      this.scene.remove(this.pitGroup);
      this.pitGroup = null;
    }
    this.clearLabels();
    this.wallLabels = [];
    if (!plan) {
      this.pitPlanes = [];
      this.applyPitClipping();
      return;
    }
    const built: PitBuild = buildPit(plan, this.wboit, this.runtime);
    this.pitGroup = built.group;
    this.pitPlanes = built.planes;
    this.wallLabels = built.labels;
    this.scene.add(this.pitGroup);
    for (const label of this.wallLabels) this.addLabel(`wall-${label.segmentId}`, label.position, label.text, label.color);
    this.applyPitClipping();
  }

  private applyPitClipping(): void {
    const planes = this.pitPlanes;
    this.wboit.setClippingPlanes(planes);
    for (const env of this.envelopes) {
      (env.mesh.material as THREE.Material).clippingPlanes = planes.length ? planes : NO_CLIP;
    }
    if (this.terrain) {
      this.terrain.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) (m as THREE.Material).clippingPlanes = planes.length ? planes : NO_CLIP;
        }
      });
    }
    if (this.pipelineGroup) {
      this.pipelineGroup.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) (m as THREE.Material).clippingPlanes = planes.length ? planes : NO_CLIP;
        }
      });
    }
  }

  // ---------- DOM 标注 ----------
  addLabel(key: string, world: THREE.Vector3, text: string, color = '#ffd54f'): void {
    if (this.labelElements.has(key)) this.removeLabel(key);
    const el = document.createElement('div');
    el.className = 'scene-label';
    el.style.borderColor = color;
    el.style.color = color;
    el.textContent = text;
    this.labelLayer.appendChild(el);
    this.labelElements.set(key, el);
    el.dataset.x = String(world.x);
    el.dataset.y = String(world.y);
    el.dataset.z = String(world.z);
  }

  removeLabel(key: string): void {
    this.labelElements.get(key)?.remove();
    this.labelElements.delete(key);
  }

  clearLabels(): void {
    for (const el of this.labelElements.values()) el.remove();
    this.labelElements.clear();
  }

  private updateLabels(): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    for (const [key, el] of this.labelElements) {
      v.set(Number(el.dataset.x), Number(el.dataset.y), Number(el.dataset.z));
      v.project(this.camera);
      if (v.z > 1) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'block';
      el.style.left = `${rect.left + (v.x * 0.5 + 0.5) * rect.width}px`;
      el.style.top = `${rect.top + (-v.y * 0.5 + 0.5) * rect.height}px`;
      void key;
    }
  }

  flyTo(x: number, y: number, z: number, tx = 0, ty = -2, tz = 0): void {
    this.camera.position.set(x, y, z);
    this.controls.target.set(tx, ty, tz);
  }

  private clearPipeline(): void {
    if (this.pipelineGroup) {
      this.scene.remove(this.pipelineGroup);
      this.pipelineGroup.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => m.dispose());
        }
      });
    }
    this.envelopeGroup.clear();
    this.envelopes = [];
    this.runtime = [];
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.wboit.dispose();
    this.renderer.dispose();
    this.host.innerHTML = '';
  }
}
