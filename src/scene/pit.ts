// 基坑：坑壁/坑底网格（不透明），坑壁出露管线标签

import * as THREE from 'three';
import { ExcavationPlan, CATEGORY_COLORS } from '../types';
import { store } from '../store';
import { segPitWallIntersections, ensureCCW } from '../geo';
import { setPitClip } from '../materials';
import { makeLabel } from './pipes';
import { LAYER_OPAQUE } from '../oit';

export interface BuiltPit {
  group: THREE.Group;
  /** 坑壁出露管线记录 */
  exposures: { segId: string; category: string; depth: number; x: number; y: number }[];
}

export function clearPitClip(): void {
  setPitClip(null, 0, 0.75);
}

export function buildPit(plan: ExcavationPlan): BuiltPit {
  const group = new THREE.Group();
  group.name = 'pit';
  const poly = ensureCCW(plan.polygon);
  const groundZ = plan.groundElev;
  const bottomZ = groundZ - plan.depth;
  const m = plan.slope;

  // 启用地层裁剪（全局 uniforms）
  setPitClip(poly, bottomZ, m);

  // —— 坑壁（每条边一个倾斜四边形）——
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xb0926a, side: THREE.DoubleSide });
  const n = poly.length;
  const positions: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    const ex = x1 - x0, ey = y1 - y0;
    const el = Math.hypot(ex, ey) || 1;
    const nx = ey / el, ny = -ex / el; // CCW 外法线
    const off = plan.depth * m;
    // 底边 (x0,y0,bottomZ)-(x1,y1,bottomZ)，顶边外扩 off
    const quad = [
      x0, y0, bottomZ, x1, y1, bottomZ, x1 + nx * off, y1 + ny * off, groundZ,
      x0, y0, bottomZ, x1 + nx * off, y1 + ny * off, groundZ, x0 + nx * off, y0 + ny * off, groundZ,
    ];
    positions.push(...quad);
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  wallGeo.computeVertexNormals();
  const walls = new THREE.Mesh(wallGeo, wallMat);
  walls.layers.set(LAYER_OPAQUE);
  walls.userData = { kind: 'pitwall' };
  group.add(walls);

  // —— 坑底 ——
  const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
  const bottomGeo = new THREE.ShapeGeometry(shape);
  const bottom = new THREE.Mesh(bottomGeo, new THREE.MeshLambertMaterial({ color: 0x8f7a58, side: THREE.DoubleSide }));
  bottom.position.z = bottomZ;
  bottom.layers.set(LAYER_OPAQUE);
  group.add(bottom);

  // —— 坑口轮廓线（坑底边投影，开挖上口线由放坡外扩，此处提示坑底范围）——
  const rimPts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const [x, y] = poly[i % n];
    rimPts.push(new THREE.Vector3(x, y, groundZ + 0.05));
  }
  const rimGeo = new THREE.BufferGeometry().setFromPoints(rimPts);
  const rim = new THREE.Line(rimGeo, new THREE.LineBasicMaterial({ color: 0xff5722 }));
  rim.layers.set(LAYER_OPAQUE);
  group.add(rim);

  // —— 坑壁出露管线：求交 + 标签 ——
  const exposures: BuiltPit['exposures'] = [];
  for (const e of store.entities) {
    const hits = segPitWallIntersections(
      { x: e.ax, y: e.ay, z: e.az }, { x: e.bx, y: e.by, z: e.bz },
      poly, bottomZ, m, groundZ,
    );
    for (const h of hits) {
      const color = CATEGORY_COLORS[e.seg.category];
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(0.15, e.outerR), 16, 12),
        new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: color }),
      );
      marker.position.set(h.p.x, h.p.y, h.p.z);
      marker.layers.set(LAYER_OPAQUE);
      group.add(marker);
      const label = makeLabel(`${e.seg.category} ${e.seg.id} 埋深${h.depth.toFixed(2)}m`, { size: 40 });
      label.position.set(h.p.x, h.p.y, h.p.z + 0.8);
      group.add(label);
      exposures.push({ segId: e.seg.id, category: e.seg.category, depth: h.depth, x: h.p.x, y: h.p.y });
    }
  }

  return { group, exposures };
}
