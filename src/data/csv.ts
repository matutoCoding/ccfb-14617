// CSV 普查成果表导入: 管点表 + 管段表, 校验坏行并对缺埋深做相邻点插值
import type {
  AccuracyGrade,
  DetectMethod,
  ImportResult,
  Material,
  PipePoint,
  PipeSegment,
  PointKind,
  SectionShape,
  UtilityType,
  ValidationIssue
} from '../domain/types';
import { UTILITY_META } from '../domain/constants';

// ---------- 通用 CSV 解析(支持引号、逗号转义) ----------
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
  }
  return rows;
}

function toRecords(rows: string[][]): Record<string, string>[] {
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = (cells[i] ?? '').trim()));
    return rec;
  });
}

const UTILS = new Set(['water', 'drain', 'gas', 'power', 'comm', 'heat']);
const METHODS = new Set(['excavation', 'electromagnetic', 'gpr', 'inferred']);
const GRADES = new Set(['A', 'B', 'C']);

function num(v: string): number | null {
  if (v === '' || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 导入两张 CSV 文本。
 * 管点表列: id,kind,x,y,depth,groundZ,utility,method,grade,owner
 * 管段表列: id,utility,startId,endId,diameter,material,method,grade,shape,holes,boxW,boxH,owner
 */
export function importCsv(pointCsv: string, segmentCsv: string): ImportResult {
  const issues: ValidationIssue[] = [];
  const pointRecs = toRecords(parseCSV(pointCsv));
  const segRecs = toRecords(parseCSV(segmentCsv));

  // ---------- 管点 ----------
  const points: PipePoint[] = [];
  const coordSeen = new Map<string, string>();
  const idSeen = new Set<string>();

  pointRecs.forEach((r, idx) => {
    const rowNo = idx + 2;
    const id = r.id;
    if (!id) {
      issues.push({ level: 'error', table: 'point', row: rowNo, refId: '(空)', message: '管点缺少 id, 该行已丢弃' });
      return;
    }
    if (idSeen.has(id)) {
      issues.push({ level: 'error', table: 'point', row: rowNo, refId: id, message: `管点 id 重复, 该行已丢弃` });
      return;
    }
    const x = num(r.x);
    const y = num(r.y);
    if (x === null || y === null || Number.isNaN(x) || Number.isNaN(y)) {
      issues.push({ level: 'error', table: 'point', row: rowNo, refId: id, message: '坐标 x/y 非法, 该行已丢弃' });
      return;
    }
    if (!UTILS.has(r.utility)) {
      issues.push({ level: 'error', table: 'point', row: rowNo, refId: id, message: `未知管线类型 "${r.utility}", 该行已丢弃` });
      return;
    }
    if (!METHODS.has(r.method)) {
      issues.push({ level: 'warning', table: 'point', row: rowNo, refId: id, message: `探测方法非法, 按电磁法处理` });
    }
    let grade = r.grade as AccuracyGrade | '';
    if (grade && !GRADES.has(grade)) grade = '';
    if (!grade) {
      issues.push({ level: 'warning', table: 'point', row: rowNo, refId: id, message: '精度等级未填, 按 B 级保守处理' });
    }
    const depthRaw = num(r.depth);
    const depth = depthRaw === null ? null : Number.isNaN(depthRaw) ? null : depthRaw;
    if (depth === null) {
      issues.push({ level: 'warning', table: 'point', row: rowNo, refId: id, message: '埋深缺失, 将按相邻同行业管点线性插值并标记为推测' });
    }
    const key = `${x.toFixed(2)},${y.toFixed(2)}`;
    if (coordSeen.has(key)) {
      issues.push({
        level: 'warning',
        table: 'point',
        row: rowNo,
        refId: id,
        message: `坐标与管点 ${coordSeen.get(key)} 完全重复(疑似坐标错位/重复录入)`
      });
    } else {
      coordSeen.set(key, id);
    }
    idSeen.add(id);
    points.push({
      id,
      kind: (r.kind as PointKind) || 'ordinary',
      x,
      y,
      depth,
      groundZ: num(r.groundZ) || 0,
      utility: r.utility as UtilityType,
      method: METHODS.has(r.method) ? (r.method as DetectMethod) : 'electromagnetic',
      grade,
      owner: r.owner || UTILITY_META[r.utility as UtilityType].owner
    });
  });

  const pointMap = new Map(points.map((p) => [p.id, p]));

  // ---------- 管段 ----------
  const segments: PipeSegment[] = [];
  const segIdSeen = new Set<string>();
  segRecs.forEach((r, idx) => {
    const rowNo = idx + 2;
    const id = r.id || `SEG-ROW${rowNo}`;
    if (segIdSeen.has(id)) {
      issues.push({ level: 'error', table: 'segment', row: rowNo, refId: id, message: '管段 id 重复, 该行已丢弃' });
      return;
    }
    const start = pointMap.get(r.startId);
    const end = pointMap.get(r.endId);
    if (!start || !end) {
      issues.push({
        level: 'error',
        table: 'segment',
        row: rowNo,
        refId: id,
        message: `管段连接到不存在的管点(起点 ${r.startId ?? '?'} / 终点 ${r.endId ?? '?'}), 该行已丢弃`
      });
      return;
    }
    if (!UTILS.has(r.utility)) {
      issues.push({ level: 'error', table: 'segment', row: rowNo, refId: id, message: '未知管线类型, 该行已丢弃' });
      return;
    }
    const diameter = num(r.diameter);
    if (diameter === null || Number.isNaN(diameter) || diameter <= 0) {
      issues.push({ level: 'error', table: 'segment', row: rowNo, refId: id, message: '管径非法, 该行已丢弃' });
      return;
    }
    let grade = r.grade as AccuracyGrade | '';
    if (grade && !GRADES.has(grade)) grade = '';
    if (!grade) {
      issues.push({ level: 'warning', table: 'segment', row: rowNo, refId: id, message: '精度等级未填, 按 B 级保守处理' });
    }
    const shape = (['round', 'duct', 'box'].includes(r.shape) ? r.shape : 'round') as SectionShape;
    segIdSeen.add(id);
    segments.push({
      id,
      utility: r.utility as UtilityType,
      startId: r.startId,
      endId: r.endId,
      startDepth: start.depth,
      endDepth: end.depth,
      diameter,
      material: (r.material as Material) || 'steel',
      method: METHODS.has(r.method) ? (r.method as DetectMethod) : 'electromagnetic',
      grade,
      shape,
      holes: r.holes ? Number(r.holes) : undefined,
      boxW: r.boxW ? Number(r.boxW) : undefined,
      boxH: r.boxH ? Number(r.boxH) : undefined,
      owner: r.owner || UTILITY_META[r.utility as UtilityType].owner
    });
  });

  // ---------- 缺埋深插值 ----------
  const inferredCount = interpolateDepths(points, segments, issues);
  // 回填管段埋深与推测标记
  for (const seg of segments) {
    const a = pointMap.get(seg.startId)!;
    const b = pointMap.get(seg.endId)!;
    seg.startDepth = a.depth;
    seg.endDepth = b.depth;
    seg.inferred = a.inferred || b.inferred;
    if (seg.inferred) seg.grade = seg.grade || 'C';
  }

  return { points, segments, issues, inferredCount };
}

/**
 * 缺埋深按相邻同行业管点线性插值:
 * 沿管段图做 BFS, 找到最近的有埋深邻居, 按平面距离加权;
 * 整条同行业链都缺时回退到行业默认埋深。
 */
function interpolateDepths(points: PipePoint[], segments: PipeSegment[], issues: ValidationIssue[]): number {
  const adjacency = new Map<string, PipeSegment[]>();
  for (const seg of segments) {
    for (const [a, b] of [
      [seg.startId, seg],
      [seg.endId, seg]
    ] as [string, PipeSegment][]) {
      if (!adjacency.has(a)) adjacency.set(a, []);
      adjacency.get(a)!.push(b);
    }
  }
  const pointMap = new Map(points.map((p) => [p.id, p]));
  let count = 0;

  for (const p of points) {
    if (p.depth !== null) continue;
    // BFS 找同行业已知埋深点
    const visited = new Set<string>([p.id]);
    const queue: { id: string; dist: number }[] = [{ id: p.id, dist: 0 }];
    const found: { id: string; dist: number }[] = [];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const seg of adjacency.get(cur.id) ?? []) {
        const otherId = seg.startId === cur.id ? seg.endId : seg.startId;
        if (visited.has(otherId)) continue;
        visited.add(otherId);
        const other = pointMap.get(otherId);
        if (!other || other.utility !== p.utility) continue;
        const d = cur.dist + Math.hypot(other.x - p.x, other.y - p.y);
        if (other.depth !== null) found.push({ id: otherId, dist: Math.max(d, 0.01) });
        else queue.push({ id: otherId, dist: d });
      }
    }
    if (found.length) {
      // 距离倒数加权
      let wsum = 0;
      let dsum = 0;
      for (const f of found) {
        const w = 1 / f.dist;
        wsum += w;
        dsum += w * pointMap.get(f.id)!.depth!;
      }
      p.depth = dsum / wsum;
    } else {
      p.depth = UTILITY_META[p.utility].defaultDepth;
      issues.push({
        level: 'warning',
        table: 'point',
        row: -1,
        refId: p.id,
        message: `管点 ${p.id} 无任何同行业已知埋深邻居, 回退为行业默认埋深 ${p.depth.toFixed(2)}m`
      });
    }
    p.inferred = true;
    if (p.method !== 'inferred') p.method = 'inferred';
    if (!p.grade) p.grade = 'C';
    count++;
  }
  return count;
}

/** 导出 CSV(用于重新下载成果表) */
export function exportPointsCsv(points: PipePoint[]): string {
  const head = 'id,kind,x,y,depth,groundZ,utility,method,grade,owner';
  const lines = points.map((p) =>
    [p.id, p.kind, p.x, p.y, p.inferred ? '' : p.depth?.toFixed(3) ?? '', p.groundZ, p.utility, p.method, p.grade, p.owner ?? ''].join(',')
  );
  return [head, ...lines].join('\n');
}

export function exportSegmentsCsv(segments: PipeSegment[]): string {
  const head = 'id,utility,startId,endId,diameter,material,method,grade,shape,holes,boxW,boxH,owner';
  const lines = segments.map((s) =>
    [
      s.id, s.utility, s.startId, s.endId, s.diameter, s.material, s.method, s.grade, s.shape,
      s.holes ?? '', s.boxW ?? '', s.boxH ?? '', s.owner ?? ''
    ].join(',')
  );
  return [head, ...lines].join('\n');
}
