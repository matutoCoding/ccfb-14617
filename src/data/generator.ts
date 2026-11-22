// 测试数据生成: 十字路口(东西主干道 + 南北主干道)+ 两条支路, 200+ 管段
// 含上下交叉、缺埋深、坐标重复、悬空引用、精度等级缺失等坏数据
import type { DetectMethod, PipePoint, PipeSegment, PointKind, UtilityType } from '../domain/types';
import { UTILITY_META } from '../domain/constants';

// 确定性伪随机
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261122);

interface GenCtx {
  points: PipePoint[];
  segments: PipeSegment[];
  seq: number;
}

function makePoint(
  ctx: GenCtx,
  utility: UtilityType,
  x: number,
  y: number,
  depth: number | null,
  method: DetectMethod,
  grade: PipePoint['grade'],
  kind: PointKind = 'ordinary'
): PipePoint {
  const p: PipePoint = {
    id: `${utility[0].toUpperCase()}${String(ctx.seq).padStart(4, '0')}`,
    kind,
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    depth,
    groundZ: 0,
    utility,
    method,
    grade,
    owner: UTILITY_META[utility].owner
  };
  ctx.seq++;
  ctx.points.push(p);
  return p;
}

function connect(
  ctx: GenCtx,
  utility: UtilityType,
  a: PipePoint,
  b: PipePoint,
  diameter: number,
  method: DetectMethod,
  grade: PipeSegment['grade'],
  extra: Partial<PipeSegment> = {}
): PipeSegment {
  const seg: PipeSegment = {
    id: `S-${utility[0].toUpperCase()}${String(ctx.segments.length + 1).padStart(4, '0')}`,
    utility,
    startId: a.id,
    endId: b.id,
    startDepth: a.depth,
    endDepth: b.depth,
    diameter,
    material: 'steel',
    method,
    grade,
    shape: 'round',
    owner: UTILITY_META[utility].owner,
    ...extra
  };
  ctx.segments.push(seg);
  return seg;
}

/** 沿一条折线按间距生成管点与管段 */
function runLine(
  ctx: GenCtx,
  utility: UtilityType,
  coords: [number, number][],
  baseDepth: number,
  diameter: number,
  spacing: number,
  method: DetectMethod,
  grade: PipePoint['grade'],
  shape: PipeSegment['shape'] = 'round',
  extra: Partial<PipeSegment> = {}
): PipePoint[] {
  const chain: PipePoint[] = [];
  for (let c = 0; c < coords.length - 1; c++) {
    const [x1, y1] = coords[c];
    const [x2, y2] = coords[c + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(1, Math.round(len / spacing));
    for (let i = 0; i <= n; i++) {
      if (c > 0 && i === 0) continue;
      const t = i / n;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      const depth = baseDepth + (rand() - 0.5) * 0.25;
      const kind: PointKind = i % 5 === 0 ? utility === 'drain' ? 'well' : utility === 'gas' || utility === 'water' ? 'valve' : 'ordinary' : 'ordinary';
      const p = makePoint(ctx, utility, x, y, Number(depth.toFixed(2)), method, grade, kind);
      chain.push(p);
    }
  }
  for (let i = 0; i < chain.length - 1; i++) {
    connect(ctx, utility, chain[i], chain[i + 1], diameter, method, grade, { shape, ...extra });
  }
  return chain;
}

export function generateDataset(): { points: PipePoint[]; segments: PipeSegment[] } {
  const ctx: GenCtx = { points: [], segments: [], seq: 1 };

  // 主干道: 东西向 y=0, x ∈ [-80,80]; 南北向 x=0, y ∈ [-60,60]
  // 支路1: 北端折向东 y∈[20,45]→x∈[0,35]; 支路2: 南端折向西 y∈[-20,-45]→x∈[0,-35]
  const ew: [number, number][] = [[-80, 0], [80, 0]];
  const ns: [number, number][] = [[0, -60], [0, 60]];
  const branch1: [number, number][] = [[0, 20], [0, 45], [35, 45]];
  const branch2: [number, number][] = [[0, -20], [0, -45], [-35, -45]];

  // ---- 给水: 东西+南北+两支路, 蓝色, 埋深 ~1.2m, 电磁法 B 级 ----
  runLine(ctx, 'water', ew, 1.2, 400, 10, 'electromagnetic', 'B');
  runLine(ctx, 'water', ns.map(([x, y]) => [x + 2.2, y] as [number, number]), 1.25, 300, 10, 'electromagnetic', 'B');
  runLine(ctx, 'water', branch1, 1.15, 200, 10, 'electromagnetic', 'B', 'round', { material: 'pe' });
  runLine(ctx, 'water', branch2, 1.3, 200, 10, 'gpr', 'B', 'round', { material: 'pe' });

  // ---- 排水: 重力流, 最深 2.2~3.0m, 混凝土管, 检查井多 ----
  const drainEW = runLine(ctx, 'drain', ew.map(([x, y]) => [x, y - 3.0] as [number, number]), 2.6, 800, 12, 'gpr', 'B', 'round', { material: 'concrete' });
  runLine(ctx, 'drain', ns.map(([x, y]) => [x - 2.5, y] as [number, number]), 2.8, 600, 12, 'gpr', 'B', 'round', { material: 'concrete' });
  runLine(ctx, 'drain', branch1, 2.4, 500, 12, 'gpr', 'B', 'round', { material: 'concrete' });
  runLine(ctx, 'drain', branch2, 2.7, 500, 12, 'gpr', 'B', 'round', { material: 'concrete' });
  // 排水方沟段(横穿路口下方)
  const boxA = makePoint(ctx, 'drain', -12, -2.5, 3.1, 'excavation', 'A', 'well');
  const boxB = makePoint(ctx, 'drain', 12, -2.5, 3.05, 'excavation', 'A', 'well');
  connect(ctx, 'drain', boxA, boxB, 1200, 'excavation', 'A', { shape: 'box', boxW: 1600, boxH: 1400, material: 'concrete' });
  void drainEW;

  // ---- 燃气: 中压钢管, 埋深 ~1.0m, 电磁法; 含开挖实测 A 级段 ----
  const gasEW = runLine(ctx, 'gas', ew.map(([x, y]) => [x, y + 2.0] as [number, number]), 1.0, 300, 9, 'electromagnetic', 'B', 'round', { material: 'steel' });
  runLine(ctx, 'gas', ns.map(([x, y]) => [x + 2.8, y] as [number, number]), 1.05, 250, 9, 'electromagnetic', 'B', 'round', { material: 'steel' });
  runLine(ctx, 'gas', branch1.map(([x, y]) => [x + 1.5, y] as [number, number]), 0.95, 200, 9, 'electromagnetic', 'B', 'round', { material: 'pe' });
  // 开挖实测段(A 级, 包络窄)
  const ga = gasEW.find((p) => Math.abs(p.x - 18) < 5)!;
  const gb = gasEW.find((p) => Math.abs(p.x - 36) < 5)!;
  if (ga && gb) {
    const a2 = makePoint(ctx, 'gas', ga.x, ga.y, 1.02, 'excavation', 'A', 'valve');
    const b2 = makePoint(ctx, 'gas', gb.x, gb.y, 0.98, 'excavation', 'A');
    connect(ctx, 'gas', a2, b2, 300, 'excavation', 'A', { material: 'steel' });
  }

  // ---- 电力: 排管(12 孔) + 电缆沟, 浅埋 0.8m ----
  runLine(ctx, 'power', ew.map(([x, y]) => [x, y - 1.8] as [number, number]), 0.85, 150, 12, 'electromagnetic', 'B', 'duct', { holes: 12, material: 'cable' });
  runLine(ctx, 'power', ns.map(([x, y]) => [x - 1.6, y] as [number, number]), 0.9, 150, 12, 'electromagnetic', 'B', 'duct', { holes: 8, material: 'cable' });
  runLine(ctx, 'power', branch2.map(([x, y]) => [x - 1.2, y] as [number, number]), 0.8, 150, 10, 'gpr', 'B', 'duct', { holes: 6, material: 'cable' });
  // 电力方沟
  const pa = makePoint(ctx, 'power', -18, 1.6, 1.0, 'excavation', 'A', 'well');
  const pb = makePoint(ctx, 'power', 6, 1.6, 0.95, 'excavation', 'A', 'well');
  connect(ctx, 'power', pa, pb, 100, 'excavation', 'A', { shape: 'box', boxW: 1200, boxH: 1000, material: 'concrete' });

  // ---- 通信: PVC 多孔管, 最浅 0.6~0.75m ----
  runLine(ctx, 'comm', ew.map(([x, y]) => [x, y + 3.2] as [number, number]), 0.7, 100, 12, 'gpr', 'B', 'duct', { holes: 6, material: 'pvc' });
  runLine(ctx, 'comm', ns.map(([x, y]) => [x + 3.4, y] as [number, number]), 0.72, 100, 12, 'gpr', 'B', 'duct', { holes: 4, material: 'pvc' });
  runLine(ctx, 'comm', branch1.map(([x, y]) => [x - 1.2, y] as [number, number]), 0.65, 100, 10, 'gpr', 'B', 'duct', { holes: 4, material: 'pvc' });

  // ---- 热力: 保温钢管, 埋深 1.5m ----
  runLine(ctx, 'heat', ew.map(([x, y]) => [x, y - 3.4] as [number, number]), 1.55, 500, 11, 'electromagnetic', 'B', 'round', { material: 'steel' });
  runLine(ctx, 'heat', ns.map(([x, y]) => [x - 3.2, y] as [number, number]), 1.6, 400, 11, 'electromagnetic', 'B', 'round', { material: 'steel' });

  // ================= 坏数据注入 =================
  // 1) 缺埋深(3 个管点) —— 导入时插值并标推测
  const noDepthTargets = ctx.points.filter((p) => p.utility === 'water').slice(20, 23);
  for (const p of noDepthTargets) p.depth = null;

  // 2) 精度等级未填(6 个点 + 4 条段), 含燃气
  const noGrade = ctx.points.filter((p) => p.utility === 'gas').slice(5, 11);
  for (const p of noGrade) p.grade = '';
  let gradeSegs = 0;
  for (const s of ctx.segments) {
    if (s.utility === 'gas' && gradeSegs < 4) {
      s.grade = '';
      gradeSegs++;
    }
  }

  // 3) 坐标重复(造一个与现有管点完全同坐标的新点)
  const dupSrc = ctx.points.find((p) => p.utility === 'comm')!;
  ctx.points.push({
    ...dupSrc,
    id: 'C-DUP01',
    depth: 0.71,
    kind: 'ordinary',
    grade: 'B'
  });

  // 4) 管段连到不存在的管点(悬空引用, 应报错并丢弃)
  ctx.segments.push({
    id: 'S-GHOST1',
    utility: 'water',
    startId: noDepthTargets[0]?.id ?? ctx.points[0].id,
    endId: 'W-NOEXIST',
    startDepth: 1,
    endDepth: 1,
    diameter: 200,
    material: 'pe',
    method: 'electromagnetic',
    grade: 'B',
    shape: 'round',
    owner: UTILITY_META.water.owner
  });
  ctx.segments.push({
    id: 'S-GHOST2',
    utility: 'power',
    startId: 'P-MISSING-A',
    endId: 'P-MISSING-B',
    startDepth: 0.8,
    endDepth: 0.8,
    diameter: 150,
    material: 'cable',
    method: 'gpr',
    grade: '',
    shape: 'duct',
    holes: 4,
    owner: UTILITY_META.power.owner
  });

  // 5) 一个孤立推测段(整条链埋深都缺, 触发行业默认值回退)
  const iso1 = makePoint(ctx, 'heat', 55, 30, null, 'inferred', '');
  const iso2 = makePoint(ctx, 'heat', 62, 30, null, 'inferred', '');
  connect(ctx, 'heat', iso1, iso2, 350, 'inferred', '', { material: 'steel' });

  return { points: ctx.points, segments: ctx.segments };
}
