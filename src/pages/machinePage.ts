// 挖机作业页：三关节控制（滑块+键盘）、齿尖-包络实时距离、分级报警、姿态录制回放

import { View3D } from '../view3d';
import { Excavator, JOINT_LIMITS, ArmPose } from '../scene/excavator';
import { nearestEnvelope, alarmFor } from '../envelope';
import { store } from '../store';
import { PoseFrame, PoseRecording } from '../types';

const KEYMAP: Record<string, [keyof ArmPose, number]> = {
  q: ['boom', 1], a: ['boom', -1],
  w: ['stick', 1], s: ['stick', -1],
  e: ['bucket', 1], d: ['bucket', -1],
  arrowup: ['boom', 1], arrowdown: ['boom', -1],
  arrowleft: ['stick', 1], arrowright: ['stick', -1],
};

export function mountMachinePage(el: HTMLElement): () => void {
  el.innerHTML = `
    <div class="side">
      <h2>挖机作业</h2>
      <div class="btn-row"><button id="btn-place">点击放置挖机</button><button id="btn-reset">重置视角</button></div>
      <h3>关节控制</h3>
      <div id="sliders"></div>
      <div class="hint">键盘：<span class="kbd">Q/A</span> 动臂 <span class="kbd">W/S</span> 斗杆 <span class="kbd">E/D</span> 铲斗（或方向键）</div>
      <h3>姿态录制</h3>
      <div class="btn-row">
        <button id="btn-rec">● 开始录制</button>
        <button id="btn-stop" disabled>■ 停止并保存</button>
      </div>
      <div id="recs"></div>
    </div>
    <div class="view-wrap">
      <canvas class="gl"></canvas>
      <div class="dist-hud">
        <div>齿尖 → 最近管线包络</div>
        <div class="big" id="hud-dist">—</div>
        <div id="hud-info" class="hint"></div>
      </div>
      <div class="alarm-banner" id="alarm"></div>
    </div>
  `;
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const canvas = $('canvas.gl') as unknown as HTMLCanvasElement;
  const v = new View3D(canvas);
  v.rebuildContent();
  v.setEnvelopesVisible(true);

  const exc = new Excavator();
  exc.group.position.set(10, 10, store.baseElev);
  v.extras.add(exc.group);
  v.start();

  // —— 滑块 ——
  const slidersBox = $('#sliders');
  const sliderInputs: Record<keyof ArmPose, HTMLInputElement> = {} as never;
  const sliderOuts: Record<keyof ArmPose, HTMLOutputElement> = {} as never;
  const LABELS: Record<keyof ArmPose, string> = { boom: '动臂', stick: '斗杆', bucket: '铲斗' };
  for (const j of ['boom', 'stick', 'bucket'] as const) {
    const lim = JOINT_LIMITS[j];
    const row = document.createElement('div');
    row.className = 'slider-row';
    row.innerHTML = `<span>${LABELS[j]}</span>
      <input type="range" min="${lim.min}" max="${lim.max}" step="${lim.step}" value="${exc.pose[j]}" />
      <output>${exc.pose[j].toFixed(2)}</output>`;
    const inp = row.querySelector('input')!;
    const out = row.querySelector('output')!;
    inp.addEventListener('input', () => {
      exc.setPose({ ...exc.pose, [j]: Number(inp.value) });
    });
    sliderInputs[j] = inp;
    sliderOuts[j] = out;
    slidersBox.appendChild(row);
  }

  // —— 键盘 ——
  const pressed = new Set<keyof ArmPose>();
  const pressedDir = new Map<keyof ArmPose, number>();
  function onKey(ev: KeyboardEvent, down: boolean): void {
    if ((ev.target as HTMLElement)?.tagName === 'INPUT') return;
    const m = KEYMAP[ev.key.toLowerCase()];
    if (!m) return;
    ev.preventDefault();
    if (down) { pressed.add(m[0]); pressedDir.set(m[0], m[1]); }
    else {
      // 只清除对应该方向的按键
      pressedDir.delete(m[0]);
      if (![...pressedDir.keys()].includes(m[0])) pressed.delete(m[0]);
    }
  }
  const kd = (e: KeyboardEvent) => onKey(e, true);
  const ku = (e: KeyboardEvent) => onKey(e, false);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);

  // —— 放置 ——
  let placing = false;
  $('#btn-place').addEventListener('click', () => { placing = true; });
  function onClick(ev: MouseEvent): void {
    if (!placing) return;
    const rect = canvas.getBoundingClientRect();
    const p = v.pickGround(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    if (p) { exc.group.position.set(p.x, p.y, store.baseElev); placing = false; }
  }
  canvas.addEventListener('click', onClick);
  $('#btn-reset').addEventListener('click', () => v.resetCamera());

  // —— 报警 ——
  const alarmEl = $('#alarm');
  let dangerModal: HTMLElement | null = null;
  let wasInDanger = false;
  function showDangerModal(info: string): void {
    if (dangerModal) return;
    dangerModal = document.createElement('div');
    dangerModal.className = 'modal-mask';
    dangerModal.innerHTML = `<div class="modal">
      <h3>⚠ 危险接近警告</h3>
      <p>${info}</p>
      <p>铲斗齿尖已进入管线不确定包络 <b>0.5m</b> 范围内，必须立即停止机械开挖，改用人工探挖确认管位！</p>
      <div class="btn-row"><button class="danger" id="modal-ok">立即停止作业</button></div>
    </div>`;
    document.body.appendChild(dangerModal);
    dangerModal.querySelector('#modal-ok')!.addEventListener('click', () => {
      dangerModal?.remove();
      dangerModal = null;
    });
  }

  // —— 录制回放 ——
  let recording = false;
  let recFrames: PoseFrame[] = [];
  let recT = 0;
  let playing: PoseRecording | null = null;
  let playT = 0;

  $('#btn-rec').addEventListener('click', () => {
    recording = true; recFrames = []; recT = 0;
    ($('#btn-rec') as HTMLButtonElement).disabled = true;
    ($('#btn-stop') as HTMLButtonElement).disabled = false;
  });
  $('#btn-stop').addEventListener('click', async () => {
    recording = false;
    ($('#btn-rec') as HTMLButtonElement).disabled = false;
    ($('#btn-stop') as HTMLButtonElement).disabled = true;
    if (recFrames.length < 2) return;
    const name = `姿态录制 ${new Date().toLocaleString()}`;
    await store.saveRecording({ id: `rec-${Date.now()}`, name, frames: recFrames });
  });

  function renderRecs(): void {
    const box = $('#recs');
    box.innerHTML = '';
    for (const r of store.recordings) {
      const row = document.createElement('div');
      row.className = 'btn-row';
      row.innerHTML = `<button class="btn-play">▶ ${r.name}</button><button class="danger btn-del">删</button>`;
      row.querySelector('.btn-play')!.addEventListener('click', () => { playing = r; playT = 0; });
      row.querySelector('.btn-del')!.addEventListener('click', () => store.deleteRecording(r.id));
      box.appendChild(row);
    }
  }

  // —— 主循环：关节积分、距离计算、报警、录制/回放 ——
  let recAccum = 0;
  v.onFrame = (dt) => {
    // 回放优先
    if (playing) {
      playT += dt;
      const fs = playing.frames;
      if (playT >= fs[fs.length - 1].t) {
        playing = null;
      } else {
        let i = 0;
        while (i < fs.length - 2 && fs[i + 1].t < playT) i++;
        const f0 = fs[i], f1 = fs[i + 1];
        const k = f1.t > f0.t ? (playT - f0.t) / (f1.t - f0.t) : 0;
        exc.setPose({
          boom: f0.boom + (f1.boom - f0.boom) * k,
          stick: f0.stick + (f1.stick - f0.stick) * k,
          bucket: f0.bucket + (f1.bucket - f0.bucket) * k,
        });
      }
    } else {
      // 键盘积分
      if (pressed.size > 0) {
        const p = { ...exc.pose };
        for (const j of pressed) {
          p[j] += (pressedDir.get(j) ?? 0) * 0.9 * dt;
        }
        exc.setPose(p);
      }
    }
    // 滑块回显
    for (const j of ['boom', 'stick', 'bucket'] as const) {
      sliderInputs[j].value = String(exc.pose[j]);
      sliderOuts[j].textContent = exc.pose[j].toFixed(2);
    }
    // 录制（20Hz 采样）
    if (recording) {
      recT += dt;
      recAccum += dt;
      if (recAccum >= 0.05) {
        recAccum = 0;
        recFrames.push({ t: recT, ...exc.pose });
      }
    }
    // —— 距离与报警（每帧，解析计算）——
    const tip = exc.tipWorld();
    const hit = nearestEnvelope({ x: tip.x, y: tip.y, z: tip.z }, store.entities);
    const al = alarmFor(hit);
    exc.setTipAlarm(al.level);
    if (hit) {
      $('#hud-dist').textContent = `${hit.dist.toFixed(3)} m`;
      $('#hud-dist').style.color = al.level === 'danger' ? '#ff5247' : al.level === 'caution' ? '#ffd94d' : '#7fe0a3';
      $('#hud-info').textContent =
        `${hit.entity.seg.category} ${hit.entity.seg.id}（${hit.entity.seg.owner}）` +
        ` 包络不确定度 ±${hit.entity.uncR.toFixed(2)}m`;
    } else {
      $('#hud-dist').textContent = '无管线数据';
      $('#hud-info').textContent = '';
    }
    alarmEl.className = `alarm-banner ${al.level}`;
    if (al.level === 'caution' && hit) {
      alarmEl.textContent = `注意：距 ${hit.entity.seg.category}管线包络 ${hit.dist.toFixed(2)}m（<1m）`;
    } else if (al.level === 'danger' && hit) {
      alarmEl.textContent = `危险！距 ${hit.entity.seg.category}管线包络 ${hit.dist.toFixed(2)}m（<0.5m）`;
    }
    if (al.level === 'danger' && !wasInDanger && hit) {
      showDangerModal(`铲斗齿尖距 ${hit.entity.seg.category}管线 ${hit.entity.seg.id}（${hit.entity.seg.owner}）不确定包络仅 ${hit.dist.toFixed(3)}m。`);
    }
    wasInDanger = al.level === 'danger';
  };

  const unsub = store.subscribe(() => { v.rebuildContent(); v.setEnvelopesVisible(true); renderRecs(); });
  renderRecs();
  return () => {
    unsub();
    window.removeEventListener('keydown', kd);
    window.removeEventListener('keyup', ku);
    dangerModal?.remove();
    v.dispose();
  };
}
