// 应用状态：内存态 + IndexedDB 持久化，订阅通知

import { PipePoint, PipeSegment, PipeEntity, ExcavationPlan, PoseRecording } from './types';
import { buildEntity } from './envelope';
import { idbGetAll, idbPutAll, idbClear, idbPut, idbDelete, idbGet, STORES } from './db';

export interface StrataLayer {
  name: string;
  top: number;      // 相对场地基准面的顶高程 m（基准 = 场地平均地面高程）
  bottom: number;
  color: number;
}

export const STRATA: StrataLayer[] = [
  { name: '路面结构层', top: 0.25, bottom: -0.45, color: 0x555a60 },
  { name: '杂填土', top: -0.45, bottom: -1.8, color: 0xa8895a },
  { name: '粉质黏土', top: -1.8, bottom: -4.2, color: 0xc2a06b },
  { name: '砂层', top: -4.2, bottom: -8.0, color: 0xd9c07a },
];

class Store {
  points: PipePoint[] = [];
  segments: PipeSegment[] = [];
  entities: PipeEntity[] = [];
  plans: ExcavationPlan[] = [];
  recordings: PoseRecording[] = [];
  origin = { x: 0, y: 0 };       // 场地局部系原点（城建坐标）
  baseElev = 100;                // 场地基准高程（平均地面）
  pointMap = new Map<string, PipePoint>();

  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(): void { for (const fn of this.listeners) fn(); }

  async load(): Promise<void> {
    const [pts, segs, plans, recs, origin, base] = await Promise.all([
      idbGetAll<PipePoint>(STORES.points),
      idbGetAll<PipeSegment>(STORES.segments),
      idbGetAll<ExcavationPlan>(STORES.plans),
      idbGetAll<PoseRecording>(STORES.recordings),
      idbGet<{ x: number; y: number }>(STORES.meta, 'origin'),
      idbGet<number>(STORES.meta, 'baseElev'),
    ]);
    this.points = pts; this.segments = segs;
    this.plans = plans; this.recordings = recs;
    if (origin) this.origin = origin;
    if (typeof base === 'number') this.baseElev = base;
    this.rebuild();
  }

  rebuild(): void {
    this.pointMap = new Map(this.points.map(p => [p.id, p]));
    this.entities = [];
    for (const s of this.segments) {
      const e = buildEntity(s, this.pointMap, this.origin);
      if (e) this.entities.push(e);
    }
  }

  async setSurveyData(points: PipePoint[], segments: PipeSegment[]): Promise<void> {
    // 以场地质心为局部原点，避免大坐标浮点误差
    if (points.length > 0) {
      let sx = 0, sy = 0, se = 0;
      for (const p of points) { sx += p.x; sy += p.y; se += p.groundElev; }
      this.origin = { x: sx / points.length, y: sy / points.length };
      this.baseElev = se / points.length;
    }
    this.points = points;
    this.segments = segments;
    this.rebuild();
    await Promise.all([
      idbClear(STORES.points), idbClear(STORES.segments),
    ]);
    await Promise.all([
      idbPutAll(STORES.points, points),
      idbPutAll(STORES.segments, segments),
      idbPut(STORES.meta, this.origin, 'origin'),
      idbPut(STORES.meta, this.baseElev, 'baseElev'),
    ]);
    this.emit();
  }

  async clearSurvey(): Promise<void> {
    this.points = []; this.segments = []; this.entities = [];
    await Promise.all([idbClear(STORES.points), idbClear(STORES.segments)]);
    this.emit();
  }

  async savePlan(plan: ExcavationPlan): Promise<void> {
    const i = this.plans.findIndex(p => p.id === plan.id);
    if (i >= 0) this.plans[i] = plan; else this.plans.push(plan);
    await idbPut(STORES.plans, plan);
    this.emit();
  }

  async deletePlan(id: string): Promise<void> {
    this.plans = this.plans.filter(p => p.id !== id);
    await idbDelete(STORES.plans, id);
    this.emit();
  }

  async saveRecording(rec: PoseRecording): Promise<void> {
    const i = this.recordings.findIndex(r => r.id === rec.id);
    if (i >= 0) this.recordings[i] = rec; else this.recordings.push(rec);
    await idbPut(STORES.recordings, rec);
    this.emit();
  }

  async deleteRecording(id: string): Promise<void> {
    this.recordings = this.recordings.filter(r => r.id !== id);
    await idbDelete(STORES.recordings, id);
    this.emit();
  }
}

export const store = new Store();
