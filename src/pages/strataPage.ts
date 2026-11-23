// 道路地层页：分层半透明控制，透视观察地层与管线空间关系

import { View3D } from '../view3d';
import { STRATA, store } from '../store';

export function mountStrataPage(el: HTMLElement): () => void {
  el.innerHTML = `
    <div class="side">
      <h2>道路地层</h2>
      <div class="hint">拖动滑块调节各地层透明度，半透明叠加由顺序无关透明（OIT）渲染，任意转角不会闪烁错乱。</div>
      <div id="sliders"></div>
      <h3>显示</h3>
      <label class="check"><input type="checkbox" id="ck-env" checked /> 管线不确定包络</label>
      <div class="btn-row"><button id="btn-reset">重置视角</button></div>
    </div>
    <div class="view-wrap"><canvas class="gl"></canvas></div>
  `;
  const canvas = el.querySelector<HTMLCanvasElement>('canvas.gl')!;
  const v = new View3D(canvas);
  v.rebuildContent();
  v.start();

  const sliders = el.querySelector('#sliders')!;
  const defaults: Record<string, number> = { 路面结构层: 0.55, 杂填土: 0.34, 粉质黏土: 0.34, 砂层: 0.34 };
  for (const layer of STRATA) {
    const row = document.createElement('div');
    row.className = 'slider-row';
    row.innerHTML = `<span>${layer.name}</span>
      <input type="range" min="0" max="0.9" step="0.01" value="${defaults[layer.name] ?? 0.34}" />
      <output>${(defaults[layer.name] ?? 0.34).toFixed(2)}</output>`;
    const input = row.querySelector('input')!;
    const out = row.querySelector('output')!;
    input.addEventListener('input', () => {
      const a = Number(input.value);
      out.textContent = a.toFixed(2);
      v.setStrataAlpha(layer.name, a);
    });
    sliders.appendChild(row);
  }

  el.querySelector('#ck-env')!.addEventListener('change', (e) => {
    v.setEnvelopesVisible((e.target as HTMLInputElement).checked);
  });
  el.querySelector('#btn-reset')!.addEventListener('click', () => v.resetCamera());

  const unsub = store.subscribe(() => v.rebuildContent());
  return () => { unsub(); v.dispose(); };
}
