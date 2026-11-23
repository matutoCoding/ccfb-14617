// 加权混合顺序无关透明（Weighted Blended OIT）渲染器。
// WebGL2 不支持逐附件混合，故用两遍法：
//   1) 不透明物体 → sceneRT（带深度纹理）
//   2) 透明物体 → accumRT（ONE, ONE 累加，共享不透明深度）
//   3) 透明物体 → revealRT（ZERO, ONE_MINUS_SRC_COLOR 连乘透过率）
//   4) 全屏合成。透明物体渲染顺序任意，结果一致 —— 不会闪烁、不会前后错乱。

import * as THREE from 'three';
import { OitMaterialPair } from './materials';

export const LAYER_OPAQUE = 0;
export const LAYER_TRANSPARENT = 1;

const COMPOSITE_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tOpaque;
uniform sampler2D tAccum;
uniform sampler2D tReveal;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec4 opaque = texture(tOpaque, vUv);
  vec4 accum = texture(tAccum, vUv);
  float transmittance = texture(tReveal, vUv).r;
  vec3 avgColor = accum.rgb / max(accum.a, 1e-4);
  vec3 rgb = avgColor * (1.0 - transmittance) + opaque.rgb * transmittance;
  fragColor = vec4(rgb, 1.0);
}
`;

export class OitView {
  readonly renderer: THREE.WebGLRenderer;
  private sceneRT: THREE.WebGLRenderTarget;
  private accumRT: THREE.WebGLRenderTarget;
  private revealRT: THREE.WebGLRenderTarget;
  private depthTex: THREE.DepthTexture;
  private compScene = new THREE.Scene();
  private compCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private compMat: THREE.ShaderMaterial;
  private transparentMeshes: { mesh: THREE.Mesh; pair: OitMaterialPair }[] = [];
  private bgColor = new THREE.Color(0x10151c);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.depthTex = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType);
    const mk = (depth: boolean) => new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: depth,
      stencilBuffer: false,
    });
    this.sceneRT = mk(true);
    this.sceneRT.depthTexture = this.depthTex;
    this.accumRT = mk(true);
    this.accumRT.depthTexture = this.depthTex;
    this.revealRT = mk(true);
    this.revealRT.depthTexture = this.depthTex;

    this.compMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: COMPOSITE_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tOpaque: { value: this.sceneRT.texture },
        tAccum: { value: this.accumRT.texture },
        tReveal: { value: this.revealRT.texture },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compMat);
    quad.frustumCulled = false;
    this.compScene.add(quad);
  }

  setSize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sceneRT.setSize(s.x, s.y);
    this.accumRT.setSize(s.x, s.y);
    this.revealRT.setSize(s.x, s.y);
  }

  /** 登记透明网格（材质对 accum/reveal 在渲染时自动切换） */
  registerTransparent(mesh: THREE.Mesh, pair: OitMaterialPair): void {
    mesh.material = pair.accum;
    mesh.layers.set(LAYER_TRANSPARENT);
    this.transparentMeshes.push({ mesh, pair });
  }

  unregisterAll(): void { this.transparentMeshes = []; }

  setBackground(c: number): void { this.bgColor.setHex(c); }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;

    // 1) 不透明
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(this.bgColor, 1);
    r.clear(true, true, false);
    camera.layers.set(LAYER_OPAQUE);
    r.render(scene, camera);

    // 2) 透明累积
    for (const t of this.transparentMeshes) t.mesh.material = t.pair.accum;
    r.setRenderTarget(this.accumRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false); // 保留不透明深度
    camera.layers.set(LAYER_TRANSPARENT);
    r.render(scene, camera);

    // 3) 透过率连乘
    for (const t of this.transparentMeshes) t.mesh.material = t.pair.reveal;
    r.setRenderTarget(this.revealRT);
    r.setClearColor(0xffffff, 1);
    r.clear(true, false, false);
    r.render(scene, camera);
    for (const t of this.transparentMeshes) t.mesh.material = t.pair.accum;

    // 4) 合成
    r.setRenderTarget(null);
    r.clear(true, true, false);
    camera.layers.set(LAYER_OPAQUE);
    r.render(this.compScene, this.compCam);
  }

  dispose(): void {
    this.sceneRT.dispose();
    this.accumRT.dispose();
    this.revealRT.dispose();
    this.depthTex.dispose();
    this.renderer.dispose();
  }
}
