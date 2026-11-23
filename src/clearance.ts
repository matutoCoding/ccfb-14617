// 管线综合净距（GB 50289《城市工程管线综合规划规范》简化取值，单位 m）
// 键为类别对（按码点排序拼接），值为 {水平净距, 垂直净距}

import { PipeCategory } from './types';

interface Clearance { h: number; v: number }

const C = PipeCategory;
const ROWS: [PipeCategory, PipeCategory, number, number][] = [
  [C.Water, C.Water, 0.5, 0.15],
  [C.Water, C.Drainage, 1.0, 0.4],
  [C.Water, C.Gas, 0.5, 0.15],
  [C.Water, C.Power, 0.5, 0.5],
  [C.Water, C.Telecom, 0.5, 0.5],
  [C.Water, C.Heat, 1.0, 0.15],
  [C.Drainage, C.Drainage, 1.0, 0.15],
  [C.Drainage, C.Gas, 1.0, 0.4],
  [C.Drainage, C.Power, 0.5, 0.5],
  [C.Drainage, C.Telecom, 0.5, 0.5],
  [C.Drainage, C.Heat, 1.0, 0.15],
  [C.Gas, C.Gas, 0.5, 0.15],
  [C.Gas, C.Power, 1.0, 0.5],
  [C.Gas, C.Telecom, 1.0, 0.5],
  [C.Gas, C.Heat, 1.0, 0.15],
  [C.Power, C.Power, 0.5, 0.5],
  [C.Power, C.Telecom, 0.5, 0.5],
  [C.Power, C.Heat, 2.0, 0.5],
  [C.Telecom, C.Telecom, 0.5, 0.25],
  [C.Telecom, C.Heat, 1.0, 0.5],
  [C.Heat, C.Heat, 0.5, 0.15],
];

const TABLE = new Map<string, Clearance>();
for (const [a, b, h, v] of ROWS) {
  TABLE.set([a as string, b as string].sort().join('|'), { h, v });
}

export function requiredClearance(a: PipeCategory, b: PipeCategory): Clearance {
  const key = [a as string, b as string].sort().join('|');
  return TABLE.get(key) ?? { h: 0.5, v: 0.3 };
}
