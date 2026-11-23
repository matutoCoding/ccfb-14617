// 横断面：沿任意剖切线计算各管线断面位置、埋深、相互净距，并绘制 2D 断面图

import { PipeEntity, CATEGORY_COLORS, PipeCategory, ExcavationPlan } from './types';
import { store } from './store';
import { requiredClearance } from './clearance';

export interface SectionPipe {
  e: PipeEntity;
  s: number;      // 沿剖面线里程 m
  z: number;      // 管中心高程 m
  depth: number;  // 埋深 m
}

export interface ClearanceViolation {
  a: string; b: string;
  catA: PipeCategory; catB: PipeCategory;
  actual: number; required: number;
}

/** 计算剖切线 (x0,y0)-(x1,y1) 穿过的管线（包络与竖直剖切面相交即计入） */
export function computeSection(
  x0: number, y0: number, x1: number, y1: number,
  entities = store.entities,
): SectionPipe[] {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [];
  const nx = dy / len, ny = -dx / len;
  const out: SectionPipe[] = [];
  for (const e of entities) {
    const da = (e.ax - x0) * nx + (e.ay - y0) * ny;
    const db = (e.bx - x0) * nx + (e.by - y0) * ny;
    let t: number;
    if (da * db <= 0) {
      const denom = da - db;
      t = Math.abs(denom) < 1e-12 ? 0 : da / denom;
    } else {
      t = Math.abs(da) < Math.abs(db) ? 0 : 1;
      const dMin = Math.min(Math.abs(da), Math.abs(db));
      if (dMin > e.envR) continue;
    }
    const px = e.ax + (e.bx - e.ax) * t;
    const py = e.ay + (e.by - e.ay) * t;
    const pz = e.az + (e.bz - e.az) * t;
    const s = (px - x0) * (dx / len) + (py - y0) * (dy / len);
    if (s < -e.envR || s > len + e.envR) continue;
    out.push({ e, s, z: pz, depth: store.baseElev - pz });
  }
  return out.sort((a, b) => a.s - b.s);
}

/** 净距检查：断面内两两管线表面净距 vs 规范要求 */
export function checkClearances(pipes: SectionPipe[]): ClearanceViolation[] {
  const out: ClearanceViolation[] = [];
  for (let i = 0; i < pipes.length; i++) {
    for (let j = i + 1; j < pipes.length; j++) {
      const A = pipes[i], B = pipes[j];
      const dx = Math.abs(A.s - B.s), dz = Math.abs(A.z - B.z);
      const surf = Math.hypot(dx, dz) - A.e.outerR - B.e.outerR;
      const req = requiredClearance(A.e.seg.category, B.e.seg.category);
      const need = dz > dx ? req.v : req.h;
      if (surf < need) {
        out.push({
          a: A.e.seg.id, b: B.e.seg.id,
          catA: A.e.seg.category, catB: B.e.seg.category,
          actual: surf, required: need,
        });
      }
    }
  }
  return out;
}

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/** 绘制横断面图到 canvas，返回净距违规列表 */
export function drawSection(
  canvas: HTMLCanvasElement,
  pipes: SectionPipe[],
  opts?: { title?: string; lineLen?: number },
): ClearanceViolation[] {
  const violations = checkClearances(pipes);
  const bad = new Set<string>();
  for (const v of violations) { bad.add(v.a); bad.add(v.b); }

  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fbfcfd';
  ctx.fillRect(0, 0, W, H);
  const padL = 70, padR = 20, padT = 44, padB = 40;
  const sMax = opts?.lineLen ?? Math.max(10, ...pipes.map(p => p.s)) + 5;
  const zMax = store.baseElev + 1;
  const zMin = Math.min(store.baseElev - 5, ...pipes.map(p => p.z - 1.5));
  const X = (s: number) => padL + (s / sMax) * (W - padL - padR);
  const Y = (z: number) => padT + ((zMax - z) / (zMax - zMin)) * (H - padT - padB);
  const scale = (W - padL - padR) / sMax; // px per m（水平）
  const scaleZ = (H - padT - padB) / (zMax - zMin);

  // 地面线
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padL, Y(store.baseElev));
  ctx.lineTo(W - padR, Y(store.baseElev));
  ctx.stroke();
  ctx.fillStyle = '#444';
  ctx.font = '13px "Microsoft YaHei", sans-serif';
  ctx.fillText(`地面 ${store.baseElev.toFixed(2)}m`, 6, Y(store.baseElev) - 5);

  // 高程刻度
  ctx.fillStyle = '#888';
  ctx.font = '11px sans-serif';
  for (let z = Math.ceil(zMin); z <= zMax; z++) {
    ctx.fillText(`${z.toFixed(0)}m`, 40, Y(z) + 4);
    ctx.strokeStyle = '#e5e8ec';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, Y(z)); ctx.lineTo(W - padR, Y(z)); ctx.stroke();
  }

  // 管线
  for (const p of pipes) {
    const x = X(p.s), y = Y(p.z);
    const r = Math.max(3, p.e.outerR * (scale + scaleZ) / 2);
    const rEnv = Math.max(r + 2, p.e.envR * (scale + scaleZ) / 2);
    // 包络圈
    ctx.strokeStyle = p.e.seg.depthInferred ? '#c0c6cc' : '#9aa4ae';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, rEnv, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // 管体
    ctx.fillStyle = css(CATEGORY_COLORS[p.e.seg.category]);
    ctx.strokeStyle = bad.has(p.e.seg.id) ? '#ff1744' : '#222';
    ctx.lineWidth = bad.has(p.e.seg.id) ? 3 : 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 标注
    ctx.fillStyle = bad.has(p.e.seg.id) ? '#ff1744' : '#222';
    ctx.font = '11px "Microsoft YaHei", sans-serif';
    ctx.fillText(`${p.e.seg.id} 埋深${p.depth.toFixed(2)}`, x + rEnv + 3, y + 4);
  }

  // 标题与违规汇总
  ctx.fillStyle = '#111';
  ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
  ctx.fillText(opts?.title ?? '横断面图', padL, 24);
  if (violations.length > 0) {
    ctx.fillStyle = '#ff1744';
    ctx.font = '12px "Microsoft YaHei", sans-serif';
    ctx.fillText(`净距不满足规范 ${violations.length} 处（红框）`, padL + 160, 24);
  }
  // 里程轴
  ctx.fillStyle = '#666';
  ctx.font = '11px sans-serif';
  for (let s = 0; s <= sMax; s += Math.max(1, Math.round(sMax / 8))) {
    ctx.fillText(`${s.toFixed(0)}`, X(s) - 4, H - padB + 16);
  }
  ctx.fillText('里程 m', W / 2 - 20, H - 6);
  return violations;
}

/** 平面俯视图（管线 + 基坑轮廓） */
export function drawPlanView(
  canvas: HTMLCanvasElement,
  entities: PipeEntity[],
  plan?: ExcavationPlan | null,
  sectionLine?: { x0: number; y0: number; x1: number; y1: number } | null,
): void {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fbfcfd';
  ctx.fillRect(0, 0, W, H);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const e of entities) {
    minX = Math.min(minX, e.ax, e.bx); maxX = Math.max(maxX, e.ax, e.bx);
    minY = Math.min(minY, e.ay, e.by); maxY = Math.max(maxY, e.ay, e.by);
  }
  if (!Number.isFinite(minX)) return;
  const pad = 40;
  const sc = Math.min((W - pad * 2) / (maxX - minX || 1), (H - pad * 2) / (maxY - minY || 1));
  const X = (x: number) => pad + (x - minX) * sc;
  const Y = (y: number) => H - pad - (y - minY) * sc;

  for (const e of entities) {
    ctx.strokeStyle = css(CATEGORY_COLORS[e.seg.category]);
    ctx.lineWidth = Math.max(1.5, e.outerR * sc);
    ctx.beginPath();
    ctx.moveTo(X(e.ax), Y(e.ay));
    ctx.lineTo(X(e.bx), Y(e.by));
    ctx.stroke();
  }
  if (plan) {
    ctx.strokeStyle = '#ff5722';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    plan.polygon.forEach(([x, y], i) => { i === 0 ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y)); });
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = '#ff5722';
    ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
    ctx.fillText(`基坑 ${plan.name} 深${plan.depth}m`, X(plan.polygon[0][0]), Y(plan.polygon[0][1]) - 8);
  }
  if (sectionLine) {
    ctx.strokeStyle = '#7b1fa2';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(X(sectionLine.x0), Y(sectionLine.y0));
    ctx.lineTo(X(sectionLine.x1), Y(sectionLine.y1));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 图例
  const cats = [...new Set(entities.map(e => e.seg.category))];
  ctx.font = '12px "Microsoft YaHei", sans-serif';
  cats.forEach((c, i) => {
    ctx.fillStyle = css(CATEGORY_COLORS[c]);
    ctx.fillRect(pad + i * 76, 10, 12, 12);
    ctx.fillStyle = '#222';
    ctx.fillText(c, pad + i * 76 + 16, 21);
  });
}
