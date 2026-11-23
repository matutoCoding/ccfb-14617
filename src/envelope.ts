// 不确定包络：探测方法/精度等级 → 不确定度半径；管线实体（胶囊参数）构建；
// 齿尖到包络外表面的解析距离（报警的唯一数据源）。

import { PipeEntity, PipeSegment, PipePoint, SurveyMethod, PipeCategory } from './types';
import { pointSegDist, V3 } from './geo';

/**
 * 不确定度半径（m）：
 *  - 开挖实测：直接量测，最窄
 *  - 电磁法：平面与埋深均有 20~30cm 级误差
 *  - 探地雷达：略宽于电磁法
 *  - 推测（缺埋深插值 / 缺精度等级）：最宽
 * 精度等级 A/B/C 在方法基础上微调；缺精度等级一律按推测处理。
 */
export function uncertaintyRadius(seg: PipeSegment): number {
  if (seg.depthInferred || !seg.precision) return 0.50;
  const levelAdj = seg.precision === 'A' ? -0.05 : seg.precision === 'C' ? 0.05 : 0;
  let base: number;
  switch (seg.method) {
    case SurveyMethod.Excavation: base = 0.05; break;
    case SurveyMethod.Electromagnetic: base = 0.25; break;
    case SurveyMethod.GPR: base = 0.30; break;
    default: base = 0.50;
  }
  return Math.max(0.03, base + levelAdj);
}

/** 管段外半径（排管/方沟取外包络等效半径） */
export function outerRadius(seg: PipeSegment): number {
  if (seg.section === 'duct') {
    const rows = seg.ductRows ?? 2;
    const cols = seg.ductCols ?? 3;
    const d = seg.diameter / 1000;      // 单孔孔径 m
    const pitch = d * 1.5;              // 孔中心距（含管壁与净距）
    const w = (cols - 1) * pitch + d + 0.15; // 排管外包宽
    const h = (rows - 1) * pitch + d + 0.15;
    return Math.hypot(w, h) / 2;
  }
  if (seg.section === 'box') {
    const w = seg.boxWidth ?? 1.2, h = seg.boxHeight ?? 1.0;
    return Math.hypot(w, h) / 2;
  }
  return seg.diameter / 2000;
}

/** 由管段与管点表构建管线实体（局部坐标 = 原始坐标 - origin） */
export function buildEntity(
  seg: PipeSegment, points: Map<string, PipePoint>,
  origin: { x: number; y: number },
): PipeEntity | null {
  const pa = points.get(seg.startId);
  const pb = points.get(seg.endId);
  if (!pa || !pb) return null;
  const sd = seg.startDepth, ed = seg.endDepth;
  if (sd == null || ed == null) return null; // 缺埋深且未插值的不入库
  const outerR = outerRadius(seg);
  const uncR = uncertaintyRadius(seg);
  return {
    seg,
    ax: pa.x - origin.x, ay: pa.y - origin.y, az: pa.groundElev - sd,
    bx: pb.x - origin.x, by: pb.y - origin.y, bz: pb.groundElev - ed,
    outerR, uncR, envR: outerR + uncR,
  };
}

/** 点到管线实体包络外表面的解析距离（负值表示在包络内） */
export function distToEnvelope(p: V3, e: PipeEntity): number {
  return pointSegDist(p, { x: e.ax, y: e.ay, z: e.az }, { x: e.bx, y: e.by, z: e.bz }) - e.envR;
}

export interface NearestHit {
  entity: PipeEntity;
  dist: number;      // 到包络外表面距离 m
  centerDist: number;
}

/** 全部管线中距 p 最近的包络 */
export function nearestEnvelope(p: V3, entities: PipeEntity[]): NearestHit | null {
  let best: NearestHit | null = null;
  for (const e of entities) {
    const c = pointSegDist(p, { x: e.ax, y: e.ay, z: e.az }, { x: e.bx, y: e.by, z: e.bz });
    const d = c - e.envR;
    if (!best || d < best.dist) best = { entity: e, dist: d, centerDist: c };
  }
  return best;
}

/** 报警级别：燃气/电力 1m 黄、0.5m 红；其余类别仅提示 */
export type AlarmLevel = 'safe' | 'caution' | 'danger';

export function alarmFor(hit: NearestHit | null): { level: AlarmLevel; hit: NearestHit | null } {
  if (!hit) return { level: 'safe', hit };
  const cat = hit.entity.seg.category;
  const guarded = cat === PipeCategory.Gas || cat === PipeCategory.Power;
  if (guarded && hit.dist < 0.5) return { level: 'danger', hit };
  if (guarded && hit.dist < 1.0) return { level: 'caution', hit };
  return { level: 'safe', hit };
}
