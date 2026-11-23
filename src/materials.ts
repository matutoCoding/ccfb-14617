// OIT 材质工厂：所有半透明物体（地层、路面、不确定包络）共用一套加权混合 OIT 着色器。
// 包络在片元里按胶囊体有向距离场做边缘渐隐；地层支持基坑开挖体裁剪。

import * as THREE from 'three';

export const MAX_PIT_EDGES = 48;

export interface OitMaterialOptions {
  color: number;
  alpha: number;
  pitClip?: boolean;                       // 是否启用基坑裁剪（地层用）
  envelope?: boolean;                      // 是否为包络（启用胶囊 SDF 渐隐）
  feather?: number;                        // 渐隐宽度 m
  flatShade?: boolean;
}

export interface PitUniforms {
  uPitEdges: { value: THREE.Vector4[] };
  uPitEdgeCount: { value: number };
  uPitBottomZ: { value: number };
  uPitSlope: { value: number };
}

/** 全局共享的基坑裁剪 uniforms（所有地层材质引用同一对象，改一处全场景生效） */
export const pitUniforms: PitUniforms = {
  uPitEdges: { value: Array.from({ length: MAX_PIT_EDGES }, () => new THREE.Vector4()) },
  uPitEdgeCount: { value: 0 },
  uPitBottomZ: { value: 0 },
  uPitSlope: { value: 0.75 },
};

export function setPitClip(poly: [number, number][] | null, bottomZ: number, slope: number): void {
  if (!poly || poly.length < 3 || poly.length > MAX_PIT_EDGES) {
    pitUniforms.uPitEdgeCount.value = 0;
    return;
  }
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    pitUniforms.uPitEdges.value[i].set(x0, y0, x1, y1);
  }
  pitUniforms.uPitEdgeCount.value = poly.length;
  pitUniforms.uPitBottomZ.value = bottomZ;
  pitUniforms.uPitSlope.value = slope;
}

const PIT_CLIP_GLSL = /* glsl */ `
uniform vec4 uPitEdges[${MAX_PIT_EDGES}];
uniform int uPitEdgeCount;
uniform float uPitBottomZ;
uniform float uPitSlope;

bool inExcavation(vec3 w) {
  if (uPitEdgeCount < 3) return false;
  if (w.z < uPitBottomZ) return false;
  float expand = (w.z - uPitBottomZ) * uPitSlope;
  bool inside = false;
  float minD = 1e9;
  for (int i = 0; i < ${MAX_PIT_EDGES}; i++) {
    if (i >= uPitEdgeCount) break;
    vec2 a = uPitEdges[i].xy;
    vec2 b = uPitEdges[i].zw;
    // 射线法
    if ((a.y > w.y) != (b.y > w.y) && w.x < (b.x - a.x) * (w.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    // 到边距离
    vec2 ab = b - a;
    float t = clamp(dot(w.xy - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
    minD = min(minD, length(w.xy - (a + ab * t)));
  }
  return inside || minD <= expand;
}
`;

const VERT = /* glsl */ `
out vec3 vWorld;
out vec3 vNormal;
out float vViewZ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 mv = viewMatrix * wp;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG_HEAD = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uAlpha;
uniform vec3 uCapsA;   // 胶囊核心端点 A（世界系）
uniform vec3 uCapsB;
uniform float uCapsR;  // 包络半径
uniform float uFeather;
uniform vec3 uCamPos;
in vec3 vWorld;
in vec3 vNormal;
in float vViewZ;
out vec4 fragColor;
${PIT_CLIP_GLSL}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float oitWeight(float a, float z) {
  return a * clamp(0.03 / (1e-5 + pow(abs(z) / 200.0, 4.0)), 1e-2, 3e3);
}
`;

function makeFrag(reveal: boolean): string {
  return FRAG_HEAD + /* glsl */ `
void main() {
  #ifdef PIT_CLIP
  if (inExcavation(vWorld)) discard;
  #endif
  float alpha = uAlpha;
  #ifdef ENVELOPE
  // 胶囊体距离场边缘渐隐：在包络外表面附近 feather 宽度内 alpha 渐隐到 0
  float d = sdCapsule(vWorld, uCapsA, uCapsB, uCapsR);
  if (d > 0.0) discard;
  alpha *= smoothstep(0.0, -uFeather, d);
  #endif
  #ifdef REVEAL
  fragColor = vec4(alpha, alpha, alpha, alpha);
  #else
  vec3 N = normalize(vNormal);
  vec3 L = normalize(vec3(0.45, 0.55, 0.75));
  float dif = 0.5 + 0.5 * abs(dot(N, L));
  vec3 c = uColor * dif;
  float w = oitWeight(alpha, vViewZ);
  fragColor = vec4(c * alpha * w, alpha * w);
  #endif
}
`;
}

export interface OitMaterialPair {
  accum: THREE.ShaderMaterial;
  reveal: THREE.ShaderMaterial;
}

export function makeOitMaterials(opts: OitMaterialOptions): OitMaterialPair {
  const defines: Record<string, string> = {};
  if (opts.pitClip) defines.PIT_CLIP = '';
  if (opts.envelope) defines.ENVELOPE = '';
  const uniforms: Record<string, THREE.IUniform> = {
    uColor: { value: new THREE.Color(opts.color) },
    uAlpha: { value: opts.alpha },
    uCapsA: { value: new THREE.Vector3() },
    uCapsB: { value: new THREE.Vector3() },
    uCapsR: { value: 1 },
    uFeather: { value: opts.feather ?? 0.06 },
    uCamPos: { value: new THREE.Vector3() },
    ...(opts.pitClip ? {
      uPitEdges: pitUniforms.uPitEdges,
      uPitEdgeCount: pitUniforms.uPitEdgeCount,
      uPitBottomZ: pitUniforms.uPitBottomZ,
      uPitSlope: pitUniforms.uPitSlope,
    } : {}),
  };
  const base: Partial<THREE.ShaderMaterialParameters> = {
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    uniforms,
    defines,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  };
  const accum = new THREE.ShaderMaterial({
    ...base,
    fragmentShader: makeFrag(false),
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  const reveal = new THREE.ShaderMaterial({
    ...base,
    fragmentShader: makeFrag(true),
    defines: { ...defines, REVEAL: '' },
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.OneMinusSrcColorFactor,
  });
  return { accum, reveal };
}
