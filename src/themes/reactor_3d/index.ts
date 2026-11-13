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
  createTitaniumBulkheadMaps,
  createPlasmaCoreMaterial,
  createCoolantParticleMaterial,
  createReactorHandGeometry,
  createReactorHandEdgeTrimGeometry,
  createReactorSecondHandGeometry,
  createInductionCoilGeometry,
  createDynamicArcBoltGeometry,
  updateDynamicArcBoltGeometry
} from './geometries';

export const REACTOR_3D_MANIFEST: ThemeManifest = {
  name: 'Chrono-Containment Reactor',
  version: '1.0.0',
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

export interface ReactorDebugState {
  mode: ClockMode;
  targetMode: ClockMode;
  brakeFactor: number;
  coreColorHex: string;
  coreEmissiveIntensity: number;
  indexEmissiveIntensity: number;
  coolantEmissiveIntensity: number;
  secondHandEmissiveIntensity: number;
  titaniumEmissiveIntensity: number;
  copperEmissiveIntensity: number;
  gimbalAnglesRad: [number, number, number];
  gimbalTiltDeg: [number, number];
  servoPulseAngleRad: number;
  servoLastSecond: number;
  servoWristLedIntensity: number;
  servoArmRimLightIntensity: number;
  pendulumAngleRad: number;
  arcFlashIntensity: number;
  arcLightIntensity: number;
  arcLightPosition: [number, number, number];
  rimLightIntensity: number;
  cameraPosition: [number, number, number];
  bloomThreshold: number;
}

const ARC_SEGMENTS = 10;
const ARC_RADIAL_SIDES = 6;
const PENDULUM_TIP_RADIUS = 7.4;

const COLOR_ACTIVE_CYAN = new THREE.Color(0x00e5ff);
const COLOR_ACTIVE_RIM = new THREE.Color(0x68f8ff);
const COLOR_NIGHT_CRIMSON = new THREE.Color(0xff1e38);
const COLOR_NIGHT_RIM = new THREE.Color(0xff5268);
const COLOR_SLEEP_EMBER = new THREE.Color(0x180408);

function wrapSignedAngle(rad: number): number {
  const twoPi = Math.PI * 2;
  let a = ((rad % twoPi) + twoPi) % twoPi;
  if (a > Math.PI) a -= twoPi;
  return a;
}

export class Reactor3DTheme implements Theme {
  public readonly id = 'reactor_3d';
  public readonly name = 'Chrono-Containment Reactor';

  private manifest: ThemeManifest = structuredClone(REACTOR_3D_MANIFEST);
  private stage: ThreeStage | null = null;
  private isMounted = false;
  private currentMode: ClockMode = 'active';
  private targetMode: ClockMode = 'active';

  // Smooth mechanical & magnetic braking factor (1.0 = full power, 0.0 = magnetic shutdown)
  private brakeFactor = 1.0;
  private lastSleepRenderTimeMs = 0;

  // Breathing camera parallax & desktop pointer tilt state
  private cameraPhaseSec = 0;
  private pointerTargetX = 0;
  private pointerTargetY = 0;
  private pointerCurrentX = 0;
  private pointerCurrentY = 0;
  private boundOnPointerMove: ((e: PointerEvent) => void) | null = null;

  // Smooth mode transition color & intensity states
  private currentCoreColor = COLOR_ACTIVE_CYAN.clone();
  private currentRimColor = COLOR_ACTIVE_RIM.clone();
  private currentCoreIntensity = 2.0;
  private currentIndexIntensity = 2.15;
  private currentCoolantIntensity = 1.95;
  private currentSecondIntensity = 2.25;
  private currentRimLightIntensity = 88.0;
  private currentServoRimLightIntensity = 36.0;
  private currentCoreLightIntensity = 16.0;
  private currentExposure = 0.96;
  private currentEnvIntensity = 0.92;
  private currentBloomStrength = 0.3;

  // Lighting
  private ambientLight: THREE.AmbientLight | null = null;
  private overheadRimSpot: THREE.SpotLight | null = null;
  private grazingCyanRimSpot: THREE.SpotLight | null = null;
  private servoArmRimSpot: THREE.SpotLight | null = null;
  private coreGlowLight: THREE.PointLight | null = null;
  private arcFlashLight: THREE.PointLight | null = null;

  // Tracked structural & emissive materials
  private titaniumMaterial: THREE.MeshStandardMaterial | null = null;
  private copperMaterial: THREE.MeshStandardMaterial | null = null;
  private tungstenMaterial: THREE.MeshStandardMaterial | null = null;
  private plasmaCoreMaterial: THREE.ShaderMaterial | null = null;
  private indexGlowMaterial: THREE.MeshStandardMaterial | null = null;
  private handTipGlowMaterial: THREE.MeshStandardMaterial | null = null;
  private secondHandGlowMaterial: THREE.MeshStandardMaterial | null = null;
  private coolantCoreGlowMaterial: THREE.MeshStandardMaterial | null = null;
  private coolantParticleMaterial: THREE.ShaderMaterial | null = null;
  private servoWristLedMaterial: THREE.MeshStandardMaterial | null = null;
  private arcFlashMaterial: THREE.MeshBasicMaterial | null = null;
  private arcHaloMaterial: THREE.MeshBasicMaterial | null = null;

  // Upper Zone: Tokamak Core, 3 Tilted Counter-Rotating Gimbal Rings, Dial Hands
  private plasmaCoreGroup: THREE.Group | null = null;
  private gimbalOuterGroup: THREE.Group | null = null;
  private gimbalMidTiltGroup: THREE.Group | null = null;
  private gimbalMidGroup: THREE.Group | null = null;
  private gimbalInnerTiltGroup: THREE.Group | null = null;
  private gimbalInnerGroup: THREE.Group | null = null;
  private hourHandPivot: THREE.Group | null = null;
  private minuteHandPivot: THREE.Group | null = null;
  private secondHandPivot: THREE.Group | null = null;

  // Mid Zone: Left & Right Coolant Tubes + Rising Particles + Right Multi-Axis Servo Escapement
  private leftCoolantParticles: THREE.Points | null = null;
  private rightCoolantParticles: THREE.Points | null = null;
  private coolantParticleSpeeds: Float32Array | null = null;
  private servoShoulderPivot: THREE.Group | null = null;
  private servoElbowPivot: THREE.Group | null = null;
  private servoClawPivot: THREE.Group | null = null;
  private servoRatchetWheel: THREE.Mesh | null = null;
  private lastServoSecond = -1;
  private servoPulseProgress = 0;
  private servoStepCount = 0;

  // Lower Zone: Copper-Wound Magnetic Induction Pendulum + Stator Anvil + Dynamic Plasma Arc
  private pendulumPivotGroup: THREE.Group | null = null;
  private arcFlashGroup: THREE.Group | null = null;
  private arcCoreGeometry: THREE.BufferGeometry | null = null;
  private arcHaloGeometry: THREE.BufferGeometry | null = null;
  private pendulumPivotWorld = new THREE.Vector3(0, 1.0, -1.65);
  private electrodeTipWorld = new THREE.Vector3(0, -6.82, -1.65);
  private arcFlashIntensity = 0;
  private prevPendulumAngleDeg: number | null = null;
  private lastPhysicsAngleRad = 0;

  // Phase & timing state
  private reactorPhaseSec = 0;
  private lastTickTimestampMs: number | null = null;
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

  public getDebugState(): ReactorDebugState {
    const camPos = this.stage?.camera.position;
    const bloom = this.stage?.getBloomParameters();
    return {
      mode: this.currentMode,
      targetMode: this.targetMode,
      brakeFactor: this.brakeFactor,
      coreColorHex: `#${this.currentCoreColor.getHexString()}`,
      coreEmissiveIntensity: this.currentCoreIntensity,
      indexEmissiveIntensity: this.indexGlowMaterial?.emissiveIntensity ?? 0,
      coolantEmissiveIntensity: this.coolantCoreGlowMaterial?.emissiveIntensity ?? 0,
      secondHandEmissiveIntensity: this.secondHandGlowMaterial?.emissiveIntensity ?? 0,
      titaniumEmissiveIntensity: this.titaniumMaterial?.emissiveIntensity ?? 0,
      copperEmissiveIntensity: this.copperMaterial?.emissiveIntensity ?? 0,
      gimbalAnglesRad: [
        this.gimbalOuterGroup?.rotation.z ?? 0,
        this.gimbalMidGroup?.rotation.x ?? 0,
        this.gimbalInnerGroup?.rotation.y ?? 0
      ],
      gimbalTiltDeg: [
        THREE.MathUtils.radToDeg(this.gimbalMidTiltGroup?.rotation.z ?? 0),
        THREE.MathUtils.radToDeg(this.gimbalInnerTiltGroup?.rotation.x ?? 0)
      ],
      servoPulseAngleRad: this.servoElbowPivot?.rotation.z ?? 0,
      servoLastSecond: this.lastServoSecond,
      servoWristLedIntensity: this.servoWristLedMaterial?.emissiveIntensity ?? 0,
      servoArmRimLightIntensity: this.servoArmRimSpot?.intensity ?? 0,
      pendulumAngleRad: this.pendulumPivotGroup?.rotation.z ?? 0,
      arcFlashIntensity: this.arcFlashIntensity,
      arcLightIntensity: this.arcFlashLight?.intensity ?? 0,
      arcLightPosition: this.arcFlashLight
        ? [
            this.arcFlashLight.position.x,
            this.arcFlashLight.position.y,
            this.arcFlashLight.position.z
          ]
        : [0, -6.78, -1.48],
      rimLightIntensity: this.overheadRimSpot?.intensity ?? 0,
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
      this.manifest = structuredClone(REACTOR_3D_MANIFEST);
    }

    this.isMounted = true;
    this.brakeFactor = this.currentMode === 'sleep' ? 0.0 : 1.0;
    this.lastTickTimestampMs = null;
    this.lastServoSecond = -1;
    this.servoPulseProgress = 0;
    this.prevPendulumAngleDeg = null;
    this.arcFlashIntensity = 0;

    const stage = new ThreeStage({
      width: config?.width ?? 1080,
      height: config?.height ?? 1920,
      fov: 30,
      chamberDepth: 5.0,
      stageElement: config?.stageElement,
      bloomThreshold: 1.45,
      bloomStrength: 0.3,
      bloomRadius: 0.42
    });
    this.stage = stage;

    await stage.init();
    if (!this.isMounted || this.stage !== stage) {
      stage.dispose();
      return;
    }

    stage.scene.background = new THREE.Color(0x05070b);
    this.setupPointerParallax();
    this.buildSceneGraph(stage);
    this.applyModeTargets(true);
    stage.render();
  }

  private setupPointerParallax(): void {
    this.cleanupPointerParallax();
    if (typeof window === 'undefined') return;

    this.boundOnPointerMove = (e: PointerEvent) => {
      if (this.targetMode === 'sleep') return;
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

    // --- Brushed Gunmetal Titanium (#232730) & Aged Copper (#b86b35) Materials ---
    const bulkheadMaps = createTitaniumBulkheadMaps(256, 512);
    stage.trackTexture(bulkheadMaps.map);
    stage.trackTexture(bulkheadMaps.normalMap);
    stage.trackTexture(bulkheadMaps.roughnessMap);

    const cloneMaps = (rx: number, ry: number) => {
      const map = stage.trackTexture(bulkheadMaps.map.clone());
      map.repeat.set(rx, ry);
      map.needsUpdate = true;

      const normalMap = stage.trackTexture(bulkheadMaps.normalMap.clone());
      normalMap.repeat.set(rx, ry);
      normalMap.needsUpdate = true;

      const roughnessMap = stage.trackTexture(bulkheadMaps.roughnessMap.clone());
      roughnessMap.repeat.set(rx, ry);
      roughnessMap.needsUpdate = true;

      return { map, normalMap, roughnessMap };
    };

    const backMaps = cloneMaps(2.0, 2.0);
    const titaniumBackMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        map: backMaps.map,
        normalMap: backMaps.normalMap,
        normalScale: new THREE.Vector2(1.1, 1.1),
        roughnessMap: backMaps.roughnessMap,
        color: 0x232730,
        metalness: 0.86,
        roughness: 0.42
      })
    );

    const sideMaps = cloneMaps(0.9, 2.0);
    const titaniumSideMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        map: sideMaps.map,
        normalMap: sideMaps.normalMap,
        normalScale: new THREE.Vector2(1.0, 1.0),
        roughnessMap: sideMaps.roughnessMap,
        color: 0x1e222b,
        metalness: 0.86,
        roughness: 0.44
      })
    );

    // Strictly non-emissive structural metals so only core, coolant & indices trigger HDR bloom (>= 1.45)
    this.titaniumMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x232730,
        metalness: 0.88,
        roughness: 0.34,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0.0
      })
    );

    this.copperMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xb86b35,
        metalness: 0.86,
        roughness: 0.3,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0.0
      })
    );

    this.tungstenMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x191c23,
        metalness: 0.92,
        roughness: 0.25,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0.0
      })
    );

    const borosilicateGlassMaterial = stage.trackMaterial(
      new THREE.MeshPhysicalMaterial({
        color: 0xd8f8ff,
        transparent: true,
        opacity: 0.34,
        roughness: 0.06,
        metalness: 0.04,
        transmission: 0.82,
        thickness: 0.22
      })
    );

    // Emissive Cherenkov accents (> 1.45 bloom threshold in active mode)
    this.plasmaCoreMaterial = stage.trackMaterial(createPlasmaCoreMaterial());

    this.indexGlowMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x9cf8ff,
        emissive: new THREE.Color(0x00e5ff),
        emissiveIntensity: 2.15,
        metalness: 0.15,
        roughness: 0.15
      })
    );

    this.handTipGlowMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xb0fbff,
        emissive: new THREE.Color(0x00e5ff),
        emissiveIntensity: 2.1,
        metalness: 0.1,
        roughness: 0.15
      })
    );

    this.secondHandGlowMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xc2fcff,
        emissive: new THREE.Color(0x00f0ff),
        emissiveIntensity: 2.25,
        metalness: 0.15,
        roughness: 0.12
      })
    );

    this.coolantCoreGlowMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x8ef5ff,
        emissive: new THREE.Color(0x00e5ff),
        emissiveIntensity: 1.95,
        metalness: 0.1,
        roughness: 0.18
      })
    );

    this.coolantParticleMaterial = stage.trackMaterial(createCoolantParticleMaterial(0.85));

    this.servoWristLedMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xffaa33,
        emissive: new THREE.Color(0xff9218),
        emissiveIntensity: 0.95,
        metalness: 0.1,
        roughness: 0.14
      })
    );

    this.arcFlashMaterial = stage.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.0, 3.2, 3.8),
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );

    this.arcHaloMaterial = stage.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.0, 1.85, 2.5),
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );

    // =========================================================================
    // 1. GRAZING COOL-CYAN RIM LIGHTING & SHADOW RIG (2048x2048 PCFSoftShadowMap)
    // =========================================================================
    this.ambientLight = new THREE.AmbientLight(0x88b4c8, 0.24);
    scene.add(this.ambientLight);

    this.overheadRimSpot = new THREE.SpotLight(
      0x9eeeff,
      88.0,
      42.0,
      THREE.MathUtils.degToRad(38),
      0.68,
      1.5
    );
    this.overheadRimSpot.position.set(-2.6, 9.5, 4.6);
    this.overheadRimSpot.target.position.set(0.4, -1.5, -2.8);
    this.overheadRimSpot.castShadow = true;
    this.overheadRimSpot.shadow.mapSize.set(
      ThreeStage.SHADOW_MAP_SIZE,
      ThreeStage.SHADOW_MAP_SIZE
    );
    this.overheadRimSpot.shadow.camera.near = 2.0;
    this.overheadRimSpot.shadow.camera.far = 28.0;
    this.overheadRimSpot.shadow.bias = -0.00035;
    scene.add(this.overheadRimSpot);
    scene.add(this.overheadRimSpot.target);

    this.grazingCyanRimSpot = new THREE.SpotLight(
      0x3ee8ff,
      54.0,
      30.0,
      THREE.MathUtils.degToRad(44),
      0.75,
      1.5
    );
    this.grazingCyanRimSpot.position.set(4.1, 4.2, 4.4);
    this.grazingCyanRimSpot.target.position.set(-0.6, 0.2, -3.4);
    scene.add(this.grazingCyanRimSpot);
    scene.add(this.grazingCyanRimSpot.target);

    // Cool-blue grazing rim light illuminating recessed titanium bulkhead ribs & 4 o'clock servo arm
    this.servoArmRimSpot = new THREE.SpotLight(
      0x3888ff,
      36.0,
      26.0,
      THREE.MathUtils.degToRad(42),
      0.78,
      1.5
    );
    this.servoArmRimSpot.position.set(4.35, -1.15, 2.65);
    this.servoArmRimSpot.target.position.set(2.35, 0.55, -2.1);
    scene.add(this.servoArmRimSpot);
    scene.add(this.servoArmRimSpot.target);

    this.coreGlowLight = new THREE.PointLight(0x00e5ff, 16.0, 14.0, 1.5);
    this.coreGlowLight.position.set(0, 4.3, 0.4);
    scene.add(this.coreGlowLight);

    // Under-bob point light right at the central discharge electrode tip
    this.arcFlashLight = new THREE.PointLight(0x00f5ff, 0.0, 7.5, 1.5);
    this.arcFlashLight.position.set(0, -6.78, -1.48);
    scene.add(this.arcFlashLight);

    // =========================================================================
    // 2. CHAMBER BULKHEAD (RECESSED TITANIUM WALLS, RIBS, HEX FASTENERS, BUSBARS)
    // =========================================================================
    const chamberGroup = new THREE.Group();
    const outerW = 10.8;
    const outerH = 19.2;
    const chamberD = 4.2;

    const backplateMesh = new THREE.Mesh(
      new THREE.BoxGeometry(outerW, outerH, 0.36),
      titaniumBackMaterial
    );
    backplateMesh.position.set(0, 0, -chamberD);
    backplateMesh.receiveShadow = true;
    chamberGroup.add(backplateMesh);

    const splayLR = THREE.MathUtils.degToRad(14);
    const splayTB = THREE.MathUtils.degToRad(12);
    const wallSlabT = 0.52;

    const leftWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallSlabT, outerH, chamberD + 0.4),
      titaniumSideMaterial
    );
    leftWall.position.set(-outerW * 0.5 + 0.52, 0, -chamberD * 0.5);
    leftWall.rotation.y = splayLR;
    leftWall.receiveShadow = true;
    chamberGroup.add(leftWall);

    const rightWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallSlabT, outerH, chamberD + 0.4),
      titaniumSideMaterial
    );
    rightWall.position.set(outerW * 0.5 - 0.52, 0, -chamberD * 0.5);
    rightWall.rotation.y = -splayLR;
    rightWall.receiveShadow = true;
    chamberGroup.add(rightWall);

    const topWall = new THREE.Mesh(
      new THREE.BoxGeometry(outerW, wallSlabT, chamberD + 0.4),
      titaniumSideMaterial
    );
    topWall.position.set(0, outerH * 0.5 - 0.5, -chamberD * 0.5);
    topWall.rotation.x = -splayTB;
    topWall.receiveShadow = true;
    chamberGroup.add(topWall);

    const bottomWall = new THREE.Mesh(
      new THREE.BoxGeometry(outerW, wallSlabT, chamberD + 0.4),
      titaniumSideMaterial
    );
    bottomWall.position.set(0, -outerH * 0.5 + 0.5, -chamberD * 0.5);
    bottomWall.rotation.x = splayTB;
    bottomWall.receiveShadow = true;
    chamberGroup.add(bottomWall);

    // Horizontal & vertical structural titanium ribs + hex fasteners
    const ribGeoH = new THREE.BoxGeometry(outerW - 1.2, 0.34, 0.48);
    const hexFastenerGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.14, 6);
    hexFastenerGeo.rotateX(Math.PI * 0.5);

    for (const ry of [8.2, 1.0, -2.2, -7.8]) {
      const rib = new THREE.Mesh(ribGeoH, this.titaniumMaterial);
      rib.position.set(0, ry, -chamberD + 0.32);
      rib.castShadow = true;
      rib.receiveShadow = true;
      chamberGroup.add(rib);

      for (const fx of [-4.0, -2.4, 0, 2.4, 4.0]) {
        const bolt = new THREE.Mesh(hexFastenerGeo, this.copperMaterial);
        bolt.position.set(fx, ry, -chamberD + 0.58);
        chamberGroup.add(bolt);
      }
    }

    const ribGeoV = new THREE.BoxGeometry(0.32, outerH - 1.6, 0.42);
    for (const rx of [-4.35, 4.35]) {
      const vRib = new THREE.Mesh(ribGeoV, this.titaniumMaterial);
      vRib.position.set(rx, 0, -chamberD + 0.3);
      vRib.castShadow = true;
      vRib.receiveShadow = true;
      chamberGroup.add(vRib);

      for (let fy = -7.2; fy <= 7.2; fy += 2.4) {
        const bolt = new THREE.Mesh(hexFastenerGeo, this.copperMaterial);
        bolt.position.set(rx, fy, -chamberD + 0.54);
        chamberGroup.add(bolt);
      }
    }

    // Vertical aged-copper high-current busbars + titanium clamp brackets
    const busbarGeo = new THREE.BoxGeometry(0.18, outerH - 2.4, 0.22);
    const clampGeo = new THREE.BoxGeometry(0.34, 0.22, 0.32);
    for (const bx of [-3.05, -2.72, 2.72, 3.05]) {
      const busbar = new THREE.Mesh(busbarGeo, this.copperMaterial);
      busbar.position.set(bx, 0, -chamberD + 0.62);
      busbar.castShadow = true;
      busbar.receiveShadow = true;
      chamberGroup.add(busbar);

      for (const cy of [-5.8, -1.6, 2.6, 6.8]) {
        const clamp = new THREE.Mesh(clampGeo, this.tungstenMaterial);
        clamp.position.set(bx, cy, -chamberD + 0.64);
        clamp.castShadow = true;
        chamberGroup.add(clamp);
      }
    }

    // Outer chamfered titanium bulkhead bezel frame
    const innerW = outerW - 0.68;
    const innerH = outerH - 0.68;
    const trimW = 0.28;
    const trimD = 0.34;
    const topTrim = new THREE.Mesh(new THREE.BoxGeometry(innerW + trimW * 2, trimW, trimD), this.titaniumMaterial);
    topTrim.position.set(0, innerH * 0.5, -0.18);
    chamberGroup.add(topTrim);
    const botTrim = new THREE.Mesh(new THREE.BoxGeometry(innerW + trimW * 2, trimW, trimD), this.titaniumMaterial);
    botTrim.position.set(0, -innerH * 0.5, -0.18);
    chamberGroup.add(botTrim);
    const leftTrim = new THREE.Mesh(new THREE.BoxGeometry(trimW, innerH, trimD), this.titaniumMaterial);
    leftTrim.position.set(-innerW * 0.5, 0, -0.18);
    chamberGroup.add(leftTrim);
    const rightTrim = new THREE.Mesh(new THREE.BoxGeometry(trimW, innerH, trimD), this.titaniumMaterial);
    rightTrim.position.set(innerW * 0.5, 0, -0.18);
    chamberGroup.add(rightTrim);

    scene.add(chamberGroup);

    // =========================================================================
    // 3. UPPER ZONE: TOKAMAK DIAL, PLASMA CORE & 3 COUNTER-ROTATING GIMBALS
    // =========================================================================
    const dialWorld = ThreeStage.canvasToWorldXY(
      this.manifest.dial.center.x,
      this.manifest.dial.center.y
    );
    const dialGroup = new THREE.Group();
    dialGroup.position.set(dialWorld.x, dialWorld.y, -0.62);

    // Dark-titanium dial housing ring & recessed copper stator ring
    const outerDialRing = new THREE.Mesh(
      new THREE.TorusGeometry(4.08, 0.24, 24, 80),
      this.titaniumMaterial
    );
    outerDialRing.castShadow = true;
    outerDialRing.receiveShadow = true;
    dialGroup.add(outerDialRing);

    const innerCopperTrack = new THREE.Mesh(
      new THREE.TorusGeometry(3.26, 0.085, 18, 64),
      this.copperMaterial
    );
    innerCopperTrack.castShadow = true;
    dialGroup.add(innerCopperTrack);

    // Structural titanium support bridge across dial aperture
    const containmentBridge = new THREE.Mesh(
      new THREE.BoxGeometry(6.4, 0.26, 0.18),
      this.titaniumMaterial
    );
    containmentBridge.position.set(0, 0, -0.34);
    containmentBridge.castShadow = true;
    dialGroup.add(containmentBridge);

    // 12 Cherenkov-lit hour markers encapsulated in titanium/borosilicate housings
    const markerHousingGeo = new THREE.BoxGeometry(0.24, 0.72, 0.2);
    const markerCoreGeo = new THREE.CylinderGeometry(0.044, 0.044, 0.56, 14);
    const markerGlassGeo = new THREE.CylinderGeometry(0.068, 0.068, 0.6, 16);

    for (let h = 0; h < 12; h++) {
      const angle = (h / 12) * Math.PI * 2;
      const r = 3.66;
      const markerGroup = new THREE.Group();
      markerGroup.position.set(Math.sin(angle) * r, Math.cos(angle) * r, 0.12);
      markerGroup.rotation.z = -angle;

      const housing = new THREE.Mesh(markerHousingGeo, this.titaniumMaterial);
      housing.castShadow = true;
      markerGroup.add(housing);

      const glowCore = new THREE.Mesh(markerCoreGeo, this.indexGlowMaterial);
      glowCore.position.z = 0.095;
      markerGroup.add(glowCore);

      const sleeve = new THREE.Mesh(markerGlassGeo, borosilicateGlassMaterial);
      sleeve.position.z = 0.1;
      markerGroup.add(sleeve);

      dialGroup.add(markerGroup);
    }

    // 60 Aged-copper minute ticks
    const minTickGeo = new THREE.BoxGeometry(0.045, 0.2, 0.09);
    for (let m = 0; m < 60; m++) {
      if (m % 5 === 0) continue;
      const angle = (m / 60) * Math.PI * 2;
      const r = 3.82;
      const tick = new THREE.Mesh(minTickGeo, this.copperMaterial);
      tick.position.set(Math.sin(angle) * r, Math.cos(angle) * r, 0.05);
      tick.rotation.z = -angle;
      dialGroup.add(tick);
    }

    // --- Tokamak Plasma Core + Three Tilted Counter-Rotating Tungsten/Copper Containment Rings ---
    const tokamakRoot = new THREE.Group();
    tokamakRoot.position.set(0, 0, 0.02);

    this.plasmaCoreGroup = new THREE.Group();
    const coreSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.56, 36, 36),
      this.plasmaCoreMaterial
    );
    this.plasmaCoreGroup.add(coreSphere);

    const plasmaTorus = new THREE.Mesh(
      new THREE.TorusGeometry(0.72, 0.13, 20, 48),
      this.plasmaCoreMaterial
    );
    plasmaTorus.rotation.x = THREE.MathUtils.degToRad(68);
    this.plasmaCoreGroup.add(plasmaTorus);
    tokamakRoot.add(this.plasmaCoreGroup);

    const addFieldCoilCollars = (parent: THREE.Group, ringRadius: number, count: number) => {
      const collarGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.18, 12);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const collar = new THREE.Mesh(collarGeo, this.copperMaterial!);
        collar.position.set(Math.cos(a) * ringRadius, Math.sin(a) * ringRadius, 0);
        collar.rotation.z = a;
        collar.castShadow = true;
        parent.add(collar);
      }
    };

    // Gimbal 1 (Outer): Dark tungsten ring with copper field collars rotating around Z
    this.gimbalOuterGroup = new THREE.Group();
    const gimbal1Ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.52, 0.075, 18, 56),
      this.tungstenMaterial
    );
    gimbal1Ring.castShadow = true;
    this.gimbalOuterGroup.add(gimbal1Ring);
    addFieldCoilCollars(this.gimbalOuterGroup, 1.52, 6);

    // Gimbal 2 (Middle): Tilted 26° around Z, counter-rotating around X
    this.gimbalMidTiltGroup = new THREE.Group();
    this.gimbalMidTiltGroup.rotation.z = THREE.MathUtils.degToRad(26);
    this.gimbalMidGroup = new THREE.Group();
    const gimbal2Ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.24, 0.065, 18, 52),
      this.copperMaterial
    );
    gimbal2Ring.castShadow = true;
    this.gimbalMidGroup.add(gimbal2Ring);
    addFieldCoilCollars(this.gimbalMidGroup, 1.24, 4);

    // Gimbal 3 (Inner): Tilted -32° around X, counter-rotating around Y
    this.gimbalInnerTiltGroup = new THREE.Group();
    this.gimbalInnerTiltGroup.rotation.x = THREE.MathUtils.degToRad(-32);
    this.gimbalInnerGroup = new THREE.Group();
    const gimbal3Ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.98, 0.054, 16, 44),
      this.tungstenMaterial
    );
    gimbal3Ring.castShadow = true;
    this.gimbalInnerGroup.add(gimbal3Ring);
    addFieldCoilCollars(this.gimbalInnerGroup, 0.98, 4);

    this.gimbalInnerTiltGroup.add(this.gimbalInnerGroup);
    this.gimbalMidGroup.add(this.gimbalInnerTiltGroup);
    this.gimbalMidTiltGroup.add(this.gimbalMidGroup);
    this.gimbalOuterGroup.add(this.gimbalMidTiltGroup);
    tokamakRoot.add(this.gimbalOuterGroup);
    dialGroup.add(tokamakRoot);

    // --- Skeletonized Dark Titanium Hands with Luminous Edge-Trim + Razor-Thin Cyan Second Hand ---
    const buildReactorHand = (
      pivot: THREE.Group,
      length: number,
      width: number,
      thickness: number,
      tipY: number,
      tipLen: number,
      tipW: number
    ) => {
      const body = new THREE.Mesh(
        createReactorHandGeometry(length, width, thickness),
        this.titaniumMaterial!
      );
      body.castShadow = true;
      pivot.add(body);

      const edgeTrim = new THREE.Mesh(
        createReactorHandEdgeTrimGeometry(length, width, thickness * 0.45),
        this.handTipGlowMaterial!
      );
      edgeTrim.position.z = thickness * 0.34;
      pivot.add(edgeTrim);

      const hubCollar = new THREE.Mesh(
        new THREE.CylinderGeometry(width * 0.46, width * 0.5, thickness * 1.3, 18),
        this.copperMaterial!
      );
      hubCollar.rotation.x = Math.PI * 0.5;
      pivot.add(hubCollar);

      const tip = new THREE.Mesh(
        new THREE.BoxGeometry(tipW, tipLen, thickness * 1.15),
        this.handTipGlowMaterial!
      );
      tip.position.set(0, tipY, 0.01);
      pivot.add(tip);
    };

    this.hourHandPivot = new THREE.Group();
    this.hourHandPivot.position.set(0, 0, 0.44);
    buildReactorHand(this.hourHandPivot, 2.45, 0.46, 0.085, 2.1, 0.46, 0.11);
    dialGroup.add(this.hourHandPivot);

    this.minuteHandPivot = new THREE.Group();
    this.minuteHandPivot.position.set(0, 0, 0.56);
    buildReactorHand(this.minuteHandPivot, 3.52, 0.36, 0.076, 3.08, 0.58, 0.085);
    dialGroup.add(this.minuteHandPivot);

    this.secondHandPivot = new THREE.Group();
    this.secondHandPivot.position.set(0, 0, 0.68);
    const secondNeedle = new THREE.Mesh(
      createReactorSecondHandGeometry(3.78, 0.042),
      this.secondHandGlowMaterial
    );
    this.secondHandPivot.add(secondNeedle);
    dialGroup.add(this.secondHandPivot);

    const centerArborCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.2, 0.14, 16),
      this.tungstenMaterial
    );
    centerArborCap.rotation.x = Math.PI * 0.5;
    centerArborCap.position.z = 0.74;
    dialGroup.add(centerArborCap);

    scene.add(dialGroup);

    // =========================================================================
    // 4. MID ZONE: COOLANT CONDUITS (L & R) + MULTI-AXIS SERVO ESCAPEMENT (R)
    // =========================================================================
    const buildCoolantTube = (xPos: number): THREE.Points => {
      const tubeGroup = new THREE.Group();
      tubeGroup.position.set(xPos, 0.35, -1.85);

      const glassCylinder = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.32, 9.6, 24, 1, true),
        borosilicateGlassMaterial
      );
      tubeGroup.add(glassCylinder);

      // Subtle glowing Cherenkov core filament inside tube
      const coreFilament = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.065, 9.2, 12),
        this.coolantCoreGlowMaterial!
      );
      tubeGroup.add(coreFilament);

      // Aged-copper top & bottom manifold caps + titanium retaining rings
      for (const my of [-4.95, 4.95]) {
        const cap = new THREE.Mesh(
          new THREE.CylinderGeometry(0.42, 0.42, 0.42, 16),
          this.copperMaterial!
        );
        cap.position.y = my;
        cap.castShadow = true;
        tubeGroup.add(cap);
      }
      for (const ry of [-2.4, 0, 2.4]) {
        const collar = new THREE.Mesh(
          new THREE.TorusGeometry(0.36, 0.045, 10, 24),
          this.titaniumMaterial!
        );
        collar.rotation.x = Math.PI * 0.5;
        collar.position.y = ry;
        tubeGroup.add(collar);
      }

      scene.add(tubeGroup);

      // Rising Cherenkov coolant particles inside tube
      const pCount = 45;
      const pPositions = new Float32Array(pCount * 3);
      const pScales = new Float32Array(pCount);
      const pPhases = new Float32Array(pCount);
      if (!this.coolantParticleSpeeds) {
        this.coolantParticleSpeeds = new Float32Array(pCount);
      }

      for (let i = 0; i < pCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const rad = Math.random() * 0.2;
        pPositions[i * 3] = xPos + Math.cos(angle) * rad;
        pPositions[i * 3 + 1] = 0.35 + (Math.random() - 0.5) * 9.0;
        pPositions[i * 3 + 2] = -1.85 + Math.sin(angle) * rad;
        pScales[i] = 0.25 + Math.random() * 0.42;
        pPhases[i] = Math.random() * Math.PI * 2;
        this.coolantParticleSpeeds[i] = 0.65 + Math.random() * 0.9;
      }

      const pGeo = stage.trackGeometry(new THREE.BufferGeometry());
      pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
      pGeo.setAttribute('aScale', new THREE.BufferAttribute(pScales, 1));
      pGeo.setAttribute('aPhase', new THREE.BufferAttribute(pPhases, 1));

      const points = new THREE.Points(pGeo, this.coolantParticleMaterial!);
      scene.add(points);
      return points;
    };

    this.leftCoolantParticles = buildCoolantTube(-3.72);
    this.rightCoolantParticles = buildCoolantTube(3.72);

    // Multi-axis robotic escapement arm on right bulkhead indexing once per second
    const servoRoot = new THREE.Group();
    servoRoot.position.set(3.15, 0.65, -1.25);

    const servoMountBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.44, 0.45, 12),
      this.tungstenMaterial
    );
    servoMountBase.rotation.z = Math.PI * 0.5;
    servoMountBase.castShadow = true;
    servoRoot.add(servoMountBase);

    // Indexing ratchet wheel engaged by the servo caliper
    this.servoRatchetWheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.62, 0.14, 12),
      this.copperMaterial
    );
    this.servoRatchetWheel.rotation.x = Math.PI * 0.5;
    this.servoRatchetWheel.position.set(-1.32, -0.35, 0.15);
    this.servoRatchetWheel.castShadow = true;
    servoRoot.add(this.servoRatchetWheel);

    this.servoShoulderPivot = new THREE.Group();
    const upperArm = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.22, 0.22),
      this.titaniumMaterial
    );
    upperArm.position.set(-0.52, 0, 0);
    upperArm.castShadow = true;
    this.servoShoulderPivot.add(upperArm);

    const shoulderJoint = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.28, 16),
      this.copperMaterial
    );
    shoulderJoint.rotation.x = Math.PI * 0.5;
    this.servoShoulderPivot.add(shoulderJoint);

    this.servoElbowPivot = new THREE.Group();
    this.servoElbowPivot.position.set(-1.02, 0, 0.08);
    const elbowJoint = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.26, 16),
      this.copperMaterial
    );
    elbowJoint.rotation.x = Math.PI * 0.5;
    this.servoElbowPivot.add(elbowJoint);

    const forearm = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.78, 0.18),
      this.titaniumMaterial
    );
    forearm.position.set(0, -0.38, 0);
    forearm.castShadow = true;
    this.servoElbowPivot.add(forearm);

    this.servoClawPivot = new THREE.Group();
    this.servoClawPivot.position.set(0, -0.76, 0);
    const wristHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.18, 12),
      this.tungstenMaterial
    );
    wristHousing.rotation.x = Math.PI * 0.5;
    this.servoClawPivot.add(wristHousing);
    const caliper = new THREE.Mesh(
      new THREE.TorusGeometry(0.14, 0.036, 10, 20, Math.PI * 1.35),
      this.copperMaterial
    );
    this.servoClawPivot.add(caliper);
    const servoWristLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.058, 12, 12),
      this.servoWristLedMaterial
    );
    servoWristLed.position.set(0, 0.04, 0.11);
    this.servoClawPivot.add(servoWristLed);

    this.servoElbowPivot.add(this.servoClawPivot);
    this.servoShoulderPivot.add(this.servoElbowPivot);
    servoRoot.add(this.servoShoulderPivot);
    scene.add(servoRoot);

    // =========================================================================
    // 5. LOWER ZONE: ELECTROMAGNETIC INDUCTION PENDULUM & STATOR COILS
    // =========================================================================
    const pendWorld = ThreeStage.canvasToWorldXY(
      this.manifest.pendulum.pivot.x,
      this.manifest.pendulum.pivot.y
    );

    this.pendulumPivotWorld.set(pendWorld.x, pendWorld.y, -1.65);
    this.electrodeTipWorld.set(pendWorld.x, pendWorld.y - 7.82, -1.65);
    if (this.arcFlashLight) {
      this.arcFlashLight.position.set(
        this.electrodeTipWorld.x,
        this.electrodeTipWorld.y + 0.04,
        this.electrodeTipWorld.z + 0.17
      );
    }

    this.pendulumPivotGroup = new THREE.Group();
    this.pendulumPivotGroup.position.copy(this.pendulumPivotWorld);

    const bobCenterY = -6.2;

    // Dual-rod titanium suspension yoke
    for (const rx of [-0.14, 0.14]) {
      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.036, 0.036, 5.4, 12),
        this.titaniumMaterial
      );
      rod.position.set(rx, -2.7, 0);
      rod.castShadow = true;
      this.pendulumPivotGroup.add(rod);
    }

    // Copper-wound magnetic induction pendulum bob
    const bobCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.48, 0.48, 1.48, 28),
      this.tungstenMaterial
    );
    bobCore.position.y = bobCenterY;
    bobCore.castShadow = true;
    bobCore.receiveShadow = true;
    this.pendulumPivotGroup.add(bobCore);

    const bobCopperCoil = new THREE.Mesh(
      createInductionCoilGeometry(0.54, 1.24, 11, 0.04),
      this.copperMaterial
    );
    bobCopperCoil.position.y = bobCenterY;
    bobCopperCoil.castShadow = true;
    this.pendulumPivotGroup.add(bobCopperCoil);

    for (const fy of [bobCenterY + 0.72, bobCenterY - 0.72]) {
      const endPlate = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6, 0.6, 0.14, 24),
        this.titaniumMaterial
      );
      endPlate.position.y = fy;
      this.pendulumPivotGroup.add(endPlate);
    }

    const bobGlowRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.57, 0.032, 12, 36),
      this.coolantCoreGlowMaterial
    );
    bobGlowRing.rotation.x = Math.PI * 0.5;
    bobGlowRing.position.y = bobCenterY;
    this.pendulumPivotGroup.add(bobGlowRing);

    const dischargeTip = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.44, 14),
      this.copperMaterial
    );
    dischargeTip.rotation.x = Math.PI;
    dischargeTip.position.y = bobCenterY - 0.98;
    this.pendulumPivotGroup.add(dischargeTip);

    scene.add(this.pendulumPivotGroup);

    // Two flanking electromagnetic stator coils at bottom zone
    for (const sx of [-1.85, 1.85]) {
      const statorGroup = new THREE.Group();
      statorGroup.position.set(sx, pendWorld.y + bobCenterY, -1.65);

      const statorCore = new THREE.Mesh(
        new THREE.BoxGeometry(0.72, 1.48, 0.84),
        this.titaniumMaterial
      );
      statorCore.castShadow = true;
      statorCore.receiveShadow = true;
      statorGroup.add(statorCore);

      const statorCoil = new THREE.Mesh(
        createInductionCoilGeometry(0.46, 1.15, 9, 0.036),
        this.copperMaterial
      );
      statorCoil.rotation.z = sx < 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
      statorCoil.position.x = sx < 0 ? 0.28 : -0.28;
      statorCoil.castShadow = true;
      statorGroup.add(statorCoil);

      const statorAccent = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 1.0, 0.14),
        this.coolantCoreGlowMaterial
      );
      statorAccent.position.set(sx < 0 ? 0.42 : -0.42, 0, 0.42);
      statorGroup.add(statorAccent);

      scene.add(statorGroup);
    }

    // Curved 3D Brushed-Titanium Stator Anvil matched to pendulum swing arc + copper busbars + central tungsten electrode
    const statorAnvilGroup = new THREE.Group();
    statorAnvilGroup.position.copy(this.pendulumPivotWorld);

    const anvilRadius = 8.12;
    const anvilSpanRad = THREE.MathUtils.degToRad(32);
    const anvilStartAngle = -Math.PI * 0.5 - anvilSpanRad * 0.5;

    const anvilRail = new THREE.Mesh(
      new THREE.TorusGeometry(anvilRadius, 0.14, 16, 40, anvilSpanRad),
      this.titaniumMaterial
    );
    anvilRail.rotation.z = anvilStartAngle;
    anvilRail.castShadow = true;
    anvilRail.receiveShadow = true;
    statorAnvilGroup.add(anvilRail);

    const anvilLowerFlange = new THREE.Mesh(
      new THREE.TorusGeometry(anvilRadius + 0.18, 0.075, 12, 36, anvilSpanRad + 0.04),
      this.tungstenMaterial
    );
    anvilLowerFlange.rotation.z = anvilStartAngle - 0.02;
    anvilLowerFlange.castShadow = true;
    anvilLowerFlange.receiveShadow = true;
    statorAnvilGroup.add(anvilLowerFlange);

    // Machined titanium radial stiffening ribs along the curved anvil
    const anvilRibGeo = new THREE.BoxGeometry(0.18, 0.44, 0.42);
    for (const deg of [-14, -7, 0, 7, 14]) {
      const a = THREE.MathUtils.degToRad(deg);
      const rib = new THREE.Mesh(anvilRibGeo, this.titaniumMaterial);
      rib.position.set(Math.sin(a) * (anvilRadius + 0.06), -Math.cos(a) * (anvilRadius + 0.06), 0);
      rib.rotation.z = a;
      rib.castShadow = true;
      rib.receiveShadow = true;
      statorAnvilGroup.add(rib);
    }

    // Two aged-copper busbar terminals anchoring the stator anvil to the rear bulkhead (z = -4.2)
    const anvilBusbarGeo = new THREE.BoxGeometry(0.24, 0.34, 2.55);
    const anvilCollarGeo = new THREE.BoxGeometry(0.36, 0.44, 0.38);
    const busbarHexGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 6);
    busbarHexGeo.rotateX(Math.PI * 0.5);

    for (const termDeg of [-12, 12]) {
      const ta = THREE.MathUtils.degToRad(termDeg);
      const tx = Math.sin(ta) * anvilRadius;
      const ty = -Math.cos(ta) * anvilRadius;

      const busbar = new THREE.Mesh(anvilBusbarGeo, this.copperMaterial);
      busbar.position.set(tx, ty, -1.275);
      busbar.rotation.z = ta;
      busbar.castShadow = true;
      busbar.receiveShadow = true;
      statorAnvilGroup.add(busbar);

      const collar = new THREE.Mesh(anvilCollarGeo, this.tungstenMaterial);
      collar.position.set(tx, ty, 0);
      collar.rotation.z = ta;
      collar.castShadow = true;
      statorAnvilGroup.add(collar);

      const frontStud = new THREE.Mesh(busbarHexGeo, this.copperMaterial);
      frontStud.position.set(tx, ty, 0.24);
      statorAnvilGroup.add(frontStud);
    }

    // Central tungsten discharge electrode directly below bottom dead center (top apex at local y = -7.82)
    const electrodeBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 0.36, 18),
      this.tungstenMaterial
    );
    electrodeBase.position.set(0, -8.04, 0);
    electrodeBase.castShadow = true;
    electrodeBase.receiveShadow = true;
    statorAnvilGroup.add(electrodeBase);

    const electrodeCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.1, 18),
      this.copperMaterial
    );
    electrodeCollar.position.set(0, -7.94, 0);
    electrodeCollar.castShadow = true;
    statorAnvilGroup.add(electrodeCollar);

    const electrodeTip = new THREE.Mesh(
      new THREE.ConeGeometry(0.085, 0.28, 18),
      this.tungstenMaterial
    );
    electrodeTip.position.set(0, -7.96, 0);
    electrodeTip.castShadow = true;
    statorAnvilGroup.add(electrodeTip);

    const centerMountStrut = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.28, 2.55),
      this.titaniumMaterial
    );
    centerMountStrut.position.set(0, -8.12, -1.275);
    centerMountStrut.castShadow = true;
    centerMountStrut.receiveShadow = true;
    statorAnvilGroup.add(centerMountStrut);

    scene.add(statorAnvilGroup);

    // Dynamic procedural air-gap plasma arc spanning pendulum tip <-> central tungsten electrode
    this.arcFlashGroup = new THREE.Group();
    this.arcCoreGeometry = createDynamicArcBoltGeometry(ARC_SEGMENTS, ARC_RADIAL_SIDES);
    this.arcHaloGeometry = createDynamicArcBoltGeometry(ARC_SEGMENTS, ARC_RADIAL_SIDES);

    const arcCoreMesh = new THREE.Mesh(this.arcCoreGeometry, this.arcFlashMaterial);
    arcCoreMesh.frustumCulled = false;
    this.arcFlashGroup.add(arcCoreMesh);

    const arcHaloMesh = new THREE.Mesh(this.arcHaloGeometry, this.arcHaloMaterial);
    arcHaloMesh.frustumCulled = false;
    this.arcFlashGroup.add(arcHaloMesh);

    this.arcFlashGroup.visible = false;
    scene.add(this.arcFlashGroup);

    stage.registerObjectTree(scene);
  }

  private getModeTargets(mode: ClockMode): {
    coreColor: THREE.Color;
    rimColor: THREE.Color;
    coreIntensity: number;
    indexIntensity: number;
    coolantIntensity: number;
    secondIntensity: number;
    rimLightIntensity: number;
    servoRimLightIntensity: number;
    coreLightIntensity: number;
    exposure: number;
    envIntensity: number;
    bloomStrength: number;
  } {
    if (mode === 'night') {
      return {
        coreColor: COLOR_NIGHT_CRIMSON,
        rimColor: COLOR_NIGHT_RIM,
        coreIntensity: 1.08,
        indexIntensity: 0.75,
        coolantIntensity: 0.65,
        secondIntensity: 0.85,
        rimLightIntensity: 24.0,
        servoRimLightIntensity: 10.0,
        coreLightIntensity: 6.5,
        exposure: 0.68,
        envIntensity: 0.46,
        bloomStrength: 0.22
      };
    }
    if (mode === 'sleep') {
      return {
        coreColor: COLOR_SLEEP_EMBER,
        rimColor: COLOR_SLEEP_EMBER,
        coreIntensity: 0.04,
        indexIntensity: 0.04,
        coolantIntensity: 0.0,
        secondIntensity: 0.04,
        rimLightIntensity: 3.0,
        servoRimLightIntensity: 0.8,
        coreLightIntensity: 0.2,
        exposure: 0.26,
        envIntensity: 0.14,
        bloomStrength: 0.08
      };
    }
    // 'active' or 'silent'
    return {
      coreColor: COLOR_ACTIVE_CYAN,
      rimColor: COLOR_ACTIVE_RIM,
      coreIntensity: 2.0,
      indexIntensity: 2.15,
      coolantIntensity: 1.95,
      secondIntensity: 2.25,
      rimLightIntensity: 88.0,
      servoRimLightIntensity: 36.0,
      coreLightIntensity: 16.0,
      exposure: 0.96,
      envIntensity: 0.92,
      bloomStrength: 0.3
    };
  }

  private applyModeTargets(immediate: boolean, lerpAlpha = 1.0): void {
    const targets = this.getModeTargets(this.targetMode);
    const a = immediate ? 1.0 : Math.max(0, Math.min(1, lerpAlpha));

    this.currentCoreColor.lerp(targets.coreColor, a);
    this.currentRimColor.lerp(targets.rimColor, a);
    this.currentCoreIntensity = THREE.MathUtils.lerp(this.currentCoreIntensity, targets.coreIntensity, a);
    this.currentIndexIntensity = THREE.MathUtils.lerp(this.currentIndexIntensity, targets.indexIntensity, a);
    this.currentCoolantIntensity = THREE.MathUtils.lerp(
      this.currentCoolantIntensity,
      targets.coolantIntensity,
      a
    );
    this.currentSecondIntensity = THREE.MathUtils.lerp(
      this.currentSecondIntensity,
      targets.secondIntensity,
      a
    );
    this.currentRimLightIntensity = THREE.MathUtils.lerp(
      this.currentRimLightIntensity,
      targets.rimLightIntensity,
      a
    );
    this.currentServoRimLightIntensity = THREE.MathUtils.lerp(
      this.currentServoRimLightIntensity,
      targets.servoRimLightIntensity,
      a
    );
    this.currentCoreLightIntensity = THREE.MathUtils.lerp(
      this.currentCoreLightIntensity,
      targets.coreLightIntensity,
      a
    );
    this.currentExposure = THREE.MathUtils.lerp(this.currentExposure, targets.exposure, a);
    this.currentEnvIntensity = THREE.MathUtils.lerp(this.currentEnvIntensity, targets.envIntensity, a);
    this.currentBloomStrength = THREE.MathUtils.lerp(this.currentBloomStrength, targets.bloomStrength, a);

    const pulseExtra = this.targetMode === 'sleep' ? 0 : this.alertPulseBoost;

    if (this.plasmaCoreMaterial) {
      this.plasmaCoreMaterial.uniforms.uCoreColor.value.copy(this.currentCoreColor);
      this.plasmaCoreMaterial.uniforms.uRimColor.value.copy(this.currentRimColor);
      this.plasmaCoreMaterial.uniforms.uEmissiveIntensity.value =
        this.currentCoreIntensity + pulseExtra * 0.9;
    }
    if (this.indexGlowMaterial) {
      this.indexGlowMaterial.emissive.copy(this.currentCoreColor);
      this.indexGlowMaterial.emissiveIntensity = this.currentIndexIntensity + pulseExtra * 0.45;
    }
    if (this.handTipGlowMaterial) {
      this.handTipGlowMaterial.emissive.copy(this.currentCoreColor);
      this.handTipGlowMaterial.emissiveIntensity = this.currentIndexIntensity;
    }
    if (this.secondHandGlowMaterial) {
      this.secondHandGlowMaterial.emissive.copy(this.currentRimColor);
      this.secondHandGlowMaterial.emissiveIntensity = this.currentSecondIntensity;
    }
    if (this.coolantCoreGlowMaterial) {
      this.coolantCoreGlowMaterial.emissive.copy(this.currentCoreColor);
      this.coolantCoreGlowMaterial.emissiveIntensity = this.currentCoolantIntensity;
    }
    if (this.coolantParticleMaterial) {
      this.coolantParticleMaterial.uniforms.uColor.value.copy(this.currentCoreColor);
      this.coolantParticleMaterial.uniforms.uIntensity.value = this.currentCoolantIntensity;
      this.coolantParticleMaterial.uniforms.uOpacity.value =
        this.targetMode === 'sleep' ? 0.0 : this.targetMode === 'night' ? 0.45 : 0.85;
    }

    if (this.overheadRimSpot) {
      this.overheadRimSpot.intensity = this.currentRimLightIntensity;
      this.overheadRimSpot.color.copy(this.currentRimColor).lerp(new THREE.Color(0xffffff), 0.35);
    }
    if (this.grazingCyanRimSpot) {
      this.grazingCyanRimSpot.intensity = this.currentRimLightIntensity * 0.62;
      this.grazingCyanRimSpot.color.copy(this.currentCoreColor);
    }
    if (this.servoArmRimSpot) {
      this.servoArmRimSpot.intensity = this.currentServoRimLightIntensity;
    }
    if (this.coreGlowLight) {
      this.coreGlowLight.intensity = this.currentCoreLightIntensity + pulseExtra * 4.0;
      this.coreGlowLight.color.copy(this.currentCoreColor);
    }
    if (this.ambientLight) {
      this.ambientLight.intensity =
        this.targetMode === 'sleep' ? 0.04 : this.targetMode === 'night' ? 0.1 : 0.24;
    }

    if (this.stage) {
      this.stage.setBloomParameters({
        threshold: 1.45,
        strength: this.currentBloomStrength,
        radius: 0.42
      });
      this.stage.setToneMappingExposure(this.currentExposure);
      this.stage.setEnvironmentIntensity(this.currentEnvIntensity);
    }
  }

  public renderPendulum(_ctx: CanvasRenderingContext2D, physicsData: PhysicsData): void {
    if (!this.isMounted || !this.stage) return;

    if (this.targetMode === 'sleep') {
      this.brakeFactor = Math.min(this.brakeFactor * 0.88, physicsData.dampingFactor);
      if (this.brakeFactor < 0.002) this.brakeFactor = 0;
    } else {
      this.brakeFactor = physicsData.dampingFactor;
    }

    const dampedAngleRad = physicsData.angleRad * this.brakeFactor;
    this.lastPhysicsAngleRad = dampedAngleRad;

    if (this.pendulumPivotGroup) {
      this.pendulumPivotGroup.rotation.z = dampedAngleRad;
    }

    // Trigger dynamic plasma arc across air gap within +/-4 deg of bottom dead center
    const curDeg = physicsData.angleDeg * this.brakeFactor;
    const crossedZero =
      this.prevPendulumAngleDeg !== null &&
      ((this.prevPendulumAngleDeg < 0 && curDeg >= 0) ||
        (this.prevPendulumAngleDeg > 0 && curDeg <= 0));
    const withinFourDeg = Math.abs(curDeg) <= 4.0;

    if (this.targetMode !== 'sleep' && this.brakeFactor > 0.1 && (withinFourDeg || crossedZero)) {
      const windowProfile = Math.max(0, 1 - Math.pow(Math.min(4.0, Math.abs(curDeg)) / 4.0, 2));
      this.arcFlashIntensity = Math.max(this.arcFlashIntensity, 0.72 + 0.28 * windowProfile);
    }
    this.prevPendulumAngleDeg = curDeg;

    if (this.overheadRimSpot) {
      const base = this.currentRimLightIntensity;
      this.overheadRimSpot.intensity = physicsData.dimmed ? base * 0.35 : base;
    }
  }

  public renderDial(_ctx: CanvasRenderingContext2D, timeData: TimeData): void {
    if (!this.isMounted || !this.stage) return;

    const dtSec = Math.max(0.001, Math.min(0.25, timeData.deltaTimeSec || 0.016));
    if (this.targetMode === 'sleep') {
      this.brakeFactor = Math.max(0, this.brakeFactor - dtSec * 0.85);
      if (this.pendulumPivotGroup) {
        this.pendulumPivotGroup.rotation.z = this.lastPhysicsAngleRad * this.brakeFactor;
      }
      if (this.brakeFactor <= 0.002) {
        this.brakeFactor = 0;
        if (this.pendulumPivotGroup) this.pendulumPivotGroup.rotation.z = 0;
      }
    } else if (this.brakeFactor < 1.0) {
      this.brakeFactor = Math.min(1.0, this.brakeFactor + dtSec * 0.65);
    }

    // Smooth mode color & intensity interpolation
    const modeLerp = 1 - Math.exp(-dtSec * 4.5);
    this.applyModeTargets(false, modeLerp);

    // 0. Subtle Breathing Parallax Camera
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
    this.stage.camera.position.set(
      Math.sin(swayRadX) * camDist,
      Math.sin(swayRadY) * camDist,
      Math.cos(swayRadX) * Math.cos(swayRadY) * camDist
    );
    this.stage.camera.lookAt(0, 0.15, -1.65);

    // 1. Synchronized Clock Hands
    if (this.hourHandPivot) this.hourHandPivot.rotation.z = -THREE.MathUtils.degToRad(timeData.angles.hour);
    if (this.minuteHandPivot) this.minuteHandPivot.rotation.z = -THREE.MathUtils.degToRad(timeData.angles.minute);
    if (this.secondHandPivot) this.secondHandPivot.rotation.z = -THREE.MathUtils.degToRad(timeData.angles.second);

    // 2. Plasma Core Shader & Counter-Rotating Containment Gimbal Rings
    const simDeltaSec =
      this.lastTickTimestampMs !== null
        ? Math.max(0, (timeData.timestampMs - this.lastTickTimestampMs) / 1000)
        : dtSec;
    this.lastTickTimestampMs = timeData.timestampMs;

    this.reactorPhaseSec += simDeltaSec * this.brakeFactor;
    const tSec = this.reactorPhaseSec;

    if (this.plasmaCoreMaterial) {
      this.plasmaCoreMaterial.uniforms.uTime.value = tSec;
    }

    if (this.gimbalOuterGroup && this.gimbalMidGroup && this.gimbalInnerGroup) {
      if (this.targetMode === 'sleep') {
        // Magnetic shutdown: smoothly lock gimbal rings back to zero orientation
        const lockAlpha = 1 - Math.exp(-dtSec * 5.0);
        this.gimbalOuterGroup.rotation.z = THREE.MathUtils.lerp(
          wrapSignedAngle(this.gimbalOuterGroup.rotation.z),
          0,
          lockAlpha
        );
        this.gimbalMidGroup.rotation.x = THREE.MathUtils.lerp(
          wrapSignedAngle(this.gimbalMidGroup.rotation.x),
          0,
          lockAlpha
        );
        this.gimbalInnerGroup.rotation.y = THREE.MathUtils.lerp(
          wrapSignedAngle(this.gimbalInnerGroup.rotation.y),
          0,
          lockAlpha
        );
        if (this.brakeFactor <= 0.01) {
          this.gimbalOuterGroup.rotation.z = 0;
          this.gimbalMidGroup.rotation.x = 0;
          this.gimbalInnerGroup.rotation.y = 0;
        }
      } else {
        this.gimbalOuterGroup.rotation.z = -((tSec / 18) * Math.PI * 2);
        this.gimbalMidGroup.rotation.x = (tSec / 11) * Math.PI * 2;
        this.gimbalInnerGroup.rotation.y = -((tSec / 7.5) * Math.PI * 2);
      }
    }

    // 3. Mid Zone: Rising Coolant Particles
    if (this.coolantParticleMaterial) {
      this.coolantParticleMaterial.uniforms.uTime.value = tSec;
    }
    const updateParticleColumn = (pts: THREE.Points | null) => {
      if (!pts || !this.coolantParticleSpeeds || this.brakeFactor <= 0.01) return;
      const posAttr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      for (let i = 0; i < posAttr.count; i++) {
        arr[i * 3 + 1] += this.coolantParticleSpeeds[i] * dtSec * this.brakeFactor;
        if (arr[i * 3 + 1] > 4.85) {
          arr[i * 3 + 1] = -4.15;
        }
      }
      posAttr.needsUpdate = true;
    };
    updateParticleColumn(this.leftCoolantParticles);
    updateParticleColumn(this.rightCoolantParticles);

    // 4. Mid Zone: Multi-Axis Servo Escapement Arm (1 Hz pulse synced to seconds)
    if (timeData.seconds !== this.lastServoSecond && this.targetMode !== 'sleep') {
      this.lastServoSecond = timeData.seconds;
      this.servoPulseProgress = 1.0;
      this.servoStepCount += 1;
    } else if (this.servoPulseProgress > 0) {
      this.servoPulseProgress = Math.max(0, this.servoPulseProgress - dtSec * 4.5);
    }

    const pulseEnvelope = Math.sin(this.servoPulseProgress * Math.PI * 0.5) * this.brakeFactor;
    if (this.servoShoulderPivot) {
      this.servoShoulderPivot.rotation.z = pulseEnvelope * 0.24;
    }
    if (this.servoElbowPivot) {
      this.servoElbowPivot.rotation.z = -pulseEnvelope * 0.36;
    }
    if (this.servoClawPivot) {
      this.servoClawPivot.rotation.x = pulseEnvelope * 0.42;
    }
    if (this.servoWristLedMaterial) {
      if (this.targetMode === 'sleep') {
        this.servoWristLedMaterial.emissiveIntensity = 0;
      } else {
        const modeScale = this.targetMode === 'night' ? 0.45 : 1.0;
        const standbyAmber = new THREE.Color(0xff9218);
        const tickCyan = this.targetMode === 'night' ? COLOR_NIGHT_CRIMSON : COLOR_ACTIVE_CYAN;
        this.servoWristLedMaterial.emissive.copy(standbyAmber).lerp(tickCyan, pulseEnvelope);
        this.servoWristLedMaterial.emissiveIntensity = (0.9 + pulseEnvelope * 1.75) * modeScale;
      }
    }
    if (this.servoRatchetWheel) {
      const targetWheelAngle = -(this.servoStepCount * ((Math.PI * 2) / 12));
      this.servoRatchetWheel.rotation.y = THREE.MathUtils.lerp(
        this.servoRatchetWheel.rotation.y,
        targetWheelAngle,
        Math.min(1, dtSec * 14.0)
      );
    }

    // 5. Lower Zone: Dynamic Air-Gap Plasma Arc & Under-Bob Point Light Pulse
    if (this.targetMode === 'sleep') {
      this.arcFlashIntensity =
        this.arcFlashIntensity > 0.005 ? this.arcFlashIntensity * Math.exp(-dtSec * 6.0) : 0;
    } else {
      const curAngleDeg = Math.abs(THREE.MathUtils.radToDeg(this.pendulumPivotGroup?.rotation.z ?? 0));
      const inArcZone = this.brakeFactor > 0.1 && curAngleDeg <= 4.0;
      if (!inArcZone) {
        const afterglowFloor = 0.08 * this.brakeFactor;
        const decayAlpha = 1 - Math.exp(-dtSec * 2.4);
        this.arcFlashIntensity = THREE.MathUtils.lerp(
          this.arcFlashIntensity,
          afterglowFloor,
          decayAlpha
        );
      }
    }
    const arcActive = this.targetMode !== 'sleep' && this.arcFlashIntensity > 0.01;
    if (this.arcFlashGroup) {
      this.arcFlashGroup.visible = arcActive;
      if (arcActive) {
        const theta = this.pendulumPivotGroup?.rotation.z ?? 0;
        const startX = this.pendulumPivotWorld.x + PENDULUM_TIP_RADIUS * Math.sin(theta);
        const startY = this.pendulumPivotWorld.y - PENDULUM_TIP_RADIUS * Math.cos(theta);
        const startZ = this.pendulumPivotWorld.z;
        const endX = this.electrodeTipWorld.x;
        const endY = this.electrodeTipWorld.y;
        const endZ = this.electrodeTipWorld.z;
        const phase = tSec * 65.0;
        const jitter = 0.065 + this.arcFlashIntensity * 0.055;

        if (this.arcCoreGeometry) {
          updateDynamicArcBoltGeometry(
            this.arcCoreGeometry,
            startX,
            startY,
            startZ,
            endX,
            endY,
            endZ,
            0.024,
            ARC_SEGMENTS,
            ARC_RADIAL_SIDES,
            phase,
            0.0,
            jitter
          );
        }
        if (this.arcHaloGeometry) {
          updateDynamicArcBoltGeometry(
            this.arcHaloGeometry,
            startX,
            startY,
            startZ,
            endX,
            endY,
            endZ,
            0.052,
            ARC_SEGMENTS,
            ARC_RADIAL_SIDES,
            -phase * 1.13,
            3.7,
            jitter * 1.35
          );
        }
      }
    }
    if (this.arcFlashMaterial) {
      this.arcFlashMaterial.opacity = arcActive ? Math.min(1, this.arcFlashIntensity * 0.96) : 0.0;
      const col = this.currentCoreColor;
      this.arcFlashMaterial.color.setRGB(col.r * 3.4, col.g * 3.4, col.b * 3.4);
    }
    if (this.arcHaloMaterial) {
      this.arcHaloMaterial.opacity = arcActive ? Math.min(0.68, this.arcFlashIntensity * 0.58) : 0.0;
      const col = this.currentCoreColor;
      this.arcHaloMaterial.color.setRGB(col.r * 2.1, col.g * 2.1, col.b * 2.1);
    }
    if (this.arcFlashLight) {
      const crackle = this.arcFlashIntensity > 0.25 ? 0.88 + 0.12 * Math.sin(tSec * 90.0) : 1.0;
      this.arcFlashLight.intensity = arcActive ? this.arcFlashIntensity * 34.0 * crackle : 0.0;
      this.arcFlashLight.color.copy(this.currentCoreColor);
    }

    if (this.alertPulseBoost > 0) {
      this.alertPulseBoost = Math.max(0, this.alertPulseBoost - dtSec * 1.5);
    }

    if (this.targetMode === 'sleep' && this.brakeFactor <= 0.001) {
      this.currentMode = 'sleep';
      if (timeData.realTimeMs - this.lastSleepRenderTimeMs < 950) {
        return;
      }
      this.lastSleepRenderTimeMs = timeData.realTimeMs;
    } else {
      this.currentMode = this.targetMode;
    }

    this.stage.render();
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, telemetryData: TelemetryData): void {
    if (!this.isMounted) return;

    if (telemetryData.mode && telemetryData.mode !== this.targetMode) {
      this.targetMode = telemetryData.mode;
    }

    if (telemetryData.isSleeping) {
      return;
    }

    ctx.save();
    ctx.fillStyle = 'rgba(8, 12, 18, 0.82)';
    ctx.strokeStyle =
      this.targetMode === 'night' ? 'rgba(255, 30, 56, 0.45)' : 'rgba(0, 229, 255, 0.42)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(270, 1840, 540, 38, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = '600 13px "Consolas", "Courier New", monospace';
    ctx.fillStyle = this.targetMode === 'night' ? '#ff6b7f' : '#7ef4ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const wsStatusText = telemetryData.wsStatus === 'connected' ? 'REACTOR-SYNC' : 'ISOLATED';
    ctx.fillText(
      `CHRONO-CONTAINMENT REACTOR  •  ${this.targetMode.toUpperCase()}  •  ${wsStatusText}  •  ${telemetryData.fps.toFixed(0)} FPS`,
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
        this.targetMode = nextMode;
        this.currentMode = nextMode;
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
    this.overheadRimSpot = null;
    this.grazingCyanRimSpot = null;
    this.servoArmRimSpot = null;
    this.coreGlowLight = null;
    this.arcFlashLight = null;
    this.titaniumMaterial = null;
    this.copperMaterial = null;
    this.tungstenMaterial = null;
    this.plasmaCoreMaterial = null;
    this.indexGlowMaterial = null;
    this.handTipGlowMaterial = null;
    this.secondHandGlowMaterial = null;
    this.coolantCoreGlowMaterial = null;
    this.coolantParticleMaterial = null;
    this.servoWristLedMaterial = null;
    this.arcFlashMaterial = null;
    this.arcHaloMaterial = null;
    this.plasmaCoreGroup = null;
    this.gimbalOuterGroup = null;
    this.gimbalMidTiltGroup = null;
    this.gimbalMidGroup = null;
    this.gimbalInnerTiltGroup = null;
    this.gimbalInnerGroup = null;
    this.hourHandPivot = null;
    this.minuteHandPivot = null;
    this.secondHandPivot = null;
    this.leftCoolantParticles = null;
    this.rightCoolantParticles = null;
    this.coolantParticleSpeeds = null;
    this.servoShoulderPivot = null;
    this.servoElbowPivot = null;
    this.servoClawPivot = null;
    this.servoRatchetWheel = null;
    this.pendulumPivotGroup = null;
    this.arcFlashGroup = null;
    this.arcCoreGeometry = null;
    this.arcHaloGeometry = null;
  }
}
