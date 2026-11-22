import type { AccuracyGrade, DetectMethod, StratumLayer, UtilityType } from './types';

/** 行业色标(参考 CJJ/T 7-2017 城市管线图示与常见 GIS 配色) */
export const UTILITY_META: Record<
  UtilityType,
  { name: string; color: number; hex: string; owner: string; defaultDepth: number }
> = {
  water: { name: '给水', color: 0x1e88e5, hex: '#1e88e5', owner: '市水务集团', defaultDepth: 1.2 },
  drain: { name: '排水', color: 0x6d4c41, hex: '#6d4c41', owner: '市排水公司', defaultDepth: 2.4 },
  gas: { name: '燃气', color: 0xfdd835, hex: '#fdd835', owner: '燃气集团', defaultDepth: 1.1 },
  power: { name: '电力', color: 0xe53935, hex: '#e53935', owner: '供电公司', defaultDepth: 0.9 },
  comm: { name: '通信', color: 0x7e57c2, hex: '#7e57c2', owner: '通信运营商', defaultDepth: 0.7 },
  heat: { name: '热力', color: 0xfb8c00, hex: '#fb8c00', owner: '热力公司', defaultDepth: 1.6 }
};

export const UTILITY_ORDER: UtilityType[] = ['water', 'drain', 'gas', 'power', 'comm', 'heat'];

export const METHOD_META: Record<DetectMethod, { name: string; baseUncertainty: number }> = {
  excavation: { name: '开挖实测', baseUncertainty: 0.08 },
  electromagnetic: { name: '电磁法', baseUncertainty: 0.3 },
  gpr: { name: '探地雷达', baseUncertainty: 0.25 },
  inferred: { name: '推测', baseUncertainty: 0.5 }
};

export const GRADE_META: Record<AccuracyGrade, { name: string; factor: number }> = {
  A: { name: 'A 级(实测)', factor: 0.6 },
  B: { name: 'B 级(物探)', factor: 1.0 },
  C: { name: 'C 级(推测)', factor: 1.8 }
};

/**
 * 不确定包络半径(米)= 探测方法基础误差 × 精度系数, 推测段额外加宽
 * 对应需求 5: 实测窄、电磁/雷达宽、推测更宽
 */
export function envelopeRadius(method: DetectMethod, grade: AccuracyGrade | '', inferred = false): number {
  const base = METHOD_META[method]?.baseUncertainty ?? 0.3;
  const factor = grade ? GRADE_META[grade].factor : 1.4;
  return base * factor * (inferred ? 1.5 : 1);
}

/** 地层: 杂填土 / 粉质黏土 / 砂层 */
export const STRATA: StratumLayer[] = [
  { name: '杂填土', bottomDepth: 1.5, color: 0x8d6e63, opacity: 0.28 },
  { name: '粉质黏土', bottomDepth: 3.6, color: 0xc9a06a, opacity: 0.24 },
  { name: '砂层', bottomDepth: 6.0, color: 0xe0c88a, opacity: 0.2 }
];

export const MATERIAL_NAME: Record<string, string> = {
  steel: '钢管',
  cast_iron: '铸铁管',
  pe: 'PE 管',
  pvc: 'PVC 管',
  concrete: '混凝土管',
  ductile_iron: '球墨铸铁管',
  cable: '电缆'
};

/**
 * 管线之间最小垂直净距(米), 依据 GB 50289《城市工程管线综合规划规范》常用控制值简化
 * 行=上方管线, 列=下方管线
 */
export const MIN_VERTICAL_CLEARANCE: Record<UtilityType, Record<UtilityType, number>> = {
  water: { water: 0.1, drain: 0.4, gas: 0.15, power: 0.5, comm: 0.5, heat: 0.15 },
  drain: { water: 0.4, drain: 0.15, gas: 0.15, power: 0.5, comm: 0.5, heat: 0.15 },
  gas: { water: 0.15, drain: 0.15, gas: 0.1, power: 0.5, comm: 0.5, heat: 0.15 },
  power: { water: 0.5, drain: 0.5, gas: 0.5, power: 0.5, comm: 0.25, heat: 0.5 },
  comm: { water: 0.5, drain: 0.5, gas: 0.5, power: 0.25, comm: 0.25, heat: 0.5 },
  heat: { water: 0.15, drain: 0.15, gas: 0.15, power: 0.5, comm: 0.5, heat: 0.1 }
};

/** 最小水平净距(米, 交叉/平行通用简化控制值) */
export const MIN_HORIZONTAL_CLEARANCE: Record<UtilityType, number> = {
  water: 0.8,
  drain: 1.0,
  gas: 1.0,
  power: 0.5,
  comm: 0.5,
  heat: 0.8
};

/** 燃气/电力作业防护阈值(米) */
export const ALARM_YELLOW = 1.0;
export const ALARM_RED = 0.5;
