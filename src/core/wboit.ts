// 两遍加权混合顺序无关透明(Weighted Blended OIT, McGuire & Bavoil 2013)
// pass 1: 累加权重颜色 + revealage; pass 2: 合成
// 多个半透明地层/路面/包络任意叠放均与绘制顺序无关, 转视角不闪、不错乱
import * as THREE from 'three';

const COMPOSITE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tAccum;
uniform sampler2D tReveal;
uniform vec3 uBg;
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec4 accum = texture2D(tAccum, vUv);
  float reveal = texture2D(tReveal, vUv).r;
  vec3 color = accum.rgb / max(accum.a, 1e-4);
  color = color * reveal + uBg * (1.0 - reveal);
  gl_FragColor = vec4(linearToSrgb(color), 1.0);
}
`;

/** 无裁剪平面时使用空数组(three 类型不接受 null) */
const NO_CLIP: THREE.Plane[] = [];

/** WBOIT 共享 uniform, 所有透明材质通过 onBeforeCompile 注入同一模式开关 */
export interface WboitMaterial {
  material: THREE.Material;
  transparent: boolean;
}

export class Wboit {
  readonly renderer: THREE.WebGLRenderer;
  private accumTarget: THREE.WebGLRenderTarget;
  private revealTarget: THREE.WebGLRenderTarget;
  private compositeScene = new THREE.Scene();
  private compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private compositeMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private mode = { value: 0 };
  private registered = new Set<THREE.Material>();
  private clippingPlanes: THREE.Plane[] = [];
  private size = new THREE.Vector2();

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    renderer.getDrawingBufferSize(this.size);

    const depthTexture = new THREE.DepthTexture(this.size.x, this.size.y);
    depthTexture.type = THREE.UnsignedIntType;
    const opts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthTexture,
      depthBuffer: true
    };
    this.accumTarget = new THREE.WebGLRenderTarget(this.size.x, this.size.y, opts);
    this.accumTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.revealTarget = new THREE.WebGLRenderTarget(this.size.x, this.size.y, {
      ...opts,
      type: THREE.UnsignedByteType
    });
    this.revealTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;

    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: COMPOSITE_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tAccum: { value: this.accumTarget.texture },
        tReveal: { value: this.revealTarget.texture },
        uBg: { value: new THREE.Color(0x0e1420) }
      },
      depthTest: false,
      depthWrite: false
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMat);
    this.quad.frustumCulled = false;
    this.compositeScene.add(this.quad);
  }

  setClippingPlanes(planes: THREE.Plane[]): void {
    this.clippingPlanes = planes;
    for (const m of this.registered) {
      m.clippingPlanes = planes.length ? planes : NO_CLIP;
    }
  }

  setBackground(color: THREE.ColorRepresentation): void {
    (this.compositeMat.uniforms.uBg.value as THREE.Color).set(color);
  }

  /**
   * 给标准材质(road/strata/pit wall)注入 WBOIT 分支。
   * mode 0=正常不透明输出; 1=accum 通道; 2=reveal 通道
   */
  registerStandard(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    if (this.registered.has(material)) return material;
    this.registered.add(material);
    material.transparent = true;
    material.depthWrite = false;
    material.clippingPlanes = this.clippingPlanes.length ? this.clippingPlanes : NO_CLIP;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWboitMode = this.mode;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vViewZ;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvViewZ = -mvPosition.z;'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform int uWboitMode;\nvarying float vViewZ;'
        )
        .replace(
          '#include <opaque_fragment>',
          /* glsl */ `
          #include <opaque_fragment>
          if (uWboitMode == 1 || uWboitMode == 2) {
            float a = clamp(diffuseColor.a, 1e-4, 0.999);
            if (uWboitMode == 2) {
              gl_FragColor = vec4(0.0, 0.0, 0.0, a);
              return;
            }
            float viewZ = max(vViewZ, 1e-3);
            float w = clamp(pow(min(1.0, a * 10.0) + 0.01, 3.0) * 1e8 /
              (pow(viewZ, 3.0) + 1e5), 1e-2, 3e3);
            // accum 纹理为线性空间, 直接写入线性 outgoingLight
            gl_FragColor = vec4(outgoingLight * a * w, a * w);
            return;
          }
          `
        );
    };
    material.customProgramCacheKey = () => 'wboit-standard';
    return material;
  }

  /** 自定义 ShaderMaterial(不确定包络 SDF)的 WBOIT 注入头 */
  buildCustomShader(vert: string, frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { ...uniforms, uWboitMode: this.mode },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      clippingPlanes: this.clippingPlanes.length ? this.clippingPlanes : NO_CLIP
    });
    this.registered.add(mat);
    return mat;
  }

  /** 主渲染: 不透明物体走默认帧缓冲, 透明物体走两遍 WBOIT 后合成 */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const renderer = this.renderer;
    const prevBackground = scene.background;
    scene.background = null;

    // 1) 不透明物体 -> accum 目标(其深度纹理供透明阶段测试)
    this.mode.value = 0;
    this.applyBlend(0);
    renderer.setRenderTarget(this.accumTarget);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);

    // 2) 透明 accum 通道
    this.mode.value = 1;
    this.applyBlend(1);
    renderer.setRenderTarget(this.accumTarget);
    renderer.clearDepth();
    renderer.render(scene, camera);

    // 3) reveal 通道(共享同一深度纹理)
    this.mode.value = 2;
    this.applyBlend(2);
    renderer.setRenderTarget(this.revealTarget);
    renderer.clear(true, true, true);
    renderer.clearColor();
    renderer.render(scene, camera);

    // 4) 合成到屏幕
    this.mode.value = 0;
    this.applyBlend(0);
    renderer.setRenderTarget(null);
    renderer.render(this.compositeScene, this.compositeCamera);

    scene.background = prevBackground;
  }

  private applyBlend(mode: number): void {
    for (const m of this.registered) {
      if (mode === 1) {
        m.blending = THREE.CustomBlending;
        m.blendEquation = THREE.AddEquation;
        m.blendSrc = THREE.OneFactor;
        m.blendDst = THREE.OneFactor;
        m.blendSrcAlpha = THREE.OneFactor;
        m.blendDstAlpha = THREE.OneFactor;
      } else if (mode === 2) {
        m.blending = THREE.CustomBlending;
        m.blendEquation = THREE.AddEquation;
        m.blendSrc = THREE.ZeroFactor;
        m.blendDst = THREE.OneMinusSrcAlphaFactor;
        m.blendSrcAlpha = THREE.ZeroFactor;
        m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      } else {
        m.blending = THREE.NormalBlending;
      }
      m.needsUpdate = true;
    }
  }

  setSize(width: number, height: number): void {
    this.size.set(width, height);
    this.accumTarget.setSize(width, height);
    this.revealTarget.setSize(width, height);
  }

  dispose(): void {
    this.accumTarget.dispose();
    this.revealTarget.dispose();
    this.compositeMat.dispose();
    this.quad.geometry.dispose();
  }
}
