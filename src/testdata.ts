// 测试数据生成：一个十字路口 + 两条支路，200+ 管段，含上下交叉；
// 按比例掺入坏数据（缺埋深、坐标重复/错位、精度等级未填、引用不存在管点）。

import { PipePoint, PipeSegment, PointType, PipeCategory, SurveyMethod, PrecisionLevel } from './types';
import { pointsToCsv, segmentsToCsv } from './csv';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RoadDef {
  name: string;
  x0: number; y0: number; x1: number; y1: number;
  boxDrain: boolean; // 是否方沟排水
}

const ROADS: RoadDef[] = [
  { name: 'A', x0: -150, y0: 0, x1: 150, y1: 0, boxDrain: true },   // 东西主干道
  { name: 'B', x0: 0, y0: -150, x1: 0, y1: 150, boxDrain: true },   // 南北主干道
  { name: 'C', x0: -80, y0: 90, x1: 90, y1: 90, boxDrain: false },  // 支路一（东西）
  { name: 'D', x0: -90, y0: -80, x1: -90, y1: 90, boxDrain: false },// 支路二（南北）
];

interface UtilDef {
  cat: PipeCategory;
  offset: number;       // 相对道路中心线的横向偏移 m
  depth: number;        // 基准埋深 m
  dia: number;          // mm
  material: string;
  pointType: PointType;
  owner: string;
  prefix: string;
}

const UTILS: UtilDef[] = [
  { cat: PipeCategory.Power, offset: 8.5, depth: 1.2, dia: 175, material: 'MPP', pointType: PointType.Manhole, owner: '市供电公司', prefix: 'DL' },
  { cat: PipeCategory.Telecom, offset: 6.5, depth: 1.0, dia: 110, material: 'PVC', pointType: PointType.Manhole, owner: '通信运营商联合', prefix: 'TX' },
  { cat: PipeCategory.Gas, offset: 4.5, depth: 1.4, dia: 300, material: 'PE', pointType: PointType.Valve, owner: '燃气集团', prefix: 'RQ' },
  { cat: PipeCategory.Water, offset: -4.5, depth: 1.6, dia: 400, material: '球墨铸铁', pointType: PointType.Valve, owner: '自来水公司', prefix: 'JS' },
  { cat: PipeCategory.Heat, offset: -6.5, depth: 1.8, dia: 500, material: '钢', pointType: PointType.General, owner: '热力公司', prefix: 'RL' },
  { cat: PipeCategory.Drainage, offset: 0, depth: 3.0, dia: 800, material: '钢筋混凝土', pointType: PointType.Manhole, owner: '市政排水处', prefix: 'PS' },
];

const METHODS: SurveyMethod[] = [SurveyMethod.Electromagnetic, SurveyMethod.GPR, SurveyMethod.Excavation];
const LEVELS: PrecisionLevel[] = ['A', 'B', 'C'];

export function generateTestData(): { pointCsv: string; segmentCsv: string; pointCount: number; segCount: number } {
  const rnd = mulberry32(20260417);
  const points: PipePoint[] = [];
  const segs: PipeSegment[] = [];
  const groundAt = (x: number, y: number) => 100 + 0.3 * Math.sin(x / 55) + 0.2 * Math.cos(y / 47);

  for (const road of ROADS) {
    const dx = road.x1 - road.x0, dy = road.y1 - road.y0;
    const len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;   // 道路方向
    const nx = -uy, ny = ux;              // 左法线
    const nSeg = Math.max(4, Math.round(len / 25));
    for (const u of UTILS) {
      const isDrain = u.cat === PipeCategory.Drainage;
      const section = u.cat === PipeCategory.Power ? 'duct'
        : (isDrain && road.boxDrain) ? 'box' : 'circle';
      // 每条管线一个随机游走的埋深序列
      let depth = u.depth + (rnd() - 0.5) * 0.2;
      const depths: number[] = [];
      for (let i = 0; i <= nSeg; i++) {
        depth += (rnd() - 0.5) * 0.12;
        depth = Math.max(0.7, Math.min(isDrain ? 4.2 : 2.6, depth));
        depths.push(depth);
      }
      // 交叉口处人为制造一处上下交叉冲突：燃气上抬、通信下压
      const ptIds: string[] = [];
      for (let i = 0; i <= nSeg; i++) {
        const t = i / nSeg;
        const cx = road.x0 + dx * t + nx * u.offset;
        const cy = road.y0 + dy * t + ny * u.offset;
        const id = `${u.prefix}${road.name}${String(i + 1).padStart(2, '0')}`;
        ptIds.push(id);
        points.push({
          id, x: cx, y: cy, groundElev: groundAt(cx, cy),
          type: i === 0 || i === nSeg ? PointType.General : u.pointType,
          feature: u.pointType === PointType.Manhole ? `井${i}` : '',
        });
      }
      for (let i = 0; i < nSeg; i++) {
        const method = METHODS[Math.floor(rnd() * METHODS.length)];
        const precision = LEVELS[Math.floor(rnd() * LEVELS.length)];
        segs.push({
          id: `${u.prefix}${road.name}S${String(i + 1).padStart(2, '0')}`,
          startId: ptIds[i], endId: ptIds[i + 1],
          category: u.cat, section: section as PipeSegment['section'],
          diameter: u.dia, material: u.material,
          startDepth: depths[i], endDepth: depths[i + 1],
          depthInferred: false, method, precision, owner: u.owner,
          ductRows: section === 'duct' ? 2 : undefined,
          ductCols: section === 'duct' ? 3 : undefined,
          boxWidth: section === 'box' ? 1.6 : undefined,
          boxHeight: section === 'box' ? 1.2 : undefined,
        });
      }
    }
  }

  // —— 制造上下交叉：支路C燃气在 x≈0 处上抬到 0.9m，主干道B通信保持 1.0m，形成近距交叉 ——
  for (const s of segs) {
    if (s.id.startsWith('RQC') && s.startDepth != null && s.endDepth != null) {
      s.startDepth = Math.max(0.8, s.startDepth - 0.5);
      s.endDepth = Math.max(0.8, s.endDepth - 0.5);
    }
  }

  // —— 掺坏数据 ——
  // 1) 缺埋深（交给导入端插值）
  const missSet = new Set(['JSA S03', 'RQB S05', 'TXA S07', 'PSD S02', 'RLB S04', 'JSC S01'].map(s => s.replace(' ', '')));
  for (const s of segs) {
    if (missSet.has(s.id)) { s.startDepth = null; s.endDepth = null; }
  }
  // 2) 精度等级未填
  let cleared = 0;
  for (const s of segs) {
    if (cleared < 9 && rnd() < 0.06) { s.precision = ''; cleared++; }
  }
  // 3) 坐标重复/错位：复制一个已有点（坐标完全相同）
  const dupSrc = points.find(p => p.id === 'JSA03')!;
  points.push({ ...dupSrc, id: 'JSA03B', feature: '普查重复采集点' });
  // 4) 引用不存在管点的坏段
  segs.push({
    id: 'BAD001', startId: 'GHOST01', endId: 'JSA03', category: PipeCategory.Water,
    section: 'circle', diameter: 300, material: 'PE', startDepth: 1.5, endDepth: 1.5,
    depthInferred: false, method: SurveyMethod.Electromagnetic, precision: 'B', owner: '自来水公司',
  });

  return {
    pointCsv: pointsToCsv(points),
    segmentCsv: segmentsToCsv(segs),
    pointCount: points.length,
    segCount: segs.length,
  };
}
