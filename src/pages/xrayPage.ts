// 页面3: 透视浏览 —— 拾取管段查看属性、推测段高亮、图例、快捷视角
import * as THREE from 'three';
import { h, clear, fmt } from '../ui/dom';
import type { SceneContext } from '../core/sceneContext';
import { GRADE_META, MATERIAL_NAME, METHOD_META, UTILITY_META, envelopeRadius } from '../domain/constants';
import type { PipeSegment } from '../domain/types';

export function renderXrayPage(root: HTMLElement, ctx: SceneContext): void {
  clear(root);
  const info = h('div', { className: 'panel info-panel inspect-panel' });

  const showInfer = h('input', { type: 'checkbox' }) as HTMLInputElement;
  showInfer.addEventListener('change', () => {
    ctx.pipelineGroup?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.userData.segmentId) return;
      const seg = ctx.segments.find((s) => s.id === mesh.userData.segmentId);
      if (!seg) return;
      mesh.visible = showInfer.checked ? !seg.inferred : true;
    });
  });

  const envToggle = h('input', { type: 'checkbox', checked: 'true' }) as HTMLInputElement;
  envToggle.addEventListener('change', () => ctx.setEnvelopeVisible(envToggle.checked));

  const renderInfo = (seg: PipeSegment | null) => {
    info.innerHTML = '';
    if (!seg) {
      info.append(h('h3', { textContent: '管段属性' }), h('p', { className: 'muted', textContent: '在三维视图中点击任意管段查看详情' }));
      return;
    }
    const pa = ctx.points.find((p) => p.id === seg.startId);
    const pb = ctx.points.find((p) => p.id === seg.endId);
    const envR = envelopeRadius(seg.method, seg.grade, seg.inferred);
    info.append(
      h('h3', { textContent: `管段 ${seg.id}` }),
      h('div', { className: 'kv' },
        kv('行业', `${UTILITY_META[seg.utility].name} · ${seg.owner ?? ''}`),
        kv('连接', `${seg.startId} → ${seg.endId}`),
        kv('断面', seg.shape === 'round' ? `圆管 DN${seg.diameter} ${MATERIAL_NAME[seg.material]}` : seg.shape === 'duct' ? `排管 ${seg.holes} 孔 DN${seg.diameter}` : `方沟 ${seg.boxW}×${seg.boxH} mm`),
        kv('起止埋深', `${fmt(seg.startDepth)}m ~ ${fmt(seg.endDepth)}m`),
        kv('探测方法', METHOD_META[seg.method].name),
        kv('精度等级', seg.grade ? GRADE_META[seg.grade].name : '未填(按 B 级)'),
        kv('包络半径', `${fmt(envR, 2)} m(不含管体)`),
        kv('数据状态', seg.inferred ? h('span', { className: 'tag tag-infer', textContent: '插值推测段' }) : h('span', { className: 'tag tag-ok', textContent: '实测/物探' })),
        kv('端点坐标', pa && pb ? `(${fmt(pa.x, 1)},${fmt(pa.y, 1)}) → (${fmt(pb.x, 1)},${fmt(pb.y, 1)})` : '—')
      )
    );
  };
  renderInfo(null);

  // 拾取
  const pointer = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  const dom = ctx.renderer.domElement;
  const onClick = (ev: MouseEvent) => {
    const rect = dom.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(pointer, ctx.camera);
    const hits = ray.intersectObjects(ctx.pipelineGroup?.children ?? [], true);
    const hit = hits.find((x) => x.object.userData.segmentId);
    if (hit) renderInfo(ctx.segments.find((s) => s.id === hit.object.userData.segmentId) ?? null);
  };
  dom.addEventListener('click', onClick);

  root.append(
    h('div', { className: 'page xray-page' },
      h('div', { className: 'page-head' }, h('h2', { textContent: '透视浏览' })),
      h('div', { className: 'control-dock' },
        h('div', { className: 'dock-row' }, h('label', { textContent: '不确定包络' }), envToggle),
        h('div', { className: 'dock-row' }, h('label', { textContent: '仅隐藏推测段' }), showInfer),
        h('div', { className: 'dock-row' },
          h('button', { className: 'btn', onClick: () => ctx.flyTo(0, 95, 0.01), textContent: '俯视' }),
          h('button', { className: 'btn', onClick: () => ctx.flyTo(60, 25, 60, 0, -1.5, 0), textContent: '低角度透视' }),
          h('button', { className: 'btn', onClick: () => ctx.flyTo(-55, 40, -45), textContent: '路口斜视' })
        ),
        h('div', { className: 'legend' },
          ...Object.values(UTILITY_META).map((m) =>
            h('div', { className: 'legend-item' }, h('span', { className: 'chip-dot', style: `background:${m.hex}` }), h('span', { textContent: m.name }))
          ),
          h('div', { className: 'legend-item' }, h('span', { className: 'chip-dot', style: 'background:#ff7043' }), h('span', { textContent: '推测数据(橙描边)' }))
        )
      ),
      info
    )
  );
}

function kv(k: string, v: string | Node): Node {
  return h('div', { className: 'kv-row' }, h('span', { className: 'kv-key', textContent: k }), typeof v === 'string' ? h('span', { className: 'kv-val', textContent: v }) : h('span', { className: 'kv-val' }, v));
}
