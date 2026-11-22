// 领域模型与枚举

export type UtilityType = 'water' | 'drain' | 'gas' | 'power' | 'comm' | 'heat';

export type PointKind = 'well' | 'valve' | 'tee' | 'reducer' | 'ordinary';

export type DetectMethod = 'excavation' | 'electromagnetic' | 'gpr' | 'inferred';

/** 探测精度等级: A=开挖实测(最准) B=电磁/雷达常规 C=推测 */
export type AccuracyGrade = 'A' | 'B' | 'C';

export interface PipePoint {
  id: string;
  kind: PointKind;
  /** 平面坐标(米, 本地工程坐标系) */
  x: number;
  y: number;
  /** 管底埋深(米), null 表示缺失待插值 */
  depth: number | null;
  /** 地面高程(米) */
  groundZ: number;
  utility: UtilityType;
  method: DetectMethod;
  grade: AccuracyGrade | '';
  /** 埋深是否由相邻点插值得到 */
  inferred?: boolean;
  owner?: string;
}

export type Material = 'steel' | 'cast_iron' | 'pe' | 'pvc' | 'concrete' | 'ductile_iron' | 'cable';
export type SectionShape = 'round' | 'duct' | 'box';

export interface PipeSegment {
  id: string;
  utility: UtilityType;
  startId: string;
  endId: string;
  /** 起点/终点管底埋深, 导入校验后填充 */
  startDepth: number | null;
  endDepth: number | null;
  /** 管径/断面(毫米); 排管为单孔孔径 */
  diameter: number;
  material: Material;
  method: DetectMethod;
  grade: AccuracyGrade | '';
  inferred?: boolean;
  /** 断面形状: 圆管 / 电力排管 / 方沟 */
  shape: SectionShape;
  /** 排管孔数(shape=duct 时有效) */
  holes?: number;
  /** 方沟宽高(毫米, shape=box 时有效) */
  boxW?: number;
  boxH?: number;
  owner?: string;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  table: 'point' | 'segment';
  row: number;
  refId: string;
  message: string;
}

export interface ImportResult {
  points: PipePoint[];
  segments: PipeSegment[];
  issues: ValidationIssue[];
  inferredCount: number;
}

/** 地层定义(自上而下) */
export interface StratumLayer {
  name: string;
  /** 层底埋深(米) */
  bottomDepth: number;
  color: number;
  opacity: number;
}

/** 开挖方案 */
export interface ExcavationPlan {
  id: string;
  name: string;
  /** 基坑多边形角点(本地坐标 x,y) */
  polygon: [number, number][];
  /** 开挖深度(米) */
  depth: number;
  /** 放坡比 1:slope (水平/垂直) */
  slope: number;
  createdAt: number;
}

/** 挖机姿态关键帧 */
export interface PoseKeyframe {
  t: number;
  boom: number;
  arm: number;
  bucket: number;
  /** 底盘位置与朝向 */
  baseX: number;
  baseY: number;
  yaw: number;
  toothX: number;
  toothY: number;
  toothZ: number;
}

export interface PoseRecording {
  id: string;
  name: string;
  frames: PoseKeyframe[];
  createdAt: number;
}
