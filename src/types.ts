// 核心数据类型：管点、管段、枚举与行业色标

export enum PipeCategory {
  Water = '给水',
  Drainage = '排水',
  Gas = '燃气',
  Power = '电力',
  Telecom = '通信',
  Heat = '热力',
}

export const CATEGORY_COLORS: Record<PipeCategory, number> = {
  [PipeCategory.Water]: 0x1e6fd9,    // 蓝
  [PipeCategory.Drainage]: 0x8a5a2b, // 棕
  [PipeCategory.Gas]: 0xe8c832,      // 黄
  [PipeCategory.Power]: 0xd93025,    // 红
  [PipeCategory.Telecom]: 0x2fa84f,  // 绿
  [PipeCategory.Heat]: 0xe07020,     // 橙
};

export enum PointType {
  Manhole = '检查井',
  Valve = '阀门',
  Tee = '三通',
  Reducer = '变径',
  General = '一般点',
}

export enum SurveyMethod {
  Excavation = '开挖实测',
  Electromagnetic = '电磁法',
  GPR = '探地雷达',
  Inferred = '推测',
}

export type PrecisionLevel = 'A' | 'B' | 'C' | '';

export interface PipePoint {
  id: string;          // 点号
  x: number;           // 平面坐标 m（城建坐标，入库前不减中心）
  y: number;
  groundElev: number;  // 地面高程 m
  type: PointType;
  feature: string;     // 附属物说明
}

export type SectionKind = 'circle' | 'duct' | 'box'; // 圆管 / 电力排管 / 方沟

export interface PipeSegment {
  id: string;              // 段号
  startId: string;         // 起点号
  endId: string;           // 终点号
  category: PipeCategory;
  section: SectionKind;
  diameter: number;        // 圆管管径 mm；排管单孔孔径 mm
  material: string;
  startDepth: number | null; // 起点埋深 m（null = 缺失待插值）
  endDepth: number | null;
  depthInferred: boolean;    // 埋深为推测值
  method: SurveyMethod;
  precision: PrecisionLevel;
  owner: string;             // 权属单位
  // 电力排管
  ductRows?: number;
  ductCols?: number;
  // 方沟
  boxWidth?: number;   // m
  boxHeight?: number;  // m
}

// —— 解析后用于渲染/计算的管线实体（坐标已平移到场地局部系）——
export interface PipeEntity {
  seg: PipeSegment;
  // 中心线两端点（局部坐标，z 为高程）
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  outerR: number;      // 外半径 m（圆管半径 / 排管、方沟外包络等效半径）
  uncR: number;        // 不确定度半径 m
  envR: number;        // 包络半径 = outerR + uncR
}

export interface ExcavationPlan {
  id: string;
  name: string;
  // 坑底轮廓（局部坐标多边形，逆时针），放坡向上向外
  polygon: [number, number][];
  depth: number;      // 开挖深度 m
  slope: number;      // 放坡比（水平:垂直，如 0.75）
  groundElev: number; // 坑口地面高程
}

export interface PoseFrame {
  t: number;        // 相对时间 s
  boom: number; stick: number; bucket: number; // 关节角 rad
}

export interface PoseRecording {
  id: string;
  name: string;
  frames: PoseFrame[];
}

export interface ImportIssue {
  row: number;
  table: '管点表' | '管段表';
  level: '错误' | '警告';
  message: string;
}

export interface ImportResult {
  points: PipePoint[];
  segments: PipeSegment[];
  issues: ImportIssue[];
}
