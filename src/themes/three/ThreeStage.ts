import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface ThreeStageOptions {
  width?: number;
  height?: number;
  fov?: number;
  chamberDepth?: number;
  stageElement?: HTMLElement;
  antialias?: boolean;
  bloomThreshold?: number;
  bloomStrength?: number;
  bloomRadius?: number;
}

export interface ThreeStageResourceStats {
  geometries: number;
  materials: number;
  textures: number;
  renderTargets: number;
  disposed: boolean;
}

/**
 * Reusable 1080×1920 Portrait Three.js Host Stage with:
 * - WebGL 2 renderer (`ACESFilmicToneMapping`, 2048×2048 `PCFSoftShadowMap`)
 * - Post-processing pipeline (`EffectComposer` + `RenderPass` + `UnrealBloomPass` + `OutputPass`)
 *   configured with a high luminance threshold (~0.85) and soft radius
 * - High-contrast studio `PMREMGenerator` environment map (dark matte surroundings with 4 crisp,
 *   high-intensity warm/cool rectangular softbox strips)
 * - Strict `.dispose()` resource cleanup when switching themes
 */
export class ThreeStage {
  public static readonly DEFAULT_WIDTH = 1080;
  public static readonly DEFAULT_HEIGHT = 1920;
  public static readonly DEFAULT_FOV = 30;
  public static readonly PIXELS_PER_UNIT = 100;
  public static readonly SHADOW_MAP_SIZE = 2048;

  public readonly width: number;
  public readonly height: number;
  public readonly fov: number;
  public readonly chamberDepth: number;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly domElement: HTMLCanvasElement;
  public readonly baseCameraZ: number;

  private renderer: THREE.WebGLRenderer | null = null;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private outputPass: OutputPass | null = null;
  private pmremGenerator: THREE.PMREMGenerator | null = null;
  private envRenderTarget: { texture: THREE.Texture; dispose: () => void } | null = null;
  private stageElement: HTMLElement | null = null;
  private isInitialized = false;
  private isDisposed = false;

  private bloomThreshold: number;
  private bloomStrength: number;
  private bloomRadius: number;

  // Explicit resource registries for deterministic `.dispose()` verification
  private trackedGeometries = new Set<THREE.BufferGeometry>();
  private trackedMaterials = new Set<THREE.Material>();
  private trackedTextures = new Set<THREE.Texture>();
  private trackedRenderTargets = new Set<{ dispose: () => void }>();

  constructor(options?: ThreeStageOptions) {
    this.width = options?.width ?? ThreeStage.DEFAULT_WIDTH;
    this.height = options?.height ?? ThreeStage.DEFAULT_HEIGHT;
    this.fov = options?.fov ?? ThreeStage.DEFAULT_FOV;
    this.chamberDepth = options?.chamberDepth ?? 5.2;
    this.stageElement = options?.stageElement ?? null;

    this.bloomThreshold = options?.bloomThreshold ?? 1.45;
    this.bloomStrength = options?.bloomStrength ?? 0.28;
    this.bloomRadius = options?.bloomRadius ?? 0.4;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x090503);

    const aspect = this.width / this.height;
    const halfHeightUnits = (this.height / ThreeStage.PIXELS_PER_UNIT) * 0.5; // 9.6
    const fovRad = THREE.MathUtils.degToRad(this.fov);
    this.baseCameraZ = halfHeightUnits / Math.tan(fovRad * 0.5); // ~35.828 units

    this.camera = new THREE.PerspectiveCamera(this.fov, aspect, 1.0, 120.0);
    this.camera.position.set(0, 0, this.baseCameraZ);
    this.camera.lookAt(0, 0, -1.5);

    this.domElement = this.createHostCanvas();
    if (this.stageElement && typeof this.stageElement.prepend === 'function') {
      this.stageElement.prepend(this.domElement);
    }
  }

  /**
   * Converts 1080×1920 2D canvas coordinates into z = 0 world coordinates.
   */
  public static canvasToWorldXY(px: number, py: number): { x: number; y: number } {
    return {
      x: (px - ThreeStage.DEFAULT_WIDTH * 0.5) / ThreeStage.PIXELS_PER_UNIT,
      y: (ThreeStage.DEFAULT_HEIGHT * 0.5 - py) / ThreeStage.PIXELS_PER_UNIT
    };
  }

  private createHostCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas') as HTMLCanvasElement;
    canvas.width = this.width;
    canvas.height = this.height;
    if (canvas.classList) {
      canvas.classList.add('clock-layer', 'three-stage-canvas');
    }
    if (canvas.style) {
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = `${this.width}px`;
      canvas.style.height = `${this.height}px`;
      canvas.style.zIndex = '24';
      canvas.style.pointerEvents = 'none';
    }
    return canvas;
  }

  /**
   * Initializes the WebGL 2 renderer, 2048×2048 `PCFSoftShadowMap`,
   * high-contrast studio `PMREMGenerator` environment map, and `EffectComposer` + `UnrealBloomPass`.
   */
  public async init(): Promise<void> {
    if (this.isDisposed || this.isInitialized) return;

    const envScene = this.buildHighContrastStudioEnvironmentScene();

    try {
      let canUseWebGL2 = false;
      if (typeof document !== 'undefined') {
        const probe = document.createElement('canvas');
        const gl2 = probe.getContext ? probe.getContext('webgl2') : null;
        canUseWebGL2 = Boolean(
          gl2 && typeof (gl2 as WebGL2RenderingContext).createVertexArray === 'function'
        );
      }

      if (canUseWebGL2) {
        const renderer = new THREE.WebGLRenderer({
          canvas: this.domElement,
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance'
        });

        renderer.setPixelRatio(1);
        renderer.setSize(this.width, this.height, false);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.96;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // High-contrast studio PMREM environment map
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileCubemapShader();
        const envTarget = pmrem.fromScene(envScene, 0.025, 0.1, 60);

        this.renderer = renderer;
        this.pmremGenerator = pmrem;
        this.envRenderTarget = envTarget;
        this.scene.environment = envTarget.texture;
        this.scene.environmentIntensity = 0.92;

        this.trackTexture(envTarget.texture);
        this.trackRenderTarget(envTarget);

        // Post-Processing: EffectComposer + RenderPass + UnrealBloomPass + OutputPass
        const composer = new EffectComposer(renderer);
        composer.setSize(this.width, this.height);

        const renderPass = new RenderPass(this.scene, this.camera);
        const bloomPass = new UnrealBloomPass(
          new THREE.Vector2(this.width, this.height),
          this.bloomStrength,
          this.bloomRadius,
          this.bloomThreshold
        );
        const outputPass = new OutputPass();

        composer.addPass(renderPass);
        composer.addPass(bloomPass);
        composer.addPass(outputPass);

        this.composer = composer;
        this.renderPass = renderPass;
        this.bloomPass = bloomPass;
        this.outputPass = outputPass;
        this.trackRenderTarget(composer);
      } else {
        // Headless / Node test fallback
        const fallbackEnvTex = this.createProceduralFallbackEnvTexture();
        const fallbackTarget = {
          texture: fallbackEnvTex,
          dispose: () => fallbackEnvTex.dispose()
        };
        this.envRenderTarget = fallbackTarget;
        this.scene.environment = fallbackEnvTex;
        this.trackTexture(fallbackEnvTex);
        this.trackRenderTarget(fallbackTarget);
      }
    } catch {
      const fallbackEnvTex = this.createProceduralFallbackEnvTexture();
      const fallbackTarget = {
        texture: fallbackEnvTex,
        dispose: () => fallbackEnvTex.dispose()
      };
      this.envRenderTarget = fallbackTarget;
      this.scene.environment = fallbackEnvTex;
      this.trackTexture(fallbackEnvTex);
      this.trackRenderTarget(fallbackTarget);
    } finally {
      this.disposeSceneGraph(envScene);
    }

    this.isInitialized = true;
  }

  /**
   * Builds a high-contrast horological studio rig:
   * Dark matte surroundings (#050302) with 4 crisp, high-intensity HDR warm/cool
   * rectangular softbox strips so curved brass bezels, beveled gear teeth, and the
   * biconvex pendulum lens catch razor-sharp metallic highlights.
   */
  private buildHighContrastStudioEnvironmentScene(): THREE.Scene {
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x040201);

    // Dark matte studio enclosure
    const roomGeo = new THREE.SphereGeometry(24, 32, 20);
    const roomMat = new THREE.MeshBasicMaterial({
      color: 0x060302,
      side: THREE.BackSide
    });
    envScene.add(new THREE.Mesh(roomGeo, roomMat));

    // Softbox 1: Overhead warm tungsten key strip (~50% intensity for rich dark-gold contrast)
    const topStrip = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 3.2),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(4.6, 3.1, 1.55),
        side: THREE.DoubleSide
      })
    );
    topStrip.position.set(0, 14.5, 6.0);
    topStrip.lookAt(0, 0, 0);
    envScene.add(topStrip);

    // Softbox 2: Left vertical warm-gold specular rim strip
    const leftStrip = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 18.0),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(4.1, 2.6, 1.05),
        side: THREE.DoubleSide
      })
    );
    leftStrip.position.set(-13.5, 1.5, 8.5);
    leftStrip.lookAt(0, 0, 0);
    envScene.add(leftStrip);

    // Softbox 3: Right vertical cool-daylight horological contrast strip
    const rightStrip = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 17.0),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(3.0, 3.4, 4.4),
        side: THREE.DoubleSide
      })
    );
    rightStrip.position.set(13.5, 2.0, 9.0);
    rightStrip.lookAt(0, 0, 0);
    envScene.add(rightStrip);

    // Softbox 4: Lower-front warm amber reflection bar for pendulum lens & lower bevels
    const bottomStrip = new THREE.Mesh(
      new THREE.PlaneGeometry(13.0, 2.0),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.9, 1.7, 0.75),
        side: THREE.DoubleSide
      })
    );
    bottomStrip.position.set(0, -12.0, 11.0);
    bottomStrip.lookAt(0, 0, 0);
    envScene.add(bottomStrip);

    return envScene;
  }

  private createProceduralFallbackEnvTexture(): THREE.DataTexture {
    const width = 32;
    const height = 16;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const v = y / (height - 1);
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const idx = (y * width + x) * 4;
        // High-contrast studio strip simulation in equirectangular layout
        const isStrip =
          (v > 0.12 && v < 0.24 && u > 0.2 && u < 0.8) ||
          (u > 0.12 && u < 0.2 && v > 0.2 && v < 0.8) ||
          (u > 0.8 && u < 0.88 && v > 0.2 && v < 0.8);
        data[idx] = isStrip ? 255 : 14;
        data[idx + 1] = isStrip ? 205 : 8;
        data[idx + 2] = isStrip ? 135 : 5;
        data[idx + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.needsUpdate = true;
    return tex;
  }

  public trackGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.trackedGeometries.add(geometry);
    return geometry;
  }

  public trackMaterial<T extends THREE.Material>(material: T): T {
    this.trackedMaterials.add(material);
    return material;
  }

  public trackTexture<T extends THREE.Texture>(texture: T): T {
    this.trackedTextures.add(texture);
    return texture;
  }

  public trackRenderTarget<T extends { dispose: () => void }>(target: T): T {
    this.trackedRenderTargets.add(target);
    return target;
  }

  /**
   * Recursively indexes all geometries, materials, and textures on an Object3D subtree
   * so they are guaranteed to be cleaned up on `.dispose()`.
   */
  public registerObjectTree<T extends THREE.Object3D>(root: T): T {
    root.traverse((obj) => {
      const meshLike = obj as THREE.Mesh;
      if (meshLike.geometry && meshLike.geometry instanceof THREE.BufferGeometry) {
        this.trackedGeometries.add(meshLike.geometry);
      }
      if (meshLike.material) {
        const materials = Array.isArray(meshLike.material)
          ? meshLike.material
          : [meshLike.material];
        for (const mat of materials) {
          if (mat) {
            this.trackedMaterials.add(mat);
            this.collectMaterialTextures(mat);
          }
        }
      }
    });
    return root;
  }

  private collectMaterialTextures(material: THREE.Material): void {
    const record = material as unknown as Record<string, unknown>;
    for (const value of Object.values(record)) {
      if (value instanceof THREE.Texture) {
        this.trackedTextures.add(value);
      }
    }
  }

  public render(): void {
    if (this.isDisposed || !this.isInitialized) return;
    if (this.composer) {
      this.composer.render();
    } else if (this.renderer) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  public setBloomParameters(params: {
    threshold?: number;
    strength?: number;
    radius?: number;
  }): void {
    if (params.threshold !== undefined) {
      this.bloomThreshold = params.threshold;
      if (this.bloomPass) this.bloomPass.threshold = params.threshold;
    }
    if (params.strength !== undefined) {
      this.bloomStrength = params.strength;
      if (this.bloomPass) this.bloomPass.strength = params.strength;
    }
    if (params.radius !== undefined) {
      this.bloomRadius = params.radius;
      if (this.bloomPass) this.bloomPass.radius = params.radius;
    }
  }

  public getBloomParameters(): { threshold: number; strength: number; radius: number } {
    return {
      threshold: this.bloomPass?.threshold ?? this.bloomThreshold,
      strength: this.bloomPass?.strength ?? this.bloomStrength,
      radius: this.bloomPass?.radius ?? this.bloomRadius
    };
  }

  public setToneMappingExposure(exposure: number): void {
    if (this.renderer) {
      this.renderer.toneMappingExposure = exposure;
    }
  }

  public setEnvironmentIntensity(intensity: number): void {
    this.scene.environmentIntensity = intensity;
  }

  public getResourceStats(): ThreeStageResourceStats {
    return {
      geometries: this.trackedGeometries.size,
      materials: this.trackedMaterials.size,
      textures: this.trackedTextures.size,
      renderTargets: this.trackedRenderTargets.size,
      disposed: this.isDisposed
    };
  }

  private disposeSceneGraph(root: THREE.Object3D): void {
    root.traverse((obj) => {
      const meshLike = obj as THREE.Mesh;
      if (meshLike.geometry && typeof meshLike.geometry.dispose === 'function') {
        meshLike.geometry.dispose();
      }
      if (meshLike.material) {
        const materials = Array.isArray(meshLike.material)
          ? meshLike.material
          : [meshLike.material];
        for (const mat of materials) {
          if (mat) {
            const record = mat as unknown as Record<string, unknown>;
            for (const value of Object.values(record)) {
              if (value instanceof THREE.Texture) {
                value.dispose();
              }
            }
            mat.dispose();
          }
        }
      }
    });
  }

  /**
   * Strict cleanup of all scene objects, geometries, materials, textures,
   * post-processing passes, PMREM environment targets, and WebGL renderer resources.
   */
  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.isInitialized = false;

    // 1. Index anything added directly to the scene before disposal
    this.registerObjectTree(this.scene);

    // 2. Dispose all tracked geometries
    for (const geo of this.trackedGeometries) {
      try {
        geo.dispose();
      } catch {
        // Ignore individual disposal errors
      }
    }
    this.trackedGeometries.clear();

    // 3. Dispose all tracked materials and any attached textures
    for (const mat of this.trackedMaterials) {
      try {
        this.collectMaterialTextures(mat);
        mat.dispose();
      } catch {
        // Ignore individual disposal errors
      }
    }
    this.trackedMaterials.clear();

    // 4. Dispose all tracked textures
    for (const tex of this.trackedTextures) {
      try {
        tex.dispose();
      } catch {
        // Ignore individual disposal errors
      }
    }
    this.trackedTextures.clear();

    // 5. Dispose post-processing passes & composer
    if (this.bloomPass) {
      try {
        this.bloomPass.dispose();
      } catch {
        // Ignore disposal errors
      }
      this.bloomPass = null;
    }
    if (this.outputPass) {
      try {
        this.outputPass.dispose();
      } catch {
        // Ignore disposal errors
      }
      this.outputPass = null;
    }
    if (this.renderPass) {
      try {
        this.renderPass.dispose();
      } catch {
        // Ignore disposal errors
      }
      this.renderPass = null;
    }

    if (this.composer) {
      try {
        this.composer.dispose();
      } catch {
        // Ignore disposal errors
      }
      this.composer = null;
    }

    // 6. Dispose all render targets & PMREMGenerator
    for (const rt of this.trackedRenderTargets) {
      try {
        rt.dispose();
      } catch {
        // Ignore individual disposal errors
      }
    }
    this.trackedRenderTargets.clear();

    if (this.envRenderTarget) {
      try {
        this.envRenderTarget.dispose();
      } catch {
        // Ignore disposal errors
      }
      this.envRenderTarget = null;
    }

    if (this.pmremGenerator) {
      try {
        this.pmremGenerator.dispose();
      } catch {
        // Ignore PMREM disposal errors
      }
      this.pmremGenerator = null;
    }

    // 7. Clear scene children and environment references
    this.scene.environment = null;
    this.scene.clear();

    // 8. Dispose renderer and detach host canvas
    if (this.renderer) {
      try {
        this.renderer.dispose();
      } catch {
        // Ignore renderer disposal errors
      }
      this.renderer = null;
    }

    if (this.domElement && this.domElement.parentNode) {
      this.domElement.parentNode.removeChild(this.domElement);
    } else if (this.stageElement && typeof this.stageElement.removeChild === 'function') {
      try {
        this.stageElement.removeChild(this.domElement);
      } catch {
        // Ignore if not attached
      }
    }
  }
}
