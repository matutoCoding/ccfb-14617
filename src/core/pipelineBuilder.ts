// 管线/管点三维构建: 圆管、电力排管孔阵、方沟、检查井(井筒+井室)、阀门/三通/变径
import * as THREE from 'three';
import type { PipePoint, PipeSegment } from '../domain/types';
import { UTILITY_META } from '../domain/constants';
import { depthToCenterZ } from './geo';

export interface RuntimeSegment {
  seg: PipeSegment;
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** 外轮廓等效半径(米), 用于距离/包络计算 */
  outerRadius: number;
  envelopeRadius: number;
  utility: PipeSegment['utility'];
}

function orientAlong(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const dir = new THREE.Vector3().subVectors(b, a);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
}

/** 圆管 */
function buildRoundPipe(seg: PipeSegment, a: THREE.Vector3, b: THREE.Vector3, color: number): THREE.Mesh {
  const r = seg.diameter / 1000 / 2;
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(r, r, len, 16, 1, false);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: seg.material === 'steel' ? 0.6 : 0.15 });
  const mesh = new THREE.Mesh(geo, mat);
  orientAlong(mesh, a, b);
  mesh.userData.segmentId = seg.id;
  return mesh;
}

/** 电力/通信排管: 按孔数排列的断面孔阵(每孔一根细管) */
function buildDuct(seg: PipeSegment, a: THREE.Vector3, b: THREE.Vector3, color: number): THREE.Group {
  const group = new THREE.Group();
  const holes = Math.max(2, seg.holes ?? 4);
  const cols = Math.ceil(Math.sqrt(holes * 1.4));
  const rows = Math.ceil(holes / cols);
  const holeR = seg.diameter / 1000 / 2;
  const pitch = holeR * 2.6;
  const len = a.distanceTo(b);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  // 断面基向量
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(up, dir);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  for (let i = 0; i < holes; i++) {
    const cx = (i % cols) - (cols - 1) / 2;
    const cy = Math.floor(i / cols) - (rows - 1) / 2;
    const geo = new THREE.CylinderGeometry(holeR, holeR, len, 10, 1, false);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(mid).addScaledVector(side, cx * pitch).addScaledVector(up, cy * pitch);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    m.userData.segmentId = seg.id;
    group.add(m);
  }
  // 外包混凝土框
  const w = cols * pitch + holeR;
  const h = rows * pitch + holeR;
  const boxGeo = new THREE.BoxGeometry(w, len, h);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x9e9e9e, roughness: 0.9, transparent: true, opacity: 0.35 });
  const box = new THREE.Mesh(boxGeo, boxMat);
  orientAlong(box, a, b);
  box.rotateY(Math.PI / 2);
  group.add(box);
  group.userData.outerW = w;
  group.userData.outerH = h;
  return group;
}

/** 方沟: 宽×高箱体 */
function buildBoxConduit(seg: PipeSegment, a: THREE.Vector3, b: THREE.Vector3, color: number): THREE.Mesh {
  const w = (seg.boxW ?? 1000) / 1000;
  const h = (seg.boxH ?? 1000) / 1000;
  const len = a.distanceTo(b);
  const geo = new THREE.BoxGeometry(w, len, h);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, transparent: true, opacity: 0.85 });
  const mesh = new THREE.Mesh(geo, mat);
  orientAlong(mesh, a, b);
  mesh.rotateY(Math.PI / 2);
  mesh.userData.segmentId = seg.id;
  return mesh;
}

/** 检查井: 井筒(圆柱) + 井室(放大箱体) */
function buildWell(point: PipePoint, color: number): THREE.Group {
  const g = new THREE.Group();
  const depth = point.depth ?? 1.5;
  const shaftR = 0.4;
  const chamberH = Math.min(1.4, depth * 0.5);
  const shaftH = Math.max(0.3, depth - chamberH);
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(shaftR, shaftR, shaftH, 14),
    new THREE.MeshStandardMaterial({ color: 0x757575, roughness: 0.9 })
  );
  shaft.position.set(point.x, -shaftH / 2, point.y);
  const chamber = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, chamberH, 1.4),
    new THREE.MeshStandardMaterial({ color: 0x616161, roughness: 0.9, transparent: true, opacity: 0.9 })
  );
  chamber.position.set(point.x, -(shaftH + chamberH / 2), point.y);
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.48, 0.08, 14),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 })
  );
  rim.position.set(point.x, -0.04, point.y);
  g.add(shaft, chamber, rim);
  g.userData.pointId = point.id;
  return g;
}

function buildNodeMarker(point: PipePoint, color: number): THREE.Mesh {
  let geo: THREE.BufferGeometry;
  switch (point.kind) {
    case 'valve':
      geo = new THREE.ConeGeometry(0.28, 0.5, 4);
      break;
    case 'tee':
      geo = new THREE.SphereGeometry(0.24, 12, 10);
      break;
    case 'reducer':
      geo = new THREE.CylinderGeometry(0.26, 0.16, 0.4, 10);
      break;
    default:
      geo = new THREE.SphereGeometry(0.14, 10, 8);
  }
  const z = depthToCenterZ(point.depth ?? 1, 200);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 }));
  mesh.position.set(point.x, z, point.y);
  mesh.userData.pointId = point.id;
  return mesh;
}

export interface BuildResult {
  root: THREE.Group;
  runtime: RuntimeSegment[];
  pointObjects: THREE.Object3D[];
}

/** 由校验后的管点/管段构建整网三维对象 */
export function buildPipeline(points: PipePoint[], segments: PipeSegment[], envRadiusOf: (s: PipeSegment) => number): BuildResult {
  const root = new THREE.Group();
  root.name = 'pipeline-root';
  const pointMap = new Map(points.map((p) => [p.id, p]));
  const runtime: RuntimeSegment[] = [];
  const pointObjects: THREE.Object3D[] = [];

  for (const seg of segments) {
    const pa = pointMap.get(seg.startId);
    const pb = pointMap.get(seg.endId);
    if (!pa || !pb) continue;
    const color = UTILITY_META[seg.utility].color;
    const r = seg.shape === 'box' ? Math.max((seg.boxW ?? 1000), (seg.boxH ?? 1000)) / 1000 / 2 : seg.diameter / 1000 / 2;
    const a = new THREE.Vector3(pa.x, depthToCenterZ(seg.startDepth ?? pa.depth ?? 1, seg.diameter), pa.y);
    const b = new THREE.Vector3(pb.x, depthToCenterZ(seg.endDepth ?? pb.depth ?? 1, seg.diameter), pb.y);

    let obj: THREE.Object3D;
    if (seg.shape === 'duct') obj = buildDuct(seg, a, b, color);
    else if (seg.shape === 'box') obj = buildBoxConduit(seg, a, b, color);
    else obj = buildRoundPipe(seg, a, b, color);
    root.add(obj);

    const envR = envRadiusOf(seg);
    runtime.push({
      seg,
      a,
      b,
      outerRadius: r,
      envelopeRadius: r + envR,
      utility: seg.utility
    });
  }

  // 管点对象(井/阀/三通/变径)
  const grouped = new Set<string>();
  for (const p of points) {
    const color = UTILITY_META[p.utility].color;
    if (p.kind === 'well') {
      const well = buildWell(p, color);
      root.add(well);
      pointObjects.push(well);
      grouped.add(p.id);
    } else if (p.kind !== 'ordinary') {
      const marker = buildNodeMarker(p, color);
      root.add(marker);
      pointObjects.push(marker);
      grouped.add(p.id);
    }
  }
  void grouped;
  return { root, runtime, pointObjects };
}
