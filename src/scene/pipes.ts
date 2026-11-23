// 管线三维建模：圆管 / 电力排管 / 方沟 / 检查井（井筒+井室）/ 阀门等管点，
// 以及每根管的不确定包络（胶囊网格 + 距离场渐隐材质）。
// 包络网格与解析距离共用 envelope.ts 的同一组胶囊参数（中心线 A/B、envR），
// 因此“看到的包络面”与“算出来的距离”天然一致。

import * as THREE from 'three';
import { PipeEntity, PipePoint, PointType, CATEGORY_COLORS } from '../types';
import { makeOitMaterials, OitMaterialPair } from '../materials';
import { LAYER_OPAQUE } from '../oit';

export interface BuiltPipes {
  group: THREE.Group;
  transparents: { mesh: THREE.Mesh; pair: OitMaterialPair }[];
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

function orientAlong(obj: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  const dir = b.clone().sub(a);
  const len = dir.length();
  obj.position.copy(a).add(b).multiplyScalar(0.5);
  obj.quaternion.setFromUnitVectors(Y_AXIS, dir.normalize());
  obj.scale.set(1, 1, 1);
  obj.userData.len = len;
}

function pipeBodyGeometry(e: PipeEntity, len: number): THREE.BufferGeometry {
  const seg = e.seg;
  if (seg.section === 'duct') {
    const rows = seg.ductRows ?? 2, cols = seg.ductCols ?? 3;
    const d = seg.diameter / 1000;
    const pitch = d * 1.5;
    const w = (cols - 1) * pitch + d + 0.15;
    const h = (rows - 1) * pitch + d + 0.15;
    return new THREE.BoxGeometry(w, len, h);
  }
  if (seg.section === 'box') {
    return new THREE.BoxGeometry(seg.boxWidth ?? 1.2, len, seg.boxHeight ?? 1.0);
  }
  return new THREE.CylinderGeometry(e.outerR, e.outerR, len, 24, 1);
}

export function buildPipes(
  entities: PipeEntity[],
  points: Map<string, PipePoint>,
  origin: { x: number; y: number },
): BuiltPipes {
  const group = new THREE.Group();
  group.name = 'pipes';
  const transparents: BuiltPipes['transparents'] = [];

  for (const e of entities) {
    const a = new THREE.Vector3(e.ax, e.ay, e.az);
    const b = new THREE.Vector3(e.bx, e.by, e.bz);
    const len = a.distanceTo(b);
    if (len < 1e-6) continue;
    const color = CATEGORY_COLORS[e.seg.category];

    // —— 管道本体（不透明）——
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(pipeBodyGeometry(e, len), bodyMat);
    orientAlong(body, a, b);
    body.layers.set(LAYER_OPAQUE);
    body.userData = { kind: 'pipe', category: e.seg.category, segId: e.seg.id };
    group.add(body);

    // —— 不确定包络（OIT 透明，胶囊距离场渐隐）——
    // 几何体比真实包络外扩 18%，渐隐区落在几何体内部
    const inflate = 1.18;
    const envGeo = new THREE.CapsuleGeometry(e.envR * inflate, len, 8, 32);
    const pair = makeOitMaterials({
      color, alpha: 0.32, envelope: true, feather: Math.min(0.08, e.envR * 0.25),
    });
    for (const m of [pair.accum, pair.reveal]) {
      (m.uniforms.uCapsA.value as THREE.Vector3).copy(a);
      (m.uniforms.uCapsB.value as THREE.Vector3).copy(b);
      m.uniforms.uCapsR.value = e.envR;
    }
    const env = new THREE.Mesh(envGeo, pair.accum);
    orientAlong(env, a, b);
    env.userData = { kind: 'envelope', category: e.seg.category, segId: e.seg.id };
    group.add(env);
    transparents.push({ mesh: env, pair });
  }

  // —— 管点 ——
  for (const p of points.values()) {
    const px = p.x - origin.x, py = p.y - origin.y;
    if (p.type === PointType.Manhole) {
      // 井室 + 井筒
      const depth = 2.2;
      const chamber = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.7, 1.6, 16),
        new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }),
      );
      chamber.position.set(px, py, p.groundElev - depth + 0.8);
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, depth - 0.8, 12),
        new THREE.MeshLambertMaterial({ color: 0xb8bdc4 }),
      );
      shaft.position.set(px, py, p.groundElev - (depth - 0.8) / 2);
      for (const m of [chamber, shaft]) {
        m.layers.set(LAYER_OPAQUE);
        m.userData = { kind: 'marker', pointId: p.id };
        group.add(m);
      }
    } else if (p.type !== PointType.General) {
      const color = p.type === PointType.Valve ? 0x42a5f5 : p.type === PointType.Tee ? 0xab47bc : 0xffb300;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 8),
        new THREE.MeshLambertMaterial({ color }),
      );
      marker.position.set(px, py, p.groundElev - 1.2);
      marker.layers.set(LAYER_OPAQUE);
      marker.userData = { kind: 'marker', pointId: p.id };
      group.add(marker);
    }
  }

  return { group, transparents };
}

/** 文本标签精灵（alphaTest 当作不透明渲染，避免排序问题） */
export function makeLabel(text: string, opts?: { size?: number; color?: string; bg?: string }): THREE.Sprite {
  const size = opts?.size ?? 44;
  const pad = 14;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d')!;
  ctx.font = `${size}px "Microsoft YaHei", sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = size + pad * 2;
  cv.width = w; cv.height = h;
  ctx.fillStyle = opts?.bg ?? 'rgba(16,20,28,0.92)';
  ctx.fillRect(0, 0, w, h);
  ctx.font = `${size}px "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = opts?.color ?? '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.1, depthTest: true });
  const sp = new THREE.Sprite(mat);
  const scale = 0.02;
  sp.scale.set(w * scale, h * scale, 1);
  sp.layers.set(LAYER_OPAQUE);
  return sp;
}
