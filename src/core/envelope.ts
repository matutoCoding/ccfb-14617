// 不确定包络: 每根管一个胶囊体, 片段着色器内用胶囊体距离场做边缘渐隐
// 实测窄 / 电磁雷达宽 / 推测更宽(半径由 constants.envelopeRadius 决定)
import * as THREE from 'three';
import type { Wboit } from './wboit';

const VERT = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vLocalPos;
varying float vViewZ;
void main() {
  vLocalPos = position;
  #include <begin_vertex>
  #include <project_vertex>
  vViewZ = -mvPosition.z;
  #include <clipping_planes_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
uniform int uWboitMode;
uniform vec3 uColor;
uniform vec3 uA;
uniform vec3 uB;
uniform float uRadius;
uniform float uOpacity;
varying vec3 vLocalPos;
varying float vViewZ;

// 胶囊体: 线段 a-b + 半球半径 r, 返回片段到胶囊轴的径向余量(>0 在内)
float capsuleRemain(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  float d = length(pa - ba * h);
  return r - d;
}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  #include <clipping_planes_fragment>
  float remain = capsuleRemain(vLocalPos, uA, uB, uRadius);
  if (remain < 0.0) discard;
  // 边缘 35% 半径范围内渐隐, 形成柔和包络边界
  float edge = smoothstep(0.0, uRadius * 0.35, remain);
  float alpha = uOpacity * (0.18 + 0.55 * edge);

  if (uWboitMode == 2) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
    return;
  }
  if (uWboitMode == 1) {
    float viewZ = max(vViewZ, 1e-3);
    float a = clamp(alpha, 1e-4, 0.999);
    float w = clamp(pow(min(1.0, a * 10.0) + 0.01, 3.0) * 1e8 /
      (pow(viewZ, 3.0) + 1e5), 1e-2, 3e3);
    // accum 为线性空间纹理, uColor 已是线性, 直接累加
    gl_FragColor = vec4(uColor * a * w, a * w);
    return;
  }
  gl_FragColor = vec4(linearToSrgb(uColor), alpha);
}
`;

export interface EnvelopeMesh {
  mesh: THREE.Mesh;
  /** 局部胶囊端点(圆柱轴段, 不含半球; 半球由半径覆盖) */
  a: THREE.Vector3;
  b: THREE.Vector3;
  radius: number;
  segmentId: string;
}

/** 生成沿 a-b 轴、半径 radius 的胶囊几何体(圆柱 + 两端朝外半球)。
 * 端盖只保留朝外半球(phiLength=PI), 不生成穿入圆柱内部的内半球面片,
 * 保证网格外表面与解析胶囊 SDF 完全一致, 暴力距离对照误差 < 1cm。
 */
export function capsuleGeometry(a: THREE.Vector3, b: THREE.Vector3, radius: number): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const radialSegments = 48;
  // 圆柱覆盖整个轴段 [0, len]
  const cyl = new THREE.CylinderGeometry(radius, radius, len, radialSegments, 1, true);
  cyl.translate(0, len / 2, 0);
  // 朝外半球: SphereGeometry 的 phi 从 +Y 极(phiStart=0)起, 取上半球 [0, PI/2]。
  // 起点端(a)需要朝下(-Y)的半球 => 旋转 PI; 终点端(b)用朝上半球。
  const hemiSegs = 32;
  const topHemi = new THREE.SphereGeometry(radius, radialSegments, hemiSegs, 0, Math.PI * 2, 0, Math.PI / 2);
  topHemi.translate(0, len, 0); // 球心在 b(局部上端)
  const bottomHemi = new THREE.SphereGeometry(radius, radialSegments, hemiSegs, 0, Math.PI * 2, 0, Math.PI / 2);
  bottomHemi.rotateZ(Math.PI); // 翻转为朝下半球, 球心仍在原点(a)
  const merged = mergeBufferGeometries([cyl, topHemi, bottomHemi]);
  merged.computeVertexNormals();
  return orientGeometry(merged, a, dir);
}

function orientGeometry(geo: THREE.BufferGeometry, a: THREE.Vector3, dir: THREE.Vector3): THREE.BufferGeometry {
  const len = dir.length();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  geo.applyQuaternion(quat);
  geo.translate(a.x, a.y, a.z);
  void len;
  return geo;
}

/** 简易 BufferGeometry 合并(先统一转为非索引几何体, 保证 position 为连续三角形) */
function mergeBufferGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position.array as Float32Array;
    const n = g.attributes.normal?.array as Float32Array | undefined;
    for (let i = 0; i < p.length; i++) positions.push(p[i]);
    if (n) for (let i = 0; i < n.length; i++) normals.push(n[i]);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return out;
}

export function createEnvelopeMaterial(
  wboit: Wboit,
  color: number,
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  opacity = 0.5
): THREE.ShaderMaterial {
  return wboit.buildCustomShader(
    VERT,
    FRAG,
    {
      uColor: { value: new THREE.Color(color) },
      uA: { value: a.clone() },
      uB: { value: b.clone() },
      uRadius: { value: radius },
      uOpacity: { value: opacity }
    }
  );
}
