// 内存中的应用状态 + 订阅, 持久化委托 db.ts
import { db } from '../data/db';
import { generateDataset } from '../data/generator';
import { importCsv } from '../data/csv';
import type { ExcavationPlan, PipePoint, PipeSegment, PoseRecording, ValidationIssue } from '../domain/types';

type Listener = () => void;

class AppStore {
  points: PipePoint[] = [];
  segments: PipeSegment[] = [];
  issues: ValidationIssue[] = [];
  inferredCount = 0;
  plans: ExcavationPlan[] = [];
  recordings: PoseRecording[] = [];
  activePlanId: string | null = null;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  async init(): Promise<void> {
    const [pts, segs, plans, recs, stored] = await Promise.all([
      db.loadPoints(),
      db.loadSegments(),
      db.listPlans(),
      db.listRecordings(),
      db.loadIssues()
    ]);
    this.plans = plans;
    this.recordings = recs;
    this.issues = stored.issues;
    this.inferredCount = stored.inferredCount;
    if (pts.length && segs.length) {
      this.points = pts;
      this.segments = segs;
    } else {
      await this.loadDemo();
    }
    this.emit();
  }

  async loadDemo(): Promise<void> {
    const gen = generateDataset();
    const result = importCsv(toCsvPoints(gen.points), toCsvSegments(gen.segments));
    this.points = result.points;
    this.segments = result.segments;
    this.issues = result.issues;
    this.inferredCount = result.inferredCount;
    await db.savePipeline(this.points, this.segments);
    await db.saveIssues(this.issues, this.inferredCount);
    this.emit();
  }

  async importFromCsv(pointCsv: string, segmentCsv: string): Promise<ValidationIssue[]> {
    const result = importCsv(pointCsv, segmentCsv);
    this.points = result.points;
    this.segments = result.segments;
    this.issues = result.issues;
    this.inferredCount = result.inferredCount;
    await db.savePipeline(this.points, this.segments);
    await db.saveIssues(this.issues, this.inferredCount);
    this.emit();
    return result.issues;
  }

  async savePlan(plan: ExcavationPlan): Promise<void> {
    await db.savePlan(plan);
    this.plans = await db.listPlans();
    this.activePlanId = plan.id;
    this.emit();
  }

  async deletePlan(id: string): Promise<void> {
    await db.deletePlan(id);
    if (this.activePlanId === id) this.activePlanId = null;
    this.plans = await db.listPlans();
    this.emit();
  }

  get activePlan(): ExcavationPlan | null {
    return this.plans.find((p) => p.id === this.activePlanId) ?? null;
  }

  async saveRecording(rec: PoseRecording): Promise<void> {
    await db.saveRecording(rec);
    this.recordings = await db.listRecordings();
    this.emit();
  }

  async deleteRecording(id: string): Promise<void> {
    await db.deleteRecording(id);
    this.recordings = await db.listRecordings();
    this.emit();
  }
}

// 生成器直接产出对象, 导入器吃 CSV —— demo 路径也走完整校验管线
function toCsvPoints(points: PipePoint[]): string {
  const head = 'id,kind,x,y,depth,groundZ,utility,method,grade,owner';
  const lines = points.map((p) =>
    [p.id, p.kind, p.x, p.y, p.depth ?? '', p.groundZ, p.utility, p.method, p.grade, p.owner ?? ''].join(',')
  );
  return [head, ...lines].join('\n');
}

function toCsvSegments(segments: PipeSegment[]): string {
  const head = 'id,utility,startId,endId,diameter,material,method,grade,shape,holes,boxW,boxH,owner';
  const lines = segments.map((s) =>
    [s.id, s.utility, s.startId, s.endId, s.diameter, s.material, s.method, s.grade, s.shape, s.holes ?? '', s.boxW ?? '', s.boxH ?? '', s.owner ?? ''].join(',')
  );
  return [head, ...lines].join('\n');
}

export const store = new AppStore();
