// 开挖方案页：绘制坑底轮廓、设深度与放坡比；基坑从地层中挖出，坑壁标注出露管线

import * as THREE from 'three';
import { View3D } from '../view3d';
import { store } from '../store';
import { ExcavationPlan } from '../types';
import { buildPit, clearPitClip, BuiltPit } from '../scene/pit';
import { LAYER_OPAQUE } from '../oit';

export function mountExcavPage(el: HTMLElement): () => void {
  el.innerHTML = `
    <div class="side">
      <h2>开挖方案</h2>
      <div class="btn-row">
        <button id="btn-draw" class="primary">绘制坑底轮廓</button>
        <button id="btn-finish" disabled>完成绘制</button>
      </div>
      <div class="hint">在地面逐点点击勾勒坑底边界（至少3点），放坡由坑底向上向外展开。</div>
      <label class="field"><span>方案名称</span><input type="text" id="inp-name" value="基坑-1" /></label>
      <label class="field"><span>开挖深度 (m)</span><input type="number" id="inp-depth" value="2.5" min="0.5" max="7" step="0.1" /></label>
      <label class="field"><span>放坡比（水平:垂直）</span><input type="number" id="inp-slope" value="0.75" min="0" max="2" step="0.05" /></label>
      <div class="btn-row"><button id="btn-save" class="primary" disabled>保存方案</button></div>
      <h3>已有方案</h3>
      <div id="plans"></div>
      <h3>坑壁出露管线</h3>
      <div id="exposures" class="hint"></div>
    </div>
    <div class="view-wrap"><canvas class="gl"></canvas></div>
  `;
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const canvas = $('canvas.gl') as unknown as HTMLCanvasElement;
  const v = new View3D(canvas);
  v.rebuildContent();
  v.start();

  let drawing = false;
  let drawPts: THREE.Vector3[] = [];
  let drawLine: THREE.Line | null = null;
  let currentPit: BuiltPit | null = null;
  let activePlan: ExcavationPlan | null = null;

  function refreshDrawLine(): void {
    if (drawLine) { v.extras.remove(drawLine); drawLine = null; }
    if (drawPts.length >= 2) {
      const pts = [...drawPts, drawPts[0]].map(p => p.clone().setZ(store.baseElev + 0.3));
      drawLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xff5722 }),
      );
      drawLine.layers.set(LAYER_OPAQUE);
      v.extras.add(drawLine);
    }
  }

  function showPit(plan: ExcavationPlan): void {
    if (currentPit) { v.extras.remove(currentPit.group); currentPit = null; }
    clearPitClip();
    activePlan = plan;
    currentPit = buildPit(plan);
    v.extras.add(currentPit.group);
    $('#exposures').innerHTML = currentPit.exposures.length === 0
      ? '坑壁无出露管线'
      : currentPit.exposures.map(x =>
        `<div>${x.category} ${x.segId} — 埋深 ${x.depth.toFixed(2)}m</div>`).join('');
  }

  function renderPlans(): void {
    const box = $('#plans');
    box.innerHTML = '';
    for (const p of store.plans) {
      const row = document.createElement('div');
      row.className = 'btn-row';
      row.style.alignItems = 'center';
      row.innerHTML = `<button class="btn-show">${p.name}（深${p.depth}m）</button><button class="danger btn-del">删</button>`;
      row.querySelector('.btn-show')!.addEventListener('click', () => showPit(p));
      row.querySelector('.btn-del')!.addEventListener('click', async () => {
        await store.deletePlan(p.id);
        if (activePlan?.id === p.id) {
          if (currentPit) { v.extras.remove(currentPit.group); currentPit = null; }
          clearPitClip();
          $('#exposures').textContent = '';
        }
      });
      box.appendChild(row);
    }
  }

  function onClick(ev: MouseEvent): void {
    if (!drawing) return;
    const rect = canvas.getBoundingClientRect();
    const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    const p = v.pickGround(nx, ny);
    if (!p) return;
    drawPts.push(p);
    refreshDrawLine();
    ($('#btn-finish') as HTMLButtonElement).disabled = drawPts.length < 3;
  }
  canvas.addEventListener('click', onClick);

  $('#btn-draw').addEventListener('click', () => {
    drawing = true;
    drawPts = [];
    refreshDrawLine();
    ($('#btn-finish') as HTMLButtonElement).disabled = true;
  });

  $('#btn-finish').addEventListener('click', () => {
    if (drawPts.length < 3) return;
    drawing = false;
    const plan: ExcavationPlan = {
      id: `plan-${Date.now()}`,
      name: ($('#inp-name') as HTMLInputElement).value || '基坑',
      polygon: drawPts.map(p => [p.x, p.y]),
      depth: Number(($('#inp-depth') as HTMLInputElement).value) || 2.5,
      slope: Number(($('#inp-slope') as HTMLInputElement).value) || 0.75,
      groundElev: store.baseElev,
    };
    showPit(plan);
    ($('#btn-save') as HTMLButtonElement).disabled = false;
  });

  $('#btn-save').addEventListener('click', async () => {
    if (!activePlan) return;
    await store.savePlan(activePlan);
    ($('#btn-save') as HTMLButtonElement).disabled = true;
  });

  // 深度/放坡变化时实时更新预览
  for (const id of ['#inp-depth', '#inp-slope']) {
    $(id).addEventListener('input', () => {
      if (!activePlan) return;
      activePlan = {
        ...activePlan,
        depth: Number(($('#inp-depth') as HTMLInputElement).value) || 2.5,
        slope: Number(($('#inp-slope') as HTMLInputElement).value) || 0.75,
      };
      showPit(activePlan);
      ($('#btn-save') as HTMLButtonElement).disabled = false;
    });
  }

  const unsub = store.subscribe(renderPlans);
  renderPlans();
  return () => {
    unsub();
    clearPitClip();
    v.dispose();
  };
}
