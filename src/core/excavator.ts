// 挖机正运动学: 底盘-回转台-动臂(boom)-斗杆(arm)-铲斗(bucket)-齿尖
// 关节角均为相对转角(度), 滑块与键盘共用同一组状态
import * as THREE from 'three';

export interface ExcavatorPose {
  boom: number; // 动臂相对水平上抬角
  arm: number; // 斗杆相对动臂的内收角
  bucket: number; // 铲斗相对斗杆的卷曲角
  baseX: number;
  baseY: number;
  yaw: number; // 上车回转角
}

// 尺寸(米)—— 中型挖掘机, 齿尖最大挖掘深度约 3m
const L_BOOM = 5.6;
const L_ARM = 4.8;
const L_BUCKET = 1.8;
const BOOM_PIVOT_Y = 1.8;

export class ExcavatorRig {
  readonly group = new THREE.Group();
  private boomPivot: THREE.Group;
  private armPivot: THREE.Group;
  private bucketPivot: THREE.Group;
  private toothMarker: THREE.Mesh;
  pose: ExcavatorPose = { boom: 35, arm: -95, bucket: 45, baseX: 26, baseY: 14, yaw: 0 };

  // 关节限位(度): boom 动臂俯仰(负=下俯), arm 斗杆相对动臂内收, bucket 铲斗相对斗杆卷曲
  readonly limits = {
    boom: { min: -70, max: 70 },
    arm: { min: -175, max: -10 },
    bucket: { min: -40, max: 120 }
  };

  constructor() {
    const steel = new THREE.MeshStandardMaterial({ color: 0xf57f17, roughness: 0.5, metalness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.7, metalness: 0.4 });

    // 履带底盘
    const track = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 5.2), dark);
    track.position.y = 0.55;
    this.group.add(track);
    for (const sx of [-1.7, 1.7]) {
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 5.4), dark);
      belt.position.set(sx, 0.5, 0);
      this.group.add(belt);
    }
    // 回转台
    const slew = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.8, 16), steel);
    slew.position.y = 1.3;
    this.group.add(slew);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 1.4), new THREE.MeshStandardMaterial({ color: 0x90caf9, roughness: 0.2, metalness: 0.1 }));
    cab.position.set(0.9, 2.2, -0.6);
    this.group.add(cab);

    // 动臂(绕根部)
    this.boomPivot = new THREE.Group();
    this.boomPivot.position.set(0, BOOM_PIVOT_Y, 0);
    const boomMesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, L_BOOM, 0.55), steel);
    boomMesh.position.y = L_BOOM / 2;
    this.boomPivot.add(boomMesh);
    this.group.add(this.boomPivot);

    // 斗杆(绕动臂顶端)
    this.armPivot = new THREE.Group();
    this.armPivot.position.y = L_BOOM;
    const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.45, L_ARM, 0.45), steel);
    armMesh.position.y = L_ARM / 2;
    this.armPivot.add(armMesh);
    this.boomPivot.add(this.armPivot);

    // 铲斗(绕斗杆顶端)
    this.bucketPivot = new THREE.Group();
    this.bucketPivot.position.y = L_ARM;
    const bucketMesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, L_BUCKET, 0.9), dark);
    bucketMesh.position.y = L_BUCKET / 2;
    this.bucketPivot.add(bucketMesh);
    // 齿尖
    this.toothMarker = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.5, 6),
      new THREE.MeshStandardMaterial({ color: 0xd50000, emissive: 0x660000 })
    );
    this.toothMarker.position.y = L_BUCKET + 0.2;
    this.bucketPivot.add(this.toothMarker);
    this.armPivot.add(this.bucketPivot);

    this.applyPose();
  }

  setPose(partial: Partial<ExcavatorPose>): void {
    this.pose = { ...this.pose, ...partial };
    this.pose.boom = THREE.MathUtils.clamp(this.pose.boom, this.limits.boom.min, this.limits.boom.max);
    this.pose.arm = THREE.MathUtils.clamp(this.pose.arm, this.limits.arm.min, this.limits.arm.max);
    this.pose.bucket = THREE.MathUtils.clamp(this.pose.bucket, this.limits.bucket.min, this.limits.bucket.max);
    this.applyPose();
  }

  private applyPose(): void {
    this.group.position.set(this.pose.baseX, 0, this.pose.baseY);
    this.group.rotation.y = this.pose.yaw;
    this.boomPivot.rotation.z = -THREE.MathUtils.degToRad(this.pose.boom);
    this.armPivot.rotation.z = -THREE.MathUtils.degToRad(this.pose.arm);
    this.bucketPivot.rotation.z = -THREE.MathUtils.degToRad(this.pose.bucket);
    this.group.updateMatrixWorld(true);
  }

  /** 齿尖世界坐标(报警计算的唯一输入) */
  getToothWorld(): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.toothMarker.getWorldPosition(new THREE.Vector3());
  }

  /** 各关节世界坐标(用于姿态回放/标注) */
  getJointWorld(): { boomTip: THREE.Vector3; armTip: THREE.Vector3; tooth: THREE.Vector3 } {
    this.group.updateMatrixWorld(true);
    return {
      boomTip: this.armPivot.getWorldPosition(new THREE.Vector3()),
      armTip: this.bucketPivot.getWorldPosition(new THREE.Vector3()),
      tooth: this.getToothWorld()
    };
  }

  /** 键盘调整: 每帧按按下的键增量驱动 */
  nudge(keys: Set<string>, dt: number): void {
    const speed = 28 * dt;
    const p: Partial<ExcavatorPose> = {};
    if (keys.has('q')) p.boom = this.pose.boom + speed;
    if (keys.has('z')) p.boom = this.pose.boom - speed;
    if (keys.has('w')) p.arm = this.pose.arm + speed;
    if (keys.has('x')) p.arm = this.pose.arm - speed;
    if (keys.has('e')) p.bucket = this.pose.bucket + speed;
    if (keys.has('c')) p.bucket = this.pose.bucket - speed;
    if (keys.has('a')) p.yaw = this.pose.yaw + speed * 0.8;
    if (keys.has('d')) p.yaw = this.pose.yaw - speed * 0.8;
    if (Object.keys(p).length) this.setPose(p);
  }
}
