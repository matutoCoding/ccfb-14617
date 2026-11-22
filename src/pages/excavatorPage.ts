// 页面5: 挖机作业 —— 动臂/斗杆/铲斗滑块+键盘、齿尖实时距离、黄红报警、姿态录制回放、算法自检
import { h, clear, fmt, table, download } from '../ui/dom';
import { toast, setAlarmBanner } from '../ui/toast';
import { store } from '../state/store';
import type { SceneContext } from '../core/sceneContext';
import { ExcavatorRig } from '../core/excavator';
import { queryNearest, runDistanceSelfCheck, type NearestHit } from '../core/distance';
import { ALARM_RED, ALARM_YELLOW, UTILITY_META } from '../domain/constants';
import type { PoseKeyframe, PoseRecording } from '../domain/types';

let activeRig: ExcavatorRig | null = null;
let activeCleanup: (() => void) | null = null;

/** 路由离开挖机页时回收监听器与挖机模型 */
export function disposeExcavatorPage(ctx: SceneContext): void {
  activeCleanup?.();
  activeCleanup = null;
  if (activeRig) {
    ctx.scene.remove(activeRig.group);
    activeRig = null;
  }
}

export function renderExcavatorPage(root: HTMLElement, ctx: SceneContext): void {
  clear(root);
  setAlarmBanner('none');

  const rig = new ExcavatorRig();
  activeRig = rig;
  ctx.scene.add(rig.group);

  const keys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    keys.add(e.key.toLowerCase());
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  activeCleanup = () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    ctx.scene.remove(rig.group);
    setAlarmBanner('none');
  };

  const distanceText = h('div', { className: 'distance-readout' });
  const nearestText = h('div', { className: 'nearest-readout muted' });

  const boomSlider = slider(rig.limits.boom.min, rig.limits.boom.max, rig.pose.boom);
  const armSlider = slider(rig.limits.arm.min, rig.limits.arm.max, rig.pose.arm);
  const bucketSlider = slider(rig.limits.bucket.min, rig.limits.bucket.max, rig.pose.bucket);
  const yawSlider = slider(-180, 180, 0);
  const xSlider = slider(-70, 70, rig.pose.baseX);
  const ySlider = slider(-55, 55, rig.pose.baseY);

  const syncSliders = () => {
    boomSlider.value = String(rig.pose.boom);
    armSlider.value = String(rig.pose.arm);
    bucketSlider.value = String(rig.pose.bucket);
    yawSlider.value = String(rig.pose.yaw);
    xSlider.value = String(rig.pose.baseX);
    ySlider.value = String(rig.pose.baseY);
  };
  boomSlider.addEventListener('input', () => rig.setPose({ boom: Number(boomSlider.value) }));
  armSlider.addEventListener('input', () => rig.setPose({ arm: Number(armSlider.value) }));
  bucketSlider.addEventListener('input', () => rig.setPose({ bucket: Number(bucketSlider.value) }));
  yawSlider.addEventListener('input', () => rig.setPose({ yaw: Number(yawSlider.value) }));
  xSlider.addEventListener('input', () => rig.setPose({ baseX: Number(xSlider.value) }));
  ySlider.addEventListener('input', () => rig.setPose({ baseY: Number(ySlider.value) }));

  // 录制状态
  let recording: PoseKeyframe[] | null = null;
  let recordStart = 0;
  let playback: { frames: PoseKeyframe[]; start: number; duration: number } | null = null;
  const recordBtn = h('button', { className: 'btn', textContent: '● 开始录制' }) as HTMLButtonElement;
  const playBtn = h('button', { className: 'btn', textContent: '▶ 回放最近录制' }) as HTMLButtonElement;
  playBtn.disabled = true;
  const saveBtn = h('button', { className: 'btn btn-primary', textContent: '保存录像到 IndexedDB' }) as HTMLButtonElement;
  saveBtn.disabled = true;
  const recIndicator = h('span', { className: 'rec-indicator' });

  recordBtn.addEventListener('click', () => {
    if (!recording) {
      recording = [];
      recordStart = performance.now();
      recordBtn.textContent = '■ 停止录制';
      recordBtn.classList.add('recording');
      recIndicator.textContent = '录制中…';
      toast('开始记录作业姿态', 'info');
    } else {
      recordBtn.textContent = '● 开始录制';
      recordBtn.classList.remove('recording');
      recIndicator.textContent = `已录 ${recording.length} 帧 / ${((performance.now() - recordStart) / 1000).toFixed(1)}s`;
      playBtn.disabled = recording.length < 2;
      saveBtn.disabled = recording.length < 2;
      toast(`录制结束, 共 ${recording.length} 帧`, 'ok');
    }
  });

  playBtn.addEventListener('click', () => {
    if (!recording || recording.length < 2) return;
    playback = { frames: recording, start: performance.now(), duration: recording[recording.length - 1].t };
    toast('回放作业姿态', 'info');
  });

  saveBtn.addEventListener('click', async () => {
    if (!recording || recording.length < 2) return;
    const rec: PoseRecording = {
      id: `REC-${Date.now()}`,
      name: `作业录像 ${new Date().toLocaleTimeString('zh-CN')}`,
      frames: recording,
      createdAt: Date.now()
    };
    await store.saveRecording(rec);
    toast('录像已保存', 'ok');
    renderRecordingList();
  });

  // 自检面板
  const selfCheckBox = h('div', { className: 'selfcheck-box' });
  const runCheck = () => {
    const result = runDistanceSelfCheck(ctx.runtime, ctx.envelopes);
    selfCheckBox.innerHTML = '';
    selfCheckBox.append(
      h('div', { className: result.pass1cm ? 'check-pass' : 'check-fail', textContent: result.pass1cm ? `✔ 自检通过: 解析距离 vs 网格暴力距离 最大误差 ${(result.maxError * 1000).toFixed(2)} mm (≤10mm)` : `✘ 自检失败: 最大误差 ${(result.maxError * 1000).toFixed(2)} mm` }),
      h('div', { className: 'table-scroll small' }, table(
        ['管段', '行业', '解析距离 m', '网格距离 m', '误差 mm'],
        result.cases.slice(0, 12).map((c) => [c.segmentId, c.utility, fmt(c.analytic, 4), fmt(c.mesh, 4), (c.absError * 1000).toFixed(2)])
      ))
    );
  };

  const recList = h('div', { className: 'rec-list' });
  const renderRecordingList = () => {
    recList.innerHTML = '';
    if (!store.recordings.length) {
      recList.appendChild(h('p', { className: 'muted', textContent: '暂无已保存录像' }));
      return;
    }
    for (const r of store.recordings) {
      recList.appendChild(
        h('div', { className: 'plan-item' },
          h('div', {
            className: 'plan-item-main', onClick: () => {
              playback = { frames: r.frames, start: performance.now(), duration: r.frames[r.frames.length - 1].t };
              toast(`回放 ${r.name}`, 'info');
            }
          },
            h('div', { className: 'plan-name', textContent: r.name }),
            h('div', { className: 'plan-meta', textContent: `${r.frames.length} 帧 · 时长 ${(r.frames[r.frames.length - 1].t / 1000).toFixed(1)}s` })
          ),
          h('button', { className: 'btn btn-mini', onClick: () => store.deleteRecording(r.id), textContent: '删除' })
        )
      );
    }
  };
  renderRecordingList();

  // 每帧: 键盘驱动 -> 回放插值 -> 距离查询 -> 报警
  let lastHit: NearestHit | null = null;
  ctx.onFrame = (dt) => {
    if (!playback) rig.nudge(keys, dt);
    if (playback) {
      const elapsed = performance.now() - playback.start;
      const tt = elapsed % (playback.duration + 1200);
      if (tt <= playback.duration) {
        const frame = sampleFrame(playback.frames, tt);
        rig.setPose(frame);
        syncSliders();
      }
    }
    const tooth = rig.getToothWorld();
    const hit = queryNearest(tooth, ctx.runtime);
    lastHit = hit;
    if (hit) {
      const meta = UTILITY_META[hit.utility];
      const d = hit.distance;
      distanceText.className = 'distance-readout ' + (hit.alarm === 'red' ? 'dist-red' : hit.alarm === 'yellow' ? 'dist-yellow' : 'dist-ok');
      distanceText.textContent = `${d >= 0 ? '' : '侵入 '}${Math.abs(d).toFixed(3)} m`;
      nearestText.innerHTML = '';
      nearestText.append(
        h('span', { style: `color:${meta.hex};font-weight:600`, textContent: `${meta.name} ${hit.segmentId}` }),
        document.createTextNode(`  包络半径 ${fmt(ctx.runtime.find((r) => r.seg.id === hit.segmentId)?.envelopeRadius ?? 0, 2)}m  阈值: 黄≤${ALARM_YELLOW}m 红≤${ALARM_RED}m`)
      );
      if (hit.alarm === 'red') {
        setAlarmBanner('red', `${meta.name}管 ${hit.segmentId} 齿尖距包络仅 ${Math.max(0, d).toFixed(2)}m, 立即停止作业!`);
      } else if (hit.alarm === 'yellow') {
        setAlarmBanner('yellow', `${meta.name}管 ${hit.segmentId} 接近中: ${d.toFixed(2)}m, 改为人工探挖`);
      } else {
        setAlarmBanner('none');
      }
    }
    if (recording) {
      recording.push({
        t: performance.now() - recordStart,
        boom: rig.pose.boom,
        arm: rig.pose.arm,
        bucket: rig.pose.bucket,
        baseX: rig.pose.baseX,
        baseY: rig.pose.baseY,
        yaw: rig.pose.yaw,
        toothX: tooth.x,
        toothY: tooth.y,
        toothZ: tooth.z
      });
    }
  };

  root.append(
    h('div', { className: 'page excavator-page' },
      h('div', { className: 'page-head' }, h('h2', { textContent: '挖机作业防护' }), recIndicator),
      h('div', { className: 'excav-layout' },
        h('div', { className: 'panel control-panel' },
          h('h3', { textContent: '关节控制(滑块 / 键盘)' }),
          sliderRow('动臂 boom (Q/Z)', boomSlider),
          sliderRow('斗杆 arm (W/X)', armSlider),
          sliderRow('铲斗 bucket (E/C)', bucketSlider),
          sliderRow('回转 yaw (A/D)', yawSlider),
          sliderRow('底盘 X', xSlider),
          sliderRow('底盘 Y', ySlider),
          h('div', { className: 'key-hint muted', textContent: '键盘: Q/Z 动臂 · W/X 斗杆 · E/C 铲斗 · A/D 回转' }),
          h('div', { className: 'form-actions' }, recordBtn, playBtn, saveBtn),
          h('h3', { textContent: '齿尖实时距离(到包络外表面)' }),
          distanceText,
          nearestText,
          h('h3', { textContent: '距离算法自检(精度 ≤1cm)' }),
          h('button', { className: 'btn', onClick: runCheck, textContent: '运行解析 vs 网格对照自检' }),
          selfCheckBox
        ),
        h('div', { className: 'panel side-panel' },
          h('h3', { textContent: '已保存录像' }),
          recList,
          h('button', {
            className: 'btn btn-ghost', onClick: () => {
              if (!recording) return toast('没有可导出的本次录像', 'warn');
              download('挖机姿态录像.json', JSON.stringify(recording, null, 2), 'application/json');
            }, textContent: '导出本次录像 JSON'
          })
        )
      )
    )
  );

  void lastHit;
}

function slider(min: number, max: number, value: number): HTMLInputElement {
  return h('input', { type: 'range', min: String(min), max: String(max), value: String(value), step: '0.1' }) as HTMLInputElement;
}

function sliderRow(label: string, input: HTMLInputElement): Node {
  return h('div', { className: 'slider-row' }, h('label', { textContent: label }), input);
}

function sampleFrame(frames: PoseKeyframe[], t: number): PoseKeyframe {
  if (t <= frames[0].t) return frames[0];
  for (let i = 0; i < frames.length - 1; i++) {
    if (t >= frames[i].t && t <= frames[i + 1].t) {
      const a = frames[i];
      const b = frames[i + 1];
      const k = (t - a.t) / (b.t - a.t || 1);
      const lerp = (x: number, y: number) => x + (y - x) * k;
      return {
        t,
        boom: lerp(a.boom, b.boom),
        arm: lerp(a.arm, b.arm),
        bucket: lerp(a.bucket, b.bucket),
        baseX: lerp(a.baseX, b.baseX),
        baseY: lerp(a.baseY, b.baseY),
        yaw: lerp(a.yaw, b.yaw),
        toothX: lerp(a.toothX, b.toothX),
        toothY: lerp(a.toothY, b.toothY),
        toothZ: lerp(a.toothZ, b.toothZ)
      };
    }
  }
  return frames[frames.length - 1];
}
