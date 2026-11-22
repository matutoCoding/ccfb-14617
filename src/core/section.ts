// 任意直线横断面: 求各管段与切面的交点, 2D 绘制断面位置/埋深/相互净距
// 净距不满足 GB 50289 控制值标红
import * as THREE from 'three';
import { MIN_HORIZONTAL_CLEARANCE, MIN_VERTICAL_CLEARANCE, UTILITY_META } from '../domain/constants';
import type { RuntimeSegment } from './pipelineBuilder';

export interface SectionCut {
  a: [number, number];
  b: [number, number];
}

export interface SectionItem {
  segmentId: string;
  utility: RuntimeSegment['utility'];
  /** 断面横向坐标(米, 相对切点起点) */
  s: number;
  /** 管中心世界 z(负值) */
  z: number;
  /** 管底埋深(米) */
  depth: number;
  radius: number;
  envelopeRadius: number;
  diameter: number;
  inferred: boolean;
}

/** 线段与竖直切面的交点(平面几何, 忽略平行) */
export function cutSection(cut: SectionCut, runtime: RuntimeSegment[]): SectionItem[] {
  const [ax, ay] = cut.a;
  const [bx, by] = cut.b;
  const dx = bx - ax;
  const dy = by - ay;
  const cutLen = Math.hypot(dx, dy);
  // 切线单位向量与法向
  const ux = dx / cutLen;
  const uy = dy / cutLen;
  const items: SectionItem[] = [];

  for (const r of runtime) {
    const p1x = r.a.x;
    const p1y = r.a.z; // 世界 xz 平面
    const p2x = r.b.x;
    const p2y = r.b.z;
    const ex = p2x - p1x;
    const ey = p2y - p1y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-9) continue;
    // 求 cut: P=a+t*d 与 seg: Q=p1+u*e 的交点
    const tx = p1x - ax;
    const ty = p1y - ay;
    const t = (tx * ey - ty * ex) / denom;
    const u = (tx * dy - ty * dx) / denom;
    if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) continue;
    const ix = ax + t * dx;
    const iy = ay + t * dy;
    const s = (ix - ax) * ux + (iy - ay) * uy;
    const z = THREE.MathUtils.lerp(r.a.y, r.b.y, THREE.MathUtils.clamp(u, 0, 1));
    items.push({
      segmentId: r.seg.id,
      utility: r.utility,
      s,
      z,
      depth: -z + r.outerRadius,
      radius: r.outerRadius,
      envelopeRadius: r.envelopeRadius,
      diameter: r.seg.diameter,
      inferred: !!r.seg.inferred
    });
  }
  items.sort((m, n) => m.s - n.s);
  return items;
}

export interface ClearanceViolation {
  idA: string;
  idB: string;
  utilityA: string;
  utilityB: string;
  verticalGap: number;
  horizontalGap: number;
  minVertical: number;
  minHorizontal: number;
  reason: string;
}

/** 断面内两两净距校核 */
export function checkClearances(items: SectionItem[]): ClearanceViolation[] {
  const violations: ClearanceViolation[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const horizontalGap = Math.abs(a.s - b.s) - (a.radius + b.radius);
      const verticalGap = Math.abs(a.z - b.z) - (a.radius + b.radius);
      const minV = MIN_VERTICAL_CLEARANCE[a.utility][b.utility];
      const minH = Math.max(MIN_HORIZONTAL_CLEARANCE[a.utility], MIN_HORIZONTAL_CLEARANCE[b.utility]);
      // 上下叠置(水平几乎重合)时校核垂直净距, 否则校核水平净距
      const stacked = Math.abs(a.s - b.s) < a.radius + b.radius + 0.3;
      if (stacked && verticalGap < minV) {
        violations.push({
          idA: a.segmentId,
          idB: b.segmentId,
          utilityA: UTILITY_META[a.utility].name,
          utilityB: UTILITY_META[b.utility].name,
          verticalGap,
          horizontalGap,
          minVertical: minV,
          minHorizontal: minH,
          reason: `垂直净距 ${verticalGap.toFixed(2)}m < 规范 ${minV.toFixed(2)}m`
        });
      } else if (!stacked && horizontalGap < minH) {
        violations.push({
          idA: a.segmentId,
          idB: b.segmentId,
          utilityA: UTILITY_META[a.utility].name,
          utilityB: UTILITY_META[b.utility].name,
          verticalGap,
          horizontalGap,
          minVertical: minV,
          minHorizontal: minH,
          reason: `水平净距 ${horizontalGap.toFixed(2)}m < 规范 ${minH.toFixed(2)}m`
        });
      }
    }
  }
  return violations;
}

/** 在 2D canvas 上绘制横断面图 */
export function drawSection(
  canvas: HTMLCanvasElement,
  cut: SectionCut,
  items: SectionItem[],
  violations: ClearanceViolation[]
): void {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#101826';
  ctx.fillRect(0, 0, W, H);

  const padL = 56;
  const padR = 24;
  const padT = 30;
  const padB = 44;
  const cutLen = Math.hypot(cut.b[0] - cut.a[0], cut.b[1] - cut.a[1]);
  const maxDepth = Math.max(5, ...items.map((i) => i.depth + 0.5));
  const xOf = (s: number) => padL + (s / cutLen) * (W - padL - padR);
  const yOf = (depth: number) => padT + (depth / maxDepth) * (H - padT - padB);

  // 地层带
  const bands = [
    { name: '杂填土', to: 1.5, color: 'rgba(141,110,99,0.35)' },
    { name: '粉质黏土', to: 3.6, color: 'rgba(201,160,106,0.28)' },
    { name: '砂层', to: maxDepth, color: 'rgba(224,200,138,0.22)' }
  ];
  let prev = 0;
  for (const band of bands) {
    ctx.fillStyle = band.color;
    ctx.fillRect(padL, yOf(prev), W - padL - padR, yOf(band.to) - yOf(prev));
    ctx.fillStyle = '#8fa3b8';
    ctx.font = '11px sans-serif';
    ctx.fillText(band.name, padL + 6, yOf(prev) + 14);
    prev = band.to;
  }
  // 地面线
  ctx.strokeStyle = '#cfd8dc';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padL, yOf(0));
  ctx.lineTo(W - padR, yOf(0));
  ctx.stroke();

  // 网格 + 埋深刻度
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#90a4ae';
  ctx.font = '10px sans-serif';
  for (let d = 0.5; d <= maxDepth; d += 0.5) {
    const y = yOf(d);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(`${d.toFixed(1)}m`, 8, y + 3);
  }

  const badPairs = new Set(violations.flatMap((v) => [v.idA + '|' + v.idB, v.idB + '|' + v.idA]));

  // 管线断面圆 + 包络虚线圆
  for (const it of items) {
    const x = xOf(it.s);
    const y = yOf(it.depth);
    const meta = UTILITY_META[it.utility];
    // 包络
    ctx.beginPath();
    ctx.arc(x, y, Math.max(4, it.envelopeRadius * ((H - padT - padB) / maxDepth)), 0, Math.PI * 2);
    ctx.strokeStyle = meta.hex + '88';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    // 管体
    const rr = Math.max(5, it.radius * ((H - padT - padB) / maxDepth));
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fillStyle = meta.hex;
    ctx.fill();
    ctx.strokeStyle = it.inferred ? '#ff7043' : '#0b1018';
    ctx.lineWidth = it.inferred ? 2 : 1;
    ctx.stroke();
    // 标签
    ctx.fillStyle = '#eceff1';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${meta.name} DN${it.diameter}`, x + rr + 4, y - 4);
    ctx.fillStyle = it.inferred ? '#ffab91' : '#b0bec5';
    ctx.fillText(`埋深${it.depth.toFixed(2)}m${it.inferred ? '(推测)' : ''}`, x + rr + 4, y + 10);
  }

  // 违规连线标红
  ctx.strokeStyle = '#ff1744';
  ctx.lineWidth = 2;
  for (const v of violations) {
    const ia = items.find((i) => i.segmentId === v.idA)!;
    const ib = items.find((i) => i.segmentId === v.idB)!;
    ctx.beginPath();
    ctx.moveTo(xOf(ia.s), yOf(ia.depth));
    ctx.lineTo(xOf(ib.s), yOf(ib.depth));
    ctx.stroke();
    const mx = (xOf(ia.s) + xOf(ib.s)) / 2;
    const my = (yOf(ia.depth) + yOf(ib.depth)) / 2;
    ctx.fillStyle = '#ff1744';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('✕ ' + v.reason, mx + 4, my);
  }

  // 标题
  ctx.fillStyle = '#eceff1';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(`横断面 (${cut.a[0].toFixed(1)},${cut.a[1].toFixed(1)}) → (${cut.b[0].toFixed(1)},${cut.b[1].toFixed(1)})  共 ${items.length} 处管线`, padL, 18);
  void badPairs;
}
