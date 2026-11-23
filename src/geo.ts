// 几何数学：全部解析算法。报警距离的唯一权威实现在这里（点到线段距离），
// 渲染侧的包络网格与着色器参数均由 envelope.ts 中同一组胶囊参数生成，保证一致。

export interface V3 { x: number; y: number; z: number }

/** 点 P 到线段 AB 的最短距离（3D，解析） */
export function pointSegDist(p: V3, a: V3, b: V3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + abx * t, cy = a.y + aby * t, cz = a.z + abz * t;
  const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 点 P 到线段 AB 的最近点 */
export function closestOnSeg(p: V3, a: V3, b: V3): V3 {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + abx * t, y: a.y + aby * t, z: a.z + abz * t };
}

/** 点在多边形内（射线法，2D xy） */
export function pointInPolygon(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 点到多边形边界的最短距离（2D） */
export function distToPolygonBoundary(px: number, py: number, poly: [number, number][]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const abx = bx - ax, aby = by - ay;
    const len2 = abx * abx + aby * aby;
    let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = px - (ax + abx * t), dy = py - (ay + aby * t);
    const d = Math.hypot(dx, dy);
    if (d < best) best = d;
  }
  return best;
}

/**
 * 判断点 (px,py,pz) 是否位于开挖体内（坑底多边形 poly，坑底高程 bottomZ，放坡比 slope）。
 * 开挖体：z ∈ [bottomZ, +∞)，水平截面 = 坑底多边形向外扩 (z - bottomZ) * slope。
 */
export function insideExcavation(
  px: number, py: number, pz: number,
  poly: [number, number][], bottomZ: number, slope: number,
): boolean {
  if (pz < bottomZ) return false;
  const expand = (pz - bottomZ) * slope;
  if (pointInPolygon(px, py, poly)) return true;
  return distToPolygonBoundary(px, py, poly) <= expand;
}

/** 多边形面积（带符号，CCW 为正） */
export function polygonArea(poly: [number, number][]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return s / 2;
}

/** 确保多边形逆时针 */
export function ensureCCW(poly: [number, number][]): [number, number][] {
  return polygonArea(poly) >= 0 ? poly : [...poly].reverse();
}

/**
 * 线段 (a→b, 3D) 与基坑各侧壁面的交点。
 * 侧壁 i：坑底边 (p_i → p_{i+1}) 沿坡度向外向上倾斜的平面。
 * 返回 {point, depth, edgeIndex} 列表（depth 为坑口地面起算的埋深）。
 */
export function segPitWallIntersections(
  a: V3, b: V3,
  poly: [number, number][], bottomZ: number, slope: number, groundZ: number,
): { p: V3; depth: number; edge: number }[] {
  const out: { p: V3; depth: number; edge: number }[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    // 边方向与面内上坡方向（水平外法线 * slope + 竖直 1）
    const ex = x1 - x0, ey = y1 - y0;
    const elen = Math.hypot(ex, ey) || 1;
    // CCW 多边形的外法线（指向右侧）
    let nx = ey / elen, ny = -ex / elen;
    // 面内一点（坑底边中点）
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, mz = bottomZ;
    // 平面法线 = 边方向 × 坡向；坡向 = (nx*slope, ny*slope, 1)
    const sx = nx * slope, sy = ny * slope, sz = 1;
    // N = E × S
    const Nx = ey * sz - 0 * sy, Ny = 0 * sx - ex * sz, Nz = ex * sy - ey * sx;
    const d = Nx * mx + Ny * my + Nz * mz;
    const da = Nx * a.x + Ny * a.y + Nz * a.z - d;
    const db = Nx * b.x + Ny * b.y + Nz * b.z - d;
    if (da * db > 0) continue; // 同侧无交
    const denom = da - db;
    if (Math.abs(denom) < 1e-12) continue;
    const t = da / denom;
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    const pz = a.z + (b.z - a.z) * t;
    if (pz < bottomZ - 1e-6 || pz > groundZ + 1e-6) continue;
    // 交点须落在该壁面范围内：到边直线的水平距离 ≈ (pz-bottomZ)*slope，且沿边方向在边的跨度内
    const along = ((px - x0) * ex + (py - y0) * ey) / (elen * elen);
    if (along < -1e-6 || along > 1 + 1e-6) continue;
    const perp = (px - mx) * nx + (py - my) * ny;
    const expect = (pz - bottomZ) * slope;
    if (Math.abs(perp - expect) > Math.max(0.05, 0.05 * expect)) continue;
    out.push({ p: { x: px, y: py, z: pz }, depth: groundZ - pz, edge: i });
  }
  return out;
}

/** 线段与竖直剖切面（过 (x0,y0)→(x1,y1) 的竖直平面）求交，返回沿剖面线的里程 s 与交点 */
export function segSectionPlaneHit(
  a: V3, b: V3, x0: number, y0: number, x1: number, y1: number,
): { s: number; p: V3 } | null {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const nx = dy / len, ny = -dx / len; // 平面法线（水平）
  const da = (a.x - x0) * nx + (a.y - y0) * ny;
  const db = (b.x - x0) * nx + (b.y - y0) * ny;
  if (da * db > 0) return null;
  const denom = da - db;
  if (Math.abs(denom) < 1e-12) return null;
  const t = da / denom;
  if (t < 0 || t > 1) return null;
  const px = a.x + (b.x - a.x) * t;
  const py = a.y + (b.y - a.y) * t;
  const pz = a.z + (b.z - a.z) * t;
  const s = (px - x0) * (dx / len) + (py - y0) * (dy / len);
  if (s < -1e-6 || s > len + 1e-6) return null;
  return { s, p: { x: px, y: py, z: pz } };
}

/** 点到竖直剖切面的水平距离（带符号） */
export function distToSectionPlane(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  return ((px - x0) * dy - (py - y0) * dx) / len;
}
