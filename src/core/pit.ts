// 基坑: 真三维开挖。对地层/路面/管线施加 5 个裁剪平面(四放坡壁 + 坑底),
// 同时生成放坡 frustum 坑壁, 管壁与坑壁交点处挂埋深标注
import * as THREE from 'three';
import type { ExcavationPlan } from '../domain/types';
import { STRATA, UTILITY_META } from '../domain/constants';
import type { Wboit } from './wboit';
import type { RuntimeSegment } from './pipelineBuilder';
import { pointToSegment } from './geo';

export interface PitBuild {
  group: THREE.Group;
  planes: THREE.Plane[];
  labels: WallLabel[];
}

export interface WallLabel {
  position: THREE.Vector3;
  text: string;
  color: string;
  segmentId: string;
}

/** 基坑在给定深度处的水平收缩多边形(放坡) */
function insetPolygon(poly: [number, number][], inset: number): [number, number][] {
  // 简化: 沿多边形重心方向收缩(路口基坑为凸多边形, 足够准确)
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x - (dx / len) * inset, y - (dy / len) * inset];
  });
}

/** 构建连接上下两个环的侧壁(三角带) */
function buildWallGeometry(topRing: [number, number][], bottomRing: [number, number][], depth: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const n = topRing.length;
  const layerColor = (y: number): THREE.Color => {
    const d = -y;
    let top = 0;
    for (const layer of STRATA) {
      if (d <= layer.bottomDepth) {
        const t = (d - top) / (layer.bottomDepth - top || 1);
        return new THREE.Color(layer.color).lerp(new THREE.Color(0xffffff), 0.08 * t);
      }
      top = layer.bottomDepth;
    }
    return new THREE.Color(STRATA[STRATA.length - 1].color);
  };
  const push = (x: number, y: number, z: number) => {
    pos.push(x, y, z);
    const c = layerColor(y);
    col.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const t0 = topRing[i];
    const t1 = topRing[j];
    const b0 = bottomRing[i];
    const b1 = bottomRing[j];
    // 两个三角形
    push(t0[0], 0, t0[1]);
    push(b0[0], -depth, b0[1]);
    push(t1[0], 0, t1[1]);
    push(t1[0], 0, t1[1]);
    push(b0[0], -depth, b0[1]);
    push(b1[0], -depth, b1[1]);
  }
  // 坑底
  const center = bottomRing.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]).map((v) => v / n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    push(center[0], -depth, center[1]);
    push(bottomRing[j][0], -depth, bottomRing[j][1]);
    push(bottomRing[i][0], -depth, bottomRing[i][1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** 计算每条边的内倾裁剪平面(normal 指向坑外保留侧) */
function buildPlanes(poly: [number, number][], depth: number, slope: number): THREE.Plane[] {
  const planes: THREE.Plane[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[j];
    // 边方向与水平外法线
    const ex = x2 - x1;
    const ey = y2 - y1;
    const elen = Math.hypot(ex, ey) || 1;
    const nx = ey / elen;
    const ny = -ex / elen;
    // 使法线指向多边形外
    const cx = poly.reduce((s, p) => s + p[0], 0) / n;
    const cy = poly.reduce((s, p) => s + p[1], 0) / n;
    const sign = nx * (cx - x1) + ny * (cy - y1) > 0 ? -1 : 1;
    const onx = nx * sign;
    const ony = ny * sign;
    // 放坡: 坑壁在深度 d 处向内收 slope*d, 平面过 (x1,y1,0), 法向 (onx, 1/slope 分量, ony)
    // 保留条件: onx*(X-x1)+ony*(Y-y1)+(slope)*Yworld >= 0 (Yworld<=0)
    const normal = new THREE.Vector3(onx, slope, ony).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(x1, 0, y1));
    planes.push(plane);
  }
  // 坑底: 保留 y >= -depth
  planes.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), depth));
  return planes;
}

/** 管段与坑壁的交点: 求线段与每个放坡壁平面的穿越点, 在壁面位置挂埋深标注 */
function wallIntersections(rt: RuntimeSegment[], planes: THREE.Plane[], depth: number): WallLabel[] {
  const labels: WallLabel[] = [];
  const wallPlanes = planes.slice(0, -1); // 去掉坑底平面
  for (const r of rt) {
    let best: { p: THREE.Vector3; gap: number } | null = null;
    for (const pl of wallPlanes) {
      // 线段 a-b 与平面 pl 的交点: pl.normal·p + pl.constant = 0
      const da = pl.distanceToPoint(r.a);
      const db = pl.distanceToPoint(r.b);
      if (da * db >= 0) continue; // 同侧, 无穿越
      const t = da / (da - db);
      if (t < 0 || t > 1) continue;
      const p = new THREE.Vector3().lerpVectors(r.a, r.b, t);
      if (p.y > -0.05 || p.y < -depth - 0.4) continue;
      const cand = { p, gap: 0 };
      if (!best) best = cand;
    }
    // 若无穿越(整条段都在坑内), 取线段中点投影到最近壁面
    if (!best) {
      const mid = new THREE.Vector3().lerpVectors(r.a, r.b, 0.5);
      if (mid.y < -0.05 && mid.y > -depth - 0.4) {
        let minGap = Infinity;
        let nearestPlane = wallPlanes[0];
        for (const pl of wallPlanes) {
          const g = Math.abs(pl.distanceToPoint(mid));
          if (g < minGap) { minGap = g; nearestPlane = pl; }
        }
        if (minGap < 4) {
          const p = mid.clone().addScaledVector(nearestPlane.normal, -nearestPlane.distanceToPoint(mid));
          best = { p, gap: minGap };
        }
      }
    }
    if (best) {
      // 管底埋深: 交点处管中心的埋深(取两端插值) + 管外半径
      const ab = new THREE.Vector3().subVectors(r.b, r.a);
      const tt = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(best.p, r.a).dot(ab) / ab.lengthSq(), 0, 1);
      const centerDepth = -THREE.MathUtils.lerp(r.a.y, r.b.y, tt);
      const bury = centerDepth + r.outerRadius;
      labels.push({
        position: best.p.clone(),
        text: `${UTILITY_META[r.utility].name} ${r.seg.id}\n管底埋深 ${bury.toFixed(2)}m  DN${r.seg.diameter}`,
        color: UTILITY_META[r.utility].hex,
        segmentId: r.seg.id
      });
    }
  }
  // 控制标注密度: 同行业只保留最贴近坑口的前若干条, 避免遮挡
  const perUtility = new Map<string, number>();
  return labels.filter((l) => {
    const u = l.text.split(' ')[0];
    const n = perUtility.get(u) ?? 0;
    if (n >= 4) return false;
    perUtility.set(u, n + 1);
    return true;
  });
}

export function buildPit(plan: ExcavationPlan, wboit: Wboit, runtime: RuntimeSegment[]): PitBuild {
  const group = new THREE.Group();
  group.name = 'pit';
  const inset = plan.depth * plan.slope;
  const bottomRing = insetPolygon(plan.polygon, inset);
  const planes = buildPlanes(plan.polygon, plan.depth, plan.slope);

  const wallGeo = buildWallGeometry(plan.polygon, bottomRing, plan.depth);
  const wallMat = wboit.registerStandard(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide
    })
  );
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.renderOrder = 30;
  group.add(wall);

  // 坑口轮廓线
  const ringPts = plan.polygon.map(([x, y]) => new THREE.Vector3(x, 0.02, y));
  ringPts.push(ringPts[0].clone());
  const outline = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(ringPts),
    new THREE.LineBasicMaterial({ color: 0xff5252 })
  );
  group.add(outline);

  const labels = wallIntersections(runtime, planes, plan.depth);
  return { group, planes, labels };
}
