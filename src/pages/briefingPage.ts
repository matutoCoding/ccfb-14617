// 页面7: 施工交底 —— 开挖范围内管线、权属单位、人工探挖段落、平面/横断面图导出文件
import { h, clear, table, download, fmt } from '../ui/dom';
import { toast } from '../ui/toast';
import { store } from '../state/store';
import type { SceneContext } from '../core/sceneContext';
import { UTILITY_META, METHOD_META } from '../domain/constants';
import { pointInPolygon, pointToPolygonEdge } from '../core/geo';
import { cutSection, checkClearances, drawSection, type SectionCut } from '../core/section';
import type { RuntimeSegment } from '../core/pipelineBuilder';
import type { ExcavationPlan } from '../domain/types';

interface BriefRow {
  rt: RuntimeSegment;
  minDepth: number;
  manualDig: boolean;
  reason: string;
}

function buildBrief(plan: ExcavationPlan, ctx: SceneContext): BriefRow[] {
  const rows: BriefRow[] = [];
  for (const rt of ctx.runtime) {
    const mx = (rt.a.x + rt.b.x) / 2;
    const my = (rt.a.z + rt.b.z) / 2;
    if (!(pointInPolygon(mx, my, plan.polygon) || pointToPolygonEdge(mx, my, plan.polygon) < 2.0)) continue;
    const minDepth = Math.min(-rt.a.y, -rt.b.y) + rt.outerRadius;
    const manualDig =
      rt.utility === 'gas' ||
      rt.utility === 'power' ||
      rt.seg.inferred ||
      rt.seg.method === 'inferred' ||
      minDepth < plan.depth + 0.3;
    const reasons: string[] = [];
    if (rt.utility === 'gas' || rt.utility === 'power') reasons.push('燃气/电力强制人工探挖');
    if (rt.seg.inferred) reasons.push('埋深为插值推测');
    if (rt.seg.method === 'inferred') reasons.push('无物探实测, 属推测段');
    if (minDepth < plan.depth + 0.3) reasons.push('管底位于坑底以上 0.3m 范围内');
    rows.push({ rt, minDepth, manualDig, reason: reasons.join('; ') || '机械开挖可达, 注意保护层' });
  }
  rows.sort((a, b) => a.minDepth - b.minDepth);
  return rows;
}

/** 生成平面图 SVG(基坑 + 管线投影 + 图例) */
function planSvg(plan: ExcavationPlan, ctx: SceneContext, rows: BriefRow[]): string {
  const W = 900;
  const H = 700;
  const allX = ctx.runtime.flatMap((r) => [r.a.x, r.b.x]);
  const allY = ctx.runtime.flatMap((r) => [r.a.z, r.b.z]);
  const minX = Math.min(...allX, ...plan.polygon.map((p) => p[0])) - 6;
  const maxX = Math.max(...allX, ...plan.polygon.map((p) => p[0])) + 6;
  const minY = Math.min(...allY, ...plan.polygon.map((p) => p[1])) - 6;
  const maxY = Math.max(...allY, ...plan.polygon.map((p) => p[1])) + 6;
  const sx = W / (maxX - minX);
  const sy = H / (maxY - minY);
  const sc = Math.min(sx, sy);
  const X = (x: number) => (x - minX) * sc + 20;
  const Y = (y: number) => H - ((y - minY) * sc + 20);
  const ids = new Set(rows.map((r) => r.rt.seg.id));
  const segLines = ctx.runtime
    .filter((r) => ids.has(r.seg.id))
    .map((r) => {
      const c = UTILITY_META[r.utility].hex;
      return `<line x1="${X(r.a.x).toFixed(1)}" y1="${Y(r.a.z).toFixed(1)}" x2="${X(r.b.x).toFixed(1)}" y2="${Y(r.b.z).toFixed(1)}" stroke="${c}" stroke-width="${r.seg.inferred ? 1.5 : 3}" stroke-dasharray="${r.seg.inferred ? '6 4' : 'none'}"/>`;
    })
    .join('\n');
  const poly = plan.polygon.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ');
  const legend = Object.values(UTILITY_META)
    .map((m, i) => `<rect x="${30 + i * 130}" y="${H - 18}" width="14" height="10" fill="${m.hex}"/><text x="${48 + i * 130}" y="${H - 9}" font-size="12" fill="#263238">${m.name}</text>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#f7f9fb"/>
<text x="24" y="34" font-size="20" font-weight="bold" fill="#263238">${plan.name} 开挖交底平面图</text>
<text x="24" y="54" font-size="13" fill="#607d8b">深度 ${plan.depth}m · 放坡 1:${plan.slope} · 虚线=推测段</text>
${segLines}
<polygon points="${poly}" fill="rgba(229,57,53,0.12)" stroke="#e53935" stroke-width="2.5"/>
${legend}
</svg>`;
}

export function renderBriefingPage(root: HTMLElement, ctx: SceneContext): void {
  clear(root);
  const plan = store.activePlan;

  if (!plan) {
    root.append(
      h('div', { className: 'page briefing-page' },
        h('div', { className: 'page-head' }, h('h2', { textContent: '施工交底' })),
        h('section', { className: 'panel' }, h('p', { className: 'muted', textContent: '请先在「开挖方案」页选择并打开一个基坑, 再生成施工交底。' }))
      )
    );
    return;
  }

  const rows = buildBrief(plan, ctx);
  const manualRows = rows.filter((r) => r.manualDig);
  const cut: SectionCut = { a: [plan.polygon[0][0], plan.polygon[0][1]], b: [plan.polygon[2][0], plan.polygon[2][1]] };
  const sectionItems = cutSection(cut, ctx.runtime);
  const violations = checkClearances(sectionItems);
  const sectionCanvas = h('canvas', { width: '980', height: '480' }) as HTMLCanvasElement;
  drawSection(sectionCanvas, cut, sectionItems, violations);

  root.append(
    h('div', { className: 'page briefing-page' },
      h('div', { className: 'page-head' },
        h('h2', { textContent: `施工交底 · ${plan.name}` }),
        h('div', { className: 'head-actions' },
          h('button', {
            className: 'btn btn-primary', onClick: () => {
              const svg = planSvg(plan, ctx, rows);
              download('交底平面图.svg', svg, 'image/svg+xml');
              sectionCanvas.toBlob((blob) => {
                if (blob) download('交底横断面图.png', blob, 'image/png');
              });
              const md = buildMarkdown(plan, rows, violations);
              download('施工交底书.md', md, 'text/markdown;charset=utf-8');
              toast('已导出交底书 Markdown + 平面图 SVG + 横断面 PNG', 'ok', 5000);
            }, textContent: '导出全部交底文件'
          })
        )
      ),
      h('div', { className: 'summary-bar' },
        h('span', { textContent: `开挖范围内管线 ${rows.length} 段` }),
        h('span', { className: 'text-bad', textContent: `必须人工探挖 ${manualRows.length} 段` }),
        h('span', { className: violations.length ? 'text-bad' : 'text-ok', textContent: `净距违规 ${violations.length} 组` })
      ),
      h('section', { className: 'panel' },
        h('h3', { textContent: '开挖范围内管线交底清单' }),
        h('div', { className: 'table-scroll' }, table(
          ['管段', '行业', '权属单位', '最浅埋深', '探测方法', '数据状态', '人工探挖', '判定依据'],
          rows.map((r) => [
            r.rt.seg.id,
            UTILITY_META[r.rt.utility].name,
            r.rt.seg.owner ?? '—',
            `${fmt(r.minDepth)} m`,
            METHOD_META[r.rt.seg.method].name,
            r.rt.seg.inferred ? h('span', { className: 'tag tag-infer', textContent: '推测' }) : h('span', { className: 'tag tag-ok', textContent: '可靠' }),
            r.manualDig ? h('span', { className: 'tag tag-bad', textContent: '必须' }) : h('span', { textContent: '机械可控' }),
            r.reason
          ])
        ))
      ),
      h('section', { className: 'panel' },
        h('h3', { textContent: '人工探挖段落(开挖前必须落实现场探坑)' }),
        manualRows.length
          ? h('div', { className: 'table-scroll' }, table(
              ['管段', '行业', '权属', '埋深', '探挖要求'],
              manualRows.map((r) => [
                r.rt.seg.id,
                UTILITY_META[r.rt.utility].name,
                r.rt.seg.owner ?? '—',
                `${fmt(r.minDepth)} m`,
                r.reason
              ])
            ))
          : h('p', { className: 'text-ok', textContent: '无需强制人工探挖段落' })
      ),
      h('section', { className: 'panel' }, h('h3', { textContent: '基坑对角线横断面图(随交底导出)' }), h('div', { className: 'canvas-scroll' }, sectionCanvas))
    )
  );
}

function buildMarkdown(plan: ExcavationPlan, rows: BriefRow[], violations: ReturnType<typeof checkClearances>): string {
  const lines: string[] = [];
  lines.push(`# ${plan.name} 施工交底书`);
  lines.push('');
  lines.push(`- 生成时间: ${new Date().toLocaleString('zh-CN')}`);
  lines.push(`- 开挖深度: ${plan.depth} m`);
  lines.push(`- 放坡比: 1:${plan.slope}`);
  lines.push(`- 基坑角点: ${plan.polygon.map((p) => `(${p[0]},${p[1]})`).join(' ')}`);
  lines.push('');
  lines.push('## 开挖范围内管线');
  lines.push('| 管段 | 行业 | 权属单位 | 最浅埋深(m) | 探测方法 | 状态 | 人工探挖 | 依据 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    lines.push(`| ${r.rt.seg.id} | ${UTILITY_META[r.rt.utility].name} | ${r.rt.seg.owner} | ${r.minDepth.toFixed(2)} | ${METHOD_META[r.rt.seg.method].name} | ${r.rt.seg.inferred ? '推测' : '可靠'} | ${r.manualDig ? '必须' : '机械可控'} | ${r.reason} |`);
  }
  lines.push('');
  lines.push('## 净距违规提示');
  if (!violations.length) lines.push('断面内管线净距均满足 GB 50289 控制值。');
  else for (const v of violations) lines.push(`- ${v.utilityA} ${v.idA} 与 ${v.utilityB} ${v.idB}: ${v.reason}`);
  lines.push('');
  lines.push('## 安全要求');
  lines.push('1. 燃气、电力管线及推测段开挖前必须人工探挖确认, 严禁机械直接开挖。');
  lines.push('2. 挖机齿尖距燃气/电力包络 1.0m 内系统黄灯预警, 0.5m 内红灯报警并立即停止作业。');
  lines.push('3. 附图: 交底平面图.svg、交底横断面图.png。');
  return lines.join('\n');
}
