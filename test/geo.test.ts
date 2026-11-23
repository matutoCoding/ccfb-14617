// 精度验证：解析距离（报警依据） vs 渲染包络网格表面距离，任意姿态/位置偏差 ≤1cm。
// 运行：npm run test:geo

declare const process: { exit(code: number): void };

import * as THREE from 'three';
import { pointSegDist, segPitWallIntersections, insideExcavation } from '../src/geo';
import { uncertaintyRadius, outerRadius, distToEnvelope, buildEntity, alarmFor, nearestEnvelope } from '../src/envelope';
import { PipeSegment, PipePoint, PipeCategory, SurveyMethod, PointType } from '../src/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (!cond) { failures++; console.error(`✗ ${name} ${detail}`); }
  else console.log(`✓ ${name}`);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(42);

// —— 1. pointSegDist 正确性（对照 20000 步暴力采样）——
{
  let maxErr = 0;
  for (let i = 0; i < 500; i++) {
    const a = { x: rnd() * 100 - 50, y: rnd() * 100 - 50, z: 95 + rnd() * 5 };
    const b = { x: rnd() * 100 - 50, y: rnd() * 100 - 50, z: 95 + rnd() * 5 };
    const p = { x: rnd() * 100 - 50, y: rnd() * 100 - 50, z: 95 + rnd() * 5 };
    const analytic = pointSegDist(p, a, b);
    let brute = Infinity;
    for (let k = 0; k <= 20000; k++) {
      const t = k / 20000;
      const dx = p.x - (a.x + (b.x - a.x) * t);
      const dy = p.y - (a.y + (b.y - a.y) * t);
      const dz = p.z - (a.z + (b.z - a.z) * t);
      brute = Math.min(brute, Math.hypot(dx, dy, dz));
    }
    maxErr = Math.max(maxErr, Math.abs(analytic - brute));
  }
  check('pointSegDist 与暴力采样一致 (<1mm)', maxErr < 1e-3, `maxErr=${maxErr}`);
}

// —— 2. 点到三角形距离（测试辅助）——
function pointTriangleDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const ab = b.clone().sub(a), ac = c.clone().sub(a), ap = p.clone().sub(a);
  const d1 = ab.dot(ap), d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return ap.length();
  const bp = p.clone().sub(b);
  const d3 = ab.dot(bp), d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return bp.length();
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const den = d1 - d3;
    return ap.clone().sub(ab.clone().multiplyScalar(den === 0 ? 0 : d1 / den)).length();
  }
  const cp = p.clone().sub(c);
  const d5 = ab.dot(cp), d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return cp.length();
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const den = d2 - d6;
    return ap.clone().sub(ac.clone().multiplyScalar(den === 0 ? 0 : d2 / den)).length();
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return bp.clone().sub(c.clone().sub(b).multiplyScalar(w)).length();
  }
  const n = ab.clone().cross(ac);
  return Math.abs(ap.dot(n) / n.length());
}

// —— 3. 渲染包络网格（与 pipes.ts 完全相同的构造参数）与解析包络的一致性 ——
// 可见包络面 = 着色器 SDF=0 的理想胶囊面（与解析距离同源）；几何体只是外扩 18% 的载体。
// 需验证：a) 网格局部弦高差远小于外扩量（理想胶囊面完整落在载体内部，不会被载体裁掉）；
//         b) 载体之外的点：到网格面距离 + 外扩量 ≈ 解析包络距离（≤1cm）。
{
  const envR = 0.65, len = 25, inflate = 1.18;
  const radialSeg = 32, capSeg = 8;
  const geo = new THREE.CapsuleGeometry(envR * inflate, len, capSeg, radialSeg);
  // a) 弦高差：径向与帽顶两个方向
  const sagRadial = envR * inflate * (1 - Math.cos(Math.PI / radialSeg));
  const sagCap = envR * inflate * (1 - Math.cos(Math.PI / (2 * capSeg)));
  const margin = envR * (inflate - 1);
  check('网格弦高差 << 几何外扩量', Math.max(sagRadial, sagCap) < margin * 0.2,
    `sag=${(Math.max(sagRadial, sagCap) * 1000).toFixed(1)}mm margin=${(margin * 1000).toFixed(0)}mm`);

  // b) 载体外部点：网格面距离换算 vs 解析
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex();
  const tris: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [];
  const readV = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) tris.push([readV(idx.getX(i)), readV(idx.getX(i + 1)), readV(idx.getX(i + 2))]);
  } else {
    for (let i = 0; i < pos.count; i += 3) tris.push([readV(i), readV(i + 1), readV(i + 2)]);
  }
  const A = { x: 0, y: -len / 2, z: 0 }, B = { x: 0, y: len / 2, z: 0 };
  let maxErr = 0;
  for (let i = 0; i < 300; i++) {
    const theta = rnd() * Math.PI * 2;
    const y = (rnd() - 0.5) * (len + 4);
    const r = envR * inflate + 0.05 + rnd() * 0.6; // 明确在载体之外
    const p = new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r);
    const analytic = pointSegDist({ x: p.x, y: p.y, z: p.z }, A, B) - envR;
    let meshD = Infinity;
    for (const [a, b, c] of tris) meshD = Math.min(meshD, pointTriangleDist(p, a, b, c));
    const viaMesh = meshD + envR * (inflate - 1);
    maxErr = Math.max(maxErr, Math.abs(viaMesh - analytic));
  }
  check('渲染包络面 vs 解析距离 ≤1cm', maxErr <= 0.01, `maxErr=${(maxErr * 1000).toFixed(1)}mm`);
}

// —— 4. 不确定度分级：开挖实测 < 电磁法 < 探地雷达 < 推测 ——
{
  const mk = (method: SurveyMethod, precision: 'A' | 'B' | 'C' | '', inferred = false): PipeSegment => ({
    id: 't', startId: 'a', endId: 'b', category: PipeCategory.Gas, section: 'circle',
    diameter: 300, material: 'PE', startDepth: 1.2, endDepth: 1.2, depthInferred: inferred,
    method, precision, owner: '',
  });
  const rExc = uncertaintyRadius(mk(SurveyMethod.Excavation, 'A'));
  const rEm = uncertaintyRadius(mk(SurveyMethod.Electromagnetic, 'B'));
  const rGpr = uncertaintyRadius(mk(SurveyMethod.GPR, 'B'));
  const rInf = uncertaintyRadius(mk(SurveyMethod.Electromagnetic, 'B', true));
  const rNoPrec = uncertaintyRadius(mk(SurveyMethod.Excavation, ''));
  check('不确定度 实测<电磁<雷达<推测', rExc < rEm && rEm < rGpr && rGpr < rInf);
  check('缺精度等级按推测', rNoPrec === rInf);
}

// —— 5. distToEnvelope / 报警阈值 ——
{
  const pts = new Map<string, PipePoint>([
    ['a', { id: 'a', x: 0, y: 0, groundElev: 100, type: PointType.General, feature: '' }],
    ['b', { id: 'b', x: 20, y: 0, groundElev: 100, type: PointType.General, feature: '' }],
  ]);
  const seg: PipeSegment = {
    id: 'g1', startId: 'a', endId: 'b', category: PipeCategory.Gas, section: 'circle',
    diameter: 300, material: 'PE', startDepth: 1.0, endDepth: 1.0, depthInferred: false,
    method: SurveyMethod.Excavation, precision: 'A', owner: '燃气集团',
  };
  const e = buildEntity(seg, pts, { x: 0, y: 0 })!;
  // 管中心 z=99，outerR=0.15，uncR=0.05(实测A=0.05-0.05→max(0.03,0)=0.03)
  const tip1 = { x: 10, y: 0, z: 99 + 0.15 + 0.03 + 0.4 }; // 包络面外 0.4m
  const d1 = distToEnvelope(tip1, e);
  check('包络距离解析值正确', Math.abs(d1 - 0.4) < 1e-9, `d1=${d1}`);
  const hit = nearestEnvelope({ x: 10, y: 0, z: 99 + 0.18 + 0.6 }, [e]);
  check('燃气 1m 内黄警', alarmFor(hit).level === 'caution');
  const hit2 = nearestEnvelope({ x: 10, y: 0, z: 99 + 0.18 + 0.3 }, [e]);
  check('燃气 0.5m 内红警', alarmFor(hit2).level === 'danger');
  const hit3 = nearestEnvelope({ x: 10, y: 0, z: 99 + 0.18 + 1.2 }, [e]);
  check('1m 以外安全', alarmFor(hit3).level === 'safe');
}

// —— 6. 基坑裁剪/坑壁求交自洽 ——
{
  const poly: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const bottomZ = 97.5, slope = 1.0, groundZ = 100;
  check('坑内点判定', insideExcavation(5, 5, 99, poly, bottomZ, slope));
  check('坑底以下不判定', !insideExcavation(5, 5, 97, poly, bottomZ, slope));
  check('坡面外不判定（z=99 外扩1.5m，x=12 在坡外）', !insideExcavation(12, 5, 99, poly, bottomZ, slope));
  check('坡面上判定（外扩1.5@z=99）', insideExcavation(11, 5, 99.4, poly, bottomZ, slope));
  // 一根横穿基坑的管，应交出两个坑壁点
  const hits = segPitWallIntersections(
    { x: -5, y: 5, z: 98.5 }, { x: 15, y: 5, z: 98.5 },
    poly, bottomZ, slope, groundZ,
  );
  check('横穿管线交出两个坑壁点', hits.length === 2, `hits=${hits.length}`);
  if (hits.length === 2) {
    const ok = hits.every(h => Math.abs(h.p.z - 98.5) < 1e-6 && Math.abs(h.depth - 1.5) < 1e-6);
    check('坑壁交点高程/埋深正确', ok, JSON.stringify(hits.map(h => h.p)));
  }
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
