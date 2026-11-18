import * as THREE from 'three';
import { ThemeManifest, ClockMode } from '../../types/theme';
import {
  Theme,
  ThemeConfig,
  TimeData,
  PhysicsData,
  TelemetryData,
  ThemeEvent
} from '../types';
import { ThreeStage, ThreeStageResourceStats } from '../three/ThreeStage';
import {
  createWalnutWoodMaps,
  createInvoluteGearGeometry,
  createCathedralHandGeometry,
  createSecondHandGeometry,
  createHairspringGeometry,
  createLensBobGeometry,
  createVolumetricBeamMaterial,
  createBokehDustMaterial
} from './geometries';

export const TOURBILLON_3D_MANIFEST: ThemeManifest = {
  name: 'Horological Tourbillon 3D',
  version: '2.0.0',
  author: 'Chrono Artisan',
  background: '',
  dial: {
    image: '',
    center: { x: 540, y: 530 }
  },
  hands: {
    hour: {
      image: '',
      pivot: { x: 540, y: 530 }
    },
    minute: {
      image: '',
      pivot: { x: 540, y: 530 }
    },
    second: {
      image: '',
      pivot: { x: 540, y: 530 },
      mode: 'sweep'
    },
    cap: {
      image: '',
      center: { x: 540, y: 530 }
    }
  },
  pendulum: {
    image: '',
    pivot: { x: 540, y: 860 },
    anchor: { x: 540, y: 860 },
    periodSeconds: 2.0,
    maxAngleDeg: 6.0
  },
  notificationZone: {
    x: 140,
    y: 1250,
    width: 800,
    height: 450
  }
};

export interface TourbillonDebugState {
  mode: ClockMode;
  brakeFactor: number;
  pendulumAngleRad: number;
  tourbillonOuterRad: number;
  tourbillonMidRad: number;
  tourbillonInnerRad: number;
  tourbillonTiltDeg: [number, number];
  balanceWheelAngleRad: number;
  gearPlaneZ: [number, number, number, number];
  gearAnglesRad: [number, number, number, number];
  counterweightProgress: number;
  leftWeightY: number;
  rightWeightY: number;
  spotlightIntensity: number;
  indexEmissiveIntensity: number;
  rubyEmissiveIntensity: number;
  cameraPosition: [number, number, number];
  bloomThreshold: number;
}

const SECONDS_PER_WEEK = 7 * 86400; // 604,800s
const SUNDAY_REWIND_WINDOW_SEC = 60; // Smooth 60-second rewind at Sunday 00:00

/**
 * Computes weekly counterweight descent progress in [0, 1].
 * - Slowly descends from 0.0 (top) to 1.0 (bottom) across the 7-day week.
 * - At midnight Sunday (day === 0, first 60 seconds), smoothly rewinds from 1.0 back to 0.0.
 */
export function computeCounterweightProgress(date: Date): number {
  const day = date.getDay(); // 0 = Sunday .. 6 = Saturday
  const secOfDay =
    date.getHours() * 3600 +
    date.getMinutes() * 60 +
    date.getSeconds() +
    date.getMilliseconds() / 1000;
  const weekSec = day * 86400 + secOfDay;

  if (weekSec < SUNDAY_REWIND_WINDOW_SEC) {
    const u = weekSec / SUNDAY_REWIND_WINDOW_SEC;
    return 0.5 * (1 + Math.cos(Math.PI * u));
  }

  return Math.min(
    1,
    Math.max(0, (weekSec - SUNDAY_REWIND_WINDOW_SEC) / (SECONDS_PER_WEEK - SUNDAY_REWIND_WINDOW_SEC))
  );
}

export class Tourbillon3DTheme implements Theme {
  public readonly id = 'tourbillon_3d';
  public readonly name = 'Horological Tourbillon 3D';

  private manifest: ThemeManifest = structuredClone(TOURBILLON_3D_MANIFEST);
  private stage: ThreeStage | null = null;
  private isMounted = false;
  private currentMode: ClockMode = 'active';

  // Smooth mechanical braking factor (1.0 = full motion, 0.0 = braked in sleep mode)
  private brakeFactor = 1.0;
  private lastSleepRenderTimeMs = 0;

  // Breathing camera parallax & desktop pointer tilt state
  private cameraPhaseSec = 0;
  private pointerTargetX = 0;
  private pointerTargetY = 0;
  private pointerCurrentX = 0;
  private pointerCurrentY = 0;
  private boundOnPointerMove: ((e: PointerEvent) => void) | null = null;

  // Lighting & materials adjusted by operating mode
  private ambientLight: THREE.AmbientLight | null = null;
  private overheadSpotlight: THREE.SpotLight | null = null;
  private dialKeySpotlight: THREE.SpotLight | null = null;
  private dialWarmLight: THREE.PointLight | null = null;
  private escapementRubyLight: THREE.PointLight | null = null;
  private indexGlowMaterial: THREE.MeshStandardMaterial | null = null;
  private rubyJewelMaterial: THREE.MeshPhysicalMaterial | null = null;
  private volumetricBeamMaterial: THREE.ShaderMaterial | null = null;
  private bokehDustMaterial: THREE.ShaderMaterial | null = null;

  // Dynamic mechanical sub-assemblies
  private hourHandPivot: THREE.Group | null = null;
  private dialGroup: THREE.Group | null = null;
  private dialBasePos = { x: 0, y: 0 };
  private minuteHandPivot: THREE.Group | null = null;
  private secondHandPivot: THREE.Group | null = null;

  // Tilted tri-axial tourbillon cage & 2.5 Hz balance assembly
  private tourbillonOuterGimbal: THREE.Group | null = null;
  private tourbillonMidTiltGroup: THREE.Group | null = null;
  private tourbillonMidGimbal: THREE.Group | null = null;
  private tourbillonInnerTiltGroup: THREE.Group | null = null;
  private tourbillonInnerCage: THREE.Group | null = null;
  private balanceWheelGroup: THREE.Group | null = null;
  private hairspringMesh: THREE.Mesh | null = null;
  private rubyJewelMesh: THREE.Mesh | null = null;

  // Multi-plane involute gear train across 4 distinct Z-depths
  private gearPlane1Seconds: THREE.Mesh | null = null;
  private gearPlane2Idler: THREE.Mesh | null = null;
  private gearPlane3Minute: THREE.Mesh | null = null;
  private gearPlane4Barrel: THREE.Mesh | null = null;
  private leftPulleyGear: THREE.Mesh | null = null;
  private rightPulleyGear: THREE.Mesh | null = null;

  // Descending counterweights & braided steel cables
  private leftWeightGroup: THREE.Group | null = null;
  private rightWeightGroup: THREE.Group | null = null;
  private leftCableMesh: THREE.Mesh | null = null;
  private rightCableMesh: THREE.Mesh | null = null;

  // Lower heavy brass lyre pendulum & golden bokeh dust motes
  private pendulumPivotGroup: THREE.Group | null = null;
  private dustParticles: THREE.Points | null = null;
  private dustVelocities: Float32Array | null = null;

  // Accumulated phase angles so smooth braking in sleep mode stops without snapping
  private tourbillonPhaseSec = 0;
  private lastTickTimestampMs: number | null = null;
  private lastPhysicsAngleRad = 0;
  private lastCounterweightProgress = 0;
  private alertPulseBoost = 0;

  public getManifest(): ThemeManifest {
    return this.manifest;
  }

  public getThreeStage(): ThreeStage | null {
    return this.stage;
  }

  public getResourceStats(): ThreeStageResourceStats | null {
    return this.stage ? this.stage.getResourceStats() : null;
  }

  public getDebugState(): TourbillonDebugState {
    const camPos = this.stage?.camera.position;
    const bloom = this.stage?.getBloomParameters();
    return {
      mode: this.currentMode,
      brakeFactor: this.brakeFactor,
      pendulumAngleRad: this.pendulumPivotGroup?.rotation.z ?? 0,
      tourbillonOuterRad: this.tourbillonOuterGimbal?.rotation.z ?? 0,
      tourbillonMidRad: this.tourbillonMidGimbal?.rotation.x ?? 0,
      tourbillonInnerRad: this.tourbillonInnerCage?.rotation.y ?? 0,
      tourbillonTiltDeg: [
        THREE.MathUtils.radToDeg(this.tourbillonMidTiltGroup?.rotation.z ?? 0),
        THREE.MathUtils.radToDeg(this.tourbillonInnerTiltGroup?.rotation.x ?? 0)
      ],
      balanceWheelAngleRad: this.balanceWheelGroup?.rotation.z ?? 0,
      gearPlaneZ: [
        this.gearPlane1Seconds?.position.z ?? -1.15,
        this.gearPlane2Idler?.position.z ?? -1.62,
        this.gearPlane3Minute?.position.z ?? -2.1,
        this.gearPlane4Barrel?.position.z ?? -2.58
      ],
      gearAnglesRad: [
        this.gearPlane1Seconds?.rotation.z ?? 0,
        this.gearPlane2Idler?.rotation.z ?? 0,
        this.gearPlane3Minute?.rotation.z ?? 0,
        this.gearPlane4Barrel?.rotation.z ?? 0
      ],
      counterweightProgress: this.lastCounterweightProgress,
      leftWeightY: this.leftWeightGroup?.position.y ?? 0,
      rightWeightY: this.rightWeightGroup?.position.y ?? 0,
      spotlightIntensity: this.overheadSpotlight?.intensity ?? 0,
      indexEmissiveIntensity: this.indexGlowMaterial?.emissiveIntensity ?? 0,
      rubyEmissiveIntensity: this.rubyJewelMaterial?.emissiveIntensity ?? 0,
      cameraPosition: camPos ? [camPos.x, camPos.y, camPos.z] : [0, 0, 35.8],
      bloomThreshold: bloom?.threshold ?? 1.45
    };
  }

  public async mount(_canvasContext: CanvasRenderingContext2D, config?: ThemeConfig): Promise<void> {
    if (this.stage) {
      this.stage.dispose();
      this.stage = null;
    }

    if (config?.manifest) {
      this.manifest = structuredClone(config.manifest);
    } else {
      this.manifest = structuredClone(TOURBILLON_3D_MANIFEST);
    }

    this.isMounted = true;
    this.brakeFactor = this.currentMode === 'sleep' ? 0.0 : 1.0;
    this.lastTickTimestampMs = null;

    const stage = new ThreeStage({
      width: config?.width ?? 1080,
      height: config?.height ?? 1920,
      fov: 30,
      chamberDepth: 4.8,
      stageElement: config?.stageElement,
      bloomThreshold: 1.45,
      bloomStrength: 0.28,
      bloomRadius: 0.4
    });
    this.stage = stage;

    await stage.init();
    if (!this.isMounted || this.stage !== stage) {
      stage.dispose();
      return;
    }

    this.setupPointerParallax();
    this.buildSceneGraph(stage);
    this.applyModeLighting();
    stage.clearCameraViewOffset();
    stage.render();
  }

  private setupPointerParallax(): void {
    this.cleanupPointerParallax();
    if (typeof window === 'undefined') return;

    this.boundOnPointerMove = (e: PointerEvent) => {
      if (this.currentMode === 'sleep') return;
      const w = window.innerWidth || 1080;
      const h = window.innerHeight || 1920;
      const nx = (e.clientX / w) * 2 - 1;
      const ny = (e.clientY / h) * 2 - 1;
      this.pointerTargetX = Math.max(-1, Math.min(1, nx));
      this.pointerTargetY = Math.max(-1, Math.min(1, -ny));
    };

    window.addEventListener('pointermove', this.boundOnPointerMove, { passive: true });
  }

  private cleanupPointerParallax(): void {
    if (this.boundOnPointerMove && typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.boundOnPointerMove);
    }
    this.boundOnPointerMove = null;
  }

  private buildSceneGraph(stage: ThreeStage): void {
    const scene = stage.scene;

    // --- Oiled Walnut Wood-Grain Diffuse, Normal & Roughness Maps with Aspect-Matched UV Repeats ---
    const walnutMaps = createWalnutWoodMaps(256, 512);
    stage.trackTexture(walnutMaps.map);
    stage.trackTexture(walnutMaps.normalMap);
    stage.trackTexture(walnutMaps.roughnessMap);

    const cloneRepeatedMaps = (repeatX: number, repeatY: number) => {
      const map = stage.trackTexture(walnutMaps.map.clone());
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(repeatX, repeatY);
      map.needsUpdate = true;

      const normalMap = stage.trackTexture(walnutMaps.normalMap.clone());
      normalMap.wrapS = THREE.RepeatWrapping;
      normalMap.wrapT = THREE.RepeatWrapping;
      normalMap.repeat.set(repeatX, repeatY);
      normalMap.needsUpdate = true;

      const roughnessMap = stage.trackTexture(walnutMaps.roughnessMap.clone());
      roughnessMap.wrapS = THREE.RepeatWrapping;
      roughnessMap.wrapT = THREE.RepeatWrapping;
      roughnessMap.repeat.set(repeatX, repeatY);
      roughnessMap.needsUpdate = true;

      return { map, normalMap, roughnessMap };
    };

    // Backplate (10.8 x 19.2 on 256x512 1:2 texture): uniform physical texel density
    const backMaps = cloneRepeatedMaps(2.0, 1.8);
    const walnutBackMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        map: backMaps.map,
        normalMap: backMaps.normalMap,
        normalScale: new THREE.Vector2(1.15, 1.15),
        roughnessMap: backMaps.roughnessMap,
        color: 0x3b2012,
        roughness: 0.8,
        metalness: 0.0
      })
    );

    // Left & Right recessed walls (depth 4.6 x height 19.2 on 256x512 1:2 texture): matched texel density
    const sideWallMaps = cloneRepeatedMaps(0.85, 1.8);
    const walnutSideWallMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        map: sideWallMaps.map,
        normalMap: sideWallMaps.normalMap,
        normalScale: new THREE.Vector2(1.05, 1.05),
        roughnessMap: sideWallMaps.roughnessMap,
        color: 0x2f180d,
        roughness: 0.8,
        metalness: 0.0
      })
    );

    // Top & Bottom recessed walls (width 10.8 x depth 4.6 on 256x512 1:2 texture): matched texel density
    const topBottomWallMaps = cloneRepeatedMaps(2.0, 0.42);
    const walnutTopBottomWallMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        map: topBottomWallMaps.map,
        normalMap: topBottomWallMaps.normalMap,
        normalScale: new THREE.Vector2(1.05, 1.05),
        roughnessMap: topBottomWallMaps.roughnessMap,
        color: 0x2f180d,
        roughness: 0.8,
        metalness: 0.0
      })
    );

    // High-contrast metallic & horological materials
    const polishedBrassMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xe6b85c,
        metalness: 0.94,
        roughness: 0.14
      })
    );

    const brushedBrassMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xcca045,
        metalness: 0.88,
        roughness: 0.28
      })
    );

    const antiqueBronzeMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x785627,
        metalness: 0.84,
        roughness: 0.36
      })
    );

    // Heat-blued horological steel with metallic cobalt sheen
    const heatBluedSteelMaterial = stage.trackMaterial(
      new THREE.MeshPhysicalMaterial({
        color: 0x164c9c,
        emissive: new THREE.Color(0x092452),
        emissiveIntensity: 0.45,
        metalness: 0.96,
        roughness: 0.12,
        clearcoat: 1.0,
        clearcoatRoughness: 0.08
      })
    );

    const titaniumCageMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xdfe6f0,
        metalness: 0.95,
        roughness: 0.16
      })
    );

    const steelShaftMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xb8c2ce,
        metalness: 0.92,
        roughness: 0.22
      })
    );

    const braidedSteelMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x9aa5b4,
        metalness: 0.88,
        roughness: 0.35
      })
    );

    // Warm amber backlit glass tubes inside the 12 hour markers
    this.indexGlowMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xffdf9e,
        emissive: new THREE.Color(0xff9d2e),
        emissiveIntensity: 1.85,
        metalness: 0.2,
        roughness: 0.15
      })
    );

    const borosilicateGlassSleeveMaterial = stage.trackMaterial(
      new THREE.MeshPhysicalMaterial({
        color: 0xfff5e4,
        transparent: true,
        opacity: 0.42,
        roughness: 0.06,
        metalness: 0.05,
        transmission: 0.82,
        thickness: 0.18
      })
    );

    // Glowing crimson synthetic ruby bearings (emissive: #ff1a40, emissiveIntensity: 2.5)
    this.rubyJewelMaterial = stage.trackMaterial(
      new THREE.MeshPhysicalMaterial({
        color: 0xff1a40,
        emissive: new THREE.Color(0xff1a40),
        emissiveIntensity: 2.5,
        metalness: 0.08,
        roughness: 0.08,
        transmission: 0.65,
        thickness: 0.35,
        clearcoat: 1.0
      })
    );

    // =========================================================================
    // 1. DRAMATIC DIRECTIONAL & SPOTLIGHT RIG (2048×2048 PCFSoftShadowMap)
    // =========================================================================
    this.ambientLight = new THREE.AmbientLight(0xffdcb5, 0.38);
    scene.add(this.ambientLight);

    // Main overhead volumetric spotlight casting crisp shadows onto the walnut backplate
    this.overheadSpotlight = new THREE.SpotLight(
      0xffd296,
      115.0,
      40.0,
      THREE.MathUtils.degToRad(36),
      0.72,
      1.5
    );
    this.overheadSpotlight.position.set(1.3, 9.4, 5.2);
    this.overheadSpotlight.target.position.set(0, -1.8, -2.8);
    this.overheadSpotlight.castShadow = true;
    this.overheadSpotlight.shadow.mapSize.set(
      ThreeStage.SHADOW_MAP_SIZE,
      ThreeStage.SHADOW_MAP_SIZE
    );
    this.overheadSpotlight.shadow.camera.near = 2.0;
    this.overheadSpotlight.shadow.camera.far = 28.0;
    this.overheadSpotlight.shadow.bias = -0.00035;
    scene.add(this.overheadSpotlight);
    scene.add(this.overheadSpotlight.target);

    // Grazing front-left key spotlight for deep gear-train shadows on the walnut backplate
    this.dialKeySpotlight = new THREE.SpotLight(
      0xffe0b2,
      55.0,
      25.0,
      THREE.MathUtils.degToRad(40),
      0.65,
      1.5
    );
    this.dialKeySpotlight.position.set(-3.2, 6.2, 5.8);
    this.dialKeySpotlight.target.position.set(0.2, 2.5, -3.5);
    scene.add(this.dialKeySpotlight);
    scene.add(this.dialKeySpotlight.target);

    this.dialWarmLight = new THREE.PointLight(0xffb454, 18.0, 14.0, 1.5);
    this.dialWarmLight.position.set(2.2, 4.5, 2.4);
    scene.add(this.dialWarmLight);

    this.escapementRubyLight = new THREE.PointLight(0xff1a40, 4.8, 5.0, 1.7);
    this.escapementRubyLight.position.set(0, 4.3, -0.35);
    scene.add(this.escapementRubyLight);

    // =========================================================================
    // 2. VISIBLE RECESSED WALNUT & BRASS CHAMBER (ANGLED PERSPECTIVE WALLS)
    // =========================================================================
    const chamberGroup = new THREE.Group();
    const outerW = 10.8;
    const outerH = 19.2;
    const chamberD = 4.2;

    // Recessed oiled-walnut backplate at z = -4.2 with carved movement recess
    const backplateMesh = new THREE.Mesh(
      new THREE.BoxGeometry(outerW, outerH, 0.38),
      walnutBackMaterial
    );
    backplateMesh.position.set(0, 0, -chamberD);
    backplateMesh.receiveShadow = true;
    chamberGroup.add(backplateMesh);

    const surroundBacking = new THREE.Mesh(
      new THREE.BoxGeometry(24.0, 32.0, 0.38),
      walnutBackMaterial
    );
    surroundBacking.position.set(0, 0, -chamberD - 0.38);
    surroundBacking.receiveShadow = true;
    chamberGroup.add(surroundBacking);

    // Recessed circular brass-rimmed walnut movement alcove behind the upper dial
    const movementRecessRing = new THREE.Mesh(
      new THREE.TorusGeometry(3.85, 0.14, 16, 64),
      antiqueBronzeMaterial
    );
    movementRecessRing.position.set(0, 4.3, -chamberD + 0.22);
    movementRecessRing.receiveShadow = true;
    chamberGroup.add(movementRecessRing);

    // Four angled (splayed) interior cabinet walls framing the scene in 3D perspective
    const splayAngleLR = THREE.MathUtils.degToRad(14);
    const splayAngleTB = THREE.MathUtils.degToRad(12);
    const wallSlabThickness = 0.55;

    const leftAngledWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallSlabThickness, outerH, chamberD + 0.4),
      walnutSideWallMaterial
    );
    leftAngledWall.position.set(-outerW * 0.5 + 0.55, 0, -chamberD * 0.5);
    leftAngledWall.rotation.y = splayAngleLR;
    leftAngledWall.receiveShadow = true;
    chamberGroup.add(leftAngledWall);

    const rightAngledWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallSlabThickness, outerH, chamberD + 0.4),
      walnutSideWallMaterial
    );
    rightAngledWall.position.set(outerW * 0.5 - 0.55, 0, -chamberD * 0.5);
    rightAngledWall.rotation.y = -splayAngleLR;
    rightAngledWall.receiveShadow = true;
    chamberGroup.add(rightAngledWall);

    const topAngledWall = new THREE.Mesh(
      new THREE.BoxGeometry(outerW, wallSlabThickness, chamberD + 0.4),
      walnutTopBottomWallMaterial
    );
    topAngledWall.position.set(0, outerH * 0.5 - 0.52, -chamberD * 0.5);
    topAngledWall.rotation.x = -splayAngleTB;
    topAngledWall.receiveShadow = true;
    chamberGroup.add(topAngledWall);

    const bottomAngledWall = new THREE.Mesh(
      new THREE.BoxGeometry(outerW, wallSlabThickness, chamberD + 0.4),
      walnutTopBottomWallMaterial
    );
    bottomAngledWall.position.set(0, -outerH * 0.5 + 0.52, -chamberD * 0.5);
    bottomAngledWall.rotation.x = splayAngleTB;
    bottomAngledWall.receiveShadow = true;
    chamberGroup.add(bottomAngledWall);

    // Inner vertical shadow-box wainscoting rails along the backplate perimeter
    const backRailGeoV = new THREE.BoxGeometry(0.32, outerH - 1.8, 0.45);
    const leftBackRail = new THREE.Mesh(backRailGeoV, brushedBrassMaterial);
    leftBackRail.position.set(-4.35, 0, -chamberD + 0.32);
    leftBackRail.castShadow = true;
    leftBackRail.receiveShadow = true;
    chamberGroup.add(leftBackRail);

    const rightBackRail = new THREE.Mesh(backRailGeoV, brushedBrassMaterial);
    rightBackRail.position.set(4.35, 0, -chamberD + 0.32);
    rightBackRail.castShadow = true;
    rightBackRail.receiveShadow = true;
    chamberGroup.add(rightBackRail);

    // Front chamfered brushed-brass bezel frame at z = -0.15
    const trimWidth = 0.28;
    const trimDepth = 0.32;
    const innerW = outerW - 0.65;
    const innerH = outerH - 0.65;

    const topBrassTrim = new THREE.Mesh(
      new THREE.BoxGeometry(innerW + trimWidth * 2, trimWidth, trimDepth),
      brushedBrassMaterial
    );
    topBrassTrim.position.set(0, innerH * 0.5, -0.16);
    topBrassTrim.castShadow = true;
    chamberGroup.add(topBrassTrim);

    const bottomBrassTrim = new THREE.Mesh(
      new THREE.BoxGeometry(innerW + trimWidth * 2, trimWidth, trimDepth),
      brushedBrassMaterial
    );
    bottomBrassTrim.position.set(0, -innerH * 0.5, -0.16);
    bottomBrassTrim.castShadow = true;
    chamberGroup.add(bottomBrassTrim);

    const leftBrassTrim = new THREE.Mesh(
      new THREE.BoxGeometry(trimWidth, innerH, trimDepth),
      brushedBrassMaterial
    );
    leftBrassTrim.position.set(-innerW * 0.5, 0, -0.16);
    leftBrassTrim.castShadow = true;
    chamberGroup.add(leftBrassTrim);

    const rightBrassTrim = new THREE.Mesh(
      new THREE.BoxGeometry(trimWidth, innerH, trimDepth),
      brushedBrassMaterial
    );
    rightBrassTrim.position.set(innerW * 0.5, 0, -0.16);
    rightBrassTrim.castShadow = true;
    chamberGroup.add(rightBrassTrim);

    // Sculpted horizontal movement bridge beam with heat-blued screws & ruby jewel settings
    const bridgeBeam = new THREE.Mesh(
      new THREE.BoxGeometry(innerW - 0.4, 0.36, 0.58),
      brushedBrassMaterial
    );
    bridgeBeam.position.set(0, -0.35, -1.25);
    bridgeBeam.castShadow = true;
    bridgeBeam.receiveShadow = true;
    chamberGroup.add(bridgeBeam);

    // 4 Corner L-brackets with heat-blued screws casting shadows
    const cornerOffsets: Array<[number, number]> = [
      [-innerW * 0.5 + 0.44, innerH * 0.5 - 0.44],
      [innerW * 0.5 - 0.44, innerH * 0.5 - 0.44],
      [-innerW * 0.5 + 0.44, -innerH * 0.5 + 0.44],
      [innerW * 0.5 - 0.44, -innerH * 0.5 + 0.44]
    ];
    const bracketGeo = new THREE.BoxGeometry(0.92, 0.92, 0.34);
    const bluedScrewGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.1, 16);
    bluedScrewGeo.rotateX(Math.PI * 0.5);
    for (const [cx, cy] of cornerOffsets) {
      const bracket = new THREE.Mesh(bracketGeo, antiqueBronzeMaterial);
      bracket.position.set(cx, cy, -0.22);
      bracket.castShadow = true;
      chamberGroup.add(bracket);

      const screw = new THREE.Mesh(bluedScrewGeo, heatBluedSteelMaterial);
      screw.position.set(cx, cy, -0.02);
      chamberGroup.add(screw);
    }

    scene.add(chamberGroup);

    // =========================================================================
    // 3. 4-PLANE BEVELED GEAR TRAIN WITH STEEL SHAFTS, BRASS BUSHINGS & RUBY JEWELS
    // =========================================================================
    const dialWorld = ThreeStage.canvasToWorldXY(
      this.manifest.dial.center.x,
      this.manifest.dial.center.y
    );
    const dialCenterY = dialWorld.y; // +4.3

    const gearTrainGroup = new THREE.Group();
    gearTrainGroup.position.set(dialWorld.x, dialCenterY, 0);

    // Helper that adds a steel arbor shaft extending to the backplate, a brass bushing collar,
    // and a glowing crimson synthetic ruby bearing at (gx, gy, gz)
    const addGearShaftAndRubyBearing = (gx: number, gy: number, gz: number, hubR: number) => {
      const shaftLen = Math.max(0.4, Math.abs(-chamberD - gz));
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.065, shaftLen, 16),
        steelShaftMaterial
      );
      shaft.rotation.x = Math.PI * 0.5;
      shaft.position.set(gx, gy, gz - shaftLen * 0.5);
      shaft.castShadow = true;
      gearTrainGroup.add(shaft);

      // Chamfered brass chaton / bushing collar
      const bushing = new THREE.Mesh(
        new THREE.CylinderGeometry(hubR * 0.68, hubR * 0.78, 0.22, 24),
        polishedBrassMaterial
      );
      bushing.rotation.x = Math.PI * 0.5;
      bushing.position.set(gx, gy, gz + 0.03);
      gearTrainGroup.add(bushing);

      // Glowing synthetic crimson ruby bearing (emissive #ff1a40, intensity 2.5)
      const rubyBearing = new THREE.Mesh(
        new THREE.TorusGeometry(hubR * 0.34, 0.045, 14, 24),
        this.rubyJewelMaterial!
      );
      rubyBearing.position.set(gx, gy, gz + 0.14);
      gearTrainGroup.add(rubyBearing);

      const rubyCore = new THREE.Mesh(
        new THREE.SphereGeometry(hubR * 0.24, 16, 16),
        this.rubyJewelMaterial!
      );
      rubyCore.position.set(gx, gy, gz + 0.14);
      gearTrainGroup.add(rubyCore);
    };

    // Plane 1 (z = -1.15): Escape / Fourth wheel (30 beveled teeth, synced 1:1 with seconds)
    const gear1Geo = createInvoluteGearGeometry({
      teeth: 30,
      pitchRadius: 1.08,
      thickness: 0.16,
      spokes: 5,
      hubRadius: 0.26
    });
    this.gearPlane1Seconds = new THREE.Mesh(gear1Geo, polishedBrassMaterial);
    this.gearPlane1Seconds.position.set(0, 0, -1.15);
    this.gearPlane1Seconds.castShadow = true;
    this.gearPlane1Seconds.receiveShadow = true;
    gearTrainGroup.add(this.gearPlane1Seconds);
    addGearShaftAndRubyBearing(0, 0, -1.15, 0.26);

    // Plane 2 (z = -1.62): Third intermediate wheel (36 beveled teeth)
    const gear2Geo = createInvoluteGearGeometry({
      teeth: 36,
      pitchRadius: 1.34,
      thickness: 0.17,
      spokes: 6,
      hubRadius: 0.28
    });
    this.gearPlane2Idler = new THREE.Mesh(gear2Geo, brushedBrassMaterial);
    this.gearPlane2Idler.position.set(1.22, -1.32, -1.62);
    this.gearPlane2Idler.castShadow = true;
    this.gearPlane2Idler.receiveShadow = true;
    gearTrainGroup.add(this.gearPlane2Idler);
    addGearShaftAndRubyBearing(1.22, -1.32, -1.62, 0.28);

    // Plane 3 (z = -2.10): Center / Minute wheel (45 beveled teeth)
    const gear3Geo = createInvoluteGearGeometry({
      teeth: 45,
      pitchRadius: 1.68,
      thickness: 0.18,
      spokes: 6,
      hubRadius: 0.32
    });
    this.gearPlane3Minute = new THREE.Mesh(gear3Geo, polishedBrassMaterial);
    this.gearPlane3Minute.position.set(-1.12, -1.42, -2.1);
    this.gearPlane3Minute.castShadow = true;
    this.gearPlane3Minute.receiveShadow = true;
    gearTrainGroup.add(this.gearPlane3Minute);
    addGearShaftAndRubyBearing(-1.12, -1.42, -2.1, 0.32);

    // Plane 4 (z = -2.58): Great Barrel Wheel (54 beveled teeth, deepest plane near walnut plate)
    const gear4Geo = createInvoluteGearGeometry({
      teeth: 54,
      pitchRadius: 2.15,
      thickness: 0.2,
      spokes: 8,
      hubRadius: 0.38
    });
    this.gearPlane4Barrel = new THREE.Mesh(gear4Geo, antiqueBronzeMaterial);
    this.gearPlane4Barrel.position.set(0.18, -2.35, -2.58);
    this.gearPlane4Barrel.castShadow = true;
    this.gearPlane4Barrel.receiveShadow = true;
    gearTrainGroup.add(this.gearPlane4Barrel);
    addGearShaftAndRubyBearing(0.18, -2.35, -2.58, 0.38);

    scene.add(gearTrainGroup);

    // Left & Right Flank Pulley Gears and Descending Cylindrical Brass Counterweights
    const pulleyGeo = createInvoluteGearGeometry({
      teeth: 20,
      pitchRadius: 0.44,
      thickness: 0.16,
      spokes: 4,
      hubRadius: 0.16
    });
    const pulleyY = 6.8;
    const flankX = 3.65;
    const weightZ = -2.05;

    this.leftPulleyGear = new THREE.Mesh(pulleyGeo, brushedBrassMaterial);
    this.leftPulleyGear.position.set(-flankX, pulleyY, weightZ);
    this.leftPulleyGear.castShadow = true;
    scene.add(this.leftPulleyGear);

    this.rightPulleyGear = new THREE.Mesh(pulleyGeo, brushedBrassMaterial);
    this.rightPulleyGear.position.set(flankX, pulleyY, weightZ);
    this.rightPulleyGear.castShadow = true;
    scene.add(this.rightPulleyGear);

    // Ruby bearings on pulley arbors
    const leftPulleyRuby = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 12, 12),
      this.rubyJewelMaterial
    );
    leftPulleyRuby.position.set(-flankX, pulleyY, weightZ + 0.11);
    scene.add(leftPulleyRuby);

    const rightPulleyRuby = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 12, 12),
      this.rubyJewelMaterial
    );
    rightPulleyRuby.position.set(flankX, pulleyY, weightZ + 0.11);
    scene.add(rightPulleyRuby);

    // Braided steel cables
    const cableGeo = new THREE.CylinderGeometry(0.028, 0.028, 1.0, 10);
    this.leftCableMesh = new THREE.Mesh(cableGeo, braidedSteelMaterial);
    this.rightCableMesh = new THREE.Mesh(cableGeo, braidedSteelMaterial);
    scene.add(this.leftCableMesh);
    scene.add(this.rightCableMesh);

    const buildCounterweight = (): THREE.Group => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.38, 0.38, 1.7, 32),
        polishedBrassMaterial
      );
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const topCap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.14, 32),
        antiqueBronzeMaterial
      );
      topCap.position.y = 0.84;
      group.add(topCap);

      const bottomCap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.14, 32),
        antiqueBronzeMaterial
      );
      bottomCap.position.y = -0.84;
      group.add(bottomCap);

      const hookRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.11, 0.03, 12, 24),
        polishedBrassMaterial
      );
      hookRing.position.y = 0.98;
      group.add(hookRing);

      return group;
    };

    this.leftWeightGroup = buildCounterweight();
    this.leftWeightGroup.position.set(-flankX, 4.0, weightZ);
    scene.add(this.leftWeightGroup);

    this.rightWeightGroup = buildCounterweight();
    this.rightWeightGroup.position.set(flankX, 4.0, weightZ);
    scene.add(this.rightWeightGroup);

    // =========================================================================
    // 4. UPPER DIAL, WARM BACKLIT HOUR TUBES, HANDS & TILTED TRI-AXIAL TOURBILLON
    // =========================================================================
    const dialGroup = new THREE.Group();
    dialGroup.position.set(dialWorld.x, dialCenterY, -0.58);
    this.dialGroup = dialGroup;
    this.dialBasePos = { x: dialWorld.x, y: dialCenterY };

    // Outer stepped chamfered brass chapter bezel ring
    const outerChapterRing = new THREE.Mesh(
      new THREE.TorusGeometry(4.12, 0.22, 24, 80),
      polishedBrassMaterial
    );
    outerChapterRing.castShadow = true;
    outerChapterRing.receiveShadow = true;
    dialGroup.add(outerChapterRing);

    // Inner skeleton chapter track ring with heat-blued dial screws
    const innerTrackRing = new THREE.Mesh(
      new THREE.TorusGeometry(3.22, 0.085, 18, 64),
      brushedBrassMaterial
    );
    innerTrackRing.castShadow = true;
    dialGroup.add(innerTrackRing);

    // Sculpted tourbillon bridge spanning across the dial aperture with blued screws
    const tourbillonBridge = new THREE.Mesh(
      new THREE.BoxGeometry(6.35, 0.24, 0.16),
      brushedBrassMaterial
    );
    tourbillonBridge.position.set(0, 0, -0.22);
    tourbillonBridge.castShadow = true;
    dialGroup.add(tourbillonBridge);

    for (const bx of [-2.85, -2.45, 2.45, 2.85]) {
      const bridgeScrew = new THREE.Mesh(bluedScrewGeo, heatBluedSteelMaterial);
      bridgeScrew.position.set(bx, 0, -0.11);
      dialGroup.add(bridgeScrew);
    }

    // 12 Extruded 3D Brass Hour Markers housing Warm Amber Backlit Glass Tubes
    const hourMarkerGeo = new THREE.BoxGeometry(0.22, 0.72, 0.18);
    const glowTubeGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.54, 14);
    const glassSleeveGeo = new THREE.CylinderGeometry(0.058, 0.058, 0.58, 16);

    for (let h = 0; h < 12; h++) {
      const angle = (h / 12) * Math.PI * 2;
      const r = 3.66;
      const markerGroup = new THREE.Group();
      markerGroup.position.set(Math.sin(angle) * r, Math.cos(angle) * r, 0.1);
      markerGroup.rotation.z = -angle;

      const brassBaton = new THREE.Mesh(hourMarkerGeo, polishedBrassMaterial);
      brassBaton.castShadow = true;
      brassBaton.receiveShadow = true;
      markerGroup.add(brassBaton);

      // Warm amber glowing filament core
      const glowTube = new THREE.Mesh(glowTubeGeo, this.indexGlowMaterial);
      glowTube.position.z = 0.09;
      markerGroup.add(glowTube);

      // Encapsulating borosilicate glass tube sleeve
      const glassSleeve = new THREE.Mesh(glassSleeveGeo, borosilicateGlassSleeveMaterial);
      glassSleeve.position.z = 0.095;
      markerGroup.add(glassSleeve);

      dialGroup.add(markerGroup);
    }

    // 60 Extruded Minute Chapter Ticks
    const minuteTickGeo = new THREE.BoxGeometry(0.048, 0.22, 0.09);
    for (let m = 0; m < 60; m++) {
      if (m % 5 === 0) continue;
      const angle = (m / 60) * Math.PI * 2;
      const r = 3.8;
      const tick = new THREE.Mesh(minuteTickGeo, brushedBrassMaterial);
      tick.position.set(Math.sin(angle) * r, Math.cos(angle) * r, 0.04);
      tick.rotation.z = -angle;
      dialGroup.add(tick);
    }

    // --- Tilted Tri-Axial Tourbillon Cage at Dial Center ---
    const tourbillonRoot = new THREE.Group();
    tourbillonRoot.position.set(0, 0, 0.02);

    // Glowing synthetic ruby pivot bearings at top/bottom of tourbillon bridge
    const pivotRubyGeo = new THREE.OctahedronGeometry(0.1, 2);
    const leftPivotRuby = new THREE.Mesh(pivotRubyGeo, this.rubyJewelMaterial);
    leftPivotRuby.position.set(-1.26, 0, 0);
    tourbillonRoot.add(leftPivotRuby);

    const rightPivotRuby = new THREE.Mesh(pivotRubyGeo, this.rubyJewelMaterial);
    rightPivotRuby.position.set(1.26, 0, 0);
    tourbillonRoot.add(rightPivotRuby);

    // Axis 1: Outer Carriage rotating around Z
    this.tourbillonOuterGimbal = new THREE.Group();
    const outerCageRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.22, 0.072, 18, 56),
      titaniumCageMaterial
    );
    outerCageRing.castShadow = true;
    this.tourbillonOuterGimbal.add(outerCageRing);

    const outerPillarGeo = new THREE.CylinderGeometry(0.042, 0.042, 2.44, 12);
    const outerPillar = new THREE.Mesh(outerPillarGeo, polishedBrassMaterial);
    outerPillar.rotation.z = Math.PI * 0.5;
    this.tourbillonOuterGimbal.add(outerPillar);

    // Axis 2: Middle Gimbal tilted by 28° so rotation sweeps dramatically through 3D Z-space
    this.tourbillonMidTiltGroup = new THREE.Group();
    this.tourbillonMidTiltGroup.rotation.z = THREE.MathUtils.degToRad(28);

    this.tourbillonMidGimbal = new THREE.Group();
    const midCageRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.96, 0.062, 18, 48),
      polishedBrassMaterial
    );
    midCageRing.castShadow = true;
    this.tourbillonMidGimbal.add(midCageRing);

    // Axis 3: Inner Escapement Cage tilted by 32° so balance & hairspring sweep across all 3 axes
    this.tourbillonInnerTiltGroup = new THREE.Group();
    this.tourbillonInnerTiltGroup.rotation.x = THREE.MathUtils.degToRad(32);

    this.tourbillonInnerCage = new THREE.Group();
    const innerCageRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.048, 16, 40),
      titaniumCageMaterial
    );
    innerCageRing.castShadow = true;
    this.tourbillonInnerCage.add(innerCageRing);

    // Oscillating Balance Wheel (2.5 Hz) with heat-blued & brass timing screws
    this.balanceWheelGroup = new THREE.Group();
    const balanceRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.046, 14, 36),
      polishedBrassMaterial
    );
    this.balanceWheelGroup.add(balanceRim);

    const balanceCrossbar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.98, 10),
      polishedBrassMaterial
    );
    balanceCrossbar.rotation.z = Math.PI * 0.5;
    this.balanceWheelGroup.add(balanceCrossbar);

    const screwGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.1, 10);
    for (let s = 0; s < 8; s++) {
      const sa = (s / 8) * Math.PI * 2;
      const screw = new THREE.Mesh(
        screwGeo,
        s % 2 === 0 ? heatBluedSteelMaterial : polishedBrassMaterial
      );
      screw.position.set(Math.cos(sa) * 0.55, Math.sin(sa) * 0.55, 0);
      screw.rotation.z = sa + Math.PI * 0.5;
      this.balanceWheelGroup.add(screw);
    }
    this.tourbillonInnerCage.add(this.balanceWheelGroup);

    // Heat-Blued Breguet Hairspring Coil
    const hairspringGeo = createHairspringGeometry(0.08, 0.36, 4.5, 0.012);
    this.hairspringMesh = new THREE.Mesh(hairspringGeo, heatBluedSteelMaterial);
    this.hairspringMesh.position.z = 0.05;
    this.tourbillonInnerCage.add(this.hairspringMesh);

    // Central Glowing Crimson Ruby Impulse Jewel
    const rubyGeo = new THREE.OctahedronGeometry(0.125, 2);
    this.rubyJewelMesh = new THREE.Mesh(rubyGeo, this.rubyJewelMaterial);
    this.rubyJewelMesh.position.z = 0.09;
    this.tourbillonInnerCage.add(this.rubyJewelMesh);

    this.tourbillonInnerTiltGroup.add(this.tourbillonInnerCage);
    this.tourbillonMidGimbal.add(this.tourbillonInnerTiltGroup);
    this.tourbillonMidTiltGroup.add(this.tourbillonMidGimbal);
    this.tourbillonOuterGimbal.add(this.tourbillonMidTiltGroup);
    tourbillonRoot.add(this.tourbillonOuterGimbal);
    dialGroup.add(tourbillonRoot);

    // --- Extruded 3D Skeletonized Cathedral Hour & Minute Hands + Heat-Blued Second Hand ---
    this.hourHandPivot = new THREE.Group();
    this.hourHandPivot.position.set(0, 0, 0.42);
    const hourHandMesh = new THREE.Mesh(
      createCathedralHandGeometry(2.45, 0.36, 0.085),
      polishedBrassMaterial
    );
    hourHandMesh.castShadow = true;
    this.hourHandPivot.add(hourHandMesh);
    dialGroup.add(this.hourHandPivot);

    this.minuteHandPivot = new THREE.Group();
    this.minuteHandPivot.position.set(0, 0, 0.55);
    const minuteHandMesh = new THREE.Mesh(
      createCathedralHandGeometry(3.52, 0.28, 0.075),
      polishedBrassMaterial
    );
    minuteHandMesh.castShadow = true;
    this.minuteHandPivot.add(minuteHandMesh);
    dialGroup.add(this.minuteHandPivot);

    this.secondHandPivot = new THREE.Group();
    this.secondHandPivot.position.set(0, 0, 0.68);
    const secondHandMesh = new THREE.Mesh(
      createSecondHandGeometry(3.75, 0.048),
      heatBluedSteelMaterial
    );
    secondHandMesh.castShadow = true;
    this.secondHandPivot.add(secondHandMesh);
    dialGroup.add(this.secondHandPivot);

    // Center cap nut with glowing ruby cabochon
    const centerCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.12, 24),
      polishedBrassMaterial
    );
    centerCap.rotation.x = Math.PI * 0.5;
    centerCap.position.z = 0.74;
    dialGroup.add(centerCap);

    const capRuby = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 16, 16),
      this.rubyJewelMaterial
    );
    capRuby.position.z = 0.81;
    dialGroup.add(capRuby);

    scene.add(dialGroup);

    // =========================================================================
    // 5. LOWER HEAVY BRASS LYRE PENDULUM, FRESNEL VOLUMETRIC BEAM & BOKEH DUST
    // =========================================================================
    const pendWorld = ThreeStage.canvasToWorldXY(
      this.manifest.pendulum.pivot.x,
      this.manifest.pendulum.pivot.y
    );

    this.pendulumPivotGroup = new THREE.Group();
    this.pendulumPivotGroup.position.set(pendWorld.x, pendWorld.y, -1.65);

    const bobCenterY = -6.2;

    const upperRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.058, 0.058, 1.8, 16),
      polishedBrassMaterial
    );
    upperRod.position.y = -0.9;
    upperRod.castShadow = true;
    this.pendulumPivotGroup.add(upperRod);

    // Curved Brass Lyre Harp Frame
    const lyreCenterY = -3.35;
    const lyreRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.64, 0.048, 16, 52),
      polishedBrassMaterial
    );
    lyreRing.scale.set(1.0, 2.55, 1.0);
    lyreRing.position.y = lyreCenterY;
    lyreRing.castShadow = true;
    this.pendulumPivotGroup.add(lyreRing);

    // 5 Vertical compensation gridiron harp rods inside the lyre
    const harpOffsets = [-0.32, -0.16, 0, 0.16, 0.32];
    for (let i = 0; i < harpOffsets.length; i++) {
      const hx = harpOffsets[i];
      const rodH = 3.1 - Math.abs(hx) * 1.4;
      const harpRod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.024, 0.024, rodH, 12),
        i % 2 === 0 ? polishedBrassMaterial : titaniumCageMaterial
      );
      harpRod.position.set(hx, lyreCenterY, 0);
      harpRod.castShadow = true;
      this.pendulumPivotGroup.add(harpRod);
    }

    // Upper & lower lyre crown clasps with blued screws
    const claspGeo = new THREE.BoxGeometry(0.68, 0.15, 0.18);
    const topClasp = new THREE.Mesh(claspGeo, antiqueBronzeMaterial);
    topClasp.position.y = -1.78;
    this.pendulumPivotGroup.add(topClasp);

    const bottomClasp = new THREE.Mesh(claspGeo, antiqueBronzeMaterial);
    bottomClasp.position.y = -4.92;
    this.pendulumPivotGroup.add(bottomClasp);

    // Heavy Biconvex Lens-Shaped Brass Bob catching high-contrast studio reflections
    const lensBobMesh = new THREE.Mesh(
      createLensBobGeometry(1.26, 0.38),
      polishedBrassMaterial
    );
    lensBobMesh.position.y = bobCenterY;
    lensBobMesh.castShadow = true;
    lensBobMesh.receiveShadow = true;
    this.pendulumPivotGroup.add(lensBobMesh);

    const ratingNut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 0.18, 6),
      antiqueBronzeMaterial
    );
    ratingNut.position.y = bobCenterY - 1.35;
    this.pendulumPivotGroup.add(ratingNut);

    const pointerSpike = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.4, 16),
      polishedBrassMaterial
    );
    pointerSpike.rotation.x = Math.PI;
    pointerSpike.position.y = bobCenterY - 1.62;
    this.pendulumPivotGroup.add(pointerSpike);

    scene.add(this.pendulumPivotGroup);

    // Custom Fresnel Edge-Fade + Vertical Gradient Volumetric Light Beam (zero hard edges)
    const beamGeo = new THREE.CylinderGeometry(1.15, 4.35, 16.5, 48, 24, true);
    this.volumetricBeamMaterial = stage.trackMaterial(createVolumetricBeamMaterial(0.095));
    const volumetricBeamMesh = new THREE.Mesh(beamGeo, this.volumetricBeamMaterial);
    volumetricBeamMesh.position.set(0.25, -0.4, -1.45);
    volumetricBeamMesh.rotation.z = THREE.MathUtils.degToRad(-3.5);
    scene.add(volumetricBeamMesh);

    // Bright Golden Bokeh Dust Motes drifting through the volumetric beam
    const dustCount = 110;
    const dustPositions = new Float32Array(dustCount * 3);
    const dustScales = new Float32Array(dustCount);
    const dustPhases = new Float32Array(dustCount);
    this.dustVelocities = new Float32Array(dustCount * 3);

    for (let i = 0; i < dustCount; i++) {
      dustPositions[i * 3] = (Math.random() - 0.5) * 7.2;
      dustPositions[i * 3 + 1] = (Math.random() - 0.5) * 15.2;
      dustPositions[i * 3 + 2] = -0.35 - Math.random() * 2.9;

      dustScales[i] = 0.28 + Math.random() * 0.55;
      dustPhases[i] = Math.random() * Math.PI * 2;

      this.dustVelocities[i * 3] = (Math.random() - 0.5) * 0.14;
      this.dustVelocities[i * 3 + 1] = 0.05 + Math.random() * 0.12;
      this.dustVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.08;
    }

    const dustGeo = stage.trackGeometry(new THREE.BufferGeometry());
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    dustGeo.setAttribute('aScale', new THREE.BufferAttribute(dustScales, 1));
    dustGeo.setAttribute('aPhase', new THREE.BufferAttribute(dustPhases, 1));

    this.bokehDustMaterial = stage.trackMaterial(createBokehDustMaterial(0.25));
    this.dustParticles = new THREE.Points(dustGeo, this.bokehDustMaterial);
    scene.add(this.dustParticles);

    // Register full scene object tree for strict disposal tracking
    stage.registerObjectTree(scene);
  }

  private applyModeLighting(): void {
    if (!this.stage) return;

    if (this.currentMode === 'night') {
      if (this.overheadSpotlight) this.overheadSpotlight.intensity = 18.0;
      if (this.dialKeySpotlight) this.dialKeySpotlight.intensity = 8.0;
      if (this.ambientLight) this.ambientLight.intensity = 0.12;
      if (this.dialWarmLight) this.dialWarmLight.intensity = 3.5;
      if (this.escapementRubyLight) this.escapementRubyLight.intensity = 1.6;
      if (this.indexGlowMaterial) this.indexGlowMaterial.emissiveIntensity = 0.65;
      if (this.rubyJewelMaterial) this.rubyJewelMaterial.emissiveIntensity = 1.55;
      if (this.volumetricBeamMaterial) {
        this.volumetricBeamMaterial.uniforms.uOpacity.value = 0.025;
      }
      if (this.bokehDustMaterial) {
        this.bokehDustMaterial.uniforms.uOpacity.value = 0.12;
      }
      this.stage.setBloomParameters({ threshold: 1.45, strength: 0.22, radius: 0.35 });
      this.stage.setToneMappingExposure(0.68);
      this.stage.setEnvironmentIntensity(0.45);
    } else if (this.currentMode === 'sleep') {
      if (this.overheadSpotlight) this.overheadSpotlight.intensity = 3.5;
      if (this.dialKeySpotlight) this.dialKeySpotlight.intensity = 0.0;
      if (this.ambientLight) this.ambientLight.intensity = 0.04;
      if (this.dialWarmLight) this.dialWarmLight.intensity = 0.6;
      if (this.escapementRubyLight) this.escapementRubyLight.intensity = 0.0;
      if (this.indexGlowMaterial) this.indexGlowMaterial.emissiveIntensity = 0.08;
      if (this.rubyJewelMaterial) this.rubyJewelMaterial.emissiveIntensity = 0.2;
      if (this.volumetricBeamMaterial) {
        this.volumetricBeamMaterial.uniforms.uOpacity.value = 0.0;
      }
      if (this.bokehDustMaterial) {
        this.bokehDustMaterial.uniforms.uOpacity.value = 0.0;
      }
      this.stage.setBloomParameters({ threshold: 1.45, strength: 0.1, radius: 0.3 });
      this.stage.setToneMappingExposure(0.28);
      this.stage.setEnvironmentIntensity(0.16);
    } else {
      // 'active' or 'silent'
      if (this.overheadSpotlight) this.overheadSpotlight.intensity = 65.0;
      if (this.dialKeySpotlight) this.dialKeySpotlight.intensity = 28.0;
      if (this.ambientLight) this.ambientLight.intensity = 0.28;
      if (this.dialWarmLight) this.dialWarmLight.intensity = 9.5;
      if (this.escapementRubyLight) this.escapementRubyLight.intensity = 3.8;
      if (this.indexGlowMaterial) this.indexGlowMaterial.emissiveIntensity = 2.1;
      if (this.rubyJewelMaterial) this.rubyJewelMaterial.emissiveIntensity = 2.5;
      if (this.volumetricBeamMaterial) {
        this.volumetricBeamMaterial.uniforms.uOpacity.value = 0.065;
      }
      if (this.bokehDustMaterial) {
        this.bokehDustMaterial.uniforms.uOpacity.value = 0.25;
      }
      this.stage.setBloomParameters({ threshold: 1.45, strength: 0.28, radius: 0.4 });
      this.stage.setToneMappingExposure(0.96);
      this.stage.setEnvironmentIntensity(0.92);
    }
  }

  public renderPendulum(_ctx: CanvasRenderingContext2D, physicsData: PhysicsData): void {
    if (!this.isMounted || !this.stage) return;

    if (this.currentMode === 'sleep') {
      this.brakeFactor = Math.min(this.brakeFactor * 0.9, physicsData.dampingFactor);
      if (this.brakeFactor < 0.002) this.brakeFactor = 0;
    } else {
      this.brakeFactor = physicsData.dampingFactor;
    }

    const dampedAngleRad = physicsData.angleRad * this.brakeFactor;
    this.lastPhysicsAngleRad = dampedAngleRad;

    if (this.pendulumPivotGroup) {
      this.pendulumPivotGroup.rotation.z = dampedAngleRad;
    }

    if (this.overheadSpotlight) {
      const baseIntensity =
        this.currentMode === 'night' ? 18.0 : this.currentMode === 'sleep' ? 3.5 : 65.0;
      this.overheadSpotlight.intensity = physicsData.dimmed ? baseIntensity * 0.35 : baseIntensity;
    }
  }

  public renderDial(_ctx: CanvasRenderingContext2D, timeData: TimeData): void {
    if (!this.isMounted || !this.stage) return;

    const dtSec = Math.max(0.001, Math.min(0.25, timeData.deltaTimeSec || 0.016));
    if (this.currentMode === 'sleep') {
      this.brakeFactor = Math.max(0, this.brakeFactor - dtSec * 0.45);
      if (this.pendulumPivotGroup) {
        this.pendulumPivotGroup.rotation.z = this.lastPhysicsAngleRad * this.brakeFactor;
      }
    } else if (this.brakeFactor < 1.0) {
      this.brakeFactor = Math.min(1.0, this.brakeFactor + dtSec * 0.5);
    }

    // 0. Subtle Breathing Parallax Camera (±3.5° on X and ±2.0° on Y over ~25s cycle + pointer tilt)
    this.cameraPhaseSec += dtSec * this.brakeFactor;
    this.pointerCurrentX += (this.pointerTargetX - this.pointerCurrentX) * Math.min(1, dtSec * 4.5);
    this.pointerCurrentY += (this.pointerTargetY - this.pointerCurrentY) * Math.min(1, dtSec * 4.5);

    const swayDegX =
      Math.sin((this.cameraPhaseSec * Math.PI * 2) / 25.0) * 3.5 * this.brakeFactor +
      this.pointerCurrentX * 2.2 * this.brakeFactor;
    const swayDegY =
      Math.cos((this.cameraPhaseSec * Math.PI * 2) / 19.5) * 2.0 * this.brakeFactor +
      this.pointerCurrentY * 1.4 * this.brakeFactor;

    const swayRadX = THREE.MathUtils.degToRad(swayDegX);
    const swayRadY = THREE.MathUtils.degToRad(swayDegY);
    const camDist = this.stage.baseCameraZ;
    const camX = Math.sin(swayRadX) * camDist;
    const camY = Math.sin(swayRadY) * camDist;
    const camZ = Math.cos(swayRadX) * Math.cos(swayRadY) * camDist;

    this.stage.camera.position.set(camX, camY, camZ);
    this.stage.camera.lookAt(0, 0.15, -1.65);

    // 1. Update Extruded Cathedral Hour, Minute, and Heat-Blued Second Hands
    const hourRad = -THREE.MathUtils.degToRad(timeData.angles.hour);
    const minuteRad = -THREE.MathUtils.degToRad(timeData.angles.minute);
    const secondRad = -THREE.MathUtils.degToRad(timeData.angles.second);

    if (this.hourHandPivot) this.hourHandPivot.rotation.z = hourRad;
    if (this.minuteHandPivot) this.minuteHandPivot.rotation.z = minuteRad;
    if (this.secondHandPivot) this.secondHandPivot.rotation.z = secondRad;

    // 2. Advance Tilted Tri-Axial Tourbillon Cage & 2.5 Hz Balance Wheel / Hairspring / Ruby Impulse
    const simDeltaSec =
      this.lastTickTimestampMs !== null
        ? Math.max(0, (timeData.timestampMs - this.lastTickTimestampMs) / 1000)
        : dtSec;
    this.lastTickTimestampMs = timeData.timestampMs;

    this.tourbillonPhaseSec += simDeltaSec * this.brakeFactor;
    const tSec = this.tourbillonPhaseSec;

    if (this.tourbillonOuterGimbal && this.tourbillonMidGimbal && this.tourbillonInnerCage) {
      this.tourbillonOuterGimbal.rotation.z = -((tSec / 60) * Math.PI * 2);
      this.tourbillonMidGimbal.rotation.x = (tSec / 24) * Math.PI * 2;
      this.tourbillonInnerCage.rotation.y = (tSec / 16) * Math.PI * 2;
    }

    // 2.5 Hz (5 beats per second) balance wheel oscillation & hairspring breathing
    const freq25Hz = 2.5;
    const omega25 = Math.PI * 2 * freq25Hz;
    const balanceOsc = Math.sin(omega25 * tSec) * this.brakeFactor;

    if (this.balanceWheelGroup) {
      this.balanceWheelGroup.rotation.z = balanceOsc * 1.25;
    }
    if (this.hairspringMesh) {
      const breathScale = 1.0 + 0.09 * balanceOsc;
      this.hairspringMesh.scale.set(breathScale, breathScale, 1.0);
    }
    if (this.rubyJewelMesh && this.rubyJewelMaterial) {
      const impulseBeat = Math.pow(Math.abs(Math.cos(omega25 * tSec)), 6) * this.brakeFactor;
      const baseEmissive =
        this.currentMode === 'night' ? 1.4 : this.currentMode === 'sleep' ? 0.2 : 2.5;
      this.rubyJewelMaterial.emissiveIntensity =
        baseEmissive + impulseBeat * 0.85 + this.alertPulseBoost;
    }

    // 3. 4-Plane Beveled Gear Train Meshing with Seconds / Minutes Ratio
    const gear1Angle = secondRad;
    const gear2Angle = -gear1Angle * (30 / 36) + 0.08;
    const gear3Angle = minuteRad;
    const gear4Angle = -minuteRad * (45 / 54);

    if (this.gearPlane1Seconds) this.gearPlane1Seconds.rotation.z = gear1Angle;
    if (this.gearPlane2Idler) this.gearPlane2Idler.rotation.z = gear2Angle;
    if (this.gearPlane3Minute) this.gearPlane3Minute.rotation.z = gear3Angle;
    if (this.gearPlane4Barrel) this.gearPlane4Barrel.rotation.z = gear4Angle;

    // 4. Weekly Descending Brass Counterweights & Sunday Midnight Smooth Rewind
    const weightProgress = computeCounterweightProgress(timeData.date);
    this.lastCounterweightProgress = weightProgress;

    const topWeightY = 5.1;
    const bottomWeightY = -6.4;
    const pulleyY = 6.8;
    const flankX = 3.65;
    const weightZ = -2.05;
    const currentWeightY = topWeightY - weightProgress * (topWeightY - bottomWeightY);
    const cableLen = Math.max(0.4, pulleyY - (currentWeightY + 0.85));
    const cableCenterY = pulleyY - cableLen * 0.5;

    if (this.leftWeightGroup) this.leftWeightGroup.position.y = currentWeightY;
    if (this.rightWeightGroup) this.rightWeightGroup.position.y = currentWeightY;

    if (this.leftCableMesh) {
      this.leftCableMesh.scale.set(1, cableLen, 1);
      this.leftCableMesh.position.set(-flankX, cableCenterY, weightZ);
    }
    if (this.rightCableMesh) {
      this.rightCableMesh.scale.set(1, cableLen, 1);
      this.rightCableMesh.position.set(flankX, cableCenterY, weightZ);
    }

    const pulleyAngle = weightProgress * Math.PI * 12;
    if (this.leftPulleyGear) this.leftPulleyGear.rotation.z = pulleyAngle;
    if (this.rightPulleyGear) this.rightPulleyGear.rotation.z = -pulleyAngle;

    // 5. Update Volumetric Beam & Golden Bokeh Dust Mote Shaders
    if (this.volumetricBeamMaterial) {
      this.volumetricBeamMaterial.uniforms.uTime.value = tSec;
    }
    if (this.bokehDustMaterial) {
      this.bokehDustMaterial.uniforms.uTime.value = tSec;
    }

    if (this.dustParticles && this.dustVelocities && this.brakeFactor > 0.01) {
      const posAttr = this.dustParticles.geometry.getAttribute(
        'position'
      ) as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const count = posAttr.count;
      const step = dtSec * this.brakeFactor;

      for (let i = 0; i < count; i++) {
        const ix = i * 3;
        arr[ix] += this.dustVelocities[ix] * step;
        arr[ix + 1] += this.dustVelocities[ix + 1] * step;
        arr[ix + 2] += this.dustVelocities[ix + 2] * step;

        if (arr[ix + 1] > 7.5) arr[ix + 1] = -7.5;
        if (arr[ix] > 3.8) arr[ix] = -3.8;
        if (arr[ix] < -3.8) arr[ix] = 3.8;
      }
      posAttr.needsUpdate = true;
    }

    if (this.alertPulseBoost > 0) {
      this.alertPulseBoost = Math.max(0, this.alertPulseBoost - dtSec * 1.5);
    }

    // Throttle 3D GPU render pass in sleep mode once braked to rest
    if (this.currentMode === 'sleep' && this.brakeFactor <= 0.001) {
      if (timeData.realTimeMs - this.lastSleepRenderTimeMs < 950) {
        return;
      }
      this.lastSleepRenderTimeMs = timeData.realTimeMs;
    }

    if (this.dialGroup) {
      const offset = ThreeStage.dialCenterToOffsetWorld(
        this.manifest.dial.center.x,
        this.manifest.dial.center.y
      );
      this.dialGroup.position.x = this.dialBasePos.x + offset.x;
      this.dialGroup.position.y = this.dialBasePos.y + offset.y;
    }
    this.stage.render();
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, telemetryData: TelemetryData): void {
    if (!this.isMounted) return;

    if (telemetryData.mode && telemetryData.mode !== this.currentMode) {
      this.currentMode = telemetryData.mode;
      this.applyModeLighting();
    }

    if (telemetryData.isSleeping) {
      return;
    }

    // Subtle engraved brass horological plaque on the 2D HUD layer
    ctx.save();
    ctx.fillStyle = 'rgba(18, 10, 6, 0.78)';
    ctx.strokeStyle = 'rgba(217, 168, 78, 0.42)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(290, 1840, 500, 38, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = '600 13px "Georgia", "Times New Roman", serif';
    ctx.fillStyle = '#ecc97e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const wsStatusText = telemetryData.wsStatus === 'connected' ? 'CHRONO-SYNC' : 'AUTONOMOUS';
    ctx.fillText(
      `HOROLOGICAL TOURBILLON 3D  •  2.5 HZ CAGE  •  ${wsStatusText}  •  ${telemetryData.fps.toFixed(0)} FPS`,
      540,
      1859
    );
    ctx.restore();
  }

  public onEvent(event: ThemeEvent): void {
    if (!this.isMounted) return;

    if (event.type === 'mode_change' && event.payload) {
      const nextMode = (event.payload as { mode?: ClockMode }).mode;
      if (nextMode) {
        this.currentMode = nextMode;
        this.applyModeLighting();
      }
    } else if (
      event.type === 'notification' ||
      event.type === 'priority_alert' ||
      event.type === 'mqtt_pulse'
    ) {
      this.alertPulseBoost = event.priority === 'urgent' ? 2.2 : 1.2;
    }
  }

  public destroy(): void {
    this.isMounted = false;
    this.cleanupPointerParallax();
    if (this.stage) {
      this.stage.dispose();
      this.stage = null;
    }
    this.ambientLight = null;
    this.overheadSpotlight = null;
    this.dialKeySpotlight = null;
    this.dialWarmLight = null;
    this.escapementRubyLight = null;
    this.indexGlowMaterial = null;
    this.rubyJewelMaterial = null;
    this.volumetricBeamMaterial = null;
    this.bokehDustMaterial = null;
    this.hourHandPivot = null;
    this.minuteHandPivot = null;
    this.secondHandPivot = null;
    this.tourbillonOuterGimbal = null;
    this.tourbillonMidTiltGroup = null;
    this.tourbillonMidGimbal = null;
    this.tourbillonInnerTiltGroup = null;
    this.tourbillonInnerCage = null;
    this.balanceWheelGroup = null;
    this.hairspringMesh = null;
    this.rubyJewelMesh = null;
    this.gearPlane1Seconds = null;
    this.gearPlane2Idler = null;
    this.gearPlane3Minute = null;
    this.gearPlane4Barrel = null;
    this.leftPulleyGear = null;
    this.rightPulleyGear = null;
    this.leftWeightGroup = null;
    this.rightWeightGroup = null;
    this.leftCableMesh = null;
    this.rightCableMesh = null;
    this.pendulumPivotGroup = null;
    this.dustParticles = null;
    this.dustVelocities = null;
  }
}
