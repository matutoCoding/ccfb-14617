// 齿尖 -> 各管线不确定包络外表面距离
// 权威值: 解析胶囊距离(点-线段距离 - 包络半径); 自检: 网格三角形暴力距离
import * as THREE from 'three';
import type { RuntimeSegment } from './pipelineBuilder';
import { pointToCapsuleSurface, pointToMeshDistance, type Vec3 } from './geo';
import { ALARM_RED, ALARM_YELLOW, UTILITY_META } from '../domain/constants';
import type { EnvelopeMesh } from './envelope';

export interface NearestHit {
  segmentId: string;
  utility: RuntimeSegment['utility'];
  /** 齿尖到包络外表面距离(米), 负值=已侵入 */
  distance: number;
  /** 最近点在线段上的参数 t */
  t: number;
  closest: Vec3;
  alarm: 'none' | 'yellow' | 'red';
  /** 仅燃气/电力触发报警, 其他行业只显示距离 */
  guarded: boolean;
}

function toVec3(v: THREE.Vector3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

/** 实时查询: 扫描全部管段, 返回最近包络命中 */
export function queryNearest(tooth: THREE.Vector3, runtime: RuntimeSegment[]): NearestHit | null {
  if (!runtime.length) return null;
  let best: NearestHit | null = null;
  const p = toVec3(tooth);
  for (const r of runtime) {
    const d = pointToCapsuleSurface(p, toVec3(r.a), toVec3(r.b), r.envelopeRadius);
    if (!best || d < best.distance) {
      const guarded = r.utility === 'gas' || r.utility === 'power';
      let alarm: NearestHit['alarm'] = 'none';
      if (guarded) {
        if (d <= ALARM_RED) alarm = 'red';
        else if (d <= ALARM_YELLOW) alarm = 'yellow';
      }
      // 最近点
      const ab = new THREE.Vector3().subVectors(r.b, r.a);
      const t = THREE.MathUtils.clamp(
        new THREE.Vector3().subVectors(tooth, r.a).dot(ab) / (ab.lengthSq() || 1),
        0,
        1
      );
      const closest = new THREE.Vector3().copy(r.a).addScaledVector(ab, t);
      best = {
        segmentId: r.seg.id,
        utility: r.utility,
        distance: d,
        t,
        closest: toVec3(closest),
        alarm,
        guarded
      };
    }
  }
  return best;
}

export interface SelfCheckResult {
  cases: {
    segmentId: string;
    utility: string;
    analytic: number;
    mesh: number;
    absError: number;
  }[];
  maxError: number;
  pass1cm: boolean;
}

/**
 * 距离算法自检: 随机姿态下对比"解析胶囊距离"与"包络网格三角形暴力距离"。
 * 要求最大绝对误差 <= 1cm。
 */
export function runDistanceSelfCheck(runtime: RuntimeSegment[], envelopes: EnvelopeMesh[]): SelfCheckResult {
  const envMap = new Map(envelopes.map((e) => [e.segmentId, e]));
  const cases: SelfCheckResult['cases'] = [];
  let maxError = 0;
  // 确定性采样点(不用 Math.random, 保证可复现)
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pick = runtime.filter((_, i) => i % Math.max(1, Math.floor(runtime.length / 24)) === 0).slice(0, 24);
  for (const r of pick) {
    const env = envMap.get(r.seg.id);
    if (!env) continue;
    const t = rnd();
    const onAxis = new THREE.Vector3().lerpVectors(r.a, r.b, t);
    // 在轴线周围不同方向、不同距离布点(含包络内外)
    const theta = rnd() * Math.PI * 2;
    const phi = Math.acos(2 * rnd() - 1);
    const offset = r.envelopeRadius * (0.4 + rnd() * 2.2);
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    );
    const probe = onAxis.clone().addScaledVector(dir, offset);
    const analytic = pointToCapsuleSurface(toVec3(probe), toVec3(r.a), toVec3(r.b), r.envelopeRadius);
    // 网格暴力法只给绝对表面距离; 内外符号以解析胶囊为准(两者为独立数值实现, 形成对照)
    const meshAbs = pointToMeshDistance(probe, env.mesh, 1).dist;
    const meshDist = analytic < 0 ? -meshAbs : meshAbs;
    const absError = Math.abs(analytic - meshDist);
    maxError = Math.max(maxError, absError);
    cases.push({
      segmentId: r.seg.id,
      utility: UTILITY_META[r.utility].name,
      analytic,
      mesh: meshDist,
      absError
    });
  }
  return { cases, maxError, pass1cm: maxError <= 0.01 };
}
