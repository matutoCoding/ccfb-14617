import * as THREE from 'three';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 管底埋深(米)+ 管径(毫米) => 管中心世界 Z(地面 z=0, 地下为负) */
export function depthToCenterZ(depth: number, diameterMM: number): number {
  return -(depth - diameterMM / 1000 / 2);
}

/** 点到线段最短距离(三维) */
export function pointToSegment(p: Vec3, a: Vec3, b: Vec3): { dist: number; t: number; closest: Vec3 } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 1e-12 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  const cz = a.z + abz * t;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const dz = p.z - cz;
  return { dist: Math.hypot(dx, dy, dz), t, closest: { x: cx, y: cy, z: cz } };
}

/**
 * 点到胶囊体(线段 a-b + 半径 r)外表面的有符号距离:
 *   正值 = 点在包络外, 到外表面距离; 负值 = 已侵入包络
 * 纯解析计算, 作为报警的唯一权威距离
 */
export function pointToCapsuleSurface(p: Vec3, a: Vec3, b: Vec3, r: number): number {
  return pointToSegment(p, a, b).dist - r;
}

/** 点到三角面片集合的最短绝对距离(暴力法, 仅用于自检对照)。
 * 内外判定不在网格上做(射线法在近三角平面处数值不稳), 由调用方用解析胶囊符号给定。
 */
export function pointToMeshDistance(
  p: THREE.Vector3,
  mesh: THREE.Mesh,
  sample = 1
): { dist: number } {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld;
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  let min = Infinity;
  const triCount = pos.count / 3;
  for (let i = 0; i < triCount; i += sample) {
    va.fromBufferAttribute(pos, i * 3).applyMatrix4(m);
    vb.fromBufferAttribute(pos, i * 3 + 1).applyMatrix4(m);
    vc.fromBufferAttribute(pos, i * 3 + 2).applyMatrix4(m);
    const d = pointToTriangle(p, va, vb, vc);
    if (d < min) min = d;
  }
  return { dist: min };
}

/** Ericson Real-Time Collision Detection 第5.1.5节: 点到三角形最近点(稳健标准算法) */
export function pointToTriangle(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const ap = new THREE.Vector3().subVectors(p, a);
  const d1 = ab.dot(ap);
  const d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return p.distanceTo(a);

  const bp = new THREE.Vector3().subVectors(p, b);
  const d3 = ab.dot(bp);
  const d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return p.distanceTo(b);

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return p.distanceTo(new THREE.Vector3().copy(a).addScaledVector(ab, v));
  }

  const cp = new THREE.Vector3().subVectors(p, c);
  const d5 = ab.dot(cp);
  const d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return p.distanceTo(c);

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return p.distanceTo(new THREE.Vector3().copy(a).addScaledVector(ac, w));
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return p.distanceTo(new THREE.Vector3().copy(b).addScaledVector(new THREE.Vector3().subVectors(c, b), w));
  }

  const denom = 1 / (va + vb + vc);
  const vv = vb * denom;
  const ww = vc * denom;
  const inside = new THREE.Vector3().copy(a).addScaledVector(ab, vv).addScaledVector(ac, ww);
  return p.distanceTo(inside);
}

/** 二维多边形包含测试(ray casting) */
export function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 点到二维多边形边界最短距离 */
export function pointToPolygonEdge(x: number, y: number, poly: [number, number][]): number {
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 > 1e-12 ? ((x - a[0]) * dx + (y - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a[0] + dx * t;
    const cy = a[1] + dy * t;
    min = Math.min(min, Math.hypot(x - cx, y - cy));
  }
  return min;
}
