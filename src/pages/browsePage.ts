// 透视浏览页：分类显隐、透明度调节、任意线横断面（净距检查标红）

import * as THREE from 'three';
import { View3D } from '../view3d';
import { store } from '../store';
import { PipeCategory, CATEGORY_COLORS } from '../types';
import { computeSection, drawSection } from '../section';
import { LAYER_OPAQUE } from '../oit';

export function mountBrowsePage(el: HTMLElement): () => void {
  el.innerHTML = `
    <div class="side">
      <h2>透视浏览</h2>
      <h3>管线分类</h3>
      <div id="cats"></div>
      <h3>显示</h3>
      <label class="check"><input type="checkbox" id="ck-env" checked /> 不确定包络</label>
      <div class="slider-row"><span>地层透明</span>
        <input type="range" id="rg-strata" min="0" max="0.9" step="0.01" value="0.34" /><output>0.34</output>
      </div>
      <h3>横断面</h3>
      <div class="hint">点击“画剖切线”后在场景地面点两点，即生成该线横断面图。</div>
      <div class="btn-row">
        <button id="btn-section" class="primary">画剖切线</button>
        <button id="btn-clear-sec">清除</button>
      </div>
      <div id="sec-status" class="hint"></div>
      <div class="btn-row"><button id="btn-reset">重置视角</button></div>
    </div>
    <div class="view-wrap">
      <canvas class="gl"></canvas>
      <div class="overlay-panel" id="sec-panel" style="display:none;max-width:560px;">
        <canvas class="section-canvas" id="sec-canvas" width="1040" height="520"></canvas>
        <div id="sec-violations" class="hint" style="max-height:110px;overflow-y:auto;"></div>
      </div>
    </div>
  `;
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const canvas = $('canvas.gl') as unknown as HTMLCanvasElement;
  const v = new View3D(canvas);
  v.rebuildContent();
  v.start();

  // 分类显隐
  const cats = el.querySelector('#cats')!;
  for (const c of Object.values(PipeCategory)) {
    const id = `ck-${c}`;
    const lab = document.createElement('label');
    lab.className = 'check';
    lab.innerHTML = `<input type="checkbox" id="${id}" checked />
      <span style="color:#${CATEGORY_COLORS[c].toString(16).padStart(6, '0')}">●</span> ${c}`;
    lab.querySelector('input')!.addEventListener('change', (e) => {
      v.setCategoryVisible(c, (e.target as HTMLInputElement).checked);
    });
    cats.appendChild(lab);
  }
  $('#ck-env').addEventListener('change', (e) => v.setEnvelopesVisible((e.target as HTMLInputElement).checked));
  const rg = $('#rg-strata') as HTMLInputElement;
  rg.addEventListener('input', () => {
    const a = Number(rg.value);
    (rg.nextElementSibling as HTMLOutputElement).textContent = a.toFixed(2);
    for (const name of ['杂填土', '粉质黏土', '砂层']) v.setStrataAlpha(name, a);
  });
  $('#btn-reset').addEventListener('click', () => v.resetCamera());

  // —— 剖切线绘制 ——
  let picking = false;
  let pts: THREE.Vector3[] = [];
  let lineObj: THREE.Line | null = null;

  function clearSection(): void {
    pts = [];
    if (lineObj) { v.extras.remove(lineObj); lineObj = null; }
    $('#sec-panel').style.display = 'none';
    $('#sec-status').textContent = '';
  }

  function finishSection(): void {
    const [a, b] = pts;
    const pipes = computeSection(a.x, a.y, b.x, b.y);
    const lineLen = a.distanceTo(b);
    const cv = $('#sec-canvas') as unknown as HTMLCanvasElement;
    const violations = drawSection(cv, pipes, {
      title: `横断面（${pipes.length} 根管线，剖长 ${lineLen.toFixed(1)}m）`,
      lineLen,
    });
    $('#sec-panel').style.display = 'block';
    $('#sec-violations').innerHTML = violations.length === 0
      ? '<span style="color:#7fe0a3">净距均满足规范要求</span>'
      : violations.map(x =>
        `<div style="color:#ff8a80">${x.catA} ${x.a} × ${x.catB} ${x.b}：净距 ${x.actual.toFixed(2)}m &lt; 要求 ${x.required.toFixed(2)}m</div>`,
      ).join('');
    $('#sec-status').textContent = `断面穿过 ${pipes.length} 根管线`;
  }

  function onClick(ev: MouseEvent): void {
    if (!picking) return;
    const rect = canvas.getBoundingClientRect();
    const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    const p = v.pickGround(nx, ny);
    if (!p) return;
    pts.push(p);
    if (lineObj) { v.extras.remove(lineObj); lineObj = null; }
    if (pts.length === 1) {
      $('#sec-status').textContent = '已取第一点，再点第二点';
    } else if (pts.length >= 2) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        pts[0].clone().setZ(store.baseElev + 0.3),
        pts[1].clone().setZ(store.baseElev + 0.3),
      ]);
      lineObj = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xab47bc }));
      lineObj.layers.set(LAYER_OPAQUE);
      v.extras.add(lineObj);
      picking = false;
      $('#btn-section').textContent = '画剖切线';
      finishSection();
    }
  }
  canvas.addEventListener('click', onClick);

  $('#btn-section').addEventListener('click', () => {
    picking = !picking;
    if (picking) {
      clearSection();
      $('#btn-section').textContent = '取消取点';
      $('#sec-status').textContent = '在地面点击第一点';
    } else {
      $('#btn-section').textContent = '画剖切线';
    }
  });
  $('#btn-clear-sec').addEventListener('click', clearSection);

  const unsub = store.subscribe(() => v.rebuildContent());
  return () => { unsub(); v.dispose(); };
}
