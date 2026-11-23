// 挖机模型：动臂/斗杆/铲斗三关节，正向运动学，齿尖世界坐标输出

import * as THREE from 'three';
import { LAYER_OPAQUE } from '../oit';

export interface ArmPose { boom: number; stick: number; bucket: number }

export const JOINT_LIMITS = {
  boom: { min: -0.35, max: 1.10, step: 0.01 },
  stick: { min: -2.60, max: -0.30, step: 0.01 },
  bucket: { min: -2.20, max: 0.50, step: 0.01 },
} as const;

const L1 = 5.2, L2 = 3.2, L3 = 1.3; // 动臂/斗杆/铲斗铰接长度 m

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), new THREE.MeshLambertMaterial({ color }));
  m.layers.set(LAYER_OPAQUE);
  return m;
}

export class Excavator {
  readonly group = new THREE.Group();
  private boomGroup = new THREE.Group();
  private stickGroup = new THREE.Group();
  private bucketGroup = new THREE.Group();
  readonly tipMarker: THREE.Mesh;
  pose: ArmPose = { boom: 0.55, stick: -1.45, bucket: -0.9 };

  constructor() {
    const yellow = 0xf2b705, dark = 0x3c3c3c;
    // 履带
    for (const s of [-1, 1]) {
      const track = box(4.6, 0.8, 0.9, dark);
      track.position.set(0, s * 1.05, 0.4);
      this.group.add(track);
    }
    // 回转平台 + 车体
    const slew = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.35, 24), new THREE.MeshLambertMaterial({ color: dark }));
    slew.rotation.x = Math.PI / 2;
    slew.position.set(0, 0, 0.95);
    slew.layers.set(LAYER_OPAQUE);
    this.group.add(slew);
    const body = box(3.0, 1.5, 2.4, yellow);
    body.position.set(-0.4, 0, 1.9);
    this.group.add(body);
    const cab = box(1.2, 1.3, 1.1, 0x2f6f8f);
    cab.position.set(0.2, 0.75, 2.1);
    this.group.add(cab);

    // 动臂
    this.boomGroup.position.set(1.1, 0, 1.9);
    const boom = box(L1, 0.75, 0.55, yellow);
    boom.position.set(L1 / 2, 0, 0);
    this.boomGroup.add(boom);
    // 斗杆
    this.stickGroup.position.set(L1, 0, 0);
    const stick = box(L2, 0.5, 0.4, yellow);
    stick.position.set(L2 / 2, 0, 0);
    this.stickGroup.add(stick);
    // 铲斗
    this.bucketGroup.position.set(L2, 0, 0);
    const bucket = box(0.9, 0.7, 1.1, dark);
    bucket.position.set(0.45, 0, -0.1);
    this.bucketGroup.add(bucket);
    // 齿尖标记（报警变色）
    this.tipMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x33ff66 }),
    );
    this.tipMarker.position.set(L3, 0, 0);
    this.tipMarker.layers.set(LAYER_OPAQUE);
    this.bucketGroup.add(this.tipMarker);

    this.boomGroup.add(this.stickGroup);
    this.stickGroup.add(this.bucketGroup);
    this.group.add(this.boomGroup);
    this.applyPose();
  }

  setPose(p: ArmPose): void {
    this.pose = {
      boom: THREE.MathUtils.clamp(p.boom, JOINT_LIMITS.boom.min, JOINT_LIMITS.boom.max),
      stick: THREE.MathUtils.clamp(p.stick, JOINT_LIMITS.stick.min, JOINT_LIMITS.stick.max),
      bucket: THREE.MathUtils.clamp(p.bucket, JOINT_LIMITS.bucket.min, JOINT_LIMITS.bucket.max),
    };
    this.applyPose();
  }

  private applyPose(): void {
    // 臂架在局部 X-Z 平面内运动：绕 Y 轴负向旋转使臂上抬（+Z）
    this.boomGroup.rotation.y = -this.pose.boom;
    this.stickGroup.rotation.y = -this.pose.stick;
    this.bucketGroup.rotation.y = -this.pose.bucket;
  }

  /** 齿尖世界坐标（铲斗铰点沿当前姿态方向外伸 L3） */
  tipWorld(out = new THREE.Vector3()): THREE.Vector3 {
    this.group.updateWorldMatrix(true, true);
    return out.set(L3, 0, 0).applyMatrix4(this.bucketGroup.matrixWorld);
  }

  setTipAlarm(level: 'safe' | 'caution' | 'danger'): void {
    const mat = this.tipMarker.material as THREE.MeshBasicMaterial;
    mat.color.setHex(level === 'danger' ? 0xff2222 : level === 'caution' ? 0xffcc00 : 0x33ff66);
  }
}
