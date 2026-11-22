// 页面2: 道路地层 —— 路面/地层透明度、地层信息、俯视透视控制
import * as THREE from 'three';
import { h, clear } from '../ui/dom';
import type { SceneContext } from '../core/sceneContext';
import { STRATA, UTILITY_META, UTILITY_ORDER } from '../domain/constants';

export function renderTerrainPage(root: HTMLElement, ctx: SceneContext): void {
  clear(root);
  const visible = new Set(UTILITY_ORDER);

  const applyUtilityFilter = () => {
    ctx.pipelineGroup?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.userData.segmentId) return;
      const seg = ctx.segments.find((s) => s.id === mesh.userData.segmentId);
      if (seg) mesh.visible = visible.has(seg.utility);
    });
  };

  const roadSlider = h('input', { type: 'range', min: '0', max: '100', value: '55' }) as HTMLInputElement;
  roadSlider.addEventListener('input', () => ctx.setRoadOpacity(Number(roadSlider.value) / 100));
  const strataSlider = h('input', { type: 'range', min: '0', max: '100', value: '70' }) as HTMLInputElement;
  strataSlider.addEventListener('input', () => ctx.setStrataOpacity(Number(strataSlider.value) / 100));
  const envToggle = h('input', { type: 'checkbox' }) as HTMLInputElement;
  envToggle.checked = ctx.showEnvelopes;
  envToggle.addEventListener('change', () => ctx.setEnvelopeVisible(envToggle.checked));
  const terrainToggle = h('input', { type: 'checkbox', checked: 'true' }) as HTMLInputElement;
  terrainToggle.addEventListener('change', () => ctx.setTerrainVisible(terrainToggle.checked));

  root.append(
    h('div', { className: 'page terrain-page' },
      h('div', { className: 'page-head' }, h('h2', { textContent: '道路地层与透视' })),
      h('div', { className: 'control-dock' },
        h('div', { className: 'dock-row' }, h('label', { textContent: '路面透明度' }), roadSlider, h('span', { className: 'dock-val', textContent: '55%' })),
        h('div', { className: 'dock-row' }, h('label', { textContent: '地层透明度' }), strataSlider, h('span', { className: 'dock-val', textContent: '70%' })),
        h('div', { className: 'dock-row' }, h('label', { textContent: '显示不确定包络' }), envToggle),
        h('div', { className: 'dock-row' }, h('label', { textContent: '显示路面与地层' }), terrainToggle),
        h('div', { className: 'dock-row' },
          h('button', { className: 'btn', onClick: () => ctx.flyTo(0, 95, 0.01, 0, -2, 0), textContent: '垂直俯视透视' }),
          h('button', { className: 'btn', onClick: () => ctx.flyTo(48, 38, 56), textContent: '复位透视视角' })
        ),
        h('div', { className: 'dock-row utility-filter' },
          h('label', { textContent: '行业过滤' }),
          ...UTILITY_ORDER.map((u) => {
            const cb = h('input', { type: 'checkbox', checked: 'true' }) as HTMLInputElement;
            cb.addEventListener('change', () => {
              if (cb.checked) visible.add(u);
              else visible.delete(u);
              applyUtilityFilter();
            });
            return h('label', { className: 'chip' },
              h('span', { className: 'chip-dot', style: `background:${UTILITY_META[u].hex}` }),
              cb,
              h('span', { textContent: UTILITY_META[u].name })
            );
          })
        )
      ),

      h('section', { className: 'panel info-panel' },
        h('h3', { textContent: '地层柱状信息(自上而下)' }),
        h('div', { className: 'strata-list' },
          ...STRATA.map((layer, i) => {
            const top = i === 0 ? 0 : STRATA[i - 1].bottomDepth;
            return h('div', { className: 'strata-row' },
              h('span', { className: 'strata-swatch', style: `background:#${layer.color.toString(16).padStart(6, '0')}` }),
              h('div', {},
                h('div', { className: 'strata-name', textContent: layer.name }),
                h('div', { className: 'strata-meta', textContent: `层底埋深 ${layer.bottomDepth.toFixed(1)}m · 层厚 ${(layer.bottomDepth - top).toFixed(1)}m · 默认透明度 ${Math.round(layer.opacity * 100)}%` })
              )
            );
          })
        ),
        h('p', { className: 'muted', textContent: '半透明采用两遍加权混合顺序无关渲染(WBOIT), 多层透明物叠加与观察角度无关, 不会出现闪烁或前后错乱。' })
      )
    )
  );
}
