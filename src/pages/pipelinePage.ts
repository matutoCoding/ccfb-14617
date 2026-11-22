// 页面1: 管线数据 —— 行业统计、CSV 导入导出、坏数据报告、管点/管段表
import { h, clear, table, download, fmt } from '../ui/dom';
import { toast } from '../ui/toast';
import { store } from '../state/store';
import { GRADE_META, MATERIAL_NAME, METHOD_META, UTILITY_META, UTILITY_ORDER } from '../domain/constants';
import { exportPointsCsv, exportSegmentsCsv, parseCSV } from '../data/csv';
import type { UtilityType } from '../domain/types';

export function renderPipelinePage(root: HTMLElement): void {
  clear(root);
  const s = store;

  const counts = Object.fromEntries(UTILITY_ORDER.map((u) => [u, s.segments.filter((x) => x.utility === u).length])) as Record<UtilityType, number>;
  const pointCounts = Object.fromEntries(UTILITY_ORDER.map((u) => [u, s.points.filter((x) => x.utility === u).length])) as Record<UtilityType, number>;
  const inferredSegs = s.segments.filter((x) => x.inferred).length;
  const errors = s.issues.filter((i) => i.level === 'error');
  const warns = s.issues.filter((i) => i.level === 'warning');

  const statCards = UTILITY_ORDER.map((u) =>
    h('div', { className: 'stat-card', style: `border-left-color:${UTILITY_META[u].hex}` },
      h('div', { className: 'stat-name', textContent: UTILITY_META[u].name }),
      h('div', { className: 'stat-num', textContent: String(counts[u]) }),
      h('div', { className: 'stat-sub', textContent: `${pointCounts[u]} 点 · ${UTILITY_META[u].owner}` })
    )
  );

  const issueList = h('div', { className: 'issue-list' });
  for (const iss of s.issues) {
    issueList.appendChild(
      h('div', { className: `issue issue-${iss.level}` },
        h('span', { className: 'issue-badge', textContent: iss.level === 'error' ? '错误' : '警告' }),
        h('span', { className: 'issue-table', textContent: iss.table === 'point' ? '管点表' : '管段表' }),
        h('span', { className: 'issue-row', textContent: iss.row > 0 ? `第${iss.row}行` : '插值' }),
        h('span', { className: 'issue-ref', textContent: iss.refId }),
        h('span', { className: 'issue-msg', textContent: iss.message })
      )
    );
  }

  const pointRows = s.points.slice(0, 400).map((p) => [
    p.id,
    UTILITY_META[p.utility].name,
    p.kind,
    `${fmt(p.x, 2)}, ${fmt(p.y, 2)}`,
    p.inferred ? h('span', { className: 'tag tag-infer', textContent: `${fmt(p.depth, 2)} (推测)` }) : fmt(p.depth, 2),
    METHOD_META[p.method].name,
    p.grade ? GRADE_META[p.grade].name : h('span', { className: 'tag tag-bad', textContent: '未填' })
  ]);

  const segRows = s.segments.slice(0, 400).map((g) => [
    g.id,
    UTILITY_META[g.utility].name,
    `${g.startId}→${g.endId}`,
    g.shape === 'round' ? `DN${g.diameter} ${MATERIAL_NAME[g.material] ?? g.material}` : g.shape === 'duct' ? `排管 ${g.holes}孔 DN${g.diameter}` : `方沟 ${g.boxW}×${g.boxH}`,
    `${fmt(g.startDepth, 2)} ~ ${fmt(g.endDepth, 2)}m`,
    METHOD_META[g.method].name,
    g.inferred ? h('span', { className: 'tag tag-infer', textContent: '推测段' }) : g.grade ? GRADE_META[g.grade].name : h('span', { className: 'tag tag-bad', textContent: '未填' })
  ]);

  const pointFile = h('input', { type: 'file', accept: '.csv', style: 'display:none' }) as HTMLInputElement;
  const segFile = h('input', { type: 'file', accept: '.csv', style: 'display:none' }) as HTMLInputElement;
  let pointCsvText = '';
  let segCsvText = '';
  pointFile.addEventListener('change', async () => {
    pointCsvText = await pointFile.files?.[0]?.text() ?? '';
    tryImport();
  });
  segFile.addEventListener('change', async () => {
    segCsvText = await segFile.files?.[0]?.text() ?? '';
    tryImport();
  });
  const tryImport = () => {
    if (!pointCsvText || !segCsvText) return;
    // 列头自检
    const ph = parseCSV(pointCsvText)[0] ?? [];
    if (!ph.includes('id') || !ph.includes('x')) {
      toast('管点表列头不正确, 需含 id,kind,x,y,depth,...', 'error', 5000);
      return;
    }
    store.importFromCsv(pointCsvText, segCsvText).then((issues) => {
      const err = issues.filter((i) => i.level === 'error').length;
      toast(`导入完成: ${store.points.length} 点 / ${store.segments.length} 段, ${err} 个错误行已剔除`, err ? 'warn' : 'ok', 5000);
      renderPipelinePage(root);
    });
  };

  root.append(
    h('div', { className: 'page pipeline-page' },
      h('div', { className: 'page-head' },
        h('h2', { textContent: '管线数据' }),
        h('div', { className: 'head-actions' },
          h('button', {
            className: 'btn', onClick: () => pointFile.click(), textContent: '导入管点表 CSV'
          }),
          h('button', {
            className: 'btn', onClick: () => segFile.click(), textContent: '导入管段表 CSV'
          }),
          pointFile, segFile,
          h('button', { className: 'btn btn-ghost', onClick: () => download('管点表.csv', exportPointsCsv(store.points)), textContent: '导出管点表' }),
          h('button', { className: 'btn btn-ghost', onClick: () => download('管段表.csv', exportSegmentsCsv(store.segments)), textContent: '导出管段表' }),
          h('button', {
            className: 'btn btn-primary', onClick: async () => {
              await store.loadDemo();
              toast('已重新生成演示数据集(含坏数据)', 'ok');
              renderPipelinePage(root);
            }, textContent: '重新生成测试数据'
          })
        )
      ),

      h('div', { className: 'stat-grid' }, ...statCards),

      h('div', { className: 'summary-bar' },
        h('span', { textContent: `管点 ${s.points.length} 个` }),
        h('span', { textContent: `管段 ${s.segments.length} 段` }),
        h('span', { textContent: `插值推测段 ${inferredSegs} 段` }),
        h('span', { className: errors.length ? 'text-bad' : 'text-ok', textContent: `坏行错误 ${errors.length} 条` }),
        h('span', { className: 'text-warn', textContent: `警告 ${warns.length} 条` })
      ),

      h('div', { className: 'panel-grid' },
        h('section', { className: 'panel panel-wide' },
          h('h3', { textContent: '校验与坏数据报告' }),
          issueList.children.length ? issueList : h('p', { className: 'muted', textContent: '无校验问题' })
        )
      ),

      h('section', { className: 'panel' },
        h('h3', { textContent: `管点表(前 400 行 / 共 ${s.points.length})` }),
        h('div', { className: 'table-scroll' }, table(['ID', '行业', '类型', '坐标(x,y)', '埋深 m', '探测方法', '精度'], pointRows))
      ),
      h('section', { className: 'panel' },
        h('h3', { textContent: `管段表(前 400 行 / 共 ${s.segments.length})` }),
        h('div', { className: 'table-scroll' }, table(['ID', '行业', '连接', '断面', '起止埋深', '探测方法', '精度'], segRows))
      )
    )
  );
}
