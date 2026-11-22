// 页面4: 开挖方案 —— 基坑轮廓/深度/放坡比, 真三维开挖, 坑壁管线埋深标注
import { h, clear, table, fmt } from '../ui/dom';
import { toast } from '../ui/toast';
import { store } from '../state/store';
import type { SceneContext } from '../core/sceneContext';
import type { ExcavationPlan } from '../domain/types';
import { UTILITY_META } from '../domain/constants';
import { pointInPolygon, pointToPolygonEdge } from '../core/geo';

export function renderExcavationPlanPage(root: HTMLElement, ctx: SceneContext): void {
  clear(root);

  const depthInput = h('input', { type: 'number', value: '2.5', step: '0.1', min: '0.5', max: '5.5' }) as HTMLInputElement;
  const slopeInput = h('input', { type: 'number', value: '0.5', step: '0.1', min: '0', max: '2' }) as HTMLInputElement;
  const nameInput = h('input', { type: 'text', placeholder: '基坑方案名称', value: `路口基坑 ${store.plans.length + 1}` }) as HTMLInputElement;
  const preset = h('select', {},
    h('option', { value: 'intersection', textContent: '路口矩形基坑 (16×12m)' }),
    h('option', { value: 'north', textContent: '北侧支路基坑 (10×8m)' }),
    h('option', { value: 'south', textContent: '南侧支路基坑 (10×8m)' })
  ) as HTMLSelectElement;

  const presets: Record<string, [number, number][]> = {
    intersection: [[-8, -6], [8, -6], [8, 6], [-8, 6]],
    north: [[-5, 18], [5, 18], [5, 28], [-5, 28]],
    south: [[-5, -28], [5, -28], [5, -18], [-5, -18]]
  };

  const wallList = h('div', { className: 'wall-pipe-list' });

  const refreshWallList = (plan: ExcavationPlan) => {
    wallList.innerHTML = '';
    const inside = ctx.runtime.filter((r) => {
      const mx = (r.a.x + r.b.x) / 2;
      const my = (r.a.z + r.b.z) / 2;
      return pointInPolygon(mx, my, plan.polygon) || pointToPolygonEdge(mx, my, plan.polygon) < 1.5;
    });
    if (!inside.length) {
      wallList.appendChild(h('p', { className: 'muted', textContent: '基坑范围内无管线' }));
      return;
    }
    wallList.appendChild(
      table(
        ['管段', '行业', '管底埋深', '管径/断面', '数据状态'],
        inside.map((r) => [
          r.seg.id,
          UTILITY_META[r.utility].name,
          `${fmt(Math.min(-r.a.y, -r.b.y) + r.outerRadius)} m`,
          r.seg.shape === 'round' ? `DN${r.seg.diameter}` : r.seg.shape === 'duct' ? `${r.seg.holes}孔排管` : `${r.seg.boxW}×${r.seg.boxH}`,
          r.seg.inferred ? h('span', { className: 'tag tag-infer', textContent: '推测' }) : h('span', { className: 'tag tag-ok', textContent: '可靠' })
        ])
      )
    );
  };

  const applyPlan = (plan: ExcavationPlan) => {
    ctx.setPit(plan);
    store.activePlanId = plan.id;
    refreshWallList(plan);
    const labelCount = ctx.wallLabels.length;
    toast(`已开挖 ${plan.name}: 深度 ${plan.depth}m, 放坡 1:${plan.slope}, 坑壁标注管线 ${labelCount} 处`, 'ok', 4500);
  };

  const planList = h('div', { className: 'plan-list' });
  const renderPlanList = () => {
    planList.innerHTML = '';
    if (!store.plans.length) {
      planList.appendChild(h('p', { className: 'muted', textContent: '暂无保存的开挖方案' }));
      return;
    }
    for (const p of store.plans) {
      planList.appendChild(
        h('div', { className: `plan-item ${store.activePlanId === p.id ? 'active' : ''}` },
          h('div', { className: 'plan-item-main', onClick: () => applyPlan(p) },
            h('div', { className: 'plan-name', textContent: p.name }),
            h('div', { className: 'plan-meta', textContent: `深 ${p.depth}m · 放坡 1:${p.slope} · ${p.polygon.length} 边形 · ${new Date(p.createdAt).toLocaleString('zh-CN')}` })
          ),
          h('button', {
            className: 'btn btn-mini', onClick: async () => {
              await store.deletePlan(p.id);
              ctx.setPit(null);
              renderPlanList();
              toast('方案已删除', 'info');
            }, textContent: '删除'
          })
        )
      );
    }
  };
  renderPlanList();

  root.append(
    h('div', { className: 'page excavation-page' },
      h('div', { className: 'page-head' }, h('h2', { textContent: '开挖方案' })),
      h('div', { className: 'excav-grid' },
        h('section', { className: 'panel' },
          h('h3', { textContent: '新建基坑' }),
          h('div', { className: 'form-row' }, h('label', { textContent: '方案名称' }), nameInput),
          h('div', { className: 'form-row' }, h('label', { textContent: '基坑轮廓' }), preset),
          h('div', { className: 'form-row' }, h('label', { textContent: '开挖深度 m' }), depthInput),
          h('div', { className: 'form-row' }, h('label', { textContent: '放坡比 1:n' }), slopeInput),
          h('p', { className: 'muted', textContent: '基坑通过 5 个裁剪平面(四放坡壁+坑底)真实切穿地层与管线, 管段在坑壁上的位置与埋深直接标注于壁面。' }),
          h('div', { className: 'form-actions' },
            h('button', {
              className: 'btn btn-primary', onClick: async () => {
                const depth = Number(depthInput.value);
                const slope = Number(slopeInput.value);
                if (!(depth > 0)) return toast('深度非法', 'error');
                const plan: ExcavationPlan = {
                  id: `PLAN-${Date.now()}`,
                  name: nameInput.value || '未命名基坑',
                  polygon: presets[preset.value],
                  depth,
                  slope,
                  createdAt: Date.now()
                };
                await store.savePlan(plan);
                applyPlan(plan);
                renderPlanList();
              }, textContent: '保存并开挖'
            }),
            h('button', { className: 'btn btn-ghost', onClick: () => { ctx.setPit(null); store.activePlanId = null; renderPlanList(); }, textContent: '回填(关闭基坑)' })
          )
        ),
        h('section', { className: 'panel' },
          h('h3', { textContent: '已保存方案 (IndexedDB)' }),
          planList
        ),
        h('section', { className: 'panel panel-wide' },
          h('h3', { textContent: '开挖范围内管线(坑壁交底依据)' }),
          wallList
        )
      )
    )
  );
}
