// 页面6: 横断面 —— 任意直线切剖, 断面位置/埋深/相互净距, 违规标红, 导出 PNG
import { h, clear, table, download, fmt } from '../ui/dom';
import { toast } from '../ui/toast';
import type { SceneContext } from '../core/sceneContext';
import { cutSection, checkClearances, drawSection, type SectionCut } from '../core/section';
import { UTILITY_META } from '../domain/constants';

export function renderSectionPage(root: HTMLElement, ctx: SceneContext): void {
  clear(root);

  const canvas = h('canvas', { width: '980', height: '520', className: 'section-canvas' }) as HTMLCanvasElement;
  const cutSelect = h('select', {},
    h('option', { value: 'ew', textContent: '东西向切线(横穿南北干道, x=-80→80 @ y=0)' }),
    h('option', { value: 'ns', textContent: '南北向切线(横穿东西干道, y=-60→60 @ x=0)' }),
    h('option', { value: 'diag', textContent: '斜向切线(路口对角)' }),
    h('option', { value: 'branch', textContent: '北支路切线' })
  ) as HTMLSelectElement;

  const cuts: Record<string, SectionCut> = {
    ew: { a: [-80, 0], b: [80, 0] },
    ns: { a: [0, -60], b: [0, 60] },
    diag: { a: [-45, -45], b: [45, 45] },
    branch: { a: [-12, 45], b: [12, 45] }
  };

  const summary = h('div', { className: 'section-summary' });
  const violationPanel = h('div', { className: 'violation-panel' });

  const redraw = () => {
    const cut = cuts[cutSelect.value];
    const items = cutSection(cut, ctx.runtime);
    const violations = checkClearances(items);
    drawSection(canvas, cut, items, violations);

    summary.innerHTML = '';
    summary.append(
      h('span', { textContent: `切面管线 ${items.length} 处` }),
      h('span', { textContent: `推测断面 ${items.filter((i) => i.inferred).length} 处` }),
      h('span', { className: violations.length ? 'text-bad' : 'text-ok', textContent: violations.length ? `净距违规 ${violations.length} 组` : '净距全部满足规范' })
    );

    violationPanel.innerHTML = '';
    violationPanel.appendChild(h('h3', { textContent: '净距校核(GB 50289 控制值)' }));
    if (!violations.length) {
      violationPanel.appendChild(h('p', { className: 'text-ok', textContent: '✔ 该断面所有管线相互净距满足规范要求' }));
    } else {
      violationPanel.appendChild(
        table(
          ['管线 A', '管线 B', '垂直净距', '水平净距', '判定'],
          violations.map((v) => [
            `${v.utilityA} ${v.idA}`,
            `${v.utilityB} ${v.idB}`,
            `${fmt(v.verticalGap)} m (限 ${fmt(v.minVertical)})`,
            `${fmt(v.horizontalGap)} m (限 ${fmt(v.minHorizontal)})`,
            h('span', { className: 'tag tag-bad', textContent: v.reason })
          ])
        )
      );
    }
    // 断面明细
    violationPanel.appendChild(h('h3', { textContent: '断面管线明细' }));
    violationPanel.appendChild(
      table(
        ['管段', '行业', '横向位置 s', '管底埋深', '管径', '包络半径', '状态'],
        items.map((it) => [
          it.segmentId,
          UTILITY_META[it.utility].name,
          `${fmt(it.s)} m`,
          `${fmt(it.depth)} m`,
          `DN${it.diameter}`,
          `${fmt(it.envelopeRadius)} m`,
          it.inferred ? h('span', { className: 'tag tag-infer', textContent: '推测' }) : h('span', { className: 'tag tag-ok', textContent: '可靠' })
        ])
      )
    );
  };

  cutSelect.addEventListener('change', redraw);

  root.append(
    h('div', { className: 'page section-page' },
      h('div', { className: 'page-head' },
        h('h2', { textContent: '横断面切剖' }),
        h('div', { className: 'head-actions' },
          cutSelect,
          h('button', { className: 'btn btn-primary', onClick: redraw, textContent: '重新切剖' }),
          h('button', {
            className: 'btn', onClick: () => {
              canvas.toBlob((blob) => {
                if (blob) {
                  download(`横断面_${cutSelect.value}.png`, blob, 'image/png');
                  toast('横断面图已导出 PNG', 'ok');
                }
              }, 'image/png');
            }, textContent: '导出断面图 PNG'
          })
        )
      ),
      h('div', { className: 'summary-bar' }, summary),
      h('section', { className: 'panel' }, h('div', { className: 'canvas-scroll' }, canvas)),
      h('section', { className: 'panel' }, violationPanel)
    )
  );
  redraw();
}
