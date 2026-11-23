// 施工交底页：开挖范围内管线清单、权属单位、人工探挖段落，平面图+横断面图导出

import { store } from '../store';
import { ExcavationPlan, PipeCategory, PipeEntity } from '../types';
import { distToPolygonBoundary, pointInPolygon } from '../geo';
import { computeSection, drawSection, drawPlanView } from '../section';

interface BriefRow {
  e: PipeEntity;
  minDepth: number;
  maxDepth: number;
  inPit: boolean;        // 包络进入开挖体
  manualDig: boolean;    // 必须人工探挖
}

/** 计算开挖影响区内的管线（坑口外扩 1m 缓冲） */
function pipesInZone(plan: ExcavationPlan): BriefRow[] {
  const bottomZ = plan.groundElev - plan.depth;
  const rows: BriefRow[] = [];
  for (const e of store.entities) {
    // 管线中心线上若干采样点，取最近水平距离与埋深范围
    let minH = Infinity;
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = e.ax + (e.bx - e.ax) * t;
      const y = e.ay + (e.by - e.ay) * t;
      const z = e.az + (e.bz - e.az) * t;
      zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
      const inside = pointInPolygon(x, y, plan.polygon);
      const d = inside ? 0 : distToPolygonBoundary(x, y, plan.polygon);
      // 该深度处开挖体水平外扩量
      const expand = Math.max(0, (z - bottomZ)) * plan.slope;
      minH = Math.min(minH, d - expand);
    }
    if (zMax < bottomZ - 1) continue;          // 远在坑底以下
    if (minH - e.envR > 1.0) continue;          // 包络距开挖体 1m 以外
    const inPit = minH - e.envR <= 0;
    const guarded = e.seg.category === PipeCategory.Gas || e.seg.category === PipeCategory.Power;
    const manualDig = inPit || (guarded && minH - e.envR <= 1.0);
    rows.push({
      e,
      minDepth: plan.groundElev - zMax,
      maxDepth: plan.groundElev - zMin,
      inPit, manualDig,
    });
  }
  return rows.sort((a, b) => Number(b.manualDig) - Number(a.manualDig));
}

function pitSectionLine(plan: ExcavationPlan): { x0: number; y0: number; x1: number; y1: number } {
  let cx = 0, cy = 0;
  for (const [x, y] of plan.polygon) { cx += x; cy += y; }
  cx /= plan.polygon.length; cy /= plan.polygon.length;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of plan.polygon) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const ext = 12;
  if (maxX - minX >= maxY - minY) {
    return { x0: minX - ext, y0: cy, x1: maxX + ext, y1: cy };
  }
  return { x0: cx, y0: minY - ext, x1: cx, y1: maxY + ext };
}

export function mountBriefPage(el: HTMLElement): () => void {
  el.innerHTML = `
    <div class="side wide">
      <h2>施工交底</h2>
      <label class="field"><span>选择开挖方案</span><select id="sel-plan"></select></label>
      <div id="summary" class="hint"></div>
      <h3>开挖范围内管线（含1m缓冲）</h3>
      <div class="table-wrap" style="max-height:32vh;"><table class="data" id="tbl"></table></div>
      <h3>必须人工探挖段落</h3>
      <div id="manual" class="hint"></div>
      <div class="btn-row"><button class="primary" id="btn-export">导出交底文件</button></div>
    </div>
    <div class="view-wrap" style="overflow:auto;padding:14px;">
      <h3>平面图</h3>
      <canvas class="plan-canvas" id="cv-plan" width="900" height="620"></canvas>
      <h3>横断面图（过基坑中心）</h3>
      <canvas class="section-canvas" id="cv-sec" width="1040" height="520"></canvas>
    </div>
  `;
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const sel = $('#sel-plan') as HTMLSelectElement;
  let rows: BriefRow[] = [];
  let currentPlan: ExcavationPlan | null = null;

  function currentPlanId(): string | null {
    return sel.value || null;
  }

  function refresh(): void {
    sel.innerHTML = store.plans.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (currentPlanId()) sel.value = currentPlanId()!;
    const plan = store.plans.find(p => p.id === sel.value) ?? null;
    currentPlan = plan;
    if (!plan) {
      $('#summary').textContent = '暂无开挖方案，请先在“开挖方案”页绘制并保存。';
      $('#tbl').innerHTML = '';
      $('#manual').textContent = '';
      return;
    }
    rows = pipesInZone(plan);
    $('#summary').textContent =
      `${plan.name}：坑深 ${plan.depth}m，放坡 1:${plan.slope}，影响区内管线 ${rows.length} 段，` +
      `其中 ${rows.filter(r => r.manualDig).length} 段须人工探挖。`;
    $('#tbl').innerHTML = `<thead><tr>
      <th>段号</th><th>类别</th><th>权属单位</th><th>埋深(m)</th><th>材质/管径</th><th>状态</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.e.seg.depthInferred ? 'inferred' : ''}">
        <td>${r.e.seg.id}</td><td>${r.e.seg.category}</td><td>${r.e.seg.owner}</td>
        <td>${r.minDepth.toFixed(2)}~${r.maxDepth.toFixed(2)}${r.e.seg.depthInferred ? '（推测）' : ''}</td>
        <td>${r.e.seg.material} DN${r.e.seg.diameter}</td>
        <td>${r.inPit ? '<span class="badge err">穿越开挖体</span>' : r.manualDig ? '<span class="badge warn">1m缓冲内</span>' : '<span class="badge ok">影响区</span>'}</td>
      </tr>`).join('')}</tbody>`;
    $('#manual').innerHTML = rows.filter(r => r.manualDig).length === 0
      ? '无'
      : rows.filter(r => r.manualDig).map(r =>
        `<div>• ${r.e.seg.category} ${r.e.seg.id}（${r.e.seg.owner}）：机械开挖至此段 <b>1m</b> 前必须停止，改人工探挖确认管位。</div>`,
      ).join('');

    // 图
    const planCv = $('#cv-plan') as unknown as HTMLCanvasElement;
    const line = pitSectionLine(plan);
    drawPlanView(planCv, store.entities, plan, line);
    const secCv = $('#cv-sec') as unknown as HTMLCanvasElement;
    const pipes = computeSection(line.x0, line.y0, line.x1, line.y1);
    drawSection(secCv, pipes, { title: `${plan.name} 横断面`, lineLen: Math.hypot(line.x1 - line.x0, line.y1 - line.y0) });
  }

  sel.addEventListener('change', refresh);

  $('#btn-export').addEventListener('click', () => {
    if (!currentPlan) return;
    const planImg = ($('#cv-plan') as HTMLCanvasElement).toDataURL('image/png');
    const secImg = ($('#cv-sec') as HTMLCanvasElement).toDataURL('image/png');
    const manualRows = rows.filter(r => r.manualDig);
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>施工交底 - ${currentPlan.name}</title>
<style>
body{font-family:"Microsoft YaHei",sans-serif;margin:32px;color:#222}
table{border-collapse:collapse;width:100%;font-size:13px}
td,th{border:1px solid #999;padding:5px 8px;text-align:left}
th{background:#eee}
.warn{color:#c62828;font-weight:bold}
img{max-width:100%;border:1px solid #ccc;margin:8px 0}
h1{font-size:22px}h2{font-size:17px;margin-top:24px}
</style></head><body>
<h1>地下管线开挖施工交底</h1>
<p>基坑：${currentPlan.name}　开挖深度：${currentPlan.depth}m　放坡比：1:${currentPlan.slope}　交底日期：${new Date().toLocaleDateString()}</p>
<h2>一、开挖范围内管线清单（含1m缓冲，共 ${rows.length} 段）</h2>
<table><thead><tr><th>段号</th><th>类别</th><th>权属单位</th><th>埋深(m)</th><th>材质/管径</th><th>探测方法/精度</th><th>状态</th></tr></thead>
<tbody>${rows.map(r => `<tr>
<td>${r.e.seg.id}</td><td>${r.e.seg.category}</td><td>${r.e.seg.owner}</td>
<td>${r.minDepth.toFixed(2)}~${r.maxDepth.toFixed(2)}${r.e.seg.depthInferred ? '（推测）' : ''}</td>
<td>${r.e.seg.material} DN${r.e.seg.diameter}</td>
<td>${r.e.seg.method}/${r.e.seg.precision || '未填'}</td>
<td>${r.inPit ? '穿越开挖体' : r.manualDig ? '1m缓冲内' : '影响区'}</td>
</tr>`).join('')}</tbody></table>
<h2>二、必须人工探挖段落（${manualRows.length} 段）</h2>
${manualRows.length === 0 ? '<p>无</p>' : `<ul>${manualRows.map(r =>
  `<li class="warn">${r.e.seg.category} ${r.e.seg.id}（${r.e.seg.owner}）——机械开挖至此段1m前必须停止，改人工探挖确认管位后方可继续。</li>`).join('')}</ul>`}
<h2>三、安全要求</h2>
<ol>
<li>燃气、电力管线不确定包络 1m 范围内禁止机械开挖；0.5m 为红色警戒，立即停工。</li>
<li>标注“推测”的埋深系相邻管点插值，开挖前必须人工探挖复核。</li>
<li>施工前应与各权属单位现场交底确认管位。</li>
</ol>
<h2>四、平面图</h2><img src="${planImg}" alt="平面图">
<h2>五、横断面图</h2><img src="${secImg}" alt="横断面图">
</body></html>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    a.download = `施工交底-${currentPlan.name}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const unsub = store.subscribe(refresh);
  refresh();
  return () => { unsub(); };
}
