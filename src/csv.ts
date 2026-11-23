// CSV 导入：管点表 + 管段表。坏行报告、缺埋深按相邻管点插值并标记推测。

import {
  PipePoint, PipeSegment, PointType, PipeCategory, SurveyMethod,
  PrecisionLevel, ImportResult, ImportIssue, SectionKind,
} from './types';

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function parseCsv(text: string): string[][] {
  return text.replace(/^﻿/, '').split(/\r?\n/)
    .map(l => l.trim()).filter(l => l.length > 0)
    .map(splitCsvLine);
}

const num = (s: string): number | null => {
  if (s === '' || s == null) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

function asEnum<T extends string>(s: string, values: readonly T[]): T | null {
  return (values as readonly string[]).includes(s) ? (s as T) : null;
}

const POINT_TYPES = Object.values(PointType);
const CATEGORIES = Object.values(PipeCategory);
const METHODS = Object.values(SurveyMethod);

export function parsePointsCsv(text: string, issues: ImportIssue[]): PipePoint[] {
  const rows = parseCsv(text);
  const pts: PipePoint[] = [];
  const seen = new Set<string>();
  // 表头探测
  let start = 0;
  if (rows.length && /点号|编号|id/i.test(rows[0][0] ?? '')) start = 1;
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = i + 1;
    if (r.length < 4) { issues.push({ row: rowNo, table: '管点表', level: '错误', message: `列数不足（${r.length}列）` }); continue; }
    const [id, xs, ys, es, ts, feat] = r;
    const x = num(xs), y = num(ys), e = num(es ?? '0');
    if (!id) { issues.push({ row: rowNo, table: '管点表', level: '错误', message: '点号为空' }); continue; }
    if (seen.has(id)) { issues.push({ row: rowNo, table: '管点表', level: '错误', message: `点号 ${id} 重复` }); continue; }
    if (x == null || y == null) { issues.push({ row: rowNo, table: '管点表', level: '错误', message: `点号 ${id} 坐标非法（${xs},${ys}）` }); continue; }
    seen.add(id);
    const type = asEnum(ts ?? '', POINT_TYPES) ?? PointType.General;
    if (ts && !asEnum(ts, POINT_TYPES)) issues.push({ row: rowNo, table: '管点表', level: '警告', message: `点号 ${id} 管点类型“${ts}”无法识别，按一般点处理` });
    pts.push({ id, x, y, groundElev: e ?? 0, type, feature: feat ?? '' });
  }
  // 坐标重复检查（< 1cm 视为重复）
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < 0.01) {
        issues.push({ row: 0, table: '管点表', level: '错误', message: `点号 ${pts[i].id} 与 ${pts[j].id} 坐标重复（间距 ${(d * 1000).toFixed(0)}mm）` });
      }
    }
  }
  return pts;
}

export function parseSegmentsCsv(text: string, issues: ImportIssue[]): PipeSegment[] {
  const rows = parseCsv(text);
  const segs: PipeSegment[] = [];
  const seen = new Set<string>();
  let start = 0;
  if (rows.length && /段号|编号|id/i.test(rows[0][0] ?? '')) start = 1;
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = i + 1;
    if (r.length < 6) { issues.push({ row: rowNo, table: '管段表', level: '错误', message: `列数不足（${r.length}列）` }); continue; }
    const [id, s0, s1, cat, diaS, mat, d0S, d1S, meth, prec, owner, secS, a, b] = r;
    if (!id) { issues.push({ row: rowNo, table: '管段表', level: '错误', message: '段号为空' }); continue; }
    if (seen.has(id)) { issues.push({ row: rowNo, table: '管段表', level: '错误', message: `段号 ${id} 重复` }); continue; }
    const category = asEnum(cat ?? '', CATEGORIES);
    if (!category) { issues.push({ row: rowNo, table: '管段表', level: '错误', message: `段号 ${id} 管线类别“${cat}”无法识别` }); continue; }
    const section: SectionKind = secS === '排管' ? 'duct' : secS === '方沟' ? 'box' : 'circle';
    const diameter = num(diaS ?? '') ?? (section === 'circle' ? 0 : 200);
    if (section === 'circle' && diameter <= 0) issues.push({ row: rowNo, table: '管段表', level: '警告', message: `段号 ${id} 管径缺失或非法` });
    const method = asEnum(meth ?? '', METHODS);
    if (meth && !method) issues.push({ row: rowNo, table: '管段表', level: '警告', message: `段号 ${id} 探测方法“${meth}”无法识别，按推测处理` });
    const precision = (prec === 'A' || prec === 'B' || prec === 'C') ? prec as PrecisionLevel : '';
    if (!precision) issues.push({ row: rowNo, table: '管段表', level: '警告', message: `段号 ${id} 精度等级未填，不确定包络按推测加宽` });
    seen.add(id);
    segs.push({
      id, startId: s0 ?? '', endId: s1 ?? '', category, section,
      diameter, material: mat ?? '',
      startDepth: num(d0S ?? ''), endDepth: num(d1S ?? ''),
      depthInferred: false,
      method: method ?? SurveyMethod.Inferred,
      precision, owner: owner ?? '',
      ductRows: section === 'duct' ? (num(a ?? '') ?? 2) : undefined,
      ductCols: section === 'duct' ? (num(b ?? '') ?? 3) : undefined,
      boxWidth: section === 'box' ? (num(a ?? '') ?? 1.2) : undefined,
      boxHeight: section === 'box' ? (num(b ?? '') ?? 1.0) : undefined,
    });
  }
  return segs;
}

/** 缺埋深插值：沿管线连通关系，用相邻已知埋深线性插值；标记 depthInferred */
function inferDepths(segs: PipeSegment[], issues: ImportIssue[]): void {
  // 建邻接：管点 → 段
  const byPoint = new Map<string, PipeSegment[]>();
  for (const s of segs) {
    for (const pid of [s.startId, s.endId]) {
      if (!byPoint.has(pid)) byPoint.set(pid, []);
      byPoint.get(pid)!.push(s);
    }
  }
  // 迭代传播：每次用“对端已知”的段补全一端，直到收敛
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 20) {
    changed = false;
    for (const s of segs) {
      for (const end of [0, 1] as const) {
        const missing = end === 0 ? s.startDepth == null : s.endDepth == null;
        if (!missing) continue;
        const pid = end === 0 ? s.startId : s.endId;
        const neighbors = byPoint.get(pid) ?? [];
        // 收集该点处其他段的已知埋深
        const known: number[] = [];
        for (const nb of neighbors) {
          if (nb === s) continue;
          const v = nb.startId === pid ? nb.startDepth : nb.endId === pid ? nb.endDepth : null;
          if (v != null) known.push(v);
        }
        // 同一段另一端已知也可作为弱约束（沿管段线性）
        const otherEnd = end === 0 ? s.endDepth : s.startDepth;
        if (known.length > 0) {
          const v = known.reduce((x, y) => x + y, 0) / known.length;
          if (end === 0) s.startDepth = v; else s.endDepth = v;
          s.depthInferred = true;
          changed = true;
        } else if (otherEnd != null) {
          if (end === 0) s.startDepth = otherEnd; else s.endDepth = otherEnd;
          s.depthInferred = true;
          changed = true;
        }
      }
    }
  }
  for (const s of segs) {
    if (s.startDepth == null || s.endDepth == null) {
      issues.push({ row: 0, table: '管段表', level: '错误', message: `段号 ${s.id} 埋深缺失且无法由相邻管点插值，该段不参与建模` });
    } else if (s.depthInferred) {
      issues.push({ row: 0, table: '管段表', level: '警告', message: `段号 ${s.id} 埋深缺失，已按相邻管点插值（推测）` });
    }
  }
}

export function importSurvey(pointCsv: string, segmentCsv: string): ImportResult {
  const issues: ImportIssue[] = [];
  const points = parsePointsCsv(pointCsv, issues);
  const segments = parseSegmentsCsv(segmentCsv, issues);
  const ids = new Set(points.map(p => p.id));
  // 管段连到不存在管点
  const okSegs: PipeSegment[] = [];
  for (const s of segments) {
    const miss: string[] = [];
    if (!ids.has(s.startId)) miss.push(s.startId || '(空)');
    if (!ids.has(s.endId)) miss.push(s.endId || '(空)');
    if (miss.length > 0) {
      issues.push({ row: 0, table: '管段表', level: '错误', message: `段号 ${s.id} 引用了不存在的管点：${miss.join('、')}，该段剔除` });
    } else okSegs.push(s);
  }
  inferDepths(okSegs, issues);
  return { points, segments: okSegs, issues };
}

/** 导出 CSV（用于测试数据下载） */
export function pointsToCsv(points: PipePoint[]): string {
  const head = '点号,X,Y,地面高程,管点类型,附属物';
  const lines = points.map(p => `${p.id},${p.x.toFixed(3)},${p.y.toFixed(3)},${p.groundElev.toFixed(3)},${p.type},${p.feature}`);
  return [head, ...lines].join('\n');
}

export function segmentsToCsv(segs: PipeSegment[]): string {
  const head = '段号,起点号,终点号,管线类别,管径mm,材质,起点埋深,终点埋深,探测方法,精度等级,权属单位,断面,参数A,参数B';
  const lines = segs.map(s => [
    s.id, s.startId, s.endId, s.category, s.diameter, s.material,
    s.startDepth == null ? '' : s.startDepth.toFixed(2),
    s.endDepth == null ? '' : s.endDepth.toFixed(2),
    s.method, s.precision, s.owner,
    s.section === 'duct' ? '排管' : s.section === 'box' ? '方沟' : '圆管',
    s.section === 'duct' ? s.ductRows ?? '' : s.section === 'box' ? s.boxWidth ?? '' : '',
    s.section === 'duct' ? s.ductCols ?? '' : s.section === 'box' ? s.boxHeight ?? '' : '',
  ].join(','));
  return [head, ...lines].join('\n');
}
